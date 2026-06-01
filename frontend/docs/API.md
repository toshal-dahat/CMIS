# Backend API Documentation

All API calls made by the CMIS / Team Reveille frontend to the backend. **Currently placeholders** — replace with real `fetch` (or API client) when the backend is available.

---

## Authentication

Authenticated requests must send the Cognito ID token:

```
Authorization: Bearer <idToken>
```

Get the token in the app:

```javascript
import { getSession } from './lib/auth.js';
const session = await getSession();
const idToken = session?.tokens?.idToken?.toString();
```

---

## 1. Check first-time sign-in

**Purpose:** After successful sign-in, determine if the user has a profile. First-time → redirect to profile form. Returning → redirect to landing page and load profile.

| Field       | Value |
|------------|--------|
| **Called from** | `src/lib/LandingPage.svelte` (onMount, after OAuth callback) |
| **Function**   | `src/lib/api.js` → `checkIsFirstTimeSignIn(user)` |
| **Status**     | Placeholder (uses `localStorage` until backend exists) |

### Backend API (to implement)

| Field   | Value |
|--------|--------|
| **Method** | `GET` |
| **URL**    | `GET /api/users/me/profile-exists` or `GET /api/profiles/me` (then treat 404 as first-time) |
| **Auth**   | Required |

**Response (example):**

```json
{ "exists": true }
```

- `exists: true` → not first-time → go to landing and fetch profile.
- `exists: false` or 404 → first-time → go to profile form.

**Placeholder:** Returns `localStorage.getItem('cmis_profile_<userId>') === 'true'` → not first-time.

---

## 2. Fetch user profile

**Purpose:** Load the current user’s profile and auto-populate the profile store. Used after sign-in when the user is not first-time (landing page with profile details).

| Field       | Value |
|------------|--------|
| **Called from** | `src/lib/LandingPage.svelte` (onMount, when not first-time) |
| **Function**   | `src/lib/api.js` → `fetchUserProfile(user)` |
| **Status**     | Placeholder (reads from `localStorage` until backend exists) |

### Backend API (to implement)

| Field   | Value |
|--------|--------|
| **Method** | `GET` |
| **URL**    | `GET /api/profiles/me` |
| **Auth**   | Required |

**Response (example):**

```json
{
  "name": "string",
  "major": "string",
  "classYear": "string",
  "gradDate": "string",
  "linkedinUrl": "string",
  "resumeS3Key": "string",
  "resumeFileName": "string",
  "updatedAt": "ISO8601"
}
```

Frontend should write this into the profile store so the profile panel and form show autopopulated data.

**Placeholder:** Reads `localStorage.getItem('cmis_profile_data_<userId>')` and parses JSON into the profile store.

---

## 3. Save / update student profile

**Purpose:** Persist profile (name, major, class year, grad date, LinkedIn URL, resume reference) to the backend (e.g. DynamoDB). Resume file is uploaded via presigned URL; this payload stores the S3 key.

| Field       | Value |
|------------|--------|
| **Called from** | `src/lib/ProfileForm.svelte` (submit), `src/lib/ProfilePanel.svelte` (save changes) |
| **Status**     | Placeholder (updates profile store + `localStorage` only) |

### Backend API (to implement)

| Field   | Value |
|--------|--------|
| **Method** | `PUT` or `POST` |
| **URL**    | `PUT /api/profiles/me` or `POST /api/profiles` |
| **Auth**   | Required |

**Request body (example):**

```json
{
  "name": "string",
  "major": "string",
  "classYear": "string",
  "gradDate": "string",
  "linkedinUrl": "string",
  "resumeS3Key": "string"
}
```

`resumeS3Key` comes from the presigned-URL upload flow (see below).

**Response (example):**

```json
{
  "userId": "string",
  "profileId": "string",
  "updatedAt": "ISO8601"
}
```

**Placeholder:** No HTTP call; profile store and `localStorage` are updated in the UI.

---

## 4. Get presigned URL for resume upload

**Purpose:** Obtain a signed URL so the frontend can upload the resume PDF directly to S3 (binary does not go through the app).

| Field       | Value |
|------------|--------|
| **Called from** | Before saving profile when the user has selected a new resume file |
| **Status**     | Not implemented |

### Backend API (to implement)

| Field   | Value |
|--------|--------|
| **Method** | `POST` |
| **URL**    | `POST /api/profiles/resume/presigned-url` |
| **Auth**   | Required |

**Request body (example):**

```json
{
  "fileName": "resume.pdf",
  "contentType": "application/pdf"
}
```

**Response (example):**

```json
{
  "uploadUrl": "https://...",
  "objectKey": "profiles/<userId>/resume.pdf"
}
```

- Frontend `PUT`s the file to `uploadUrl`.
- Frontend sends `objectKey` (or equivalent) in the save-profile request as `resumeS3Key`.

---

## 5. List student profiles (Students Connect)

**Purpose:** List all student profiles except the current user. Filtering by name, major, and degree is done on the frontend.

| Field       | Value |
|------------|--------|
| **Called from** | `src/lib/StudentsConnect.svelte` |
| **Function**   | `src/lib/api.js` → `listProfiles()` |

### Backend API

| Field   | Value |
|--------|--------|
| **Method** | `GET` |
| **Path**   | `/api/profiles` |
| **Auth**   | Required (backend must exclude current user from results) |

**Response shape:** `{ profiles: [{ name, uin, degree, major, gradDate, linkedInUrl }] }`

---

## Summary

| # | Purpose                         | Method | URL (to implement)              | Called from              | Status        |
|---|---------------------------------|--------|----------------------------------|---------------------------|---------------|
| 1 | Check first-time sign-in        | GET    | `/api/users/me/profile-exists`   | LandingPage (after login) | Placeholder   |
| 2 | Fetch user profile              | GET    | `/api/profiles/me`              | LandingPage (not first-time) | Placeholder   |
| 3 | Save / update profile           | PUT    | `/api/profiles/me`               | ProfileForm, ProfilePanel | Placeholder   |
| 4 | Presigned URL for resume upload | POST   | `/api/profiles/resume/presigned-url` | Before profile save       | Not implemented |
| 5 | List students (Students Connect)| GET    | `/api/profiles`                     | StudentsConnect           | To implement  |

---

## Where to wire in the backend

- **First-time check:** `src/lib/api.js` → `checkIsFirstTimeSignIn()` — replace with `GET /api/users/me/profile-exists` (or similar).
- **Fetch profile:** `src/lib/api.js` → `fetchUserProfile()` — replace with `GET /api/profiles/me` and set profile store from response.
- **Save profile:** `src/lib/ProfileForm.svelte` and `src/lib/ProfilePanel.svelte` — add a call to `PUT /api/profiles/me` (and optionally a small `saveProfile()` in `api.js`).
- **Resume upload:** Before saving profile, call `POST /api/profiles/resume/presigned-url`, then `PUT` file to `uploadUrl`, then send `objectKey` in the profile save payload.

All authenticated calls should use `Authorization: Bearer <idToken>` from `getSession()`.
