# Student Identity & Profile Core Handover

This is the core handover document for the Student Identity and Profile system.

## Handover Index

Use this as the entry point, then jump to bounty-specific docs:

- Core foundation: `STUDENT_CORE.md` (this document)
- Bounty 1 - Resume Parser: `RESUME_PARSER.md`
- Bounty 2 - Profile Auto-Fill: `PROFILE_AUTO_FILL.md`
- Bounty 8 + 9 - QR Generator + Scanner: `EVENT_QR_ATTENDANCE_CHECKIN.md`
- Bounty 22 - Email alert 1 hour before event: `EVENT_REMINDER.md`
- Bounty 23 - Engagement Analytics: `STUDENT_ENGAGEMENT_ANALYTICS_CARD.md`
- Frontend - `STUDENT_SERVICE_FRONTEND.md`

## Scope

Covers:
- Google SSO via Cognito (student login path)
- Profile creation and persistence
- Secure resume upload (S3 presigned URL, direct-to-S3)
- Client/server validation rules
- DynamoDB persistence model and key data references

Does not duplicate deeper feature-specific docs for parser/auto-fill/QR/analytics.

## High-Level Architecture

```text
Student UI (Svelte)
  -> Cognito Google federated sign-in
  -> ID token in Authorization: Bearer <token>
  -> Student API (profile + resume endpoints)

Student API (Lambda handlers)
  -> validates token and user claims
  -> writes profile/resume metadata in DynamoDB
  -> generates presigned S3 URLs for resume upload/download

S3 (resume bucket)
  -> receives PDF directly from browser (binary never passes through Lambda)
```

## Cross-Service Dependency: Event Reminders (Event Service Owned)

Student Service does **not** schedule or dispatch event reminder notifications directly, but reminder delivery is dependent on student profile fields owned by this team.

- Owning service for reminders: `services/event-service`
- Reminder scheduler logic: `services/event-service/src/services/reminderService.js`
- Reminder dispatch trigger: EventBridge invokes Event Service Lambda with `action: "SEND_EVENT_REMINDER"`
- Profile fields consumed from StudentProfiles: `reminderOptIn`, `phoneNumber`

Current behavior:

1. Event Service creates one reminder rule per event (scheduled ~1 hour before event start).
2. At trigger time, Event Service queries RSVP attendees and then looks up reminder preference/profile contact data from StudentProfiles.
3. Reminders are sent only to opted-in users (email mode and/or SMS mode depending on Event Service env config).

Operational note for Student team:

- If `reminderOptIn` or `phoneNumber` schema/semantics change in Student Service, Event Service reminder filtering/sending behavior must be reviewed and updated.
- Treat reminder-related profile fields as a cross-service contract, even though implementation lives under Event Service.

## Authentication & Role Assignment (Current Behavior)

### Authentication model

- Backend API auth is Cognito **ID token** validation (`Authorization: Bearer <id_token>`).
- Student sign-in path in frontend is Google SSO via Cognito Hosted UI.
- Non-TAMU path in frontend supports email OTP sign-in/sign-up.

### Login flow by email type

| User email pattern | Frontend auth flow | Default backend group target |
|---|---|---|
| `@tamu.edu` | Google redirect (`signInWithGoogle`) | `students` |
| non-TAMU + company domain (from Companies API) | Email OTP | `investors` |
| non-TAMU + unknown domain | Email OTP | `friends` |
| admin override email | Google/OTP based on email entry path | `admins` (forced by override list) |

### Group assignment logic (backend)

`ensureUserGrouped()` currently resolves target groups using this priority:

1. admin override email list -> `admins`
2. domain `tamu.edu` -> `students`
3. domain found in Companies API -> `investors`
4. fallback -> `friends`

### Role/group sync behavior

- Profile role and Cognito groups are synchronized on login/profile operations.
- Additional transitions are handled for `FORMER_STUDENT`, `ALUMNI`, `FACULTY`, `INVESTOR`, etc.
- Graduation-date logic can move users between `students`, `alumni`, and `friends` depending on profile state.

### Important enforcement nuance

- Domain enforcement exists in shared auth helper (`requireTamuEmail` support), but many current handlers call auth with `requireTamuEmail: false`.
- Practical outcome: endpoints still require a valid Cognito token, but TAMU-domain hard-blocking is not uniformly applied across all routes.

## User Story Mapping

As a student, I can sign in with TAMU Google, fill profile fields, upload a PDF resume securely, and be discoverable via persisted profile + resume reference data.

## Acceptance Criteria Coverage

### 1) Google SSO (Cognito federated login)

- Authentication for student API endpoints is Cognito ID-token based.
- API expects `Authorization: Bearer <cognito_id_token>`.
- Student role/group handling is resolved via Cognito claims and managed group sync.
- Operational policy for students is federated login (no app-local password flow).

Primary files:
- `src/lib/jwt.js` / `src/lib/auth.js` (token verification path)
- `src/handlers/studentProfiles.js` (`requireAuth`, `ensureUserGrouped`)
- `frontend/src/lib/auth.ts` (token retrieval client path)

### 2) Profile form fields

Profile form captures (student path):
- `name`
- `major`
- `classYear` (derived from `gradDate` where used)
- `gradDate`
- `linkedInUrl`

Also captures supporting fields used by current flow (`email`, `degree`, role-related fields).

Primary files:
- `frontend/src/lib/ProfileForm.svelte`
- `frontend/src/lib/api.ts` (`createProfile`, `updateProfile`)

### 3) Resume upload via secure direct upload pattern

Resume upload flow:
1. `POST /student/api/resumes/upload-url` with `{ fileName, contentType }`
2. Browser uploads PDF to S3 presigned `uploadUrl` (HTTP `PUT`)
3. `POST /student/api/resumes/complete` with `{ resumeId }`
4. Backend verifies object and updates metadata/reference fields

Important: PDF binary does not pass through application Lambda.

Primary files:
- `src/handlers/resumes.js`
- `src/services/s3PresignService.js`
- `frontend/src/lib/resumes.ts`
- `frontend/src/lib/ResumeSection.svelte`

### 4) Validation

Client-side:
- max size: 5MB (`PDF_MAX_BYTES = 5 * 1024 * 1024`)
- extension/type restricted to PDF

Server-side:
- `upload-url` enforces `contentType === "application/pdf"`
- `complete` re-validates uploaded object content type includes `pdf`

Primary files:
- `frontend/src/lib/resumes.ts`
- `frontend/src/lib/ResumeSection.svelte`
- `src/handlers/resumes.js`

### 5) Persistence to DynamoDB with S3 key reference

Data persistence:
- Profile row stored in StudentProfiles table
- Resume metadata stored in Resumes table
- Profile stores `resumeS3Key` and `resumeId`

Primary files:
- `src/services/studentProfilesService.js`
- `src/services/resumesService.js`
- `src/handlers/studentProfiles.js`
- `src/handlers/resumes.js`

## Endpoint Inventory (Core System)

All endpoints below are under student API routing in infrastructure:

- `GET /student/api/users/me/profile-exists`
  - check first-time profile flow
- `GET /student/api/profiles/me`
  - fetch current profile
- `POST /student/api/profiles`
  - create profile
- `PUT /student/api/profiles/me`
  - update profile
- `DELETE /student/api/profiles/me`
  - delete profile
- `POST /student/api/resumes/upload-url`
  - get presigned upload URL
- `POST /student/api/resumes/complete`
  - verify uploaded PDF and mark uploaded
- `GET /student/api/resumes/me`
  - list resume metadata
- `GET /student/api/resumes/{resumeId}/download-url`
  - get presigned download URL

## Key Request/Response Examples

### Create profile

```json
POST /student/api/profiles
{
  "name": "Jane Doe",
  "email": "jane@tamu.edu",
  "major": "MIS",
  "gradDate": "2026-05",
  "linkedInUrl": "https://www.linkedin.com/in/janedoe",
  "resumeS3Key": "resumes/USER#sub/uuid.pdf"
}
```

### Get upload URL

```json
POST /student/api/resumes/upload-url
{
  "fileName": "resume.pdf",
  "contentType": "application/pdf"
}
```

```json
{
  "uploadUrl": "https://...s3.amazonaws.com/resumes/USER#sub/uuid.pdf?...",
  "resumeId": "uuid",
  "s3Key": "resumes/USER#sub/uuid.pdf",
  "expiresInSeconds": 120
}
```

### Complete upload

```json
POST /student/api/resumes/complete
{
  "resumeId": "uuid"
}
```

```json
{
  "resumeId": "uuid",
  "status": "UPLOADED",
  "s3Key": "resumes/USER#sub/uuid.pdf"
}
```

## Security and Data Rules

- Backend endpoints require valid Cognito ID token.
- Presigned upload URL is short-lived and object-key scoped by user.
- Browser must not send Authorization header to S3 presigned PUT.
- Resume is single-active per user in current backend behavior (old resume records are removed when new one is requested).

## Troubleshooting Guide

| Symptom | Likely Cause | Check/Fix |
|---|---|---|
| Profile calls return 401 | Missing/expired ID token | verify Cognito token retrieval and Authorization header |
| Upload URL request fails with 400 | invalid `fileName` or `contentType` | ensure non-empty fileName and `application/pdf` |
| Upload succeeds but complete fails | object missing / wrong content type | verify S3 key, PUT content type, then call `/resumes/complete` |
| Profile does not show resume reference | complete step not called or profile update path skipped | verify `/resumes/complete` success and `resumeS3Key` in `/profiles/me` |
| File rejected client-side | >5MB or non-PDF | confirm file size/type constraints in UI |

## Implementation Map (Where to Read First)

- Profile API handlers: `src/handlers/studentProfiles.js`
- Resume API handlers: `src/handlers/resumes.js`
- Profile persistence: `src/services/studentProfilesService.js`
- Resume persistence: `src/services/resumesService.js`
- Presign + S3 operations: `src/services/s3PresignService.js`
- Frontend profile flow: `frontend/src/lib/ProfileForm.svelte`
- Frontend resume flow: `frontend/src/lib/ResumeSection.svelte`, `frontend/src/lib/resumes.ts`

## Recommended Doc Strategy

- Keep this file as the canonical core handover for Point 1.
- `API.md` and `RESUME_UPLOAD.md` are legacy references after this consolidation.
- Treat this document as the main handover source moving forward.

---

## Consolidated API Reference

### Base URL

Current base URL used in docs/examples:

```text
https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com
```

### Authentication

All endpoints require Cognito ID token from Google SSO:

- `Authorization: Bearer <cognito_id_token>`
- `Content-Type: application/json` for `POST`/`PUT`

Token notes:
- use ID token (not access token)
- token must be from configured Cognito pool/client
- refresh when expired

Common auth errors:

```json
{ "error": "UNAUTHORIZED", "message": "Missing or invalid Authorization header" }
```

```json
{ "error": "UNAUTHORIZED", "message": "Invalid or expired token" }
```

### Core Profile Endpoints

#### 1) Check profile exists

- Method: `GET`
- Path: `/student/api/users/me/profile-exists`
- Auth: required
- Response:

```json
{ "exists": true }
```

or

```json
{ "exists": false }
```

#### 2) List profiles (Students Connect)

- Method: `GET`
- Path: `/student/api/profiles`
- Auth: required
- Response shape:

```json
{
  "profiles": [
    {
      "name": "Jane Smith",
      "uin": "987654321",
      "email": "jane.smith@example.com",
      "degree": "BS",
      "major": "Computer Engineering",
      "gradDate": "2026-05",
      "linkedInUrl": "https://linkedin.com/in/janesmith",
      "role": "student"
    }
  ]
}
```

#### 3) Get my profile

- Method: `GET`
- Path: `/student/api/profiles/me`
- Auth: required
- Response includes `resumeS3Key` reference and profile metadata.

#### 4) Create profile

- Method: `POST`
- Path: `/student/api/profiles`
- Auth: required
- Required student fields (current implementation): `name`, `uin`, `major`, `gradDate`
- Other important fields: `email`, `degree`, `linkedInUrl`, `resumeS3Key`, `role`

Mentorship-related validation is also enforced in current implementation for non-admin users.

#### 5) Update my profile

- Method: `PUT`
- Path: `/student/api/profiles/me`
- Auth: required
- Partial update supported.

#### 6) Delete my profile

- Method: `DELETE`
- Path: `/student/api/profiles/me`
- Auth: required
- Response:

```json
{ "deleted": true }
```

### Resume Endpoints

#### 7) Get presigned upload URL

- Method: `POST`
- Path: `/student/api/resumes/upload-url`
- Auth: required
- Request:

```json
{
  "fileName": "resume.pdf",
  "contentType": "application/pdf"
}
```

- Response:

```json
{
  "uploadUrl": "https://...",
  "resumeId": "uuid",
  "s3Key": "resumes/USER#sub/uuid.pdf",
  "expiresInSeconds": 120
}
```

#### 8) Complete resume upload

- Method: `POST`
- Path: `/student/api/resumes/complete`
- Auth: required
- Request:

```json
{ "resumeId": "uuid" }
```

- Response:

```json
{
  "resumeId": "uuid",
  "status": "UPLOADED",
  "s3Key": "resumes/USER#sub/uuid.pdf"
}
```

#### 9) List my resumes

- Method: `GET`
- Path: `/student/api/resumes/me`
- Auth: required
- Response contains array with `resumeId`, `s3Key`, `status`, `fileSize`, timestamps.

#### 10) Get download URL

- Method: `GET`
- Path: `/student/api/resumes/{resumeId}/download-url`
- Auth: required
- Response:

```json
{
  "downloadUrl": "https://...",
  "expiresInSeconds": 300
}
```

### Event QR + Attendance Endpoints

#### 11) Generate signed event QR code (admin)

- Method: `GET`
- Path: `/student/api/events/{eventId}/qr`
- Auth: required (admin group)
- Response includes `signedEventCode` and `qrCodeDataUrl`.

#### 12) Check in attendee (admin scanner)

- Method: `POST`
- Path: `/student/api/events/{eventId}/check-in`
- Auth: required (admin group)
- Body accepts `userId` or `scannedText`.

#### 13) Mobile scanner web app

- Method: `GET`
- Path: `/student/qr-scanner`
- Auth: required

### Common Error Responses

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | BAD_REQUEST | Invalid JSON, fileName, contentType, or resumeId |
| 401 | UNAUTHORIZED | Missing, invalid, or expired token |
| 403 | FORBIDDEN | Authorization failure |
| 404 | NOT_FOUND | Profile/resume/object not found |
| 405 | METHOD_NOT_ALLOWED | HTTP method unsupported for route |
| 500 | INTERNAL_ERROR | Server error |

### API Summary Table

| Method | Path | Description |
|--------|------|-------------|
| GET | `/student/api/users/me/profile-exists` | Check if profile exists |
| GET | `/student/api/profiles` | List student profiles |
| GET | `/student/api/profiles/me` | Get my profile |
| POST | `/student/api/profiles` | Create profile |
| PUT | `/student/api/profiles/me` | Update profile |
| DELETE | `/student/api/profiles/me` | Delete profile |
| POST | `/student/api/resumes/upload-url` | Get presigned upload URL |
| POST | `/student/api/resumes/complete` | Complete resume upload |
| GET | `/student/api/resumes/me` | List my resumes |
| GET | `/student/api/resumes/{resumeId}/download-url` | Get presigned download URL |
| GET | `/student/api/events/{eventId}/qr` | Generate signed event QR |
| POST | `/student/api/events/{eventId}/check-in` | Admin check-in |
| GET | `/student/qr-scanner` | Mobile scanner web page |

---

## Consolidated Resume Upload Workflow

### Core Principle

PDF binary never passes through Lambda; browser uploads directly to S3 via presigned URL.

### Sequence

```text
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

### Frontend integration snippets

Request upload URL:

```javascript
const response = await fetch(`${API_BASE}/student/api/resumes/upload-url`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fileName: file.name,
    contentType: "application/pdf",
  }),
});
```

PUT to S3:

```javascript
await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": "application/pdf" },
  body: file,
});
```

Get download URL:

```javascript
const res = await fetch(
  `${API_BASE}/student/api/resumes/${resumeId}/download-url`,
  { headers: { Authorization: `Bearer ${idToken}` } }
);
```

### curl examples

```bash
curl -X POST "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/upload-url" \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"resume.pdf","contentType":"application/pdf"}'
```

```bash
curl -X PUT "UPLOAD_URL_FROM_STEP_1" \
  -H "Content-Type: application/pdf" \
  -T ./my-resume.pdf
```

```bash
curl -X GET "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/me" \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

```bash
curl -X GET "https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/RESUME_ID/download-url" \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

### Validation and security notes

- Content type restricted to PDF (`application/pdf`)
- Upload URL expiry: 120 seconds
- Download URL expiry: 300 seconds
- S3 key pattern user-scoped: `resumes/USER#<sub>/<resumeId>.pdf`
- Client-side max size enforced: 5MB
