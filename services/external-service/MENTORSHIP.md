# Mentorship program – product flow and engineering notes

This document summarizes the **mentorship opt-in** work that ships with the student profile in CMIS. The **implementation lives in the student-service Lambda and the frontend**; the external-service tree holds this file so operators and other services can read the overall story next to graduation and handover behavior.

## User-facing flow

1. **First-time profile (`ProfileForm`) and “My profile” (`ProfilePanel`)**  
   For non-admin sign-ups and edits, the user must answer **Mentorship program** (**Not interested** vs **Interested in participating**). This is required to save.

2. **If interested**  
   - Choose **Mentee** or **Mentor**.  
   - **Mentor:** enter **how many students** they are willing to mentor (**1–10**).

3. **Always editable**  
   The same controls appear on profile edit; values are persisted on the student profile in DynamoDB.

4. **Role-specific Mentorship card UX**  
   - **Mentor users:** see suggested mentees and can choose to accept or skip.  
   - **Mentee users:** do **not** see suggested mentors. They only see status (in queue, matched, channel opened, etc.).

5. **Mentor-initiated only**  
   The first action to create a mentorship connection is always from the mentor side.

6. **After mentor acceptance**  
   Open a communication channel between mentor and mentee and notify the mentee by email.

## Business rules

- **Mentee:** At least one email on the profile CSV must be `@tamu.edu` (aligns with the current-student / TAMU path).  
- **Mentor:** `mentorCapacity` must be an integer from **1** to **10**.  
- **Admin** UI path does not collect mentorship; the student-service handler defaults `mentorshipInterested` to `false` for admins when omitted.

## Cognito and roles

- **`ensureUserGrouped`**, **`syncGraduatedGroupsForProfile`**, and existing **role** rules (for example STUDENT versus FORMER_STUDENT from grad date and email) are **unchanged**.  
- Mentorship fields are **additive**; they do not replace student group membership.

## Data model (StudentProfiles – DynamoDB)

Stored on the profile item, alongside existing fields (name, email, uin, `role`, resume key, and after recent `develop` merges `profileGpa`, `profileEducation`, `profileSkillKeys`):

| Field | Type | Meaning |
|-------|------|---------|
| `mentorshipInterested` | boolean | User opted into considering mentorship. |
| `mentorship` | `"mentee"` \| `"mentor"` \| null | Role in the program when interested. |
| `mentorCapacity` | number \| null | Cap count when `mentorship === "mentor"`. |

### Mentor onboarding details (new product requirement)

When a user selects **Mentor** in profile flow, show a guided modal/pop-up and save mentor preference data for matching:

- Skills they can mentor in
- Industry focus
- Company and role
- Number of mentees (`mentorCapacity`)
- Optional availability / cadence preferences
- Optional resume upload

If resume exists, use parsed resume data for matching. If not, use profile + onboarding answers.

## Matching and ranking approach (planned)

### Data sources for similarity

- **Mentee side:** parsed student resume JSON + profile fields
- **Mentor side:** parsed mentor resume JSON (if present), else mentor onboarding + profile fields
- **LinkedIn URL:** use only compliant enrichment paths; do not rely on scraping as core

### Embeddings and similarity (target design)

1. Normalize both mentor and mentee into canonical text blocks (skills, industries, education, role intent, goals).
2. Generate vector embeddings for each profile summary.
3. Store vectors in a vector index (OpenSearch vector, pgvector, Pinecone, or equivalent).
4. Retrieve top-k nearest mentees for each mentor by cosine similarity.
5. Combine semantic score with hard constraints:
   - mentorship role compatibility
   - mentor capacity remaining
   - required TAMU eligibility for mentee path
6. Save final score and rationale snippet to match records for UI explainability.

### Model recommendations

- **Best default quality/price:** OpenAI `text-embedding-3-large`
- **Lower-cost option:** OpenAI `text-embedding-3-small`
- **Open-source self-hosted option:** `bge-large-en-v1.5` (or similar strong retrieval embedding model)

For initial rollout, start with one embedding model and offline evaluation on historical sample data before production auto-matching.

## Matching records (planned)

Introduce a dedicated mentorship match entity/table:

- `mentorUserId`, `menteeUserId`
- `status` (`SUGGESTED`, `ACCEPTED_BY_MENTOR`, `CHANNEL_OPENED`, etc.)
- `similarityScore`, `reasonSummary`
- `createdAt`, `updatedAt`

## API (student-service)

- **POST** `/student/api/profiles` (create): non-admins must send boolean `mentorshipInterested`; conditional `mentorship` / `mentorCapacity` per rules above.  
- **PUT** `/student/api/profiles/me`: partial updates allowed; merged profile is validated so an “interested” state stays consistent.

More detail: `services/student-service/docs/API.md`.

## Frontend

- **`frontend/src/lib/ProfileForm.svelte`** – required mentorship block for non-admin; combined with **develop** resume-derived **GPA / education / skills** for students.  
- **`frontend/src/lib/ProfilePanel.svelte`** – same for edit.  
- **`frontend/src/lib/api.ts`** – `createProfile` / `updateProfile` / `toProfileFromApi` include mentorship and resume fields.  
- **`frontend/src/lib/types.ts`** – `Profile`, `CreateProfileBody`, `UpdateProfileBody` extended accordingly.

## External-service scope

**This Python external-service does not currently implement mentorship HTTP APIs.** It remains focused on graduation handover and related external integrations. If mentorship orchestration is moved here (matching jobs, channel bootstrap, email notifications), add endpoints and auth notes in this document.

## Integration note

Mentorship work tracks on **`feature/mentorshipchanges_main`**, merged periodically with **`develop`** so resume and skills profile changes stay aligned without dropping mentorship behavior.

## Implementation log

### Step 1 (implemented): mentor onboarding data contract and validation

Implemented in code:

- Backend persistence extended on StudentProfiles with mentor onboarding fields:
  - `mentorSkills` (string array)
  - `mentorIndustries` (string array)
  - `mentorCompany` (string/null)
  - `mentorJobTitle` (string/null)
  - `mentorYearsExperience` (number/null)
- Backend validation rules added when `mentorship === "mentor"`:
  - `mentorCapacity` remains required (1–10)
  - `mentorSkills` must have at least one entry
  - `mentorIndustries` must have at least one entry
  - `mentorCompany` is required
  - `mentorYearsExperience` optional; if provided, must be integer 0–80
- Non-mentor or not-interested paths now normalize mentor onboarding fields back to empty/null.
- Frontend API/type contracts updated so create/update/fetch profile flows can carry these fields without schema mismatch.

Files updated in this step:

- `services/student-service/src/handlers/studentProfiles.js`
- `services/student-service/src/services/studentProfilesService.js`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/api.ts`

### Step 2 (implemented): true mentor-only popup in create/edit flows

Implemented in code:

- Added a **true modal popup** for mentor onboarding in both:
  - `frontend/src/lib/ProfileForm.svelte` (first-time create)
  - `frontend/src/lib/ProfilePanel.svelte` (profile edit)
- Popup appears only when:
  - user opts into mentorship, and
  - selects `mentor`
- Popup does **not** appear for `mentee` path (explicit requirement).
- Popup fields:
  - Skills (free-text CSV)
  - Industries (fixed options list)
  - Company
  - Job title
  - Years of experience
  - Capacity remains in mentorship section (1–10), validated together.
- Submit is blocked for mentor path until required popup details are complete.
- Create/update payload now includes mentor onboarding fields so backend Step 1 validation can enforce constraints.

Files updated in this step:

- `frontend/src/lib/ProfileForm.svelte`
- `frontend/src/lib/ProfilePanel.svelte`

### Step 3 (implemented): provider-agnostic embeddings scaffold in external-service

Implemented in code:

- Added `services/external-service/mentorship_embeddings.py`:
  - Defines provider abstraction (`EmbeddingProvider` protocol).
  - Implements OpenAI provider via HTTP.
  - Defaults to high-quality model `text-embedding-3-large`.
  - Provider selection through env vars:
    - `MENTORSHIP_EMBEDDINGS_PROVIDER` (default `openai`)
    - `OPENAI_API_KEY`
    - `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-large`)
- Added `services/external-service/mentorship_matching.py`:
  - Canonical text builders for mentor/mentee profile records.
  - Cosine similarity helper for vector scoring.
- Added a lightweight diagnostics endpoint in external-service:
  - `GET /mentorship/embedding-config`
  - Returns active provider/model metadata (or setup error).

Files updated in this step:

- `services/external-service/mentorship_embeddings.py` (new)
- `services/external-service/mentorship_matching.py` (new)
- `services/external-service/handler.py`

### Step 4 (implemented): mentorship candidate + accept/skip APIs under external-service

Implemented in code:

- Added a dedicated service module: `services/external-service/mentorship_service.py`
  - Builds mentor->mentee candidate rankings from embeddings + cosine similarity.
  - Persists suggestions and match state in DynamoDB.
  - Supports status transitions: `SUGGESTED`, `SKIPPED_BY_MENTOR`, `CHANNEL_OPENED`.
  - Generates channel IDs on mentor accept.
  - Sends mentee notification email via SES (fallback log mode when SES sender is missing).
- Added mentor-only HTTP endpoints in `services/external-service/handler.py`:
  - `GET /mentorship/candidates`
  - `GET /mentorship/matches`
  - `POST /mentorship/matches/{menteeUserId}/accept`
  - `POST /mentorship/matches/{menteeUserId}/skip`
- Enforced mentor-role gating using profile flags (`mentorshipInterested=true`, `mentorship=mentor`).
- Candidate generation uses student profiles marked as mentees (`mentorshipInterested=true`, `mentorship=mentee`).
- Updated external-service README with endpoint and environment variable docs.

Scoring and enrichment updates:

- Candidate ranking now combines:
  - `semanticScore` from embedding cosine similarity
  - `ruleScore` from deterministic compatibility checks (skills overlap, industry/major alignment, mentor experience)
  - `finalScore = semanticWeight * semanticScore + ruleWeight * ruleScore`
- Parsed resume enrichment is pulled from `RESUMES_TABLE` (latest `EXTRACTED` record per user) for both mentor and mentee text canonicalization.
- Mentor enrichment first attempts student-service API `GET /student/api/resumes/me` with the incoming bearer token; if unavailable, it falls back to `RESUMES_TABLE`.
- Candidate responses and stored match records now include explainability fields:
  - `semanticScore`, `ruleScore`, `finalScore`, `matchedSignals`, `reasonSummary`
- Endpoint continues to always return top-k candidates (configurable via env).

Storage/env contract introduced:

- `MENTORSHIP_MATCHES_TABLE` (DynamoDB)
  - PK: `mentorUserId`
  - SK: `menteeUserId`
- `RESUMES_TABLE` (DynamoDB, owned by student-service)
  - PK: `userSub`
  - SK: `resumeId`
- `MENTORSHIP_EMBEDDINGS_PROVIDER` (default `openai`)
- `OPENAI_API_KEY`
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-large`)
- `MENTORSHIP_TOP_K` (default `20`)
- `MENTORSHIP_SCORING_SEMANTIC_WEIGHT` (default `0.75`)
- `MENTORSHIP_SCORING_RULE_WEIGHT` (default `0.25`)

Notes:

- “Channel opened” is represented as a generated `channelId` and persisted status; chat system wiring is intentionally decoupled for a later step.

### Step 5 (implemented): mentorship card frontend wired by mentor/mentee status

Implemented in code:

- Added `frontend/src/lib/MentorshipPage.svelte` and routed mentorship view to it.
- Replaced placeholder mentorship card rendering in `frontend/src/App.svelte`.
- UI now depends on current user mentorship status:
  - **Mentor** (`mentorshipInterested=true` + `mentorship=mentor`):
    - refresh candidate list (`GET /mentorship/candidates`)
    - review suggested mentees with score/reason
    - accept (`POST /mentorship/matches/{menteeUserId}/accept`)
    - skip (`POST /mentorship/matches/{menteeUserId}/skip`)
    - list persisted match records (`GET /mentorship/matches`)
  - **Mentee**:
    - status-only view (no mentor suggestions shown; mentor-initiated flow)
  - **Not enrolled**:
    - CTA-style guidance to opt in from profile.
- Added frontend API client methods for mentorship external-service endpoints.

Files updated in this step:

- `frontend/src/lib/api.ts`
- `frontend/src/lib/MentorshipPage.svelte` (new)
- `frontend/src/App.svelte`

### Step 6 (implemented): Terraform wiring for mentorship matches table

Implemented in infrastructure:

- Added DynamoDB table resource in external-service module:
  - `aws_dynamodb_table.mentorship_matches`
  - Name: `${var.project_name}-mentorship-matches`
  - PK: `mentorUserId` (S)
  - SK: `menteeUserId` (S)
- Wired table into external-service Lambda env:
  - `MENTORSHIP_MATCHES_TABLE = aws_dynamodb_table.mentorship_matches.name`
- Updated IAM policy for external Lambda to allow table access:
  - Added `aws_dynamodb_table.mentorship_matches.arn` to DynamoDB resource list
- Added module output:
  - `mentorship_matches_table_name`

Files updated in this step:

- `infrastructure/external-services/terraform/dynamodb.tf`
- `infrastructure/external-services/terraform/lambda.tf`
- `infrastructure/external-services/terraform/iam.tf`
- `infrastructure/external-services/terraform/outputs.tf`
