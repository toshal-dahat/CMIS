# CMIS Engagement Platform

Monorepo for the CMIS Engagement Platform (ISTM 665).

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Section 3: Team Gig 'Em — External Core](#2-section-3-team-gig-em--external-core)
3. [Section 4: Team Howdy — Admin Core](#3-section-4-team-howdy--admin-core)
4. [Section 5: Team 12th Man — Event Core Services](#4-section-5-team-12th-man--event-core-services)

---

## 1. High-Level Architecture

The CMIS Engagement Platform is a multi-team monorepo built on AWS serverless infrastructure. Each team owns a distinct service layer, all sharing a common Svelte frontend and Cognito authentication.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Browser (Svelte + Vite)                            │
│   LandingPage · ProfileForm · AdminPage · JudgeDashboard · StudentsConnect  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ HTTPS
                    ┌────────────▼────────────┐
                    │   CloudFront (CDN)       │
                    │   S3 (static frontend)   │
                    └────────────┬────────────┘
                                 │
          ┌──────────────────────▼──────────────────────┐
          │           API Gateway (HTTP API)             │
          │  /admin/*  /student/*  /external/*  /comp/* │
          └──┬──────────┬──────────┬──────────┬─────────┘
             │          │          │          │
     ┌───────▼──┐ ┌─────▼────┐ ┌──▼──────┐ ┌▼────────────┐
     │  Admin   │ │ Student  │ │External │ │ Competition │
     │ Service  │ │ Service  │ │ Service │ │  Service    │
     │ (Node.js)│ │ (Node.js)│ │(Python) │ │  (Node.js)  │
     └───┬──────┘ └────┬─────┘ └──┬──────┘ └──┬──────────┘
         │             │           │            │
         ▼             ▼           ▼            ▼
   ┌──────────┐  ┌──────────┐ ┌────────┐  ┌──────────────┐
   │DynamoDB  │  │DynamoDB  │ │Cognito │  │  DynamoDB    │
   │Companies │  │Profiles  │ │  +     │  │Competitions  │
   │Tiers     │  │Resumes   │ │Dynamo  │  │Teams/Scores  │
   │Theme     │  │Skills    │ │  +SES  │  │Submissions   │
   └──────────┘  └──────────┘ └────────┘  └──────┬───────┘
                                                   │
                                            ┌──────▼───────┐
                                            │  S3 Bucket   │
                                            │ (Submissions)│
                                            │ Textract +   │
                                            │ Bedrock AI   │
                                            └──────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  Cognito User Pool — shared across all services (JWT auth)                  │
│  Groups: Admin · SuperAdmin · Judge · Student                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  EventBridge                                                                │
│  · Monthly cron → External Service (graduation scan)                        │
│  · Annual cron  → External Service (mentorship batch matching)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Team | Purpose |
|-----------|------|---------|
| Frontend (Svelte) | Shared | UI for all user roles — student, admin, judge |
| Admin Service (Node.js) | Team Howdy | Companies, Tiers, Theme config CRUD |
| Student Service (Node.js) | Team Reveille | Student profiles, resumes, events, mentorship |
| External Service (Python) | Team Gig 'Em | External auth, graduation handover, mentorship matching |
| Competition Service (Node.js) | Team 12th Man | Case competitions, judge dashboard, AI scoring |
| Cognito User Pool | Shared | JWT auth, user groups, Google SSO |
| DynamoDB | Shared | Per-service tables (see DATABASE_TABLES_MAPPING.md) |
| S3 | Shared | Resume PDFs, competition submission PDFs, frontend assets |
| Bedrock (Claude / Titan) | AI | Submission summarization, mentorship narration, embeddings |
| Textract | AI | PDF text extraction for competition submissions |
| EventBridge | Automation | Graduation scan, mentorship batch matching |
| SES | Email | Magic links, mentorship accept/decline notifications |

---

## 2. Section 4: Team Howdy — Admin Core

More details: https://docs.google.com/document/d/1n4-mZOGtvM6s2Ns6CHrL51WLDamTGFg2gBCWh4Wa1lw/edit?tab=t.0

Implements the SaaS configuration layer: Company management, Tier definitions, and Whitelabel Theme settings.

### Stack

- **Infrastructure:** Terraform (DynamoDB, Lambda, API Gateway)
- **Backend:** Node.js Lambda (`/services/admin-service`)
- **Frontend:** Svelte Admin Dashboard (`/frontend/src/lib/AdminPage.svelte`)

### AWS Architecture

```
┌──────────────┐
│   Browser    │
│ AdminPage    │
│ (Svelte)     │
└──────┬───────┘
       │ HTTPS
       ▼
┌─────────────────────────────┐
│  API Gateway (HTTP API)     │
│  Base: /admin               │
└──────────┬──────────────────┘
           │ AWS_PROXY
           ▼
┌─────────────────────────────┐
│  Lambda (admin-service)     │
└──┬──────────┬───────────────┘
   │          │
   ▼          ▼
┌────────┐ ┌────────┐
│Dynamo  │ │Dynamo  │
│Companies│ │Tiers + │
│        │ │Theme   │
└────────┘ └────────┘
```

### Base URL

```
https://kxqvafya37.execute-api.us-east-1.amazonaws.com/test
```

### Admin API Endpoints

#### Config API

##### GET /config

Returns aggregated theme + tiers in a single call. Used by the frontend on initial load.

**Response:**
```json
{
  "theme": {
    "primaryColor": "#500000",
    "secondaryColor": "#FFFFFF",
    "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
    "updatedAt": "2026-02-14T10:00:00Z"
  },
  "tiers": [
    {
      "tierId": "gold",
      "name": "Gold",
      "rank": 1,
      "earlyAccessHours": 48,
      "createdAt": "2026-02-14T10:00:00Z",
      "updatedAt": "2026-02-16T07:29:19.356Z"
    },
    {
      "tierId": "silver",
      "name": "Silver",
      "rank": 2,
      "earlyAccessHours": 24,
      "createdAt": "2026-02-14T10:00:00Z",
      "updatedAt": "2026-02-16T07:29:07.934Z"
    }
  ],
  "timestamp": "2026-02-16T07:37:39.554Z"
}
```

---

#### Theme API

##### GET /theme

Fetches platform branding.

**Response:**
```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
  "updatedAt": "2026-02-14T10:00:00Z"
}
```

##### PUT /theme

Updates platform branding. Requires Admin role.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `primaryColor` | string | No | Hex color code (e.g. `#500000`) |
| `secondaryColor` | string | No | Hex color code (e.g. `#FFFFFF`) |
| `logoUrl` | string | No | Full URL to logo image |

```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoUrl": "https://cdn.cmis.tamu.edu/logo.png"
}
```

**Response:**
```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

---

#### Tiers API

##### GET /tiers

Lists all tiers sorted by rank (ascending).

**Response:**
```json
[
  {
    "tierId": "gold",
    "name": "Gold",
    "rank": 1,
    "earlyAccessHours": 48,
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-16T07:29:19.356Z"
  },
  {
    "tierId": "silver",
    "name": "Silver",
    "rank": 2,
    "earlyAccessHours": 24,
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-16T07:29:07.934Z"
  }
]
```

##### POST /tiers

Creates a new tier. Requires Admin role.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tierId` | string | Yes | Unique identifier (e.g. `bronze`) |
| `name` | string | Yes | Display name |
| `rank` | number | Yes | Hierarchy rank (lower = more exclusive) |
| `earlyAccessHours` | number | Yes | Hours of early event access |

```json
{
  "tierId": "bronze",
  "name": "Bronze",
  "rank": 3,
  "earlyAccessHours": 12
}
```

**Response — 201 Created:**
```json
{
  "tierId": "bronze",
  "name": "Bronze",
  "rank": 3,
  "earlyAccessHours": 12,
  "createdAt": "2026-02-16T08:00:00.000Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

##### PUT /tiers/{tierId}

Updates an existing tier.

**Request Body (all fields optional):**
```json
{
  "name": "Gold Plus",
  "rank": 1,
  "earlyAccessHours": 72
}
```

**Response:**
```json
{
  "tierId": "gold",
  "name": "Gold Plus",
  "rank": 1,
  "earlyAccessHours": 72,
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

##### DELETE /tiers/{tierId}

Deletes a tier. Blocked if any company is currently assigned to it.

**Response — 200 OK:**
```json
{ "message": "Tier deleted" }
```

**Response — 409 Conflict:**
```json
{ "message": "Cannot delete: Tier is assigned to active companies." }
```

---

#### Companies API

##### GET /companies

Lists all partner companies.

**Response:**
```json
[
  {
    "companyId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "ExxonMobil",
    "domain": "exxonmobil.com",
    "tierId": "gold",
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-14T10:00:00Z"
  }
]
```

##### GET /companies/{companyId}

Fetches a single company by ID.

**Response:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold",
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-14T10:00:00Z"
}
```

##### GET /companies/domain/{domain}

Domain lookup used by Team Gig 'Em during registration to assign PARTNER role.

**Response — 200 Found:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold"
}
```

**Response — 404 Not Found:**
```json
{ "message": "Not a partner" }
```

##### POST /companies

Registers a new partner company. Requires Admin role.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Company display name |
| `domain` | string | Yes | Email domain (e.g. `exxonmobil.com`) |
| `tierId` | string | Yes | Must match an existing tier ID |

```json
{
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold"
}
```

**Response — 201 Created:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold",
  "createdAt": "2026-02-16T08:00:00.000Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

##### PUT /companies/{companyId}

Updates an existing company.

**Request Body (all fields optional):**
```json
{
  "name": "ExxonMobil Corporation",
  "domain": "exxonmobil.com",
  "tierId": "platinum"
}
```

**Response:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil Corporation",
  "domain": "exxonmobil.com",
  "tierId": "platinum",
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

##### DELETE /companies/{companyId}

Removes a partner company.

**Response:**
```json
{ "message": "Deleted" }
```

---

### Admin API Summary Table

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config` | Public | Aggregated theme + tiers |
| GET | `/theme` | Public | Platform branding |
| PUT | `/theme` | Admin | Update branding |
| GET | `/tiers` | Public | List all tiers |
| POST | `/tiers` | Admin | Create tier |
| PUT | `/tiers/{tierId}` | Admin | Update tier |
| DELETE | `/tiers/{tierId}` | Admin | Delete tier |
| GET | `/companies` | Public | List all companies |
| GET | `/companies/{companyId}` | Public | Get single company |
| GET | `/companies/domain/{domain}` | Public | Domain lookup |
| POST | `/companies` | Admin | Create company |
| PUT | `/companies/{companyId}` | Admin | Update company |
| DELETE | `/companies/{companyId}` | Admin | Delete company |

### Admin UI Features

The Admin Dashboard (`/frontend/src/lib/AdminPage.svelte`) provides:

- **Companies** — Add, edit, delete partner companies with tier assignment
- **Tiers** — Create and manage tier hierarchy with rank and early access hours
- **Theme** — Update primary/secondary colors and logo URL with live color preview
- Role-based access: Admin Dashboard card only visible to users in the `Admin` Cognito group

### Quick Start (Admin Service)

```bash
cd infrastructure
terraform init && terraform apply

cd frontend
npm install && npm run dev
```

Set `VITE_CONFIG_API_URL`, `VITE_COMPANIES_API_URL`, `VITE_TIERS_API_URL`, and `VITE_THEME_API_URL` in `frontend/.env`.

---

### Team Submission Portal (Bounty 13)

Secure file upload for competition teams. Associates each submission with a `teamId`, enforces the competition's submission deadline, and accepts only PDF, PPT, and PPTX files.

#### Submission Upload Architecture

```
Browser (Team Member)
        │
        │  1. POST /submissions/upload-url  →  Lambda returns presigned PUT URL
        │  2. PUT <presigned URL>           →  Browser uploads file directly to S3
        │  3. POST /submissions/complete    →  Lambda verifies file exists, saves metadata
        ▼
API Gateway → Lambda (competition-service)
                    │
                    ├── DynamoDB (CompetitionSubmissions) — stores metadata
                    └── S3 (tamu-competition-submissions-*) — stores file
```

Key behaviours:
- Deadline check happens at step 1. If `submissionDeadline` has passed, the request is rejected before any S3 interaction.
- File type is validated at step 1. Only `application/pdf`, `application/vnd.ms-powerpoint`, and `application/vnd.openxmlformats-officedocument.presentationml.presentation` are accepted.
- S3 key format: `submissions/{competitionId}/{teamId}/{uuid}.{ext}` — ties every file to a specific team and competition.
- After step 3 completes, an AI summary is kicked off asynchronously via Textract + Bedrock.

#### Base URL

```
https://jpvyfqad9i.execute-api.us-east-1.amazonaws.com/dev
```

#### POST /api/competitions/{competitionId}/submissions/upload-url

Requests a presigned S3 PUT URL. Validates file type and enforces the submission deadline.

**Auth:** Required (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `competitionId` | string | UUID of the competition |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `teamId` | string | Yes | UUID of the team submitting |
| `fileName` | string | Yes | Original file name (e.g. `team-alpha.pdf`) |
| `fileType` | string | No | MIME type. Accepted: `application/pdf`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`. Defaults to `application/pdf`. |

**Sample Request:**
```http
POST /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/submissions/upload-url
Authorization: Bearer eyJraWQiOiJxxx...
Content-Type: application/json

{
  "teamId": "team-alpha-uuid",
  "fileName": "spring-2026-submission.pdf",
  "fileType": "application/pdf"
}
```

**Response — 200 OK:**
```json
{
  "uploadUrl": "https://tamu-competition-submissions-dev-123456789.s3.amazonaws.com/submissions/c3d8f43d/team-alpha-uuid/a1b2c3d4.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "s3Key": "submissions/c3d8f43d-3465-41fd-9ef6-abc123/team-alpha-uuid/a1b2c3d4.pdf",
  "submissionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "expiresInSeconds": 120
}
```

**Response — 400 DEADLINE_PASSED:**
```json
{ "error": "DEADLINE_PASSED", "message": "Submission deadline has passed" }
```

**Response — 400 BAD_REQUEST (invalid file type):**
```json
{ "error": "BAD_REQUEST", "message": "Only PDF, PPT, and PPTX files are accepted" }
```

**Response — 404 NOT_FOUND:**
```json
{ "error": "NOT_FOUND", "message": "Competition not found" }
```

---

#### PUT {uploadUrl}

Upload the file directly to S3 using the presigned URL. This call goes directly to S3 — not through API Gateway.

| Header | Value |
|--------|-------|
| `Content-Type` | Must match the `fileType` used in the upload-url request |

**Response — 200 OK** (from S3, empty body)

---

#### POST /api/competitions/{competitionId}/submissions/complete

Confirms the upload by verifying the file exists in S3 and saving metadata to DynamoDB. Must be called after the presigned PUT succeeds.

**Auth:** Required (Bearer token)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `teamId` | string | Yes | UUID of the team |
| `s3Key` | string | Yes | The `s3Key` returned from the upload-url response |
| `fileName` | string | No | Original file name for display |
| `fileType` | string | No | MIME type of the uploaded file |

**Sample Request:**
```http
POST /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/submissions/complete
Authorization: Bearer eyJraWQiOiJxxx...
Content-Type: application/json

{
  "teamId": "team-alpha-uuid",
  "s3Key": "submissions/c3d8f43d-3465-41fd-9ef6-abc123/team-alpha-uuid/a1b2c3d4.pdf",
  "fileName": "spring-2026-submission.pdf",
  "fileType": "application/pdf"
}
```

**Response — 200 OK:**
```json
{
  "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
  "teamId": "team-alpha-uuid",
  "s3Key": "submissions/c3d8f43d-3465-41fd-9ef6-abc123/team-alpha-uuid/a1b2c3d4.pdf",
  "fileName": "spring-2026-submission.pdf",
  "fileType": "application/pdf",
  "submittedAt": "2026-03-15T14:30:00.000Z",
  "updatedAt": "2026-03-15T14:30:00.000Z"
}
```

**Response — 404 NOT_FOUND:**
```json
{ "error": "NOT_FOUND", "message": "File not found in S3. Ensure the file was uploaded before confirming." }
```

---

#### GET /api/competitions/{competitionId}/submissions/{teamId}/download-url

Returns a presigned GET URL for viewing or downloading a team's submission. Used by the Judge Dashboard PDF viewer.

**Auth:** Required (Bearer token)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `competitionId` | string | UUID of the competition |
| `teamId` | string | UUID of the team |

**Sample Request:**
```http
GET /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/submissions/team-alpha-uuid/download-url
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
{
  "downloadUrl": "https://tamu-competition-submissions-dev-123456789.s3.amazonaws.com/submissions/.../a1b2c3d4.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "expiresInSeconds": 300,
  "submission": {
    "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
    "teamId": "team-alpha-uuid",
    "s3Key": "submissions/c3d8f43d-3465-41fd-9ef6-abc123/team-alpha-uuid/a1b2c3d4.pdf",
    "fileName": "spring-2026-submission.pdf",
    "fileType": "application/pdf",
    "submittedAt": "2026-03-15T14:30:00.000Z"
  }
}
```

**Response — 404 NOT_FOUND:**
```json
{ "error": "NOT_FOUND", "message": "No submission found for this team" }
```

---

#### Submission API Summary Table

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/competitions/{cid}/submissions/upload-url` | Required | Get presigned PUT URL; validates file type and deadline |
| PUT | `{uploadUrl}` (S3 direct) | Presigned | Upload file bytes directly to S3 |
| POST | `/api/competitions/{cid}/submissions/complete` | Required | Confirm upload; save metadata to DynamoDB |
| GET | `/api/competitions/{cid}/submissions/{teamId}/download-url` | Required | Get presigned GET URL for viewing/downloading |

#### Submission Common Error Responses

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `BAD_REQUEST` | Missing required field or invalid file type |
| 400 | `DEADLINE_PASSED` | Competition submission deadline has passed |
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 404 | `NOT_FOUND` | Competition or submission not found; file not in S3 |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error |

---

### The Vault — Secure S3 Storage (Bounty 14)

Private S3 bucket for all competition submission files. No object is accessible via a direct URL — all access is exclusively through short-lived presigned URLs generated by the Lambda.

#### S3 Bucket Name

```
tamu-competition-submissions-{stage}-{aws-account-id}
```

Example: `tamu-competition-submissions-dev-123456789012`

#### Security Controls

| Control | Configuration | Effect |
|---------|--------------|--------|
| Block Public ACLs | `block_public_acls = true` | Prevents any ACL from granting public read/write |
| Block Public Policy | `block_public_policy = true` | Rejects any bucket policy that grants public access |
| Ignore Public ACLs | `ignore_public_acls = true` | Ignores any existing public ACLs on objects |
| Restrict Public Buckets | `restrict_public_buckets = true` | Blocks all cross-account and public access |
| Server-Side Encryption | AES-256 (SSE-S3) | All objects encrypted at rest automatically |
| Bucket Policy — DenyNonPresignedAccess | `s3:authType != REST-QUERY-STRING` | Blocks any `GetObject` that is not a presigned query-string request |
| Bucket Policy — DenyHTTP | `aws:SecureTransport = false` | Blocks all S3 actions over plain HTTP; HTTPS only |
| Lifecycle Guard | `prevent_destroy = true` | Terraform cannot accidentally delete the bucket |

#### CORS Configuration

| Setting | Value |
|---------|-------|
| Allowed Methods | `PUT`, `GET`, `HEAD` |
| Allowed Headers | `*` |
| Allowed Origins | `*` |
| Exposed Headers | `ETag` |

#### IAM — Lambda Permissions

The competition-service Lambda is granted the following on `submissions/*`:

| Action | Purpose |
|--------|---------|
| `s3:PutObject` | Generate presigned PUT URLs for team uploads |
| `s3:GetObject` | Generate presigned GET URLs for judge downloads + Textract extraction |
| `s3:HeadObject` | Verify file exists after upload (complete endpoint) |
| `s3:DeleteObject` | Reserved for future submission replacement |

#### Presigned URL TTLs

| Operation | TTL | Used by |
|-----------|-----|---------|
| Upload (PUT) | 120 seconds | Team upload flow |
| Download (GET) | 300 seconds | Judge PDF viewer |

#### Verifying the Vault

```bash
# 1. Get your account ID
aws sts get-caller-identity --query Account --output text

# 2. Confirm all public access block flags are true
aws s3api get-public-access-block \
  --bucket tamu-competition-submissions-dev-<account-id>

# 3. Confirm bucket policy is applied
aws s3api get-bucket-policy \
  --bucket tamu-competition-submissions-dev-<account-id>

# 4. Confirm a direct URL returns 403
curl -I "https://tamu-competition-submissions-dev-<account-id>.s3.amazonaws.com/submissions/some-key.pdf"
# Expected: HTTP/1.1 403 Forbidden

# 5. List objects (requires AWS credentials)
aws s3 ls s3://tamu-competition-submissions-dev-<account-id>/submissions/ --recursive
```

---

### Judge's Dashboard, Scorecard & AI Summary, Feedback Synthesis (Bounties 17, 18, 19)

These three bounties form the complete judging pipeline: viewing assigned teams, scoring submissions with AI assistance, and synthesizing all judge feedback into a single narrative.

#### Judging Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Judge (Browser)                               │
│  JudgeDashboard.svelte                                           │
│  · Lists assigned competitions + teams                           │
│  · PDF viewer for submissions (SubmissionViewer.svelte)          │
│  · Scoring modal with AI Summary panel + rubric sliders          │
│  · FeedbackCard.svelte — shows synthesized narrative post-release│
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTPS
                       ▼
              API Gateway → Lambda (competition-service)
                       │
          ┌────────────┼────────────────────┐
          ▼            ▼                    ▼
    DynamoDB      DynamoDB             S3 + Textract
  JudgeAssignments  Scores/Submissions   + Bedrock Claude
  CompetitionTeams  SynthesizedFeedback  (AI summary &
  Competitions                           synthesis)
```

**Flow:**
1. Judge opens dashboard → `GET /api/judge/assignments` → `GET /api/judge/competitions/:cid/teams`
2. Judge clicks "View" → `GET /api/competitions/:cid/submissions/:tid/download-url` → PDF loads in browser
3. Judge clicks "Grade" → scoring modal opens; clicks "Generate Summary" → `POST /api/judge/competitions/:cid/teams/:tid/summary` → Textract + Bedrock returns 1-page AI summary
4. Judge submits ratings + feedback → `POST /api/judge/competitions/:cid/teams/:tid/score`
5. After `feedbackReleaseDate` passes → `GET /api/competitions/:cid/teams/:tid/synthesized-feedback` returns Bedrock-rewritten narrative

#### Bounty 17 — Judge's Dashboard

##### GET /api/judge/assignments

Returns all competitions where the authenticated user is assigned as a judge.

**Auth:** Required (Bearer token)

**Sample Request:**
```http
GET /api/judge/assignments
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
[
  {
    "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
    "judgeUserId": "cognito-sub-uuid",
    "judgeName": "judge@tamu.edu",
    "judgeEmail": "judge@tamu.edu",
    "teamIds": ["team-alpha-uuid", "team-beta-uuid", "team-gamma-uuid"],
    "assignedAt": "2026-03-01T10:00:00.000Z"
  }
]
```

---

##### GET /api/judge/competitions/{competitionId}/teams

Returns teams assigned to this judge, enriched with submission status, grading status, and score total. Sorted by `scoreTotal` descending.

**Auth:** Required (Bearer token) + must be assigned as judge for this competition

**Sample Request:**
```http
GET /api/judge/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
[
  {
    "teamId": "team-alpha-uuid",
    "teamName": "Team Alpha",
    "members": ["Alice Johnson", "Bob Smith", "Carol Davis"],
    "hasSubmission": true,
    "gradingStatus": "GRADED",
    "scoreTotal": 42,
    "score": {
      "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
      "feedback": "Strong presentation.",
      "gradedAt": "2026-03-15T10:00:00.000Z"
    }
  },
  {
    "teamId": "team-beta-uuid",
    "teamName": "Team Beta",
    "hasSubmission": false,
    "gradingStatus": "PENDING",
    "scoreTotal": null,
    "score": null
  }
]
```

**Response — 403 FORBIDDEN:**
```json
{ "error": "FORBIDDEN", "message": "You are not assigned as a judge for this competition" }
```

---

#### Bounty 18 — Judge's Scorecard & AI Summary

##### POST /api/judge/competitions/{competitionId}/teams/{teamId}/summary

Generates (or returns cached) a 1-page AI summary via Textract + Bedrock Claude. Rate-limited to once per 60 seconds per team.

**Auth:** Required (Bearer token) + must be assigned as judge

**Sample Request:**
```http
POST /api/judge/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/summary
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
{
  "summary": "## Overview\nTeam Alpha presents a compelling solution...\n\n### Presentation Quality\n- Clear slide structure",
  "cached": false,
  "updatedAt": "2026-03-15T10:05:00.000Z"
}
```

**Response — 429 RATE_LIMITED:**
```json
{ "error": "RATE_LIMITED", "message": "Please wait 45 seconds before requesting another summary", "retryAfterSeconds": 45 }
```

**Response — 413 PAYLOAD_TOO_LARGE:**
```json
{ "error": "PAYLOAD_TOO_LARGE", "message": "Submission is 18MB which exceeds the 15MB summarization limit" }
```

---

##### GET /api/judge/competitions/{competitionId}/teams/{teamId}/score

Returns this judge's existing score for a team.

**Auth:** Required (Bearer token) + must be assigned as judge

**Sample Request:**
```http
GET /api/judge/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/score
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
{
  "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
  "teamId": "team-alpha-uuid",
  "judgeUserId": "cognito-sub-uuid",
  "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
  "feedback": "Strong presentation.",
  "status": "GRADED",
  "gradedAt": "2026-03-15T10:00:00.000Z"
}
```

---

##### POST /api/judge/competitions/{competitionId}/teams/{teamId}/score

Submits or updates a score. Validates all rubric criteria are present and within range.

**Auth:** Required (Bearer token) + must be assigned to this specific team

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ratings` | object | Yes | Criterion key → score (1–10). Must include all rubric criteria. |
| `feedback` | string | No | Written feedback text |

**Default rubric criteria:** `presentation`, `analysis`, `creativity`, `feasibility`, `teamwork` (all 1–10)

**Sample Request:**
```http
POST /api/judge/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/score
Authorization: Bearer eyJraWQiOiJxxx...
Content-Type: application/json

{
  "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
  "feedback": "Strong presentation. Could improve feasibility analysis."
}
```

**Response — 201 Created:**
```json
{
  "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
  "teamId": "team-alpha-uuid",
  "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
  "feedback": "Strong presentation. Could improve feasibility analysis.",
  "status": "GRADED",
  "gradedAt": "2026-03-15T10:00:00.000Z"
}
```

**Response — 400 BAD_REQUEST:**
```json
{ "error": "BAD_REQUEST", "message": "Missing rating for criterion \"creativity\"" }
```

---

#### Bounty 19 — Feedback Synthesis

##### GET /api/competitions/{competitionId}/teams/{teamId}/feedback

Returns aggregated raw judge feedback. Returns `423 Locked` if `feedbackReleaseDate` hasn't passed.

**Auth:** Required (Bearer token)

**Sample Request:**
```http
GET /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/feedback
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK (released):**
```json
{
  "released": true,
  "releasedAt": "2026-05-01T00:00:00.000Z",
  "feedbackCount": 3,
  "totalJudges": 5,
  "feedback": [
    {
      "feedback": "Strong presentation with creative solutions.",
      "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
      "gradedAt": "2026-03-15T10:00:00.000Z"
    }
  ]
}
```

**Response — 423 Locked:**
```json
{
  "error": "FEEDBACK_LOCKED",
  "message": "Feedback has not been released yet",
  "released": false,
  "releasedAt": "2026-05-01T00:00:00.000Z",
  "totalJudges": 5
}
```

---

##### GET /api/competitions/{competitionId}/teams/{teamId}/synthesized-feedback

Returns the Bedrock-synthesized narrative. Enforces `feedbackReleaseDate`.

**Auth:** Required (Bearer token)

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `refresh` | boolean | Pass `true` to force regeneration |

**Sample Request:**
```http
GET /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/synthesized-feedback
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
{
  "narrative": "Your team demonstrated exceptional creativity. The presentation was polished and well-structured. To strengthen future submissions, consider deepening the feasibility analysis.",
  "synthesizedAt": "2026-05-01T08:00:00.000Z",
  "averageScores": { "presentation": 8.2, "analysis": 8.6, "creativity": 8.8, "feasibility": 6.8, "teamwork": 8.4 },
  "cached": true
}
```

**Response — 403 FEEDBACK_NOT_RELEASED:**
```json
{ "error": "FEEDBACK_NOT_RELEASED", "message": "Feedback has not been released yet.", "releaseDate": "2026-05-01T00:00:00.000Z" }
```

---

##### POST /api/competitions/{competitionId}/teams/{teamId}/synthesize

Admin-only trigger for Bedrock synthesis.

**Auth:** Required (Bearer token) + Admin group

**Sample Request:**
```http
POST /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/teams/team-alpha-uuid/synthesize
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 201 Created:**
```json
{
  "narrative": "Your team demonstrated exceptional creativity...",
  "synthesizedAt": "2026-05-01T08:00:00.000Z",
  "judgeCount": 3,
  "cached": false
}
```

---

##### GET /api/competitions/{competitionId}/scores

Returns all judge scores for a competition. Admin only.

**Auth:** Required (Bearer token) + Admin group

**Sample Request:**
```http
GET /api/competitions/c3d8f43d-3465-41fd-9ef6-abc123/scores
Authorization: Bearer eyJraWQiOiJxxx...
```

**Response — 200 OK:**
```json
[
  {
    "competitionId": "c3d8f43d-3465-41fd-9ef6-abc123",
    "teamId": "team-alpha-uuid",
    "judgeUserId": "judge-1-sub",
    "ratings": { "presentation": 9, "analysis": 8, "creativity": 9, "feasibility": 7, "teamwork": 9 },
    "feedback": "Strong presentation.",
    "status": "GRADED",
    "gradedAt": "2026-03-15T10:00:00.000Z"
  }
]
```

---

#### Judging API Summary Table (Bounties 17–19)

| Method | Path | Auth | Bounty | Description |
|--------|------|------|--------|-------------|
| GET | `/api/judge/assignments` | Judge | 17 | List competitions assigned to this judge |
| GET | `/api/judge/competitions/{cid}/teams` | Judge | 17 | List assigned teams enriched with status + score |
| POST | `/api/judge/competitions/{cid}/teams/{tid}/summary` | Judge | 18 | Generate/fetch AI summary of submission |
| GET | `/api/judge/competitions/{cid}/teams/{tid}/score` | Judge | 18 | Get this judge's score for a team |
| POST | `/api/judge/competitions/{cid}/teams/{tid}/score` | Judge | 18 | Submit or update score + feedback |
| GET | `/api/competitions/{cid}/teams/{tid}/feedback` | Auth | 19 | Get raw judge feedback (enforces release date) |
| GET | `/api/competitions/{cid}/teams/{tid}/synthesized-feedback` | Auth | 19 | Get AI-synthesized narrative (enforces release date) |
| POST | `/api/competitions/{cid}/teams/{tid}/synthesize` | Admin | 19 | Manually trigger Bedrock synthesis |
| GET | `/api/competitions/{cid}/scores` | Admin | 18/19 | All scores for a competition |

#### Judging Common Error Responses

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `BAD_REQUEST` | Missing field or rating out of range |
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 403 | `FORBIDDEN` | Not assigned to this team/competition |
| 403 | `FEEDBACK_NOT_RELEASED` | Synthesized feedback requested before release date |
| 404 | `NOT_FOUND` | Competition, team, submission, or score not found |
| 413 | `PAYLOAD_TOO_LARGE` | Submission exceeds 15MB summarization limit |
| 423 | `FEEDBACK_LOCKED` | Raw feedback requested before release date |
| 429 | `RATE_LIMITED` | AI summary requested too soon (60s cooldown) |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error |
| 502 | `AI_ERROR` | Bedrock or Textract call failed |

---

## 3. Section 3: Team Gig 'Em — External Core

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

| Component | Purpose |
|-----------|---------|
| **API Gateway** | Entry point; all routes proxy to Lambda |
| **Lambda** | Central backend; auth, forgot/reset password, graduation-status prompt check, and handover lookup/link |
| **Cognito** | User auth (signup, signin, forgot password, JWT validation) |
| **DynamoDB external_users** | User profiles (email, role, linked UIN) |
| **DynamoDB students** | Eligible graduates (uin, grad_date, personal_email) |
| **DynamoDB handover_log** | Audit log for handover events (TTL 90 days) |
| **EventBridge** | Monthly trigger for graduation scan |

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
| GET | `/graduation-status?gradDate=...` | Prompt decision for "Have you graduated?" popup |
| GET | `/graduation-handover/lookup?uin=` | Step 1: verify UIN, return student profile for confirmation (auth required; no link) |
| POST | `/graduation-handover` | Step 2: link external account to Student UIN (auth required; body: `uin`, `personalEmail`, `password`, optional `classYear`) |
The working graduation handover UX is popup-driven on landing (`/graduation-status`) followed by authenticated direct linking (`/graduation-handover`).

#### Automated tests

```bash
./scripts/test-graduation.sh
```


### Code explanation guide

For a detailed walkthrough of the codebase (architecture, data flows, key files), see [docs/CODE_EXPLANATION_GUIDE.md](docs/CODE_EXPLANATION_GUIDE.md).

### Repo structure (per project spec)

```
/frontend          — Shared Svelte app
/services/external-service  — Team Gig 'Em (this section)
/infrastructure    — Terraform (shared + external resources)
```

---

## 4. Section 5: Team 12th Man — Event & Competition Core

## Event Service

The Event Service is a core microservice of the CMIS platform, responsible for managing event lifecycles, RSVPs, waitlists, and attendee notifications.

```mermaid
graph TD
    UI[Browser: EventsDashboard] -->|HTTPS| CF[CloudFront]
    CF --> APIG[API Gateway]
    APIG -->|/api/events/*| L[Node.js Lambda]
    L -->|CRUD & Opt. Locking| DB1[(DynamoDB: Events)]
    L -->|TransactWriteItems| DB2[(DynamoDB: EventRsvps)]
    DB2 -->|Streams| MAIL[SES Email]
```

## Frontend UI & Filtering
The client-side catalog is powered by Svelte in `frontend/src/lib/EventsDashboard.svelte`.
- **Client-Side Filtering**: Users can filter events by Category and Date instantly without additional network requests.
- **Dynamic Velvet Rope Feedback**: The UI visually disables the RSVP button and renders live countdown timers (`Opens for Silver Partners in 2 days`) by running the math engine (`velvetRope.ts`) locally against the fetched global config.

## Environment Variables & Setup
To run the Event Service locally, ensure the following environment variables are set in your frontend `.env`:
- `VITE_EVENT_API_URL`: Points to your local `http://localhost:3005` or the remote API Gateway.

## Deep-Dive Documentation
For the full handover documentation regarding this section, please review:
- **[API Reference (Events)](docs/API_REFERENCE_EVENTS.md)**: Full endpoint payloads and status codes.
- **[Code Explanation Guide](docs/CODE_EXPLANATION_GUIDE.md#11-event-core-team-12th-man)**: In-depth technical breakdown of the architecture.
## Core Logic & Mechanics

### 1. The Velvet Rope (Partner Early Access)
This system gates event RSVPs based on user domains to provide partner companies with priority access.
- **How it works**: When a user RSVPs, the system calculates an `Unlock Time`:
  `UnlockTime = EventStartTime - EarlyAccessHours`
- **Lookup Flow**:
  1.  **Domain API**: Calls Team Howdy's Admin API (`GET /domain/{domain}`) to resolve the user's email domain to a `tierId`.
  2.  **Config API**: Calls `GET /config` to fetch the global `earlyAccessHours` for that tier.
- **Tier Overrides**: Admins can set event-specific overrides (e.g., "Silver gets 12 hours for this specific event") which take precedence over global defaults.
- **Exemptions**: Users in `students` or `alumni` Cognito groups, the event creator, and admins bypass the Velvet Rope entirely and can RSVP immediately.
- **Fail-Closed**: If Team Howdy's API is unresponsive, the service returns a `503 Service Unavailable` to prevent unauthorized early access.

### 2. Atomic Transactions & Optimistic Locking
- **RSVP Transactions**: We use `TransactWriteItems` to atomically increment `currentRsvps` and insert an RSVP record. This prevents over-booking during high-concurrency bursts.
- **Optimistic Locking**: The `Events` table uses a `version` attribute. Any `PUT /api/events/:id` request **must** include the current version. The update will fail with a `409 Conflict` if the version in the database has changed since it was last read, protecting against concurrent edit conflicts.

### 3. Smart Waitlisting
When an event is full, users are added to a waitlist.
- **Prioritization**: The waitlist is sorted by **Tier Rank** (Gold=1, Silver=2, Student=99) then by **Timestamp** (FIFO).
- **Atomic Promotion**: When a confirmed user cancels, the service automatically identifies the highest-priority person on the waitlist and promotes them to `CONFIRMED` in a single atomic transaction.

## API Routes

### Public Routes
- `GET /api/events`: List all upcoming events.
- `GET /api/events/:eventId`: Get detailed information about a specific event.

### Authenticated User Routes
- `POST /api/events/:eventId/rsvp`: RSVP to an event (handles waitlisting & Velvet Rope).
- `DELETE /api/events/:eventId/rsvp`: Cancel an existing RSVP (triggers waitlist promotion).
- `GET /api/events/user/rsvps`: List all events the user has RSVP'd to.

### Admin Routes
- `POST /api/events`: Create a new event.
- `PUT /api/events/:eventId`: Update event details.
- `DELETE /api/events/:eventId`: Remove an event.
- `GET /api/events/:eventId/rsvp`: List all RSVPs for an event.

## DynamoDB Tables

### Events-{stage}
- **Partition Key**: `eventId` (String)
- **Attributes**: `title`, `date`, `location`, `category`, `capacity`, `currentRsvps`, `version`, `createdBy`, `createdAt`.
- **Notes**: Uses `version` field for optimistic locking during updates.

### EventRsvps-{stage}
- **Partition Key**: `eventId` (String)
- **Sort Key**: `userId` (String)
- **GSI**: `userId-index` (PK: `userId`)
- **Attributes**: `status` (CONFIRMED/WAITLISTED), `userEmail`, `rsvpAt`, `waitlistedAt`, `confirmedAt`, `tierRank`, `checkedIn`.
- **Streams**: Enabled (used for sending automated confirmation/promotion emails).

## Local Development

To run the service locally without AWS dependencies:

```bash
cd services/event-service
npm install
node server.js
```

The local server mocks DynamoDB in-memory and bypasses real Cognito verification unless configured.

## Testing

- `node test-waitlist.js`: Comprehensive test for RSVP, waitlist, and Velvet Rope logic.
- `node test-auth-endpoints.js`: Tests for authentication middleware and route protection.
- `node test-lambda.js`: Smoke tests for the Lambda entry point.
- `node test-lambda-prod.js`: Tests for stage-prefix handling in production environments.
