# CMIS External Service — API Reference

Base URL: API Gateway invoke URL (e.g. `https://xxx.execute-api.region.amazonaws.com`). All responses are JSON. CORS is enabled.

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Returns `{ "service": "external", "version": "1.0" }`. |

---

## Auth

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/auth/signup` | No | `{ "email", "password", "formerStudent?", "classYear?" }` | Register; email must be @tamu.edu. Returns `{ message, userId, email, role, classYear }`. |
| POST | `/auth/signin` | No | `{ "email", "password" }` | Sign in. Returns `{ idToken, accessToken, refreshToken, expiresIn, user }`. |
| POST | `/auth/forgot-password` | No | `{ "email" }` | Send reset code to email. Returns generic message for privacy. |
| POST | `/auth/reset-password` | No | `{ "email", "code", "newPassword" }` | Set new password with code. Returns `{ message }`. |

---

## Profile

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/me` | Bearer | — | Current user. Returns `{ userId, email, role, classYear, linkedUin, linkedInUrl }`. |
| PUT | `/me` | Bearer | `{ "classYear?", "linkedInUrl?" }` | Update profile. At least one field required. Returns updated user. |

---

## Graduation handover

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| POST | `/graduation-handover` | Bearer | `{ "uin", "personalEmail", "password", "classYear?" }` | Link account to student UIN. Requires current password. 403 if already FORMER_STUDENT. Logs INITIATED/SUCCESS/FAILED to HandoverLog. |
| GET | `/graduation-handover/history` | Bearer (admin) | — | Admin only (user ID in ADMIN_USER_IDS). Returns `{ "entries": [ { handover_id, timestamp, status, user_id, uin, personal_email?, reason? }, ... ] }`. |
| POST | `/graduation-handover/request-link` | No | `{ "email" }` | Request magic link for graduate claim. Returns `{ success, message, magicLink? }`. |
| GET | `/graduation-handover/claim?token=...` | No | — | Validate token; returns `{ email, uin, classYear }` or 400. |
| POST | `/graduation-handover/claim` | No | `{ "token", "password" }` | Complete claim: create account, link UIN, set FORMER_STUDENT. |

---

## Errors

- **400** — Validation error (e.g. missing email, invalid UIN). Body: `{ "error", "detail?" }`.
- **401** — Missing or invalid token. Body: `{ "error" }`.
- **403** — Forbidden (e.g. not admin for history, or already FORMER_STUDENT for handover). Body: `{ "error" }`.
- **404** — Not found (path or resource). Body: `{ "error", "path?" }`.
- **409** — Conflict (e.g. email exists, UIN already linked). Body: `{ "error" }`.
- **500** — Server error. Body: `{ "error", "detail?" }`.

---

## Auth header

For protected routes, send:

```
Authorization: Bearer <accessToken>
```

Access token is from `POST /auth/signin` (or from claim flow).
