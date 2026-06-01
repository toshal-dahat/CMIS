# Resume Upload via S3 Presigned URL

The PDF file **never passes through Lambda**. The frontend uploads directly to S3 using a presigned URL.

## Flow

```
Frontend                    API (Lambda)                    S3                     Extraction Lambda
   |                             |                           |
   | 1. POST /resumes/upload-url |                           |
   |    { fileName, contentType }|                           |
   |--------------------------->|                           |
   |                             | Create DynamoDB record    |
   |                             | (UPLOADING)               |
   |                             | Generate presigned PUT    |
   |<---------------------------|                           |
   |  { uploadUrl, resumeId }    |                           |
   |                             |                           |
   | 2. PUT uploadUrl (PDF body) |                           |
   |    Content-Type: application/pdf                        |
   |------------------------------------------------------->|
   |                             |                           | 3. ObjectCreated event |
   |                             |                           |----------------------->|
   |                             |                           |                        | OCR + LLM extract
   |                             |                           |                        | Update DynamoDB
```

## Frontend Integration

### Step 1: Request presigned URL

```javascript
const response = await fetch(`${API_BASE}/api/resumes/upload-url`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fileName: file.name, // e.g. "my-resume.pdf"
    contentType: "application/pdf",
  }),
});

const { uploadUrl, resumeId, s3Key, expiresInSeconds } = await response.json();
```

### Step 2: PUT file directly to S3

**Important:** Use `Content-Type: application/pdf` and the raw file body.

```javascript
await fetch(uploadUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "application/pdf",
  },
  body: file, // Blob or File
});
```

### Step 3: Wait for automatic extraction

Once the PDF is uploaded to S3, an S3 event invokes a backend Lambda that:

- runs OCR on the PDF text
- runs LLM extraction
- updates the `Resumes` record with:
  - `status: "EXTRACTED"` (or `"EXTRACTION_FAILED"`)
  - `extractedData: { skills: string[], gpa: number | null }`

### Step 4: Get download URL (when needed)

```javascript
const res = await fetch(
  `${API_BASE}/api/resumes/${resumeId}/download-url`,
  { headers: { Authorization: `Bearer ${idToken}` } }
);
const { downloadUrl, expiresInSeconds } = await res.json();
// Use downloadUrl in window.open() or <a href>
```

## curl Examples

### 1. Get presigned upload URL

```bash
curl -X POST "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/api/resumes/upload-url" \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"resume.pdf","contentType":"application/pdf"}'
```

**Response:**
```json
{
  "uploadUrl": "https://tamu-resumes-dev-xxx.s3.us-east-1.amazonaws.com/resumes/USER%23.../uuid.pdf?X-Amz-...",
  "resumeId": "a1b2c3d4-...",
  "s3Key": "resumes/USER#sub/uuid.pdf",
  "expiresInSeconds": 120
}
```

### 2. PUT file to presigned URL

```bash
curl -X PUT "UPLOAD_URL_FROM_STEP_1" \
  -H "Content-Type: application/pdf" \
  -T ./my-resume.pdf
```

### 3. List my resumes (including extraction result)

```bash
curl -X GET "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/api/resumes/me" \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

### 4. Get download URL

```bash
curl -X GET "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/api/resumes/RESUME_ID/download-url" \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

## Validation & Security

- **TAMU domain:** `upload-url` and `complete` require `@tamu.edu` email and `email_verified`
- **Content-Type:** Only `application/pdf` allowed
- **S3 key:** `resumes/USER#<sub>/<resumeId>.pdf` – scoped by user
- **Expiry:** Upload URL 120s; download URL 300s

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | BAD_REQUEST | Invalid fileName, contentType, or resumeId |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Non-TAMU email or email not verified |
| 404 | NOT_FOUND | Resume record or S3 object not found |
