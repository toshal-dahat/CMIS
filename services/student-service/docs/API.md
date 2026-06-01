# Team Reveille Student Core – API Documentation

## Base URL

Terraform output `api_gateway_url` currently resolves to:

```
https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com
```

This is the base URL used in the examples below.

| Endpoint | Full URL |
|----------|----------|
| Profile Exists | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/users/me/profile-exists` |
| List Profiles (Students Connect) | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles` |
| Profiles (CRUD) | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles` |
| My Profile | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles/me` |
| Resume Upload URL | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/upload-url` |
| Resume Complete | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/complete` |
| My Resumes | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/me` |
| Download URL | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/{resumeId}/download-url` |

---

## Authentication

All endpoints require a valid **Cognito ID token** (from Google SSO) sent in the `Authorization` header.

| Header | Value |
|--------|-------|
| **Authorization** | `Bearer <cognito_id_token>` |
| **Content-Type** | `application/json` (required for POST and PUT) |

### Token Requirements

- Use the **ID token** (not the access token)
- Token must be issued by the configured Cognito User Pool and App Client
- Tokens typically expire after 1 hour; obtain a fresh token after expiry

### Error Responses (401)

| Status | Body |
|--------|------|
| 401 | `{ "error": "UNAUTHORIZED", "message": "Missing or invalid Authorization header" }` |
| 401 | `{ "error": "UNAUTHORIZED", "message": "Invalid or expired token" }` |

---

## Endpoints

### 1. Check Profile Exists (First-Time Sign-In)

Determines whether the authenticated user has a profile. Use for redirect logic after sign-in.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/users/me/profile-exists` |
| **Auth** | Required |
| **Request Body** | None |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
```

#### Sample Request

```http
GET /api/users/me/profile-exists
Authorization: Bearer eyJraWQiOiJxxx...
```

#### Sample Response – 200 OK (Profile Exists)

```json
{
  "exists": true
}
```

#### Sample Response – 200 OK (First-Time User)

```json
{
  "exists": false
}
```

---

### 2. List Student Profiles (Students Connect)

Returns all student profiles except the authenticated user's profile. Use for Students Connect to browse other students.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles` |
| **Auth** | Required |
| **Request Body** | None |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
```

#### Sample Request

```http
GET /api/profiles
Authorization: Bearer eyJraWQiOiJxxx...
```

#### Sample Response – 200 OK

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
    },
    {
      "name": "Alex Chen",
      "uin": "111222333",
      "email": "alex.chen@example.com",
      "degree": "MS",
      "major": "Computer Science",
      "gradDate": "2025-12",
      "linkedInUrl": null,
      "role": "student"
    }
  ]
}
```

---

### 3. Get My Profile

Returns the current user's student profile.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles/me` |
| **Auth** | Required |
| **Request Body** | None |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
```

#### Sample Request

```http
GET /api/profiles/me
Authorization: Bearer eyJraWQiOiJxxx...
```

#### Sample Response – 200 OK

Profile attributes stored in DynamoDB: **Name**, **UIN**, **Email**, **Degree**, **Major**, **Graduation Month-Year**, **LinkedIn URL**, **resume reference**, **Role**.

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "John Doe",
  "uin": "123456789",
  "email": "john.doe@example.com",
  "degree": "BS",
  "major": "Computer Science",
  "gradDate": "2026-05",
  "linkedInUrl": "https://linkedin.com/in/johndoe",
  "resumeS3Key": "resumes/a1b2c3d4/resume.pdf",
  "createdAt": "2025-02-14T10:30:00.000Z",
  "updatedAt": "2025-02-14T12:45:00.000Z",
  "role": "student"
}
```

#### Sample Response – 404 Not Found

```json
{
  "error": "NOT_FOUND",
  "message": "Profile not found"
}
```

---

### 4. Create Profile

Creates a new student profile (first-time sign-in). Fails if the user already has a profile.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles` |
| **Auth** | Required |
| **Request Body** | JSON (see schema) |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
Content-Type: application/json
```

#### Request Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Full name |
| `uin` | string | Yes | University Identification Number (UIN) |
| `email` | string | No | Email address |
| `degree` | string | No | Degree (e.g. BS, MS, PhD) |
| `major` | string | Yes | Academic major |
| `gradDate` | string | Yes | Graduation month-year (e.g. `"2026-05"`) |
| `linkedInUrl` | string | No | LinkedIn profile URL |
| `resumeS3Key` | string | No | Resume reference (S3 object key of uploaded resume PDF) |
| `role` | string | No | Role for this profile (e.g. `"student"`) |

#### Sample Request

```http
POST /api/profiles
Authorization: Bearer eyJraWQiOiJxxx...
Content-Type: application/json

{
  "name": "Jane Smith",
  "uin": "987654321",
  "email": "jane.smith@example.com",
  "degree": "BS",
  "major": "Computer Engineering",
  "gradDate": "2026-05",
  "linkedInUrl": "https://linkedin.com/in/janesmith",
  "resumeS3Key": null,
  "role": "student"
}
```

#### Sample Response – 201 Created

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Jane Smith",
  "uin": "987654321",
  "email": "jane.smith@example.com",
  "degree": "BS",
  "major": "Computer Engineering",
  "gradDate": "2026-05",
  "linkedInUrl": "https://linkedin.com/in/janesmith",
  "resumeS3Key": null,
  "createdAt": "2025-02-14T10:30:00.000Z",
  "updatedAt": "2025-02-14T10:30:00.000Z",
  "role": "student"
}
```

#### Sample Response – 400 Bad Request (Invalid JSON)

```json
{
  "error": "BAD_REQUEST",
  "message": "Invalid JSON body"
}
```

---

### 5. Update Profile

Updates the current user's profile. Only provided fields are updated.

| Field | Value |
|-------|-------|
| **Method** | `PUT` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles/me` |
| **Auth** | Required |
| **Request Body** | JSON (partial update supported) |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
Content-Type: application/json
```

#### Request Body Schema (all fields optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Full name |
| `uin` | string | No | University Identification Number (UIN) |
| `email` | string | No | Email address |
| `degree` | string | No | Degree (e.g. BS, MS, PhD) |
| `major` | string | No | Academic major |
| `gradDate` | string | No | Graduation month-year |
| `linkedInUrl` | string | No | LinkedIn profile URL |
| `resumeS3Key` | string | No | Resume reference (S3 object key) |
| `role` | string | No | Role for this profile (e.g. `"student"`) |

#### Sample Request

```http
PUT /api/profiles/me
Authorization: Bearer eyJraWQiOiJxxx...
Content-Type: application/json

{
  "linkedInUrl": "https://linkedin.com/in/janesmith-updated",
  "resumeS3Key": "resumes/a1b2c3d4/resume-v2.pdf"
}
```

#### Sample Response – 200 OK

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Jane Smith",
  "uin": "987654321",
  "email": "jane.smith@example.com",
  "degree": "BS",
  "major": "Computer Engineering",
  "gradDate": "2026-05",
  "linkedInUrl": "https://linkedin.com/in/janesmith-updated",
  "resumeS3Key": "resumes/a1b2c3d4/resume-v2.pdf",
  "createdAt": "2025-02-14T10:30:00.000Z",
  "updatedAt": "2025-02-14T14:00:00.000Z",
  "role": "student"
}
```

#### Sample Response – 404 Not Found

```json
{
  "error": "NOT_FOUND",
  "message": "Profile not found"
}
```

---

### 6. Delete Profile

Deletes the current user's profile.

| Field | Value |
|-------|-------|
| **Method** | `DELETE` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/profiles/me` |
| **Auth** | Required |
| **Request Body** | None |
| **Query Params** | None |

#### Headers

```
Authorization: Bearer <cognito_id_token>
```

#### Sample Request

```http
DELETE /api/profiles/me
Authorization: Bearer eyJraWQiOiJxxx...
```

#### Sample Response – 200 OK

```json
{
  "deleted": true
}
```

---

## Common Error Responses

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | BAD_REQUEST | Invalid JSON, fileName, contentType, or resumeId |
| 401 | UNAUTHORIZED | Missing, invalid, or expired token |
| 403 | FORBIDDEN | Authorization failure (for example, domain or verification checks if configured) |
| 404 | NOT_FOUND | Profile or resume does not exist |
| 405 | METHOD_NOT_ALLOWED | HTTP method not supported for the path |
| 500 | INTERNAL_ERROR | Server error |

All error responses follow this structure:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

---

---

## Resume Upload Endpoints

### 7. Get Presigned Upload URL

Returns a presigned PUT URL for uploading a PDF resume directly to S3.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/upload-url` |
| **Auth** | Required |
| **Request Body** | JSON |

#### Request Body

```json
{
  "fileName": "resume.pdf",
  "contentType": "application/pdf"
}
```

#### Sample Response – 200 OK

```json
{
  "uploadUrl": "https://...",
  "resumeId": "uuid",
  "s3Key": "resumes/USER#sub/uuid.pdf",
  "expiresInSeconds": 120
}
```

### 8. Complete Resume Upload

Call after PUTting the file to the presigned URL. Verifies file in S3 and updates StudentProfiles.

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/complete` |
| **Auth** | Required |
| **Request Body** | `{ "resumeId": "string" }` |

#### Sample Response – 200 OK

```json
{
  "resumeId": "uuid",
  "status": "UPLOADED",
  "s3Key": "resumes/USER#sub/uuid.pdf"
}
```

### 9. List My Resumes

Returns metadata for all resumes (no presigned URLs).

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/me` |
| **Auth** | Required |

#### Sample Response – 200 OK

```json
{
  "resumes": [
    {
      "resumeId": "uuid",
      "s3Key": "resumes/USER#sub/uuid.pdf",
      "fileName": "resume.pdf",
      "status": "UPLOADED",
      "fileSize": 12345,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 10. Get Download URL

Returns a presigned GET URL for downloading a resume.

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **URL** | `https://trj0i1jfd6.execute-api.us-east-1.amazonaws.com/api/resumes/{resumeId}/download-url` |
| **Auth** | Required |

#### Sample Response – 200 OK

```json
{
  "downloadUrl": "https://...",
  "expiresInSeconds": 300
}
```

---

## Summary Table

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me/profile-exists` | Check if profile exists |
| GET | `/api/profiles` | List student profiles (Students Connect) |
| GET | `/api/profiles/me` | Get my profile |
| POST | `/api/profiles` | Create profile |
| PUT | `/api/profiles/me` | Update profile |
| DELETE | `/api/profiles/me` | Delete profile |
| POST | `/api/resumes/upload-url` | Get presigned upload URL |
| POST | `/api/resumes/complete` | Complete resume upload |
| GET | `/api/resumes/me` | List my resumes |
| GET | `/api/resumes/{resumeId}/download-url` | Get presigned download URL |
