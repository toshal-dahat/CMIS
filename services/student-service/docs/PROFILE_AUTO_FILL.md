# Profile Auto-Fill (15 SP) - Handover

## High-Level System Architecture

Profile Auto-Fill is a frontend-driven flow backed by Student Service extraction/status endpoints.

1. User uploads resume PDF from profile UI.
2. Resume extraction runs asynchronously (S3 -> OCR -> LLM).
3. Frontend checks parsing status through Student Service (`/resumes/{resumeId}/extracted-data`) until complete.
4. On completion, frontend populates profile inputs for user review/edit.
5. Profile save persists approved values to `StudentProfiles`.

### Sequence View (Poll Loop)

1. UI uploads resume and receives `resumeId`.
2. UI calls `GET /student/api/resumes/{resumeId}/extracted-data` on an interval.
3. Backend returns one of:
   - `UPLOADING` / `UPLOADED` with `extractedData: null`
   - `EXTRACTED` with populated `extractedData`
   - `EXTRACTION_FAILED` with error message
4. When `EXTRACTED`, UI maps values into form state (`GPA`, `Skills`, `Education`; `Experience` as review tags if implemented in UI).
5. User reviews/edits and saves profile through `POST/PUT /student/api/profiles...`.

In this codebase, auto-fill data is available from two backend paths:

- Direct extraction payload from `Resumes.extractedData` (`skills`, `gpa`, `experience`, etc.).
- Profile-level merged fields written by backend merge logic (`profileGpa`, `profileEducation`, `profileSkillKeys`) and later fetched via `GET /student/api/profiles/me`.

## Frontend/Backend Responsibilities

- Frontend (`ProfileForm`/`ProfilePanel`) responsibility:
  - poll for parsing completion status.
  - prefill form fields and let user edit before submit.
- Backend responsibility:
  - expose stable status endpoint.
  - return normalized extraction payload.
  - merge selected fields into profile for durable read-back.

## Endpoints (Profile Auto-Fill Component)

- `GET /student/api/resumes/{resumeId}/extracted-data`
  - Purpose: parsing state endpoint for UI polling.
  - States used by UI:
    - `UPLOADING`
    - `UPLOADED` (parsing in progress)
    - `EXTRACTED` (parsing complete, payload available)
    - `EXTRACTION_FAILED`

- `GET /student/api/resumes/me`
  - Purpose: get latest resume metadata/status and chosen `resumeId` to poll.

- `GET /student/api/profiles/me`
  - Purpose: fetch merged profile fields after extraction merge or previous saves.
  - Relevant fields:
    - `profileGpa`
    - `profileEducation`
    - `profileSkillKeys`
    - `resumeS3Key`, `resumeId`

- `PUT /student/api/profiles/me`
  - Purpose: persist user-reviewed auto-filled values.
  - Relevant write fields:
    - `profileGpa`
    - `profileEducation`
    - `profileSkillKeys`

- `POST /student/api/profiles`
  - Purpose: first-time profile creation also accepts auto-filled fields.

- `GET /student/api/skills`
  - Purpose: canonical skills catalog used to render selected skill keys as chips/tags.
  - Note: this list can grow over time from approved unknown skills extracted from resumes.

## Data Mapping for Auto-Fill

- `extractedData.gpa` -> `profileGpa`
- `extractedData.education` -> `profileEducation`
- `extractedData.skills` -> resolved canonical keys -> `profileSkillKeys`
  - if a resume skill is not already in MasterSkills, backend may add it (after LLM validation) and then include the new key.
- `extractedData.experience`:
  - available in extraction payload for UI experience tags/review cards.
  - not currently persisted as a dedicated `StudentProfiles` field in this service.

### Education Fingerprint Merge Rule

Auto-fill consumers should expect backend education merge behavior to be deterministic:

- merge key (fingerprint): `institution|degree|field`
- matching key => overwrite existing entry with latest extracted values
- non-matching key => append as a new education entry
- duplicate keys are deduped during merge

Source implementation:
- `src/services/studentProfilesService.js` -> `educationFingerprint()`, `mergeExtractionIntoProfile()`

## Current Polling Contract

The backend contract needed for polling is stable in `GET /student/api/resumes/{resumeId}/extracted-data`:

- `status === "EXTRACTED"` => `extractedData` object populated.
- all non-terminal statuses => `extractedData: null` with status-specific message.
- `status === "EXTRACTION_FAILED"` => terminal error message.

## Example Requests and Responses

### 1) Polling Endpoint

Request:

```json
GET /student/api/resumes/{resumeId}/extracted-data
```

In-progress response:

```json
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "status": "UPLOADED",
  "extractedData": null,
  "message": "Resume uploaded successfully. Extraction is in progress."
}
```

Ready response:

```json
{
  "resumeId": "0f6c8d13-0d4f-4ccb-a8b7-9be90c7a7f4a",
  "status": "EXTRACTED",
  "extractedData": {
    "skills": ["Python", "AWS", "SQL"],
    "gpa": 3.75,
    "location": "Houston, TX",
    "education": [
      {
        "institution": "Texas A&M University",
        "degree": "B.S.",
        "field": "MIS",
        "dates": "2022 - 2026",
        "details": null,
        "gpa": 3.75
      }
    ],
    "experience": [
      {
        "company": "Example Corp",
        "title": "Intern",
        "dates": "May 2025 - Aug 2025",
        "highlights": ["Built dashboard", "Improved query performance"]
      }
    ],
    "projects": [],
    "achievements": []
  }
}
```

### 2) Persist Reviewed Fields

Request:

```json
PUT /student/api/profiles/me
{
  "profileGpa": 3.75,
  "profileEducation": [
    {
      "institution": "Texas A&M University",
      "degree": "B.S.",
      "field": "MIS",
      "dates": "2022 - 2026",
      "details": null,
      "gpa": 3.75
    }
  ],
  "profileSkillKeys": ["python", "aws", "sql"]
}
```

## Key Implementation Files

- Backend status endpoint: `src/handlers/resumes.js`
- Backend profile merge: `src/services/studentProfilesService.js`
- Profile CRUD API: `src/handlers/studentProfiles.js`
- Frontend resume upload client: `frontend/src/lib/resumes.ts`
- Frontend profile form consumers:
  - `frontend/src/lib/ProfileForm.svelte`
  - `frontend/src/lib/ProfilePanel.svelte`
  - `frontend/src/lib/api.ts`

## Handover Notes for Next Team

- Keep polling interval conservative (for example, 2-5 seconds) and enforce timeout/backoff.
- Treat `EXTRACTION_FAILED` as terminal and provide manual edit path.
- Keep auto-fill non-destructive: never overwrite user in-progress edits silently.
- If adding persisted experience tags:
  - extend `StudentProfiles` schema (`profileExperience`).
  - add write/read support in `studentProfilesService` and API DTOs.
  - update frontend types and form serialization.

## Local Verification Checklist

1. Upload a valid PDF from profile UI.
2. Confirm `GET /student/api/resumes/me` shows latest resume with `UPLOADED` then `EXTRACTED`.
3. Poll `GET /student/api/resumes/{resumeId}/extracted-data` every 2-5 seconds.
4. Verify `EXTRACTED` payload includes expected keys (`skills`, `gpa`, `experience`).
5. Confirm form fields prefill for `GPA`, `Skills`, and education blocks.
6. Save profile and verify persisted values via `GET /student/api/profiles/me`.
7. Negative test: force invalid/empty PDF and confirm UI handles `EXTRACTION_FAILED`.

## Troubleshooting Quick Guide

| Symptom | Likely Cause | What to Check / Fix |
|---|---|---|
| UI keeps showing "parsing in progress" | Polling loop not running or wrong `resumeId` | Ensure polling targets current resume from `/resumes/me` |
| Fields never prefill though status is `EXTRACTED` | UI mapping mismatch | Verify frontend mapping from `extractedData` and fallback to `profileGpa/profileSkillKeys/profileEducation` |
| Skills appear but not canonical tags | Skill resolution mismatch | Check `skillResolutionService.resolveRawSkillsToKeys` and `/student/api/skills` catalog |
| New skill from resume not visible in picker | Unknown skill was not approved/inserted into MasterSkills yet | Validate backend logs for skill resolution and `masterSkillsService.putExtractedSkill` writes |
| User data overwritten unexpectedly | Auto-fill applied after manual edits | Apply non-destructive merge rules in UI state management |

## AC to Code Map

Acceptance criteria: Profile UI polls for "Parsing Complete" and auto-populates `Skills`, `GPA`, and `Experience` tags for user review.

- Polling status endpoint:
  - `src/handlers/resumes.js` -> `extractedData(event)`
- Resume metadata lookup:
  - `src/handlers/resumes.js` -> `list(event)` (`GET /resumes/me`)
- Backend merge to profile (GPA/education/skills):
  - `src/services/studentProfilesService.js` -> `mergeExtractionIntoProfile()`
- Profile read/write APIs used by auto-fill workflow:
  - `src/handlers/studentProfiles.js` -> `crud(event)` (`GET/PUT /profiles/me`, `POST /profiles`)
- Frontend upload + profile hydration points:
  - `frontend/src/lib/resumes.ts`
  - `frontend/src/lib/ProfileForm.svelte`
  - `frontend/src/lib/ProfilePanel.svelte`
  - `frontend/src/lib/api.ts`
