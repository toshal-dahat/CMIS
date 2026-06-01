# Mentorship admin matching API

This document describes the **operator / admin** HTTP API implemented in the external-service Lambda for **batch mentorship matching**, optional **full reset** of match rows, and **run history / snapshots** (when the audit table is configured).

General mentorship product APIs (mentor candidates, accept, skip, etc.) remain documented in [README.md](README.md).

## What your teammate should build first (frontend)

Implement in this order:

1. **Landing page** — Show the Mentorship card to users in the **`admins`** Cognito group even when `mentorshipInterested` is false (`frontend/src/lib/LandingPage.svelte`).
2. **Operator panel** — e.g. `MentorshipOperatorPanel.svelte` on `MentorshipPage.svelte`, visible only for admins.
3. **POST** — `POST /mentorship/admin/matching-runs` (run / reset + run); handle loading and errors.
4. **GET (after deploy)** — When `MENTORSHIP_MATCHING_RUNS_TABLE` is set in Lambda env, wire:
   - `GET /mentorship/admin/matching-runs/latest` — dashboard “last run” + **pairs** + **mentor capacity** (`run.snapshot`).
   - Optionally `GET /mentorship/admin/matching-runs?limit=25` — history list.
   - Optionally `GET /mentorship/admin/matching-runs/{runId}` — detail for a specific run.

If **`persistenceEnabled`** is `false` in list responses or GET returns **404** “Run history not configured”, the audit table is not deployed yet — keep UI placeholders or show a short “Run history unavailable” message.

**Still not implemented:** `GET`/`PUT` `/mentorship/admin/matching-schedule` (cron). Use placeholders until a later milestone.

---

## Endpoint inventory

Base URL: same external-service API Gateway as other `/mentorship/*` routes (see app env / `api.ts`).

All paths below require **`Authorization: Bearer <access_token>`** and the same **admin** rules as in [Authentication](#authentication).

| Status | Method | Path | Purpose |
|--------|--------|------|---------|
| **Available** | `POST` | `/mentorship/admin/matching-runs` | Start a run: optional full match-table reset + optional batch matching. |
| **Available** | `GET` | `/mentorship/admin/matching-runs` | List recent runs (summary only). Returns **`persistenceEnabled`**. If table unset: `200` with `runs: []`, `persistenceEnabled: false`. |
| **Available** | `GET` | `/mentorship/admin/matching-runs/latest` | Full **latest** stored run (includes **`snapshot`**). **404** if table unset, no runs yet, or pointer missing. |
| **Available** | `GET` | `/mentorship/admin/matching-runs/{runId}` | Full run by id (includes **`snapshot`**). **404** if not found. |
| Planned | `GET` | `/mentorship/admin/matching-schedule` | Read cron / next run. **Not implemented.** |
| Planned | `PUT` | `/mentorship/admin/matching-schedule` | Set or disable schedule. **Not implemented.** |

---

## Authentication

- **Header:** `Authorization: Bearer <access_token>`
- The caller must be allowed as an **admin** in one of these ways:
  1. **Cognito group:** user is in group `admins` or `admin` (resolved via `cognito-idp:AdminListGroupsForUser` on `USER_POOL_ID`), or
  2. **Allowlist:** the user’s Cognito **`sub`** appears in the optional environment variable **`ADMIN_USER_IDS`** (comma-separated). Checked in addition to group membership.

If the caller is not authorized, responses use **403** with `{ "error": "Admin access required" }`.

---

## POST `/mentorship/admin/matching-runs`

Starts a **MentorshipMatchingRun**. When **`MENTORSHIP_MATCHING_RUNS_TABLE`** is configured, the completed (or failed) run is **persisted** and the **`__LATEST_POINTER__`** row is updated for `GET …/latest`.

### Request body

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resetMatches` | boolean | `false` | If `true`, **deletes every item** in `MENTORSHIP_MATCHES_TABLE`, including synthetic mentee channel state rows (`mentorUserId = __MENTEE_CHANNEL_STATE__`). **Irreversible.** |
| `runBatchMatching` | boolean | `true` | If `true`, runs `run_annual_batch_matching()` after any reset (same as `cmis.mentorship.batch`). |

### Examples

Full rematch (clear all, then batch):

```json
{ "resetMatches": true, "runBatchMatching": true }
```

Batch only (no delete):

```json
{ "resetMatches": false, "runBatchMatching": true }
```

Wipe matches only:

```json
{ "resetMatches": true, "runBatchMatching": false }
```

### Response **200** (success)

| Field | Description |
|-------|-------------|
| `runId` | UUID for this invocation. |
| `kind` | `"MentorshipMatchingRun"`. |
| `status` | `"COMPLETED"` on success. |
| `startedAt` | ISO timestamp. |
| `finishedAt` | ISO timestamp. |
| `reset` | If reset ran: `{ "deletedMatchRows", "ok" }`. |
| `batch` | If batch ran: object from `run_annual_batch_matching()` (`totalMentors`, `totalMentees`, `matched`, `unmatched`, `errors`, …); else `null`. |
| `snapshotSummary` | When batch succeeded and snapshot was built: `{ "pairCount", "mentorCount" }`. Full **`snapshot`** is **not** included here (use **GET** to avoid huge POST bodies). |

### Response **500**

`{ "error": "Mentorship matching run failed", "detail": "<message>" }` — a **FAILED** run may still be **written** to DynamoDB when the audit table is configured (inspect with GET latest after fixing the cause).

### cURL

```bash
curl -sS -X POST "https://<api-host>/<stage>/mentorship/admin/matching-runs" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resetMatches":true,"runBatchMatching":true}'
```

---

## GET `/mentorship/admin/matching-runs`

### Query parameters

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | `25` | Max runs to return after sort (clamped **1–100**). |

### Response **200**

```json
{
  "runs": [
    {
      "runId": "...",
      "startedAt": "...",
      "finishedAt": "...",
      "status": "COMPLETED",
      "snapshotSummary": { "pairCount": 0, "mentorCount": 0 }
    }
  ],
  "persistenceEnabled": true
```

- If **`MENTORSHIP_MATCHING_RUNS_TABLE`** is **not** set: `{ "runs": [], "persistenceEnabled": false }` (still **200**).

---

## GET `/mentorship/admin/matching-runs/latest`

Returns the run pointed to by the internal **`__LATEST_POINTER__`** item.

### Response **200**

```json
{
  "run": { "... full Dynamo item including snapshot ..." },
  "persistenceEnabled": true
}
```

**`run.snapshot`** (when present and status completed) includes:

| Key | Description |
|-----|-------------|
| `pairs` | Array of `{ mentorUserId, menteeUserId, status, channelId?, finalScore?, boostedScore?, updatedAt?, mentorName?, menteeName? }`. |
| `mentors` | Per-mentor: `{ mentorUserId, mentorName?, mentorCapacity, channelOpenedCount, remainingSlots }`. |
| `pairCount` | Integer. |

### Response **404**

- Run history table not configured: `{ "error": "Run history not configured", "persistenceEnabled": false }`
- No runs yet: `{ "error": "No matching runs yet" }`

---

## GET `/mentorship/admin/matching-runs/{runId}`

Same **`run`** shape as **latest**, for a specific **`runId`** returned by POST or list.

- **400** — reserved or invalid id (e.g. `latest` as `{runId}` path is invalid; use `/latest`).
- **404** — run not found or persistence disabled.

---

## Environment variables (this feature)

| Variable | Description |
|----------|-------------|
| `MENTORSHIP_MATCHING_RUNS_TABLE` | (Optional but recommended) DynamoDB table name for run audit rows. **PK:** `runId` (string). Stores each run plus a fixed row **`runId = __LATEST_POINTER__`** with `lastRunId`, `updatedAt`, `lastStatus`. If unset, POST still works but **no** history GETs beyond empty list / 404. |
| `ADMIN_USER_IDS` | Optional comma-separated Cognito **`sub`** allowlist for admin routes. |

Terraform creates the table and sets this env on the external Lambda when you apply **`infrastructure/external-services/terraform`**.

---

## Data stores

| Store | Role |
|-------|------|
| `MENTORSHIP_MATCHES_TABLE` | Live mentor–mentee rows; cleared when `resetMatches` is true. |
| `MENTORSHIP_MATCHING_RUNS_TABLE` | Audit + UI snapshot per POST run; pointer row for **latest**. |
| `STUDENT_PROFILES_TABLE` | Names, `mentorCapacity` for snapshot. |
| `MENTORSHIP_EMBEDDINGS_TABLE` | Embedding cache (unchanged by admin run API). |

---

## Implementation reference

| Piece | Location |
|-------|----------|
| Routes | `handler.py` — `mentorship` / `admin` / `matching-runs` (GET list, GET `latest`, GET `{runId}`, POST) |
| Admin check | `handler.py` — `_is_requester_admin` |
| Orchestration + snapshot + persist | `mentorship_service.py` — `run_mentorship_matching_run`, `clear_all_match_records`, `run_annual_batch_matching`, `build_admin_run_snapshot`, `list_stored_matching_runs`, `get_latest_stored_matching_run`, `get_stored_matching_run`, `matching_runs_audit_configured` |
| DynamoDB table | `infrastructure/external-services/terraform/dynamodb.tf` — `aws_dynamodb_table.mentorship_matching_runs` |

---

## Operations notes

- Lambda **timeout** is **900 seconds** for large batches.
- **List** endpoint scans the runs table; for very high run volume, add a GSI + query later.
- DynamoDB item size limit (**400 KB**) applies to stored **`snapshot`**; extremely large cohorts may need trimming or S3 offload in a future iteration.

## Related

- [README.md](README.md) — full external-service API and environment variables.
- [MENTORSHIP.md](MENTORSHIP.md) — product and engineering notes for mentorship.
