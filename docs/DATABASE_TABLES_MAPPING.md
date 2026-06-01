# Database Tables Mapping – CMIS-prod Services

This document maps **every DynamoDB table** required by **admin-service**, **student-service**, and **external-service**, with key schema, GSIs, and which APIs use each table.

---

## Summary

| Service            | Env var(s)                 | Table(s) used                                                                 |
|--------------------|----------------------------|-------------------------------------------------------------------------------|
| **admin-service**  | `TABLE_NAME` (shared)      | 1 table: Companies + Config (Theme, Tiers) – single-table design            |
| **student-service**| `STUDENT_PROFILES_TABLE`, `RESUMES_TABLE` | 2 tables: StudentProfiles, Resumes                         |
| **external-service** | `EXTERNAL_USERS_TABLE`, `STUDENTS_TABLE`, `HANDOVER_TOKENS_TABLE`, `HANDOVER_LOG_TABLE` (optional) | 3–4 tables: external users, graduation-eligible students, handover tokens, handover log |

---

## 1. Admin-service (single table)

All four admin Lambdas use **one table** via `process.env.TABLE_NAME`.

| API / Lambda        | Path / usage               | Table access |
|---------------------|----------------------------|-------------|
| **cmis-company-api**| Domain lookup (Team Gig 'Em), CRUD companies | Query by `domain-index`; Get/Put/Delete by PK/SK; Scan with `begins_with(PK, "COMPANY#")` |
| **cmis-config-api** | GET theme + tiers          | Get `CONFIG#THEME`, Scan `TIER#*` |
| **cmis-theme-api**  | GET/PUT theme              | Get/Put `CONFIG#THEME` / `METADATA` |
| **cmis-tier-api**   | CRUD tiers                 | Get/Put/Delete `TIER#{tierId}` / `METADATA`; Scan for companies by tierId |

### Schema for admin table

- **PK** (string), **SK** (string) – composite.
- **Companies:** `PK = "COMPANY#<companyId>"`, `SK = "METADATA"`. Body can include `companyId`, `domain`, and other company fields. **GSI required:** `domain-index` with **partition key `domain`** (for company lookup by domain).
- **Config/Theme:** `PK = "CONFIG#THEME"`, `SK = "METADATA"`.
- **Tiers:** `PK = "TIER#<tierId>"`, `SK = "METADATA"`; `rank` used for sorting.

**Env:** `TABLE_NAME` = single DynamoDB table name for all admin Lambdas.

---

## 2. Student-service (two tables)

### 2.1 StudentProfiles table

| API / usage              | Table access |
|--------------------------|-------------|
| Get profile by user      | GetItem by `userId` |
| Create / update / delete profile | PutItem / UpdateItem / DeleteItem by `userId` |
| List profiles (e.g. Students Connect) | Scan with filter |

**Env:** `STUDENT_PROFILES_TABLE`

**Schema:**

- **Partition key:** `userId` (string, Cognito sub).
- **Attributes (from code):** `name`, `uin`, `email`, `degree`, `major`, `gradDate`, `linkedInUrl`, `resumeS3Key`, `createdAt`, `updatedAt`.

No GSIs required by current code.

---

### 2.2 Resumes table

| API / usage           | Table access |
|-----------------------|-------------|
| Create resume (UPLOADING) | PutItem |
| Get / list / update / delete resume | GetItem, Query by `userSub`, UpdateItem, DeleteItem |

**Env:** `RESUMES_TABLE`

**Schema:**

- **Partition key:** `userSub` (string).
- **Sort key:** `resumeId` (string).
- **Attributes:** `s3Key`, `fileName`, `contentType`, `status` (UPLOADING | UPLOADED), `fileSize`, `etag`, `createdAt`, `updatedAt`.

No GSIs required.

---

## 3. External-service (three required + one optional)

### 3.1 External users table

| API / usage                | Table access |
|----------------------------|-------------|
| Signup: store new user    | PutItem `user_id`, `email`, `role`, `class_year`, `linked_uin` |
| Signin /me: load by email or user_id | GetItem by `user_id`; Query GSI `email-index` by `email` |
| Handover: ensure UIN not already linked | Query GSI `linked-uin-index` by `linked_uin` |
| Handover: update role/UIN | UpdateItem |

**Env:** `EXTERNAL_USERS_TABLE` (default: `cmis-external-users`)

**Schema:**

- **Partition key:** `user_id` (string, Cognito sub).
- **Attributes:** `email`, `role`, `class_year` (optional), `linked_uin` (optional), `personal_email` (optional, set on handover).
- **GSIs required:**
  - **email-index:** partition key `email` (for lookup by email).
  - **linked-uin-index:** partition key `linked_uin` (for uniqueness of UIN link).

---

### 3.2 Students table (graduation-eligible)

Used for **graduation handover**: lookup by UIN, scan for eligible graduates (grad_date ≤ today, account_status = STUDENT), and self-service magic link by personal email.

| API / usage                    | Table access |
|--------------------------------|-------------|
| Handover lookup/link           | GetItem by `uin` |
| Graduation scan (EventBridge)  | Query GSI `grad-status-index` by `account_status` + `grad_date` |
| Request magic link by email    | Scan Filter `personal_email` + `account_status` |

**Env:** `STUDENTS_TABLE` (default: `cmis-external-students`)

**Schema:**

- **Partition key:** `uin` (string, 9 digits in code).
- **Attributes:** `grad_date` (string, e.g. `YYYY-MM-DD`), `account_status` (e.g. `"STUDENT"`), `personal_email`, `class_year` (optional), `tamu_email` (optional).
- **GSI required:** **grad-status-index** – composite key: partition `account_status`, sort `grad_date` (for query: eligible students with grad_date ≤ today).

**Note:** This is **not** the same as **StudentProfiles** in student-service. StudentProfiles is keyed by `userId` (Cognito) and holds app profile (name, degree, resume, etc.). This table is a separate list of **graduation-eligible** students keyed by **UIN**, used only by external-service for handover and magic links.

---

### 3.3 Handover tokens table

| API / usage              | Table access |
|--------------------------|-------------|
| Graduation scan          | PutItem: `token_hash`, `uin`, `personal_email`, `class_year`, `expires_at`, `claimed` |
| Request magic link       | Same PutItem pattern |
| GET/POST claim           | GetItem by `token_hash`; UpdateItem to set `claimed` |

**Env:** `HANDOVER_TOKENS_TABLE` (default: `cmis-external-handover-tokens`)

**Schema:**

- **Partition key:** `token_hash` (string, SHA-256 of raw token).
- **Attributes:** `uin`, `personal_email`, `class_year`, `expires_at` (number, Unix timestamp), `claimed` (boolean).

No GSIs required.

---

### 3.4 Handover log table (optional)

| API / usage | Table access |
|-------------|-------------|
| Audit handover events    | PutItem (INITIATED / SUCCESS / FAILED); Scan for list_recent |

**Env:** `HANDOVER_LOG_TABLE` – if empty or unset, handover log is skipped.

**Schema:**

- **Partition key:** `handover_id` (string, UUID).
- **Attributes:** `timestamp`, `status`, `user_id`, `uin`, `personal_email` (for INITIATED), `reason` (optional, for FAILED), `ttl_expiry` (number, for DynamoDB TTL).
- **DynamoDB TTL:** Enable TTL on attribute `ttl_expiry` (e.g. 90 days).

No GSIs required.

---

## 4. Cross-service notes

### 4.1 Company list ↔ external-service role engine

- **admin-service** **cmis-company-api** supports **lookup by domain** (path includes `"domain"`, returns one company). It does **not** expose a “list of all partner domains” endpoint.
- **external-service** **role_engine** expects `COMPANY_LIST_API_URL` to point to an API that responds to **GET `{url}/domains`** with a list of domains (e.g. `["a.com", "b.com"]` or `{"domains": ["a.com", "b.com"]`).
- **To integrate:** Add a small endpoint (e.g. in admin-service or a separate Lambda) that returns all partner domains (e.g. scan companies and collect `domain`), then set `COMPANY_LIST_API_URL` to that base URL. If you don’t, leave `COMPANY_LIST_API_URL` unset and the external-service uses stub domains (`acme.com`, `partner.org`, `example.com`).

### 4.2 Student data: StudentProfiles vs external STUDENTS_TABLE

- **StudentProfiles** (student-service): one row per **authenticated student** (key: `userId`). Used for app profile, resume link, etc.
- **STUDENTS_TABLE** (external-service): one row per **graduation-eligible** student (key: `uin`). Used only for handover (lookup, scan, magic links). Different purpose and schema; keep as **separate tables**.

### 4.3 Env vars per service (quick reference)

| Service           | Env vars |
|-------------------|----------|
| admin-service     | `TABLE_NAME` (one table for all 4 Lambdas) |
| student-service    | `STUDENT_PROFILES_TABLE`, `RESUMES_TABLE` |
| external-service  | `USER_POOL_ID`, `CLIENT_ID`, `EXTERNAL_USERS_TABLE`, `STUDENTS_TABLE`, `HANDOVER_TOKENS_TABLE`, `HANDOVER_LOG_TABLE` (optional), `COMPANY_LIST_API_URL`, `FRONTEND_BASE_URL`, `SES_VERIFIED_SENDER` (optional) |

---

## 5. Tables to create for a full deployment

1. **Admin (single table):** PK/SK + GSI `domain-index` on `domain`.
2. **StudentProfiles:** PK `userId`.
3. **Resumes:** PK `userSub`, SK `resumeId`.
4. **External users:** PK `user_id` + GSI `email-index` (PK `email`) + GSI `linked-uin-index` (PK `linked_uin`).
5. **Students (external handover):** PK `uin` + GSI `grad-status-index` (PK `account_status`, SK `grad_date`).
6. **Handover tokens:** PK `token_hash`.
7. **Handover log (optional):** PK `handover_id` + TTL on `ttl_expiry`.

This matches all current APIs across admin-service, student-service, and external-service.
