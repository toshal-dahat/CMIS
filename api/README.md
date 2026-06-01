# External Service API Reference

All endpoints are served by the **external-service** Lambda behind API Gateway. Base URL: your API Gateway URL (e.g. `https://xxxxxx.execute-api.us-east-1.amazonaws.com`).

**Headers:** Use `Content-Type: application/json` for POST bodies. Use `Authorization: Bearer <accessToken>` where noted.

---

## Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Service info |
| POST | `/auth/signup` | — | Register |
| POST | `/auth/signin` | — | Sign in |
| POST | `/auth/forgot-password` | — | Request password reset code |
| POST | `/auth/reset-password` | — | Complete password reset |
| GET | `/me` | Bearer | Current user profile |
| PUT | `/me` | Bearer | Update profile |
| GET | `/graduation-handover/lookup` | Bearer | Look up student by UIN |
| POST | `/graduation-handover` | Bearer | Link UIN to account |
| POST | `/graduation-handover/request-link` | — | Request magic link by email |
| GET | `/graduation-handover/claim` | — | Validate claim token |
| POST | `/graduation-handover/claim` | — | Complete claim with password |
| GET | `/graduation-handover/history` | Bearer | (Admin) Handover history |

---

## Health

### GET /

**Response:** `200`

```json
{ "service": "external", "version": "1.0" }
```

---

## Auth

### POST /auth/signup

Register a new user (Cognito + DynamoDB). Role is derived from email domain (PARTNER), “Former Student” + class year (FORMER_STUDENT), or FRIEND.

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass1!",
  "formerStudent": false,
  "classYear": "2025"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| email | string | Yes | Valid email; stored lowercased |
| password | string | Yes | Min 10 chars; upper, lower, number, special |
| formerStudent | boolean | No | Default false |
| classYear | string | If formerStudent | e.g. "2025" |

**Success:** `201`

```json
{
  "message": "Registration successful",
  "userId": "<cognito-sub>",
  "email": "user@example.com",
  "role": "FRIEND",
  "classYear": null
}
```

**Errors:** `400` (validation), `409` (email already exists), `500` (server error).

---

### POST /auth/signin

Sign in with email and password. Returns tokens.

**Request body:**

```json
{ "email": "user@example.com", "password": "SecurePass1!" }
```

**Success:** `200`

```json
{
  "accessToken": "<jwt>",
  "idToken": "<jwt>",
  "refreshToken": "<jwt>",
  "expiresIn": 3600
}
```

**Errors:** `400` (missing fields), `401` (invalid email or password), `500`.

---

### POST /auth/forgot-password

Request a password reset code. Cognito sends the code to the user’s verified email.

**Request body:**

```json
{ "email": "user@example.com" }
```

**Success:** `200` (generic success message; code is sent by email).

**Errors:** `400`, `404` (user not found), `500`.

---

### POST /auth/reset-password

Complete password reset with the code from email.

**Request body:**

```json
{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "NewSecure1!"
}
```

**Success:** `200`.

**Errors:** `400` (invalid code or password), `500`.

---

## Profile

### GET /me

**Headers:** `Authorization: Bearer <accessToken>`

Returns the current user profile (from Cognito + DynamoDB).

**Success:** `200`

```json
{
  "userId": "<sub>",
  "email": "user@example.com",
  "role": "FRIEND",
  "classYear": null,
  "linkedUin": null
}
```

**Errors:** `401` (invalid/expired token), `404`, `500`.

---

### PUT /me

**Headers:** `Authorization: Bearer <accessToken>`

Update profile fields.

**Request body:**

```json
{ "classYear": "2025", "linkedInUrl": "https://linkedin.com/in/..." }
```

**Success:** `200`.

**Errors:** `401`, `400`, `500`.

---

## Graduation handover

### GET /graduation-handover/lookup?uin=

**Headers:** `Authorization: Bearer <accessToken>`

Step 1: Verify UIN and get student profile (no link yet).

**Query:** `uin` (required) — student UIN.

**Success:** `200`

```json
{
  "uin": "100123456",
  "grad_date": "2025-01-15",
  "account_status": "STUDENT",
  "personal_email": "alice@example.com",
  "class_year": "25"
}
```

**Errors:** `400` (UIN missing), `404` (not found), `401`, `500`.

---

### POST /graduation-handover

**Headers:** `Authorization: Bearer <accessToken>`

Step 2: Link the authenticated user to the student UIN (transfers history, sets role to FORMER_STUDENT).

**Request body:**

```json
{
  "uin": "100123456",
  "personalEmail": "alice@example.com",
  "password": "CurrentAccountPassword",
  "classYear": "25"
}
```

**Success:** `200`.

**Errors:** `400` (validation / already linked), `401`, `404`, `500`.

---

### POST /graduation-handover/request-link

Request a magic link for graduation claim (self-service). Sends email if SES is configured, or returns a link in the response for dev.

**Request body:**

```json
{ "email": "graduate@personal.com" }
```

**Success:** `200`

```json
{ "success": true, "message": "...", "magicLink": "https://..." }
```

**Errors:** `400` (e.g. email not found), `500`.

---

### GET /graduation-handover/claim?token=

Validate a magic-link token. No auth.

**Query:** `token` (required).

**Success:** `200`

```json
{
  "email": "graduate@personal.com",
  "uin": "100123456",
  "classYear": "25"
}
```

**Errors:** `400` (invalid or expired token).

---

### POST /graduation-handover/claim

Complete the claim: create/link account with the token and a new password.

**Request body:**

```json
{ "token": "<magic-link-token>", "password": "NewSecure1!" }
```

**Success:** `200`.

**Errors:** `400` (invalid/expired token or password), `500`.

---

### GET /graduation-handover/history

**Headers:** `Authorization: Bearer <accessToken>`

(Admin) List handover history entries. Requires the token’s user to be in `ADMIN_USER_IDS`.

**Success:** `200`

```json
{ "entries": [ ... ] }
```

**Errors:** `401`, `403` (not admin), `500`.

---

## Error response shape

All errors return JSON, e.g.:

```json
{ "error": "Short message", "detail": "Optional longer message" }
```

Status codes: `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `409` Conflict, `500` Internal Server Error.

---

## CORS

The API allows origin `*` and headers `Content-Type`, `Authorization`, `x-amz-date`, `x-api-key`.
