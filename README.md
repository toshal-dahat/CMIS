# CMIS Engagement Platform

Monorepo for the CMIS Engagement Platform (ISTM 665). This folder contains **Section 3: Team Gig 'Em — External Core**.

## Section 3: External Core (Team Gig 'Em)

Implements:

- **External Auth:** Email/password login via AWS Cognito User Pool. **Forgot password** and **reset password** (Cognito code-by-email flow).

- **Registration:** Any valid email (no @tamu.edu required). Password: 10+ characters with uppercase, lowercase, number, and special character. Optional “Former Student” + class year.
- **Role Logic Engine:** On registration, assigns PARTNER (email domain in Company List), FORMER_STUDENT (former student box + class year), or FRIEND.
- **Graduation Handover:** Two-step flow: (1) verify UIN via lookup (returns student profile, no link); (2) confirm with personal email and password to link account, transferring history and setting role to FORMER_STUDENT.

### Stack

- **Infrastructure:** Terraform (Cognito, DynamoDB, Lambda, API Gateway HTTP API)
- **Backend:** Python 3.12 Lambda (`/services/external-service`)
- **Frontend:** Svelte + Vite (`/frontend`), themed with CSS variables. Hash routing (login, register, profile, handover, forgot-password, claim). Forgot Password and Reset Password flows; Graduation Handover two-step verify-then-link flow.

### AWS Architecture

```
                         ┌──────────────┐
                         │   Browser    │
                         │  (Svelte)    │
                         └──────┬───────┘
                                │ HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                    API Gateway (HTTP API)                          │
└───────────────────────────────────────────────────────────────────┘
                                │ AWS_PROXY
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Lambda (external-service)                       │
└───┬──────────┬──────────┬──────────┬──────────────┬────────┬───────┘
    │          │          │          │              │        │
    ▼          ▼          ▼          ▼              ▼        ▼
┌───────┐ ┌─────────────┐ ┌────────────┐ ┌───────────────┐ ┌────────────┐ ┌─────────┐
│Cognito│ │DynamoDB    │ │DynamoDB    │ │DynamoDB       │ │DynamoDB    │ │   SES   │
│User   │ │external_   │ │students    │ │handover_      │ │handover_   │ │(optional│
│Pool   │ │users       │ │            │ │tokens         │ │log         │ │)        │
└───────┘ └────────────┘ └────────────┘ └───────────────┘ └────────────┘ └─────────┘

┌───────────────────────────────────────────────────────────────────┐
│  EventBridge (cron: 1st of month, 08:00 UTC) → Lambda              │
└───────────────────────────────────────────────────────────────────┘
```

| Flow | Path |
|------|------|
| **Auth** | Browser → API Gateway → Lambda → Cognito + external_users |
| **Forgot / Reset password** | Browser → API Gateway → Lambda → Cognito (code to email, confirm with new password) |
| **Profile (/me)** | Browser + token → API Gateway → Lambda → Cognito + external_users |
| **Handover lookup** | Browser + token → API Gateway → Lambda → students (verify UIN, no link) |
| **Handover link** | Browser + token → API Gateway → Lambda → students + external_users (link UIN) |
| **Graduation scan** | EventBridge → Lambda → students → handover_tokens → SES/CloudWatch |
| **Claim (magic link)** | Browser → API Gateway → Lambda → handover_tokens + Cognito + external_users → SES |

| Component | Purpose |
|-----------|---------|
| **API Gateway** | Entry point; all routes proxy to Lambda |
| **Lambda** | Central backend; auth, forgot/reset password, handover lookup/link, claim, graduation scan |
| **Cognito** | User auth (signup, signin, forgot password, JWT validation) |
| **DynamoDB external_users** | User profiles (email, role, linked UIN) |
| **DynamoDB students** | Eligible graduates (uin, grad_date, personal_email) |
| **DynamoDB handover_tokens** | Magic-link tokens with TTL |
| **DynamoDB handover_log** | Audit log for handover events (TTL 90 days) |
| **EventBridge** | Monthly trigger for graduation scan |
| **SES** | Magic-link & confirmation emails (optional) |

### Quick start

**Shutdown AWS** — remove all resources to avoid charges:

```bash
./scripts/shutdown.sh
```

**After AWS shutdown** — bring everything back:

```bash
./scripts/restart.sh
```

Shutdown runs `terraform destroy`. Restart runs `terraform apply`, seeds students, updates `frontend/.env`, and starts the frontend. Use `restart.sh --no-apply` if infra already exists, or `--no-frontend` to skip starting the dev server.

1. **Infrastructure (Terraform)**

   ```bash
   cd infrastructure
   terraform init
   terraform plan
   terraform apply
   ```

   Then set `VITE_API_BASE` in `frontend/.env` to the API Gateway URL from `terraform output api_gateway_url`.

2. **Frontend (local dev)**

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   For local API testing without Terraform, use a local Lambda (e.g. SAM or a small Flask/FastAPI proxy) or point `VITE_API_BASE` at a deployed API.

3. **Company List (Team Howdy)**

   Role logic expects an optional Company List API. If `COMPANY_LIST_API_URL` is not set, the Lambda uses a stub list (`acme.com`, `partner.org`, `example.com`). Set the env var in Terraform (`variables.tf` / `terraform.tfvars`) when Howdy's API is available.

#### Frontend hosting (off by default — turn on when the project is ready)

Hosting (S3 + CloudFront, optional custom domain) is **disabled by default**. No S3 or CloudFront resources are created until you turn it on.

- **To leave it off:** Do nothing. Use local dev (`npm run dev`) and `frontend_base_url = "http://localhost:5173"` as today.
- **To turn it on later:** Set `enable_frontend_hosting = true` in Terraform (e.g. in `terraform.tfvars` or `-var="enable_frontend_hosting=true"`), then run `terraform apply`. After that you can run `./scripts/deploy-frontend.sh` to build and upload the frontend.

Optional (only when hosting is enabled): `frontend_domain` (e.g. `app.teamgigem.com`), `route53_zone_id` for a custom domain and ACM validation.

### API (External Service)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/signup` | Register (body: `email`, `password`, `formerStudent`, `classYear`). Any valid email; password: 10+ chars, upper, lower, number, special. |
| POST | `/auth/signin` | Sign in (body: `email`, `password`) |
| POST | `/auth/forgot-password` | Request reset code (body: `email`); Cognito sends code to verified email |
| POST | `/auth/reset-password` | Complete reset (body: `email`, `code`, `newPassword`) |
| GET | `/me` | Current user (header: `Authorization: Bearer <accessToken>`) |
| GET | `/graduation-handover/lookup?uin=` | Step 1: verify UIN, return student profile for confirmation (auth required; no link) |
| POST | `/graduation-handover` | Step 2: link external account to Student UIN (auth required; body: `uin`, `personalEmail`, `password`, optional `classYear`) |
| POST | `/graduation-handover/request-link` | Request magic link by email (body: `email`); self-service from UI |
| GET | `/graduation-handover/claim?token=...` | Validate magic-link token; returns `email`, `uin`, `classYear` |
| POST | `/graduation-handover/claim` | Complete claim with `token` and `password` (creates account, links UIN) |

### Graduation handover automation

An EventBridge rule runs monthly (1st at 08:00 UTC) to:

1. Scan the **students** DynamoDB table for `account_status = STUDENT` and `grad_date <= today`
2. Generate time-limited magic-link tokens (7-day TTL)
3. Deliver magic links via **SES email** (if configured) or log to CloudWatch (dev)

#### Email notifications (SES)

To send magic links by email:

1. **Verify a sender in SES**
   - AWS Console → **SES** → **Verified identities** → **Create identity**
   - Choose **Email address** and enter an address you control (e.g. `noreply@yourdomain.com` or your Gmail)
   - Confirm via the verification email

2. **Apply Terraform with the sender**
   ```bash
   terraform apply -var="ses_verified_sender=your-verified@email.com"
   ```
   Or add to `terraform.tfvars`:
   ```hcl
   ses_verified_sender = "your-verified@email.com"
   ```

3. **SES sandbox**  
   In sandbox mode, SES can only send to verified addresses. Either:
   - Verify recipient emails in SES (Verified identities → Create → Email address), or
   - Use your verified email as `personal_email` in the students table so you receive the magic link

#### Testing with dummy data

```bash
# After terraform apply, seed students (6 records: shreya.rprakash@tamu.edu, test25@gmail.com, yashassuresh775@gmail.com, etc.)
./scripts/seed-students.sh

# Trigger scan manually (simulates EventBridge)
aws lambda invoke --function-name cmis-external-external-service \
  --cli-binary-format raw-in-base64-out \
  --payload '{"source":"aws.events","detail-type":"Scheduled Event"}' out.json && cat out.json
```

Alternatively, seed via Python (with `STUDENTS_TABLE` set): `cd services/external-service && python seed_students.py`.

- **With SES:** Check the recipient inbox for the magic link.
- **Without SES:** Magic links are logged in CloudWatch (`/aws/lambda/cmis-external-external-service`). Copy the URL and open in the browser (e.g. `http://localhost:5173/#claim?token=...`).

**Self-service from UI:** On the login page, graduates can click "I'm a graduate — get my claim link", enter their personal email, and either receive the link by email (SES) or see a clickable "Open claim page" button (no SES).

#### Automated tests

```bash
./scripts/test-graduation.sh
```

Optional: set `CLAIM_TOKEN` to test the valid-token flow (get token from CloudWatch logs).

### Code explanation guide

For a detailed walkthrough of the codebase (architecture, data flows, key files), see [docs/CODE_EXPLANATION_GUIDE.md](docs/CODE_EXPLANATION_GUIDE.md).

### Repo structure (per project spec)

```
/frontend          — Shared Svelte app
/services/external-service  — Team Gig 'Em (this section)
/infrastructure    — Terraform (shared + external resources)
```
