# External Service (Team Gig 'Em)

Python 3.12 Lambda backend for **external users**: signup/signin (Cognito), role assignment (PARTNER / FORMER_STUDENT / FRIEND), and **graduation handover** (UIN lookup, link, magic-link claim).

This service was integrated from the [cloudcomputing_CMIS](https://github.com/yashassuresh775/cloudcomputing_CMIS) repo (backend only). It works alongside CMIS-prod’s **admin-service** (company/domain APIs) and **student-service** (resumes, profiles).

## Lambda entry point

- **Handler:** `handler.lambda_handler`
- **Runtime:** Python 3.12

## APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health / service info |
| POST | `/auth/signup` | Register (email, password, formerStudent, classYear) |
| POST | `/auth/signin` | Sign in |
| POST | `/auth/forgot-password` | Request reset code |
| POST | `/auth/reset-password` | Complete reset (email, code, newPassword) |
| GET | `/me` | Current user (Bearer token) |
| GET | `/graduation-handover/lookup?uin=` | Step 1: verify UIN (no link) |
| POST | `/graduation-handover` | Step 2: link UIN to account |
| POST | `/graduation-handover/request-link` | Request magic link by email |
| GET | `/graduation-handover/claim?token=` | Validate token, return email/uin/classYear |
| POST | `/graduation-handover/claim` | Complete claim with token + password |
| GET | `/mentorship/embedding-config` | Active embeddings provider/model metadata |
| GET | `/mentorship/candidates` | Mentor-only: build and return ranked mentee candidates |
| GET | `/mentorship/matches` | Mentor-only: list persisted mentorship suggestions/matches |
| POST | `/mentorship/matches/{menteeUserId}/accept` | Mentor accepts a mentee, opens channel, sends email |
| POST | `/mentorship/matches/{menteeUserId}/skip` | Mentor skips a mentee |

**EventBridge:** Invoke with `source: aws.events` / `detail-type: Scheduled Event` to run the graduation scan (generate magic links for eligible students).

For a full mapping of **all** DynamoDB tables used by admin-service, student-service, and external-service (keys, GSIs, which APIs use which table), see **[docs/DATABASE_TABLES_MAPPING.md](../../docs/DATABASE_TABLES_MAPPING.md)**.

## Environment variables

| Variable | Description |
|---------|-------------|
| `USER_POOL_ID` | Cognito User Pool ID |
| `CLIENT_ID` | Cognito App Client ID |
| `EXTERNAL_USERS_TABLE` | DynamoDB table for external user profiles (PK: user_id; GSI: email-index, linked-uin-index) |
| `STUDENTS_TABLE` | DynamoDB table for students (PK: uin; GSI: grad-status-index for account_status + grad_date) |
| `HANDOVER_TOKENS_TABLE` | DynamoDB table for magic-link tokens (PK: token_hash) |
| `HANDOVER_LOG_TABLE` | (Optional) Audit log table; leave empty to skip logging |
| `COMPANY_LIST_API_URL` | (Optional) **Full URL** to the company-list endpoint (e.g. admin-service “get all companies”). GET this URL; we accept: (1) array of objects with `domain` (e.g. admin cmis-company-api response), (2) `{"domains": ["a.com", ...]}`, or (3) `["a.com", ...]`. If unset, stub domains (acme.com, partner.org, example.com) are used for PARTNER role. |
| `FRONTEND_BASE_URL` | Base URL for magic links (e.g. `https://app.example.com` or `http://localhost:5173`) |
| `SES_VERIFIED_SENDER` | (Optional) Verified SES email for sending magic-link and confirmation emails |
| `MENTORSHIP_MATCHES_TABLE` | DynamoDB table for mentorship match records (PK: `mentorUserId`, SK: `menteeUserId`) |
| `MENTORSHIP_EMBEDDINGS_PROVIDER` | Embedding provider selector (default: `openai`) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings provider |
| `OPENAI_EMBEDDING_MODEL` | OpenAI embeddings model (default: `text-embedding-3-large`) |

## Integration with CMIS-prod

- **admin-service:** Set `COMPANY_LIST_API_URL` to the **full URL** of the admin “get all companies” endpoint (e.g. `https://your-api.execute-api.region.amazonaws.com/stage/companies`). The role engine will GET that URL and derive partner domains from the response (array of company objects with `domain`), so no changes are required in admin-service.
- **student-service** owns student-facing APIs (resumes, profiles). This external-service owns **external** auth and graduation handover only.

## Seed scripts (optional)

- `seed_students.py` — Seed dummy graduating students into `STUDENTS_TABLE`. Set `STUDENTS_TABLE` (and AWS credentials) then run: `python seed_students.py`.
- `seed_test_user.py` — Create a test external user in DynamoDB. See docstring for usage (`USER_POOL_ID`, `EXTERNAL_USERS_TABLE`, email or `--user-id`).

## Deployment

Package the service (e.g. zip `handler.py`, `auth.py`, `db.py`, `role_engine.py`, `handover.py`, `graduation_claim.py`, `graduation_scan.py`, `handover_log.py`, `validation.py`, `audit_log.py` and `requirements.txt` or use a layer for boto3). Configure API Gateway to proxy to this Lambda (e.g. `/auth/*`, `/me`, `/graduation-handover/*`). Set the environment variables above on the Lambda.
