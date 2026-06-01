# CMIS External Core — Team Handoff

For the next team or maintainer taking over the External Core (Team Gig 'Em).

## What this repo contains

- **External Core** only: external user auth (Cognito), roles (PARTNER / FORMER_STUDENT / FRIEND), graduation handover, graduate claim (magic link), and related APIs.
- **Infrastructure:** Terraform in `infrastructure/` (Cognito, DynamoDB, Lambda, API Gateway, EventBridge).
- **Backend:** Python 3.12 Lambda in `services/external-service/` (single handler, path-based routing).
- **Frontend:** Svelte + Vite in `frontend/` (Login, Register, Profile, Handover, Handover History, Claim, Forgot/Reset password).

## Where to start

1. **README.md** — Quick start, stack overview, main scripts.
2. **docs/CODE_EXPLANATION_GUIDE.md** — How the code is structured and how pieces connect.
3. **docs/API_REFERENCE.md** — All HTTP endpoints and error formats.
4. **docs/ARCHITECTURE.md** — Data stores and main flows.
5. **docs/DEPLOYMENT_CHECKLIST.md** — Pre/post deploy and rollback.
6. **docs/DEMO_SCRIPT.md** — Step-by-step demo script.

## Key config

- **Terraform variables** (`infrastructure/variables.tf`): `project_name`, `aws_region`, `frontend_base_url`, `company_list_api_url`, `ses_verified_sender`, `admin_user_ids` (comma-separated Cognito user IDs for admin endpoints).
- **Lambda env** (set by Terraform): same as above plus table names, `USER_POOL_ID`, `CLIENT_ID`, `HANDOVER_LOG_TABLE`, `ADMIN_USER_IDS`.
- **Frontend:** `VITE_API_BASE` for API URL (or dev proxy).

## Decisions to be aware of

- **Registration is @tamu.edu only** (enforced in backend).
- **Handover** is allowed only for users who are **not** already FORMER_STUDENT (403 once linked). Handover History is **admin-only** via `ADMIN_USER_IDS`.
- **Handover audit** is in DynamoDB `handover_log` (INITIATED/SUCCESS/FAILED) with 90-day TTL.
- **Profile** can be updated via PUT `/me` (classYear, linkedInUrl); Cognito custom attributes are updated for class_year where applicable.
- **Forgot/reset password** use Cognito’s ForgotPassword and ConfirmForgotPassword; no custom token in URL.
- **Graduate claim** uses magic-link tokens stored in DynamoDB; links can be emailed via SES or logged to CloudWatch.

## Running locally

- **Infra:** `cd infrastructure && terraform init && terraform apply` (then set `VITE_API_BASE` to the API URL).
- **Frontend:** `cd frontend && npm install && npm run dev`.
- **Scripts:** `./scripts/restart.sh` / `./scripts/shutdown.sh` if present for bring-up/teardown.

## Contacts and links

- Project: CMIS Engagement Platform (ISTM 665), Section 3 — Team Gig 'Em.
- Repo and issue tracker: use your team’s preferred location (e.g. GitHub/GitLab link in README).

## Handover checklist for outgoing team

- [ ] README and docs are up to date.
- [ ] `admin_user_ids` and any secrets are documented (where to set them, not the values in repo).
- [ ] Known limitations or tech debt noted in README or this file.
- [ ] Demo walkthrough (DEMO_SCRIPT.md) tested against current build.
