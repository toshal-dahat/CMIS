# CMIS External Core — Architecture

## High-level

```
Browser (Svelte)  →  API Gateway (HTTP API)  →  Lambda (external-service)
                                                      │
                         ┌────────────────────────────┼────────────────────────────┐
                         ▼                            ▼                            ▼
                    Cognito User Pool          DynamoDB (users,           SES (optional)
                                               students, handover_        EventBridge
                                               tokens, handover_log)      (graduation scan)
```

- **Single Lambda** handles all HTTP routes and the EventBridge graduation scan.
- **Cognito** is the identity store; **DynamoDB** holds profiles, students, handover tokens, and handover audit log.
- **Admin** endpoints (e.g. GET `/graduation-handover/history`) are gated by `ADMIN_USER_IDS` (Cognito sub).

---

## Data stores

| Store | Purpose |
|-------|---------|
| **Cognito User Pool** | Email/password auth; attributes: email, custom:role, custom:class_year, custom:linked_uin. |
| **DynamoDB external_users** | Profile per user_id: email, role, class_year, linked_uin, personal_email, linked_in_url. Source of truth for role and profile. |
| **DynamoDB students** | Eligible students: uin, account_status, grad_date, personal_email (for handover match). |
| **DynamoDB handover_tokens** | Magic-link tokens (token_hash PK), TTL. |
| **DynamoDB handover_log** | Audit: handover_id, timestamp, status (INITIATED/SUCCESS/FAILED), user_id, uin, etc. TTL 90 days. |

---

## Key flows

1. **Registration** — Sign up @tamu.edu → Cognito + DynamoDB; role from Role Logic Engine (PARTNER/FORMER_STUDENT/FRIEND).
2. **Sign-in** — Cognito auth → tokens + profile from DynamoDB.
3. **Profile** — GET/PUT `/me` → Cognito (token validation) + DynamoDB (read/update_profile).
4. **Graduation handover** — POST `/graduation-handover`: auth; 403 if already FORMER_STUDENT; log INITIATED; verify password; handover.link_uin_to_user → log SUCCESS/FAILED.
5. **Graduate claim** — Request link (email) → scan students, create token, send link; GET claim (token) → validate; POST claim (token, password) → create Cognito user + DynamoDB, link UIN, set FORMER_STUDENT.
6. **Graduation scan** — EventBridge (monthly) invokes Lambda → scan students, generate tokens, send magic links (SES or CloudWatch).
7. **Forgot/reset password** — Cognito ForgotPassword → email code; ConfirmForgotPassword with code + new password.

---

## Frontend

- **Svelte** app; views: Login, Register, Profile, Handover, HandoverHistory, Claim, ForgotPassword, ResetPassword.
- **Handover** nav shown only when `user.role !== 'FORMER_STUDENT'`.
- **Handover History** visible to all logged-in users; API returns 403 for non-admins.
- **API client** in `lib/api.js` (signup, signin, me, updateMe, graduationHandover, handoverHistory, requestMagicLink, claimTokenInfo, claimWithPassword, forgotPassword, resetPassword).

---

## Infrastructure (Terraform)

- **Cognito** user pool + app client.
- **DynamoDB** tables: external_users, students, handover_tokens, handover_log.
- **Lambda** single function; env: USER_POOL_ID, CLIENT_ID, table names, HANDOVER_LOG_TABLE, ADMIN_USER_IDS, FRONTEND_BASE_URL, SES_VERIFIED_SENDER, etc.
- **API Gateway** HTTP API, ANY /{proxy+} and ANY / → Lambda.
- **EventBridge** rule (cron) → Lambda for graduation scan.
- **IAM** Lambda role: DynamoDB, Cognito, SES.
