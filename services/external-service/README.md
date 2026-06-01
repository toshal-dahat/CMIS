# External Service (Team Gig 'Em)

Python 3.12 Lambda backend for **external users**: signup/signin (Cognito), role assignment (PARTNER / FORMER_STUDENT / FRIEND), **graduation handover**, and **mentorship matching** (Bedrock embeddings + Nova narration, DynamoDB matches).

This service was integrated from the [cloudcomputing_CMIS](https://github.com/yashassuresh775/cloudcomputing_CMIS) repo (backend only). It works alongside CMIS-prod’s **admin-service** (company/domain APIs) and **student-service** (resumes, profiles).

## Documentation (macro → detail)

For **future CMIS cohorts** inheriting this service, read in this order:

1. **[HANDOFF_FOR_NEXT_TEAM.md](HANDOFF_FOR_NEXT_TEAM.md)** — system context, architecture diagram, first-week plan, operational cautions.
2. **[EXTERNAL_SERVICE_NOTES.md](EXTERNAL_SERVICE_NOTES.md)** — request/async flows, glossary, module map, “where do I change X?” index.
3. **This README** — API routes and environment variables (deploy contract).
4. **[MENTORSHIP.md](MENTORSHIP.md)** — matching behavior and data model depth.
5. **[MENTORSHIP_ADMIN_MATCHING_API.md](MENTORSHIP_ADMIN_MATCHING_API.md)** — admin operator APIs for batch runs.

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
| GET | `/graduation-status?gradDate=` | Should frontend show alumni handover prompt? |
| GET | `/graduation-handover/lookup?uin=` | Step 1: verify UIN (no link) |
| POST | `/graduation-handover` | Step 2: link UIN to account |
| GET | `/mentorship/embedding-config` | Active embeddings provider/model metadata |
| GET | `/mentorship/embeddings/me` | Current user: read or compute mentor + mentee canonical embeddings; persists to DynamoDB (`MENTORSHIP_EMBEDDINGS_TABLE`). Query: `refresh=true`, `includeVector=false` (metadata only) |
| GET | `/mentorship/candidates` | Mentor-only: ranked mentee candidates (board boost via `mentorship_board` + admin `/tiers`); response includes `mentorBoard`, pause + allocator metadata; scores stripped; rows hydrated from StudentProfiles (incl. resume URL when configured). |
| GET | `/mentorship/matches` | Mentor-only: persisted rows (one active `SUGGESTED`/`PENDING_MENTOR` in API), same hydration; `mentorBoard` + pause fields |
| GET | `/mentorship/mentor/pause` | Mentor-only: read `mentorshipMentorPauseUntil` / active pause |
| PUT | `/mentorship/mentor/pause` | Mentor-only: `{ "until": "YYYY-MM-DD" }` or `{ "clear": true }` |
| GET | `/mentorship/suggested-mentors` | Mentee-only: ranked mentors (`boostedScore` = base fit × board multiplier) |
| GET | `/mentorship/mentee/matches` | Mentee-only: `MATCHED` vs `MATCHING_IN_PROGRESS`, `matchedMentor` when a channel is open, and **`menteeProgramLimits`** `{ maxActiveMentorMatches, activeOpenedCount }` (concurrent `CHANNEL_OPENED` cap) |
| POST | `/mentorship/mentee/request` | Disabled (returns `410`): mentee-initiated mentor requests are turned off; use admin-run matching flow. |
| POST | `/mentorship/matches/{menteeUserId}/accept` | Mentor accepts; opens channel; SES email when configured |
| POST | `/mentorship/matches/{menteeUserId}/skip` | Mentor skip |
| POST | `/mentorship/matches/{menteeUserId}/decline` | Decline; optional `{ "reason" }` → `DECLINED_BY_MENTOR` (optional soft SES notice) |
| POST | `/mentorship/matches/{menteeUserId}/revive` | Restore `DECLINED_BY_MENTOR` → `SUGGESTED` when mentee under cap |
| GET | `/mentorship/admin/matching-runs` | **Admin only:** list recent matching runs (summary). See **[MENTORSHIP_ADMIN_MATCHING_API.md](MENTORSHIP_ADMIN_MATCHING_API.md)**. |
| GET | `/mentorship/admin/matching-runs/latest` | **Admin only:** latest stored run including `snapshot` (pairs + mentor capacity). |
| GET | `/mentorship/admin/matching-runs/{runId}` | **Admin only:** one stored run by id. |
| POST | `/mentorship/admin/matching-runs` | **Admin only:** optional full match-table reset + batch matching. **Destructive** when `resetMatches` is true. Full spec: **[MENTORSHIP_ADMIN_MATCHING_API.md](MENTORSHIP_ADMIN_MATCHING_API.md)**. |

## Graduation handover workflow (current app behavior)

### 1) Signed-in direct handover (used by current frontend UI)

Use when a logged-in user is still on their student identity and wants to add a personal email.

1. Frontend evaluates prompt eligibility with `GET /graduation-status?gradDate=`.
2. If user confirms graduation in the popup, UI routes to handover screen.
3. Handover screen submits `POST /graduation-handover` with `uin`, `personalEmail`, and optional `classYear`.
4. Backend updates StudentProfiles role/email aliases and ensures CMIS group membership for alumni/friends.

Implementation path:
- [`handler.py`](handler.py): `do_graduation_status`, `do_handover_lookup`, `do_graduation_handover`
- [`handler.py`](handler.py): `_update_student_profile_alumni`, `_ensure_cmis_alumni_membership`

### Notes / behavior guarantees

- The landing-page graduation popup does **not** send a magic link; it only drives the direct in-app handover UI.
- The direct in-app handover path in [`handler.py`](handler.py) is the source of truth for current CMIS StudentProfiles + CMIS group synchronization behavior.
- Optional audit sink exists in [`handover_log.py`](handover_log.py) when `HANDOVER_LOG_TABLE` is configured.

## Scheduled and async invokes (EventBridge / Lambda-to-Lambda)

| Payload `source` | Behavior |
|------------------|----------|
| `aws.events` / `Scheduled Event` | Graduation scan (internal/background processing) |
| `scheduled-batch` / `cmis.mentorship.batch` | Mentorship schedule tick path: runs `run_scheduled_matching_if_due()` and executes admin-configured matching only when due. |
| `late-registration` / `cmis.mentorship.late-registration` | Body must include `menteeUserId`; runs `run_single_mentee_matching` (used from student-service on profile create / switch to mentee). |
| `cmis.mentorship.profile-saved` | Precompute mentorship embeddings after profile save/update. |
| `cmis.mentorship.admin-run` | Internal async admin run orchestration (`resetMatches` / `runBatchMatching`, with `triggerSource`). |

Terraform currently defines an optional **EventBridge schedule tick** (`rate(1 minute)`) that invokes this Lambda with `source: cmis.mentorship.batch` and `batchType: schedule-tick` (`infrastructure/external-services/terraform/eventbridge.tf`). This is **optional** and **disabled by default** (`enable_mentorship_annual_eventbridge = false`) because many Terraform IAM users lack `events:PutRule`. Set the variable to `true` after granting EventBridge permissions, or invoke the Lambda manually with the same JSON payload.

For a full mapping of **all** DynamoDB tables used by admin-service, student-service, and external-service (keys, GSIs, which APIs use which table), see **[docs/DATABASE_TABLES_MAPPING.md](../../docs/DATABASE_TABLES_MAPPING.md)**.

## Environment variables

| Variable | Description |
|---------|-------------|
| `USER_POOL_ID` | Cognito User Pool ID |
| `CLIENT_ID` | Cognito App Client ID |
| `ADMIN_USER_IDS` | (Optional) Comma-separated Cognito **`sub`** values allowed for **admin mentorship** routes (`/mentorship/admin/...`) when group listing is insufficient. Checked in addition to `admins` group membership. |
| `MENTORSHIP_MATCHING_RUNS_TABLE` | (Optional) DynamoDB table for admin **matching run** audit + snapshots (PK `runId`). Enables GET list / latest / by-id. Terraform: `mentorship-matching-runs` table in external-services module. |
| `EXTERNAL_USERS_TABLE` | DynamoDB table for external user profiles (PK: user_id; GSI: email-index, linked-uin-index) |
| `STUDENTS_TABLE` | DynamoDB table for students (PK: uin; GSI: grad-status-index for account_status + grad_date) |
| `HANDOVER_TOKENS_TABLE` | DynamoDB table name retained for compatibility with legacy flows (PK: token_hash) |
| `HANDOVER_LOG_TABLE` | (Optional) Audit log table; leave empty to skip logging |
| `COMPANY_LIST_API_URL` | (Optional) **Full URL** to the company-list endpoint (e.g. admin-service “get all companies”). GET this URL; we accept: (1) array of objects with `domain`, (2) `{"domains": ["a.com", ...]}`, or (3) `["a.com", ...]`. If unset, stub domains (acme.com, partner.org, example.com) are used for PARTNER role. |
| `FRONTEND_BASE_URL` | Frontend base URL (e.g. `https://app.example.com` or `http://localhost:5173`) |
| `SES_VERIFIED_SENDER` | (Optional) Verified SES email for notification messages |
| `MENTORSHIP_MATCHES_TABLE` | DynamoDB table for mentorship match records (PK: `mentorUserId`, SK: `menteeUserId`). A synthetic row `mentorUserId = __MENTEE_CHANNEL_STATE__` / `menteeUserId = <mentee>` stores `openedChannelCount` so concurrent **accept** operations cannot exceed `MENTEE_MAX_MATCHES` across mentors. |
| `MENTORSHIP_EMBEDDINGS_TABLE` | DynamoDB table for per-user mentor + mentee canonical embedding vectors (PK: `userId`, SK: `profileKind` = `mentor` \| `mentee`) |
| `STUDENT_PROFILES_TABLE` | Student profiles table (required for mentorship ranking, annual batch, late registration) |
| `RESUMES_TABLE` | Student resumes DynamoDB table (PK: `userSub`, SK: `resumeId`) used to fetch latest `EXTRACTED` parsed resume for mentor/mentee enrichment |
| `RESUMES_BUCKET` | S3 bucket for resume PDFs (same as student-service). Lambda needs `s3:GetObject` on `arn:aws:s3:::bucket/*`. When set, mentor APIs include short-lived `menteeResumeDownloadUrl` |
| `MENTORSHIP_RESUME_DOWNLOAD_URL_TTL` | Presigned GET expiry in seconds (default `900`, clamped 60–3600) |
| `STUDENT_RESUMES_ME_URL` | Student-service endpoint for current-user resume list (default: `https://peux35p02a.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/me`) |
| `MENTORSHIP_EMBEDDINGS_PROVIDER` | **`bedrock-titan`** (default) or `bedrock-cohere` |
| `BEDROCK_EMBEDDING_MODEL` | Bedrock model id for embeddings (set by Terraform) |
| `BEDROCK_EMBEDDING_DIMENSIONS` | Titan v2 dimensions: 256, 512, or 1024 |
| `BEDROCK_LLM_MODEL` | Bedrock model id for mentorship narration (e.g. Nova Lite Converse) |
| `MENTORSHIP_EMBED_BATCH_SIZE` | Max texts per embeddings request when ranking many mentors/mentees (default `16`, max `64`) |
| `MENTORSHIP_TOP_K` | Number of ranked candidates returned/persisted per refresh (default: `20`) |
| `MENTORSHIP_NARRATOR_TOP_K` | Top rows that receive LLM narration |
| `MENTORSHIP_SCORING_SEMANTIC_WEIGHT` | Weight for cosine semantic score in final score (default: `0.75`) |
| `MENTORSHIP_SCORING_RULE_WEIGHT` | Weight for rule-based compatibility score in final score (default: `0.25`) |
| `MENTORSHIP_MENTEE_GSI_NAME` | DynamoDB GSI on matches table for mentee queries (default: `menteeUserId-mentorUserId-index`) |
| `MENTEE_MAX_MATCHES` | Max concurrent `CHANNEL_OPENED` matches per mentee across mentors (default `1`, max `10`; enforced with synthetic `__MENTEE_CHANNEL_STATE__` row on accept). |
| `MENTORSHIP_BATCH_MAX_MENTEES` | Cap mentees processed per annual batch run (default `500`) |
| `MENTORSHIP_TIERS_API_URL` | Optional full URL to admin **`GET /tiers`**. If unset, a trailing `/companies` on `COMPANY_LIST_API_URL` is rewritten to `/tiers`. |
| `MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER` | Best admin rank (`rank` 1) multiplier (default **1.5**, clamped 1–2) |
| `MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER` | Worst rank multiplier (default **1.0**); intermediate ranks interpolate linearly |
| `MENTORSHIP_BOARD_NO_TIERS_API_MULTIPLIER` | When `/tiers` is unavailable but a company match exists (default **1.08**) |
| `MENTORSHIP_BOARD_COMPANY_CACHE_SEC` | TTL seconds for in-process cache of company list + `/tiers` responses (default **300**) |
| `MENTORSHIP_BOARD_GOLD_MULTIPLIER` | Multiplier when tier slug is **gold** (default **1.15**, clamped 1–2); overrides admin curve for that slug |
| `MENTORSHIP_BOARD_SILVER_MULTIPLIER` | Same for **silver** (default **1.08**) |
| `MENTORSHIP_BOARD_BRONZE_MULTIPLIER` | Same for **bronze** (default **1.05**) |
| `MENTORSHIP_BOARD_GOLD_DOMAINS` | Comma-separated email domains treated as gold board tier (merged with company list) |
| `MENTORSHIP_BOARD_SILVER_DOMAINS` | Same for silver (gold wins if a domain appears in multiple lists) |
| `MENTORSHIP_BOARD_BRONZE_DOMAINS` | Same for bronze |

Board multipliers use **admin `/tiers`** `rank` order for non-classic slugs; **gold** / **silver** / **bronze** slugs use the env multipliers above. Companies come from **`COMPANY_LIST_API_URL`** (`domain`, `name`, `tierId`, and optional `boardTier` / `tier` fields). Matching uses mentor email domain, company name (exact or partial), or hostname-style company string vs `domain`. See `mentorship_board.py`.

## Integration with CMIS-prod

- **admin-service:** Set `COMPANY_LIST_API_URL` to the **full URL** of the admin “get all companies” endpoint (e.g. `https://your-api.execute-api.region.amazonaws.com/stage/companies`). The role engine will GET that URL and derive partner domains from the response (array of company objects with `domain`), so no changes are required in admin-service.
- **student-service** owns student-facing APIs (resumes, profiles). External-service uses `/student/api/resumes/me` for mentor self-resume enrichment (Bearer token) and reads StudentProfiles + Resumes tables. Profiles CRUD can invoke this Lambda asynchronously when a user becomes a mentee (`MENTORSHIP_EXTERNAL_LAMBDA_NAME` in student Lambdas; IAM `lambda:InvokeFunction` on the root Lambda role).

## Seed scripts (optional)

- `seed_students.py` — Seed dummy graduating students into `STUDENTS_TABLE`. Set `STUDENTS_TABLE` (and AWS credentials) then run: `python seed_students.py`.
- `seed_test_user.py` — Create a test external user in DynamoDB. See docstring for usage (`USER_POOL_ID`, `EXTERNAL_USERS_TABLE`, email or `--user-id`).

## Tests (local)

From `services/external-service`:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## Deployment

Package the service (e.g. zip `handler.py`, `auth.py`, `db.py`, `role_engine.py`, `handover.py`, `graduation_claim.py`, `graduation_scan.py`, `mentorship_*.py`, `handover_log.py`, `validation.py`, `audit_log.py` and `requirements.txt` or use a layer for boto3). Configure API Gateway to proxy to this Lambda (e.g. `/auth/*`, `/me`, `/graduation-handover/*`, `/mentorship/*`). Set the environment variables above on the Lambda.

### GitHub Actions / Terraform

The root **Deploy CMIS Application** workflow uses Bedrock for embeddings and narration. Ensure the Lambda role allows `bedrock:InvokeModel` / `bedrock:Converse` on the configured models (see `infrastructure/external-services/terraform/iam.tf`).
