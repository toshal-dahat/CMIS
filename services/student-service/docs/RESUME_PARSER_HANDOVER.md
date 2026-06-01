# Resume Parser (30 SP) - Handover

## High-Level System Architecture

The Resume Parser is an asynchronous backend pipeline that starts from an S3 PDF upload and ends with normalized extracted JSON persisted in DynamoDB.

1. Frontend requests a presigned upload URL from Student Service.
2. Frontend uploads PDF directly to S3 (`resumes/USER#<sub>/<resumeId>.pdf`).
3. S3 `ObjectCreated` event triggers `resumeExtraction.onS3Upload`.
4. Extraction Lambda runs:
   - AWS Textract OCR (`DetectDocumentText`) for raw text extraction.
   - AWS Bedrock LLM inference (model from `RESUME_PARSER_MODEL_ID`) for structured JSON extraction.
   - Normalization/validation to a strict shape.
5. Student Service updates `Resumes` table status and extracted payload:
   - `UPLOADING` -> `UPLOADED` -> `EXTRACTED` or `EXTRACTION_FAILED`.
6. Best-effort profile merge updates `StudentProfiles` with extracted GPA/education/skills (skills resolved to canonical keys).

### Core Data Contracts

- `Resumes.status` lifecycle:
  - `UPLOADING`: presigned URL issued, upload not confirmed/processed yet.
  - `UPLOADED`: PDF exists in S3 and ready/in-progress for extraction.
  - `EXTRACTED`: extraction completed, `extractedData` present.
  - `EXTRACTION_FAILED`: extraction failed, `extractionError` set.
- `Resumes.extractedData` (normalized):
  - `skills: string[]`
  - `gpa: number | null`
  - `location: string | null`
  - `education: { institution, degree, field, dates, details, gpa }[]`
  - `experience: { company, title, dates, highlights: string[] }[]`
  - `projects: { name, description, dates, technologies: string[] }[]`
  - `achievements: string[]`

### Profile Education Merge Semantics (Important)

When extraction is merged into `StudentProfiles`, education rows are merged by fingerprint:

- identity fingerprint: `institution|degree|field` (normalized text)
- if fingerprint matches an existing row: extracted row overwrites that row (latest resume wins)
- if fingerprint does not match: extracted row is appended
- duplicate rows for the same fingerprint are collapsed during merge

Implementation owner:
- `src/services/studentProfilesService.js` -> `educationFingerprint()`, `mergeExtractionIntoProfile()`

## Runtime Components and Ownership

- Handler: `src/handlers/resumeExtraction.js`
  - S3 event entrypoint, OCR + LLM orchestration, normalization, persistence.
- Handler: `src/handlers/resumes.js`
  - Client-facing API endpoints for upload/list/download/status retrieval.
- Service: `src/services/resumesService.js`
  - DynamoDB persistence for resume records and extraction payload.
- Service: `src/services/studentProfilesService.js`
  - Merge extracted GPA/education/skills into profile.
- Service: `src/services/skillResolutionService.js`
  - Maps raw extracted skills to canonical skill keys.
  - If an extracted skill is not in MasterSkills, an LLM classification gate can approve and insert it into MasterSkills (`source: "extracted"`), then include its normalized key in the profile merge.
- Service: `src/services/masterSkillsService.js`
  - Owns MasterSkills table read/write (including insertion of newly approved extracted skills).

## Endpoints (Resume Parser Component)

All routes are exposed under the student API prefix:

- `POST /student/api/resumes/upload-url`
  - Purpose: generate presigned S3 PUT URL and create `UPLOADING` record.
  - Input: `{ fileName: string, contentType: "application/pdf" }`
  - Output: `{ uploadUrl, resumeId, s3Key, expiresInSeconds }`

- `POST /student/api/resumes/complete`
  - Purpose: confirm uploaded object and move record to `UPLOADED`.
  - Input: `{ resumeId: string }`
  - Output: `{ resumeId, status: "UPLOADED", s3Key }`

- `GET /student/api/resumes/me`
  - Purpose: list current user resumes with status and extraction metadata.
  - Output: `{ resumes: [...] }`

- `GET /student/api/resumes/{resumeId}/download-url`
  - Purpose: generate temporary presigned S3 GET URL.
  - Output: `{ downloadUrl, expiresInSeconds }`

- `GET /student/api/resumes/{resumeId}/extracted-data`
  - Purpose: return extraction status + payload for UI polling.
  - Output:
    - `EXTRACTED`: includes `extractedData`
    - otherwise: state message and `extractedData: null`

## Example Requests and Responses

### 1) Request Upload URL

Request:

```json
POST /student/api/resumes/upload-url
{
  "fileName": "john_doe_resume.pdf",
  "contentType": "application/pdf"
}
```

Response:

```json
{
  "uploadUrl": "https://...s3.amazonaws.com/resumes/USER#abc/uuid.pdf?...",
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "s3Key": "resumes/USER#abc/0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a.pdf",
  "expiresInSeconds": 120
}
```

### 2) Confirm Upload

Request:

```json
POST /student/api/resumes/complete
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a"
}
```

Response:

```json
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "status": "UPLOADED",
  "s3Key": "resumes/USER#abc/0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a.pdf"
}
```

### 3) Poll Extraction Status

Request:

```json
GET /student/api/resumes/{resumeId}/extracted-data
```

Sample in-progress response:

```json
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "status": "UPLOADED",
  "extractedData": null,
  "message": "Resume uploaded successfully. Extraction is in progress."
}
```

Sample complete response:

```json
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "status": "EXTRACTED",
  "extractedData": {
    "skills": ["Python", "SQL", "Tableau"],
    "gpa": 3.82,
    "location": "College Station, TX",
    "education": [],
    "experience": [],
    "projects": [],
    "achievements": []
  },
  "message": "Resume extracted data fetched successfully."
}
```

## Event Source (Non-HTTP)

- S3 trigger -> Lambda handler `resumeExtraction.onS3Upload`
  - Trigger condition: object-created event for uploaded PDF.
  - Infra mapping: `infrastructure/student/terraform/lambda.tf` (`resumes_extract_on_upload`).

## Environment Variables Required

- `RESUMES_TABLE`
- `STUDENT_PROFILES_TABLE`
- `RESUMES_BUCKET`
- `RESUME_PARSER_MODEL_ID`
- Plus auth/shared env vars used by student service.

## Failure Handling and Recovery Notes

- If OCR/LLM/parse fails, status is set to `EXTRACTION_FAILED` with `extractionError`.
- API consumers should handle intermediate states (`UPLOADING`, `UPLOADED`) and retry.
- Profile merge is best-effort and intentionally non-blocking for extraction completion.

## Troubleshooting Quick Guide

| Symptom | Likely Cause | What to Check / Fix |
|---|---|---|
| Status never leaves `UPLOADED` | S3 trigger not firing or extraction lambda failing early | Verify S3 event notification to `resumes_extract_on_upload`; check CloudWatch logs for `resumeExtraction.onS3Upload` |
| Immediate `EXTRACTION_FAILED` | OCR/LLM parse error or Bedrock permission/model issues | Inspect `extractionError`; confirm IAM permissions and valid `RESUME_PARSER_MODEL_ID` |
| `skills` mostly empty | OCR text quality low or prompt/model drift | Check Textract output volume and update extraction prompt rules |
| New resume skill does not appear in master list | LLM rejected unknown skill or insert failed | Check `skillResolutionService.resolveRawSkillsToKeys` and `masterSkillsService.putExtractedSkill`; confirm `MASTER_SKILLS_TABLE` permissions |
| Profile not updated after extraction | Merge step failed (best-effort) | Look for `[resume-extract] profile merge failed` log and inspect `studentProfilesService.mergeExtractionIntoProfile` |

## Infra Mapping

- API Gateway routes: `infrastructure/student/terraform/apigateway.tf`
  - Resume endpoints bound to dedicated lambdas.
- Lambda declarations: `infrastructure/student/terraform/lambda.tf`
  - `resumes_upload_url`, `resumes_complete`, `resumes_list`, `resumes_download_url`, `resumes_extracted_data`, `resumes_extract_on_upload`.

## Operational Handover Checklist

- Validate IAM permissions for Textract, Bedrock invoke, S3 read, DynamoDB read/write.
- Monitor CloudWatch logs for:
  - `[resume-extract] primary JSON parse failed, retrying`
  - `[resume-extract] profile merge failed`
  - extraction exceptions causing `EXTRACTION_FAILED`.
- Keep Bedrock model ID configurable (no hardcoded vendor lock).
- If extraction schema changes, update:
  - prompt keys in `resumeExtraction.js`
  - normalization logic
  - `resumesService.markExtracted`
  - consumers of `extractedData`.

## AC to Code Map

Acceptance criteria: Lambda triggers on S3 upload -> OCR/LLM processing -> raw JSON returned and DB updated.

- S3 trigger entrypoint:
  - `src/handlers/resumeExtraction.js` -> `onS3Upload(event)`
- OCR + LLM orchestration:
  - `src/handlers/resumeExtraction.js` -> `extractTextFromPdf()`, `runLlmExtraction()`
- JSON normalization:
  - `src/handlers/resumeExtraction.js` -> `normalizeExtraction()`
- Unknown-skill approval + insertion into master list:
  - `src/services/skillResolutionService.js` -> `resolveRawSkillsToKeys()`
  - `src/services/masterSkillsService.js` -> `putExtractedSkill()`
- Resume DB update with extracted payload:
  - `src/services/resumesService.js` -> `markExtracted()`
- Failure state persistence:
  - `src/services/resumesService.js` -> `markExtractionFailed()`
- Status API for clients:
  - `src/handlers/resumes.js` -> `extractedData(event)`
