# External Service (Team Gig ’Em) — Documentation

This document is the **single source of documentation** for `services/external-service`: clear API inventory, workflow steps, and what we delivered.

---

## Team

- Yashas Suresh  
- Manogna Yadhav  
- Shreya Rajendra Prakash  
- Ryan Tsao  
- Abin Harshan Sindhil  

---

## What we built

**External Service** is a Python 3.12 AWS Lambda backend for external users:
- **Auth**: signup/signin + forgot/reset password (Cognito)
- **Roles**: PARTNER / FORMER_STUDENT / FRIEND
- **Graduation handover**: UIN linking + magic-link claim workflow to transition students to alumni access
- **Mentorship matcher**: embeddings + ranking + persisted match workflow, plus admin matching operations

It integrates with:
- **student-service**: source of truth for StudentProfiles and resumes (used for mentorship enrichment)
- **admin-service**: company/tier APIs used for board-tier boosts

---

## Base URL

This service is deployed behind API Gateway. Use your environment’s base URL:

```
https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
```

All paths below are relative to that base URL.

---

## Authentication (how requests are validated)

### Authorization header

Most endpoints require:

```
Authorization: Bearer <token>
Content-Type: application/json
```

### Token support (as implemented in `handler.py`)

The service accepts either:
- **Cognito Access Token** (preferred; validated via Cognito `GetUser`)
- **Cognito ID Token** (fallback; decoded locally + `exp` check)

If missing/invalid/expired, endpoints return **401**.

---

## API inventory (endpoint table)

### Core
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Health / service info |
| GET | `/me` | Current user (Bearer token) |

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/signup` | Register |
| POST | `/auth/signin` | Sign in |
| POST | `/auth/forgot-password` | Request reset code |
| POST | `/auth/reset-password` | Complete reset |

### Graduation handover
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/graduation-status?gradDate=` | Public: should UI show alumni prompt (YYYY-MM or YYYY-MM-DD) |
| GET | `/graduation-handover/lookup?uin=` | Step 1: verify UIN (no link created) |
| POST | `/graduation-handover` | Step 2: link UIN to account |
| POST | `/graduation-handover/request-link` | Request magic link (email) |
| GET | `/graduation-handover/claim?token=` | Validate token, return email/uin/classYear |
| POST | `/graduation-handover/claim` | Complete claim with token + password |

### Mentorship matcher (mentor + mentee)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/mentorship/embedding-config` | Provider/model metadata |
| GET | `/mentorship/embeddings/me` | Compute/read canonical embeddings (supports `refresh=true`, `includeVector=false`) |
| GET | `/mentorship/candidates` | **Mentor-only** ranked mentee candidates |
| GET | `/mentorship/matches` | **Mentor-only** match rows (1 active actionable item in API) |
| GET | `/mentorship/mentor/pause` | **Mentor-only** read pause status |
| PUT | `/mentorship/mentor/pause` | **Mentor-only** set/clear pause |
| GET | `/mentorship/suggested-mentors` | **Mentee-only** ranked mentors |
| GET | `/mentorship/mentee/matches` | **Mentee-only** status + matched mentor once channel opens |
| POST | `/mentorship/matches/{menteeUserId}/accept` | Mentor accepts; opens channel (+ optional SES email) |
| POST | `/mentorship/matches/{menteeUserId}/skip` | Mentor skips |
| POST | `/mentorship/matches/{menteeUserId}/decline` | Mentor declines (optional reason) |
| POST | `/mentorship/matches/{menteeUserId}/revive` | Restore declined → suggested (if mentee under cap) |
| POST | `/mentorship/mentee/request` | **Disabled (HTTP 410)** — matching is driven by admin-run/batch + mentor actions |

### Mentorship admin
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/mentorship/admin/matching-runs` | List runs (summary) |
| GET | `/mentorship/admin/matching-runs/latest` | Latest run (snapshot) |
| GET | `/mentorship/admin/matching-runs/{runId}` | Run by id |
| POST | `/mentorship/admin/matching-runs` | Enqueue admin run (optional reset) |
| POST | `/mentorship/admin/run` | Enqueue admin run (alias) |
| GET | `/mentorship/admin/schedule` | Read schedule/config |
| PUT | `/mentorship/admin/schedule` | Update schedule/config |
| GET | `/mentorship/admin/mentee-cap-diagnostics` | Diagnose mentee cap state |
| POST | `/mentorship/admin/mentee-cap-diagnostics/repair` | Repair mentee cap state |
| POST | `/mentorship/admin/pair-suggest` | Suggest/admin-assisted pairing |

---

## Bounties / deliverables we worked on

- **External user auth**: signup/signin/forgot/reset + `/me`
- **Roles + partner logic**: derive PARTNER via company/domain list (admin-service integration) + FRIEND/FORMER_STUDENT
- **Graduation handover**:
  - UIN verification and linking for authenticated users
  - Magic-link claim flow (request → validate → claim)
  - `/graduation-status` logic to drive the UI prompt
  - Alumni membership enforcement without breaking TAMU SSO email behavior
- **Mentorship matcher (end-to-end)**:
  - Canonical embeddings compute/persist (`/mentorship/embeddings/me`)
  - Mentor suggestion queue + one-actionable-item behavior
  - Mentor actions: accept/skip/decline/revive (+ optional SES notifications)
  - Mentee status + program limits
  - Board-tier boosts from admin tiers/companies + caching/fallback
  - Guardrails: exclusivity locks + mentee cap enforcement for concurrency safety
- **Admin operations**:
  - Matching run audit trail (list/latest/by-id)
  - Batch run trigger + optional reset
  - Schedule and diagnostics/repair tooling

---

## Graduation handover workflow (from README, step-by-step)

### Goal
Convert a graduating TAMU student into an alumni/external access path safely.

### Workflow (direct linking)
1. **User signs in** (external-service Cognito).
2. **Verify UIN**  
   - `GET /graduation-handover/lookup?uin=...`  
   - Returns minimal verification fields (UIN/gradDate/role) without creating a link.
3. **Link UIN to account**  
   - `POST /graduation-handover`  
   - Links UIN → authenticated identity and updates alumni-related fields.
4. **UI prompt logic**  
   - `GET /graduation-status?gradDate=YYYY-MM` indicates whether the frontend should show the alumni conversion prompt.

### Workflow (magic-link claim)
1. **Request link**  
   - `POST /graduation-handover/request-link` with `{ email }`
2. **Validate token**  
   - `GET /graduation-handover/claim?token=...` → `{ email, uin, classYear }`
3. **Complete claim**  
   - `POST /graduation-handover/claim` with `{ token, password }`

### Important constraint (SSO safety)
We avoid overwriting CMIS Cognito `email` to only a personal email because it can break TAMU Google SSO behavior. Email aliases are stored on StudentProfiles and matched via CSV.

---

## Mentorship matcher workflow — mentee

### What a mentee experiences
1. **Mentee opts into mentorship** via StudentProfile flags (`mentorshipInterested=true`, `mentorship=mentee`) in student-service.
2. **Mentee checks status**  
   - `GET /mentorship/mentee/matches`  
   - Returns:
     - `MATCHING_IN_PROGRESS` vs `MATCHED`
     - `matchedMentor` only when a channel is opened
     - `menteeProgramLimits` (cap enforcement metadata)
3. **(Optional)** Browse ranked mentors  
   - `GET /mentorship/suggested-mentors`

### Guardrails
- A mentee has a configured max concurrent `CHANNEL_OPENED` cap (env `MENTEE_MAX_MATCHES`).
- Enforced using a synthetic DynamoDB row (`mentorUserId="__MENTEE_CHANNEL_STATE__"`) so concurrent accepts remain safe.

---

## Mentorship matcher workflow — mentor

### What a mentor experiences
1. **Mentor opts into mentorship** via StudentProfile flags (`mentorshipInterested=true`, `mentorship=mentor`).
2. **Embeddings are available**  
   - `GET /mentorship/embeddings/me` (optional `refresh=true`)
3. **Mentor gets candidates**  
   - `GET /mentorship/candidates`  
   - Persists suggestions; API enforces **one active actionable item** (`SUGGESTED` / `PENDING_MENTOR`) at a time.
4. **Mentor takes action**
   - Accept: `POST /mentorship/matches/{menteeUserId}/accept`
   - Skip: `POST /mentorship/matches/{menteeUserId}/skip`
   - Decline: `POST /mentorship/matches/{menteeUserId}/decline` (optional reason)
   - Revive: `POST /mentorship/matches/{menteeUserId}/revive`
5. **Mentor views match history**
   - `GET /mentorship/matches`
6. **Mentor pause**
   - `GET/PUT /mentorship/mentor/pause`  
   - When paused, candidates returns none and includes pause metadata.

---

## Mentorship matcher — admin capabilities

### What admins can do
- **Audit runs**
  - `GET /mentorship/admin/matching-runs`
  - `GET /mentorship/admin/matching-runs/latest`
  - `GET /mentorship/admin/matching-runs/{runId}`
- **Trigger runs**
  - `POST /mentorship/admin/matching-runs` (optional destructive reset)
  - `POST /mentorship/admin/run` (alias)
- **Operate safely**
  - `GET/PUT /mentorship/admin/schedule`
  - `GET /mentorship/admin/mentee-cap-diagnostics`
  - `POST /mentorship/admin/mentee-cap-diagnostics/repair`
  - `POST /mentorship/admin/pair-suggest`

---

## Scheduled + async invokes

These are non-HTTP Lambda invocations handled by the same entry point.

| Payload `source` | Behavior |
|------------------|----------|
| `aws.events` / `Scheduled Event` | Graduation scan (magic links) |
| `cmis.mentorship.batch` | Annual/batch matching run |
| `cmis.mentorship.late-registration` | Single mentee matching |
| `cmis.mentorship.profile-saved` | Precompute embeddings after profile save |
| `cmis.mentorship.admin-run` | Trusted internal admin run |
| `scheduled-batch` | Legacy alias for batch matching |
| `late-registration` | Legacy alias for single-mentee matching |

---

## Environment Variables Reference

### Required — Service will not function without these

| Variable | Description | Example |
|---------|-------------|---------|
| `USER_POOL_ID` | Cognito User Pool ID | `us-east-1_xxxxxx` |
| `CLIENT_ID` | Cognito App Client ID | `xxxxxxxxxxxxxxxxxx` |
| `EXTERNAL_USERS_TABLE` | DynamoDB table for external user profiles | `cmis-external-users` |
| `STUDENTS_TABLE` | DynamoDB table for students (graduation handover) | `cmis-students` |
| `HANDOVER_TOKENS_TABLE` | DynamoDB table for magic-link tokens | `cmis-handover-tokens` |
| `MENTORSHIP_MATCHES_TABLE` | Match rows + synthetic channel-state rows | `cmis-mentorship-matches` |
| `MENTORSHIP_EMBEDDINGS_TABLE` | Per-user embedding vectors | `cmis-mentorship-embeddings` |
| `STUDENT_PROFILES_TABLE` | Student profiles (mentorship hydration) | `cmis-student-profiles` |
| `FRONTEND_BASE_URL` | Base URL for magic link construction | `https://app.example.com` |

### Strongly recommended for production

| Variable | Description | Default / Notes |
|---------|-------------|----------------|
| `COMPANY_LIST_API_URL` | Admin-service companies endpoint URL. Used by role engine + board. | Stub domains `{acme.com, partner.org, example.com}` if unset |
| `SES_VERIFIED_SENDER` | Verified SES email for magic-links, accept, and decline notices | Emails skipped if unset |
| `RESUMES_BUCKET` | S3 bucket for resume PDFs. Enables presigned download URLs in mentorship cards. | Resume URLs omitted if unset |
| `BEDROCK_EMBEDDING_MODEL` | Titan model ID (set by Terraform) | `amazon.titan-embed-text-v2:0` |
| `BEDROCK_LLM_MODEL` | LLM model for narration (set by Terraform) | e.g. `amazon.nova-lite-v1:0` |
| `RESUMES_TABLE` | DynamoDB resumes table (mentorship resume enrichment) | Enrichment skipped if unset |

### Tuning knobs (all have sensible defaults)

| Variable | Default | Description |
|---------|---------|-------------|
| `MENTORSHIP_SCORING_SEMANTIC_WEIGHT` | `0.75` | Weight of cosine semantic score in final score |
| `MENTORSHIP_SCORING_RULE_WEIGHT` | `0.25` | Weight of rule-based score in final score |
| `MENTORSHIP_TOP_K` | `20` | Number of ranked candidates computed and persisted per refresh |
| `MENTORSHIP_NARRATOR_TOP_K` | — | Top rows that receive LLM narration (set to `0` to disable) |
| `MENTEE_MAX_MATCHES` | `1` (max `10`) | Max concurrent `CHANNEL_OPENED` matches per mentee |
| `MENTORSHIP_BATCH_MAX_MENTEES` | `500` | Cap on mentees processed per annual batch run |
| `MENTORSHIP_EMBED_BATCH_SIZE` | `16` | Max texts per embedding request (clamped `1–64`) |
| `MENTORSHIP_EMBEDDINGS_PROVIDER` | `bedrock-titan` | `bedrock-titan` or `bedrock-cohere` |
| `BEDROCK_EMBEDDING_DIMENSIONS` | `1024` | Titan v2 dimensions: `256`, `512`, or `1024` |
| `MENTORSHIP_MENTEE_GSI_NAME` | `menteeUserId-mentorUserId-index` | GSI on matches table for mentee queries |
| `MENTORSHIP_TIERS_API_URL` | auto-derived | Admin `GET /tiers` endpoint for board ranking |
| `ADMIN_USER_IDS` | — | Comma-separated Cognito `sub` values for admin route access |
| `HANDOVER_LOG_TABLE` | — | Optional audit log table; leave empty to skip |
| `MENTORSHIP_MATCHING_RUNS_TABLE` | — | Admin audit log for batch runs; leave empty to disable |

### Board multiplier configuration

| Variable | Default | Description |
|---------|---------|-------------|
| `MENTORSHIP_BOARD_GOLD_MULTIPLIER` | `1.15` | Score multiplier for gold-tier mentors (clamped `1–2`) |
| `MENTORSHIP_BOARD_SILVER_MULTIPLIER` | `1.08` | Score multiplier for silver-tier mentors |
| `MENTORSHIP_BOARD_BRONZE_MULTIPLIER` | `1.05` | Score multiplier for bronze-tier mentors |
| `MENTORSHIP_BOARD_TOP_TIER_MULTIPLIER` | `1.5` | Multiplier for rank-1 mentors in admin-ranked tier system |
| `MENTORSHIP_BOARD_BOTTOM_TIER_MULTIPLIER` | `1.0` | Multiplier for worst-ranked mentors (intermediate ranks interpolated) |
| `MENTORSHIP_BOARD_NO_TIERS_API_MULTIPLIER` | `1.08` | When `/tiers` is unavailable but company match exists |
| `MENTORSHIP_BOARD_COMPANY_CACHE_SEC` | `300` | TTL for in-process company list + `/tiers` cache (seconds) |
| `MENTORSHIP_BOARD_GOLD_DOMAINS` | — | Comma-separated email domains treated as gold tier |
| `MENTORSHIP_BOARD_SILVER_DOMAINS` | — | Same for silver (gold wins if domain appears in multiple lists) |
| `MENTORSHIP_BOARD_BRONZE_DOMAINS` | — | Same for bronze |

---

## Local tests

From `services/external-service`:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

