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
| GET | `/mentorship/embeddings/me` | Current user: read or compute mentor + mentee canonical embeddings; persists to DynamoDB (`MENTORSHIP_EMBEDDINGS_TABLE`). Query: `refresh=true`, `includeVector=false` (metadata only) |
| GET | `/mentorship/candidates` | Mentor-only: build and return ranked mentee candidates (scores include Gold/Silver **board boost** for the mentor’s company tier; response includes `mentorBoard`) |
| GET | `/mentorship/matches` | Mentor-only: list persisted mentorship suggestions/matches (pending items first) |
| GET | `/mentorship/suggested-mentors` | Mentee-only: ranked mentor suggestions (`boostedScore` = base fit × per-mentor board multiplier) |
| GET | `/mentorship/mentee/matches` | Mentee-only: this user’s outbound requests and match statuses |
| POST | `/mentorship/mentee/request` | Mentee-only: body `{ "mentorUserId" }` → status `PENDING_MENTOR` |
| POST | `/mentorship/matches/{menteeUserId}/accept` | Mentor accepts a mentee, opens channel, sends email |
| POST | `/mentorship/matches/{menteeUserId}/skip` | Mentor skips a mentee (soft pass) |
| POST | `/mentorship/matches/{menteeUserId}/decline` | Mentor declines; optional body `{ "reason" }` → `DECLINED_BY_MENTOR` |

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
| `MENTORSHIP_EMBEDDINGS_TABLE` | DynamoDB table for per-user mentor + mentee canonical embedding vectors (PK: `userId`, SK: `profileKind` = `mentor` \| `mentee`) |
| `RESUMES_TABLE` | Student resumes DynamoDB table (PK: `userSub`, SK: `resumeId`) used to fetch latest `EXTRACTED` parsed resume for mentor/mentee enrichment |
| `STUDENT_RESUMES_ME_URL` | Student-service endpoint for current-user resume list (default: `https://peux35p02a.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/me`) |
| `MENTORSHIP_EMBEDDINGS_PROVIDER` | Embedding provider: `bedrock` (Amazon Titan, default) or `openai` |
| `BEDROCK_EMBEDDING_MODEL_ID` | Bedrock model ID (default `amazon.titan-embed-text-v2:0`) |
| `BEDROCK_EMBEDDING_DIMENSIONS` | Titan v2 dimensions: `256`, `512`, or `1024` (default `1024`) |
| `BEDROCK_EMBEDDING_NORMALIZE` | `true` / `false` — L2-normalize Titan v2 vectors (default `true`) |
| `BEDROCK_REGION` | Optional override; defaults to Lambda `AWS_REGION` |
| `OPENAI_API_KEY` | Required when provider is `openai` |
| `OPENAI_EMBEDDING_MODEL` | OpenAI embeddings model when provider is `openai` (default: `text-embedding-3-large`) |
| `MENTORSHIP_EMBED_BATCH_SIZE` | Max texts per batch when calling the provider (default `16`, max `64`) |
| `MENTORSHIP_TOP_K` | Number of ranked candidates returned/persisted per refresh (default: `20`) |
| `MENTORSHIP_SCORING_SEMANTIC_WEIGHT` | Weight for cosine semantic score in final score (default: `0.75`) |
| `MENTORSHIP_SCORING_RULE_WEIGHT` | Weight for rule-based compatibility score in final score (default: `0.25`) |
| `MENTORSHIP_MENTEE_GSI_NAME` | DynamoDB GSI on matches table for mentee queries (default: `menteeUserId-mentorUserId-index`) |
| `MENTORSHIP_BOARD_GOLD_MULTIPLIER` | Score multiplier for Gold board mentors (default `1.15`, max `2`) |
| `MENTORSHIP_BOARD_SILVER_MULTIPLIER` | Score multiplier for Silver board mentors (default `1.08`, max `2`) |
| `MENTORSHIP_BOARD_GOLD_DOMAINS` | Optional comma-separated email domains forced to Gold tier (e.g. `partner.com`) |
| `MENTORSHIP_BOARD_SILVER_DOMAINS` | Optional comma-separated domains for Silver tier |

Board tiers are resolved from **`COMPANY_LIST_API_URL`** when company objects include `boardTier` / `partnerBoardTier` / `sponsorTier` / `tier` (`gold` / `silver`), plus mentor profile email domain and `mentorCompany` name/domain matching. See `mentorship_board.py`.

## Integration with CMIS-prod

- **admin-service:** Set `COMPANY_LIST_API_URL` to the **full URL** of the admin “get all companies” endpoint (e.g. `https://your-api.execute-api.region.amazonaws.com/stage/companies`). The role engine will GET that URL and derive partner domains from the response (array of company objects with `domain`), so no changes are required in admin-service.
- **student-service** owns student-facing APIs (resumes, profiles). External-service now uses `/student/api/resumes/me` for mentor self-resume enrichment (request bearer token) and reads StudentProfiles + Resumes tables for broader mentorship ranking.

## Seed scripts (optional)

- `seed_students.py` — Seed dummy graduating students into `STUDENTS_TABLE`. Set `STUDENTS_TABLE` (and AWS credentials) then run: `python seed_students.py`.
- `seed_test_user.py` — Create a test external user in DynamoDB. See docstring for usage (`USER_POOL_ID`, `EXTERNAL_USERS_TABLE`, email or `--user-id`).

## Deployment

Package the service (e.g. zip `handler.py`, `auth.py`, `db.py`, `role_engine.py`, `handover.py`, `graduation_claim.py`, `graduation_scan.py`, `handover_log.py`, `validation.py`, `audit_log.py` and `requirements.txt` or use a layer for boto3). Configure API Gateway to proxy to this Lambda (e.g. `/auth/*`, `/me`, `/graduation-handover/*`). Set the environment variables above on the Lambda.

### GitHub Actions / Terraform

The root **Deploy CMIS Application** workflow defaults mentorship embeddings to **Amazon Bedrock Titan** (`mentorship_embeddings_provider=bedrock` unless you set repository variable **`MENTORSHIP_EMBEDDINGS_PROVIDER`**). Ensure **Bedrock model access** is enabled in the AWS console for `amazon.titan-embed-text-v2:0` (or your chosen model) in the deploy region. The external Lambda IAM role includes **`bedrock:InvokeModel`** for that foundation model.

To use **OpenAI** instead, set repository variable **`MENTORSHIP_EMBEDDINGS_PROVIDER`** to `openai` and add secret **`OPENAI_API_KEY`** or variable **`OPENAI_API_KEY_SSM_PARAMETER`** (SSM parameter name).
