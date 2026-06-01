# CMIS External — Backend & Infrastructure Architecture (End-to-End)

This document describes the full backend and infrastructure: AWS services, Terraform variables/outputs, Lambda environment variables, IAM, data stores, and how they connect.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Svelte)                                   │
│  localhost:5173 or S3+CloudFront (optional) or custom domain                     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ HTTPS
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY (HTTP API)                                   │
│  ANY /  and  ANY /{proxy+}  →  Lambda (single handler)                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    LAMBDA — External Service (Python 3.12)                        │
│  handler.lambda_handler  │  Auth, /me, graduation-handover, claim, scan           │
└─────────────────────────────────────────────────────────────────────────────────┘
         │                    │                    │                    │
         ▼                    ▼                    ▼                    ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   COGNITO    │    │    DYNAMODB     │    │  EVENTBRIDGE │    │   SES (optional) │
│  User Pool   │    │  4 tables       │    │  (schedule)  │    │  Magic-link email│
│  + App Client│    │  see §3         │    │  graduation  │    │  Reset code from│
└──────────────┘    └─────────────────┘    │  scan        │    │  Cognito         │
                                           └──────────────┘    └─────────────────┘
```

**Optional (when `enable_frontend_hosting = true`):**

- **S3** — Frontend build (static assets)
- **CloudFront** — HTTPS, cache, SPA fallback to index.html
- **ACM** (us-east-1) — TLS cert for custom domain
- **Route 53** — A records for custom domain + ACM validation (if `route53_zone_id` set)

---

## 2. AWS services used

| Service | Purpose |
|--------|----------|
| **API Gateway (HTTP API)** | Single entrypoint; routes all requests to one Lambda. CORS enabled. |
| **Lambda** | Single function: `handler.lambda_handler`. Handles HTTP routes and EventBridge schedule. |
| **Cognito** | User pool (email/password) for Partners, Former Students, Friends. Password policy, custom attributes (role, class_year, linked_uin). |
| **DynamoDB** | Four tables: external-users, students, handover-tokens, handover-log. |
| **EventBridge (CloudWatch Events)** | Scheduled rule: graduation scan (e.g. 1st of month 08:00 UTC). |
| **IAM** | One role for Lambda (execution + DynamoDB, Cognito, SES). No IAM users defined in Terraform. |
| **SES** | Optional service currently used for other notifications in the platform. |
| **S3** | Optional: frontend hosting bucket (when `enable_frontend_hosting = true`). |
| **CloudFront** | Optional: frontend distribution; optional custom domain. |
| **ACM** | Optional: TLS certificate for CloudFront custom domain (us-east-1). |
| **Route 53** | Optional: A records and DNS validation for ACM (if `frontend_domain` and `route53_zone_id` set). |

---

## 3. DynamoDB tables

| Table (Terraform name) | Hash key | Range key | GSIs | TTL | Purpose |
|------------------------|----------|-----------|------|-----|---------|
| `{project_name}-external-users` | `user_id` (S) | — | `email-index` (email), `linked-uin-index` (linked_uin) | — | External users (Cognito sub → email, role, class_year, linked_uin). |
| `{project_name}-students` | `uin` (S) | — | `grad-status-index` (account_status, grad_date) | — | Student records for graduation scan (seed data; UIN, grad_date, personal_email, etc.). |
| `{project_name}-handover-log` | `handover_id` (S) | `timestamp` (S) | — | `ttl_expiry` | Audit log: INITIATED / SUCCESS / FAILED (e.g. 90-day TTL). |

Default `project_name` = `cmis-external`, so table names are e.g. `cmis-external-external-users`, `cmis-external-students`, `cmis-external-handover-tokens`, `cmis-external-handover-log`.

---

## 4. Cognito

- **User pool**: `{project_name}-external-pool`
  - **Username** = email (no separate username).
  - **Auto-verified**: email.
  - **Password policy**: min 10 chars, upper, lower, number, symbol.
  - **Schema**: `email` (required), `custom:role`, `custom:class_year`, `custom:linked_uin` (optional).
  - **Account recovery**: verified email (for forgot-password).
- **App client**: `{project_name}-external-client`
  - **Auth flows**: USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH, USER_SRP_AUTH.
  - **Token validity**: access/id 60 min, refresh 30 days.
  - **Read attributes**: email (least privilege).

**Users**: No IAM users for application auth. End users are **Cognito user pool users** (sign up via `/auth/signup` or claim via `/graduation-handover/claim`). **Admin** access to endpoints like GET `/graduation-handover/history` is controlled by Cognito `sub` listed in `ADMIN_USER_IDS` (see §7).

---

## 5. IAM (Lambda execution role)

- **Role**: `{project_name}-external-lambda-role`
- **Assume**: `lambda.amazonaws.com`
- **Attached**:
  - **AWSLambdaBasicExecutionRole** — CloudWatch Logs.
- **Inline policy** (`external-lambda-policy`):
  - **DynamoDB**: GetItem, PutItem, UpdateItem, Query, Scan, BatchGetItem, ConditionCheckItem on all four tables and their indexes.
  - **Cognito**: AdminGetUser, AdminCreateUser, AdminSetUserPassword, AdminUpdateUserAttributes, SignUp, InitiateAuth, AdminInitiateAuth, GetUser, AdminConfirmSignUp, ListUsers on the external user pool.
  - **SES**: SendEmail, SendRawEmail (resource `*`).

No other IAM users or roles are defined in this Terraform stack.

---

## 6. Lambda configuration

- **Runtime**: Python 3.12  
- **Handler**: `handler.lambda_handler`  
- **Timeout**: 30 s  
- **Package**: Zip of `services/external-service/` (excluding `__pycache__`, tests, etc.)

**Invokers**:
- **API Gateway** — permission for `apigateway.amazonaws.com` to invoke (source ARN `*/*`).
- **EventBridge** — permission for `events.amazonaws.com` to invoke (source ARN = graduation-scan rule).

---

## 7. Lambda environment variables (from Terraform)

All set in `aws_lambda_function.external_service.environment.variables`:

| Variable | Set from | Purpose |
|----------|----------|---------|
| `USER_POOL_ID` | `aws_cognito_user_pool.external.id` | Cognito user pool ID. |
| `CLIENT_ID` | `aws_cognito_user_pool_client.external.id` | Cognito app client ID. |
| `EXTERNAL_USERS_TABLE` | `aws_dynamodb_table.external_users.name` | External users DynamoDB table. |
| `STUDENTS_TABLE` | `aws_dynamodb_table.students.name` | Students table (graduation scan). |
| `HANDOVER_TOKENS_TABLE` | `aws_dynamodb_table.handover_tokens.name` | Magic-link tokens table. |
| `HANDOVER_LOG_TABLE` | `aws_dynamodb_table.handover_log.name` | Handover audit log table. |
| `ADMIN_USER_IDS` | `var.admin_user_ids` | Comma-separated Cognito `sub` values allowed for admin endpoints (e.g. handover history). |
| `COMPANY_LIST_API_URL` | `var.company_list_api_url` | Optional Team Howdy company list API (for role resolution). |
| `FRONTEND_BASE_URL` | `var.frontend_base_url` | Base URL used by frontend integrations. |
| `SES_VERIFIED_SENDER` | `var.ses_verified_sender` | Optional SES sender for notification email use-cases. |

---

## 8. Terraform variables (input)

Defined in `infrastructure/main.tf` and `infrastructure/variables.tf`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| **main.tf** | | | |
| `admin_user_ids` | string | `""` | Cognito user IDs (sub) for admin endpoints; comma-separated. |
| `ses_verified_sender` | string | `""` | Optional SES verified sender for notification emails. Sensitive. |
| **variables.tf** | | | |
| `aws_region` | string | `"us-east-1"` | AWS region for main resources. |
| `project_name` | string | `"cmis-external"` | Prefix for resource names. |
| `company_list_api_url` | string | `""` | Optional company list API base URL. |
| `frontend_base_url` | string | `"http://localhost:5173"` | Frontend base URL. |
| `enable_frontend_hosting` | bool | `false` | If true, create S3 + CloudFront (and optional domain). |
| `frontend_domain` | string | `""` | Custom domain for frontend (e.g. app.teamgigem.com). |
| `route53_zone_id` | string | `""` | Route 53 hosted zone ID for frontend_domain. |
| `cors_allow_origins` | list(string) | `["*"]` | CORS allowed origins for API. |
| `tags` | map(string) | `{}` | Tags for all resources. |

**Note**: ACM for CloudFront uses provider `aws.acm` (alias) in **us-east-1** regardless of `aws_region`.

---

## 9. Terraform outputs

| Output | Description |
|--------|-------------|
| `cognito_user_pool_id` | Cognito user pool ID. |
| `cognito_client_id` | Cognito app client ID. |
| `external_users_table_name` | DynamoDB external-users table name. |
| `students_table_name` | DynamoDB students table name. |
| `api_gateway_url` / `api_invoke_url` | API base URL (HTTP API endpoint). |
| `frontend_url` | Frontend URL (when hosting enabled; CloudFront or custom domain). |
| `frontend_cloudfront_domain` | CloudFront domain (when hosting enabled). |
| `frontend_cloudfront_id` | CloudFront distribution ID (invalidation). |
| `frontend_s3_bucket` | S3 bucket for frontend (when hosting enabled). |
| `frontend_domain` | Custom domain (when set). |

---

## 10. API routes (handler routing)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Health: `{ service, version }`. |
| POST | `/auth/signup` | No | Register (email, password, formerStudent?, classYear?). |
| POST | `/auth/signin` | No | Sign in; returns tokens + user. |
| POST | `/auth/forgot-password` | No | Send reset code (Cognito). |
| POST | `/auth/reset-password` | No | Reset password with code. |
| GET | `/me` | Bearer | Current user from token. |
| GET | `/graduation-status?gradDate=` | No | Decide whether graduation popup should show. |
| GET | `/graduation-handover/lookup?uin=` | Bearer | Lookup student for handover (no link). |
| POST | `/graduation-handover` | Bearer | Link UIN to user (password verified). |

**Documented but not implemented in handler (as of this doc):** GET `/graduation-handover/history` — intended admin-only, gated by `ADMIN_USER_IDS`; would read from `handover_log` table.

---

## 11. EventBridge schedule

- Not part of the current documented graduation handover UX. The active user flow is landing popup (`/graduation-status`) plus authenticated handover (`/graduation-handover`).

---

## 12. Data flow summary

1. **Sign up / Sign in**: Frontend → API Gateway → Lambda → Cognito (+ DynamoDB external-users for profile).
2. **Forgot / Reset password**: Frontend → Lambda → Cognito (Cognito sends email; no SES required for reset code).
3. **Handover (manual UIN link)**: Authenticated user → POST /graduation-handover with password → Lambda verifies password, links UIN (handover + db + handover_log).

---

## 13. Where to set values

- **Terraform**: `infrastructure/terraform.tfvars` or `TF_VAR_*` environment variables (e.g. `TF_VAR_admin_user_ids`, `TF_VAR_ses_verified_sender`).
- **Lambda env**: All from Terraform; no manual console edits needed if you apply Terraform.
- **Frontend API base URL**: Frontend reads from build/env (e.g. `Vite` `VITE_API_URL`); point to `api_invoke_url` when deployed.

This gives you the full backend and infrastructure picture: AWS services, users (Cognito pool users + admin via `ADMIN_USER_IDS`), variables, and end-to-end flows.
