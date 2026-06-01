# CMIS External Service — Code Explanation Guide

This document is for explaining the codebase to others: architecture, data flows, key files, and how components connect.

---

## 1. Project Overview

**What it does:** External Core for the CMIS Engagement Platform. Manages external users (Partners, Former Students, Friends) with email/password auth and a graduation handover flow.

**Key capabilities:**
- **Auth:** Sign up, sign in via Cognito
- **Roles:** PARTNER (company domain), FORMER_STUDENT (linked UIN), FRIEND (default)
- **Graduation handover:** Link an external account to a student UIN
- **Graduation automation:** Scheduled scan finds eligible students, sends magic links to claim accounts

---

## 2. Architecture

```
Browser (Svelte) → API Gateway → Lambda → Cognito / DynamoDB / SES
                                    ↑
                              EventBridge (cron)
```

| Component | Purpose |
|-----------|---------|
| **API Gateway** | HTTP API; all routes proxy to Lambda |
| **Lambda** | Single handler; routes by path and method |
| **Cognito** | User auth (signup, signin, JWT validation) |
| **DynamoDB** | 3 tables: `external_users`, `students`, `handover_tokens` |
| **EventBridge** | Monthly cron invokes Lambda for graduation scan |
| **SES** | Magic-link and confirmation emails (optional) |

---

## 3. Backend (Lambda) — `services/external-service/`

### 3.1 Entry point: `handler.py`

- **`lambda_handler(event, context)`** — Single entry for all invocations.
- **EventBridge:** If `event.source == "aws.events"` → `do_graduation_scan()`.
- **HTTP:** Uses `_route()` to get path, method, body and dispatches:

| Path | Method | Handler | Purpose |
|------|--------|---------|---------|
| `/` | GET | (inline) | Health check |
| `/auth/signup` | POST | `do_signup()` | Register |
| `/auth/signin` | POST | `do_signin()` | Sign in |
| `/me` | GET | `do_me()` | Current user (Bearer token) |
| `/graduation-handover` | POST | `do_graduation_handover()` | Link UIN (auth required) |
| `/graduation-handover/claim` | GET | (inline) | Validate token, return email/uin |
| `/graduation-handover/claim` | POST | (inline) | Complete claim with password |

**Helpers:**
- `_response(body, status, cors)` — JSON response with CORS headers.
- `_parse_body(event)` — Decode JSON body, handle base64.
- `_route(event)` — Return `(path_parts, method, body)`.

---

### 3.2 Auth: `auth.py`

Wrapper around Cognito IdP (email as username).

| Function | Purpose |
|----------|---------|
| `sign_up(email, password)` | Create Cognito user |
| `admin_confirm_sign_up(username)` | Auto-confirm so user can sign in |
| `initiate_auth(email, password)` | Sign in, returns tokens |
| `get_user_by_token(access_token)` | Validate token, return user attributes |
| `parse_token_from_header(headers)` | Extract `Bearer <token>` |
| `admin_set_custom_attributes(...)` | Set role, class_year, linked_uin on Cognito user |

**Cognito schema:** `sub`, `email`, `custom:role`, `custom:class_year`, `custom:linked_uin`.

---

### 3.3 Database: `db.py`

DynamoDB access for `external_users` (default table name from env).

| Function | Purpose |
|----------|---------|
| `get_user_by_id(user_id)` | Get by primary key (Cognito sub) |
| `get_user_by_email(email)` | Get by GSI `email-index` |
| `get_user_by_linked_uin(uin)` | Get by GSI `linked-uin-index` |
| `put_user(...)` | Create or overwrite user |
| `update_user_role_and_uin(user_id, role, linked_uin)` | Set role and linked UIN |

**external_users schema:**
- `user_id` (PK), `email`, `role`, `class_year`, `linked_uin`

---

### 3.4 Role logic: `role_engine.py`

Assigns role at signup.

| Function | Purpose |
|----------|---------|
| `resolve_role(email, former_student_checked, class_year)` | Returns `(role, class_year)` |

**Logic:**
1. **PARTNER** — Email domain in Company List (Team Howdy API or stub).
2. **FORMER_STUDENT** — `formerStudent` checked and class year provided.
3. **FRIEND** — Otherwise.

Company list: `COMPANY_LIST_API_URL/domains` or stub `acme.com`, `partner.org`, `example.com`.

---

### 3.5 Handover: `handover.py`

Links an existing external user to a student UIN.

| Function | Purpose |
|----------|---------|
| `link_uin_to_user(user_id, uin, class_year)` | Link UIN, set role to FORMER_STUDENT |

**Flow:**
1. Validate user exists and UIN not already linked to another account.
2. Update DynamoDB: `role=FORMER_STUDENT`, `linked_uin=uin`.
3. Update Cognito custom attributes.

---

### 3.6 Graduation scan: `graduation_scan.py`

Triggered by EventBridge or manual invoke.

| Function | Purpose |
|----------|---------|
| `run_scan()` | Find eligible students, create tokens, send magic links |

**Flow:**
1. Query `students` GSI `grad-status-index`: `account_status=STUDENT` and `grad_date <= today`.
2. For each: generate token, store in `handover_tokens`, build magic link.
3. Deliver link via SES or CloudWatch log.

**handover_tokens item:**
- `token_hash` (PK), `uin`, `personal_email`, `class_year`, `expires_at`, `claimed`

**Magic link format:** `{FRONTEND_BASE_URL}/#claim?token={raw_token}`

---

### 3.7 Graduation claim: `graduation_claim.py`

Processes magic-link claims.

| Function | Purpose |
|----------|---------|
| `get_token_info(token)` | Validate token, return `{uin, personal_email, class_year}` |
| `claim_with_password(token, password)` | Create account, link UIN, mark token claimed |

**Flow (claim_with_password):**
1. Validate token (exists, not claimed, not expired).
2. If email has no account: create Cognito user, DynamoDB record.
3. If email exists but not linked: reuse account.
4. Call `handover.link_uin_to_user()` to link UIN.
5. Mark token as claimed.
6. Optionally send confirmation email via SES.

---

## 4. DynamoDB Tables

### 4.1 external_users

| Attribute | Type | Key | Purpose |
|-----------|------|-----|---------|
| user_id | S | PK | Cognito sub |
| email | S | GSI: email-index | Unique lookup |
| role | S | | PARTNER, FORMER_STUDENT, FRIEND |
| class_year | S | | Optional |
| linked_uin | S | GSI: linked-uin-index | Linked student UIN |

### 4.2 students

| Attribute | Type | Key | Purpose |
|-----------|------|-----|---------|
| uin | S | PK | Student UIN |
| grad_date | S | GSI range | YYYY-MM-DD |
| account_status | S | GSI hash | STUDENT |
| personal_email | S | | Recipient for magic link |
| class_year | S | | Optional |
| tamu_email | S | | Optional reference |

**GSI:** `grad-status-index` (account_status, grad_date).

### 4.3 handover_tokens

| Attribute | Type | Key | Purpose |
|-----------|------|-----|---------|
| token_hash | S | PK | SHA256 of raw token |
| uin | S | | Student UIN |
| personal_email | S | | Claim email |
| class_year | S | | Optional |
| expires_at | N | TTL | Unix timestamp |
| claimed | B | | Prevents reuse |

---

## 5. Frontend — `frontend/`

### 5.1 App structure: `App.svelte`

- **State:** `view` (login, register, profile, handover, claim), `accessToken`, `user`, `claimToken`.
- **Routing:** Client-side via `view`; magic-link detection in `onMount()` from `#claim?token=...`.
- **Tokens:** Stored in `localStorage` (accessToken, refreshToken).

**View flow:**
- `login` / `register` → sign in / sign up.
- `profile` → show user info.
- `handover` → link UIN.
- `claim` → magic-link claim page.

---

### 5.2 API client: `lib/api.js`

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `signup({email, password, formerStudent, classYear})` | POST /auth/signup | Register |
| `signin({email, password})` | POST /auth/signin | Sign in |
| `me(accessToken)` | GET /me | Profile |
| `graduationHandover(accessToken, {uin, classYear})` | POST /graduation-handover | Link UIN |
| `claimTokenInfo(token)` | GET /graduation-handover/claim?token= | Validate token |
| `claimWithPassword(token, password)` | POST /graduation-handover/claim | Complete claim |

Base URL: `VITE_API_BASE` from env.

---

### 5.3 Views

| View | File | Purpose |
|------|------|---------|
| Login | `Login.svelte` | Email/password sign in |
| Register | `Register.svelte` | Sign up with role options |
| Profile | `Profile.svelte` | Show email, role, linked UIN |
| Handover | `Handover.svelte` | Link UIN (manual flow) |
| Claim | `Claim.svelte` | Magic-link claim (password form) |

**Claim flow (Claim.svelte):**
1. On mount: call `claimTokenInfo(token)` to validate.
2. Show email, UIN; user enters password.
3. On submit: call `claimWithPassword(token, password)`.
4. On success: show "Welcome back! Your graduate account is ready" and Log in button.

---

## 6. Data Flows (Step-by-Step)

### 6.1 Registration

1. User submits email, password, formerStudent, classYear.
2. `role_engine.resolve_role()` → PARTNER / FORMER_STUDENT / FRIEND.
3. `auth.sign_up()` → Cognito user.
4. `auth.admin_confirm_sign_up()` → Auto-confirm.
5. `db.put_user()` → DynamoDB external_users.
6. Optional: `auth.admin_set_custom_attributes()` for Cognito.

### 6.2 Sign in

1. User submits email, password.
2. `auth.initiate_auth()` → Cognito tokens.
3. `db.get_user_by_email()` → Role, class_year, linked_uin.
4. Return tokens + user object to frontend.

### 6.3 Profile (/me)

1. Frontend sends `Authorization: Bearer <accessToken>`.
2. `auth.get_user_by_token()` → Validate token, get sub/email.
3. `db.get_user_by_id(sub)` → DynamoDB record (lazy create if missing).
4. Return profile JSON.

### 6.4 Manual graduation handover

1. Logged-in user submits UIN (+ optional class year).
2. Token validated via `auth.get_user_by_token()`.
3. `handover.link_uin_to_user(sub, uin, class_year)`:
   - Check UIN not linked elsewhere.
   - Update DynamoDB and Cognito.
4. Return updated user.

### 6.5 Graduation scan (EventBridge)

1. EventBridge invokes Lambda with `{"source":"aws.events"}`.
2. `graduation_scan.run_scan()`:
   - Query students table (eligible students).
   - For each: create token, store in handover_tokens.
   - Send magic link via SES or log.
3. Return `{processed, total_eligible, errors}`.

### 6.6 Claim (magic link)

**GET (validate):**
1. `graduation_claim.get_token_info(token)` → Validate in handover_tokens.
2. Return `{email, uin, classYear}` for UI.

**POST (complete):**
1. Validate token.
2. Create Cognito user if needed; otherwise reuse existing.
3. `handover.link_uin_to_user()`.
4. Mark token claimed.
5. Send confirmation email (if SES configured).

---

## 7. Environment Variables (Lambda)

| Variable | Source | Purpose |
|----------|--------|---------|
| USER_POOL_ID | Terraform | Cognito User Pool ID |
| CLIENT_ID | Terraform | Cognito App Client ID |
| EXTERNAL_USERS_TABLE | Terraform | external_users table name |
| STUDENTS_TABLE | Terraform | students table name |
| HANDOVER_TOKENS_TABLE | Terraform | handover_tokens table name |
| COMPANY_LIST_API_URL | Terraform (optional) | Company domains API |
| FRONTEND_BASE_URL | Terraform | Base URL for magic links |
| SES_VERIFIED_SENDER | Terraform (optional) | SES verified sender email |

---

## 8. Infrastructure (Terraform)

- **`main.tf`** — Cognito, DynamoDB, Lambda, API Gateway, EventBridge, IAM.
- **`variables.tf`** — project_name, aws_region, ses_verified_sender, etc.
- **`outputs.tf`** — api_gateway_url, cognito_user_pool_id, students_table_name, etc.

Lambda is built from `services/external-service/` and packaged as a zip. API Gateway uses `ANY /{proxy+}` and `ANY /` to proxy all requests to Lambda.

---

## 9. Scripts

| Script | Purpose |
|--------|---------|
| `seed-students.sh` | Insert dummy students into DynamoDB |
| `restart.sh` | terraform apply, seed, update .env, start frontend |
| `shutdown.sh` | terraform destroy |

---

## 10. Quick Reference: File → Responsibility

| File | Responsibility |
|------|----------------|
| `handler.py` | Routing, HTTP handlers, EventBridge entry |
| `auth.py` | Cognito operations |
| `db.py` | external_users DynamoDB |
| `role_engine.py` | Role assignment at signup |
| `handover.py` | Link UIN, set FORMER_STUDENT |
| `graduation_scan.py` | Find students, create tokens, send links |
| `graduation_claim.py` | Validate token, complete claim |
| `App.svelte` | Shell, routing, state |
| `lib/api.js` | API client |
| `Login.svelte` | Sign-in form |
| `Register.svelte` | Sign-up form |
| `Profile.svelte` | Profile display |
| `Handover.svelte` | Manual UIN link form |
| `Claim.svelte` | Magic-link claim form |
