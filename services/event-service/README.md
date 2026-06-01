# Event Service

The Event Service is a core microservice of the CMIS platform, responsible for managing event lifecycles, RSVPs, waitlists, attendee notifications, surveys, and analytics.

> **For full API and data schema reference, see [REFERENCE.md](REFERENCE.md).**
> Last updated: 2026-04-26. Maintained by Team 12th Man, Spring 2026.

---

## What this service does

The event-service is the backbone of CMIS event management. It handles the full lifecycle from event creation through RSVP, waitlist promotion, check-in, post-event surveys, and analytics. It exposes 19 HTTP routes (full list in [REFERENCE.md](REFERENCE.md)) and depends on Team Howdy's admin-service for tier configuration.

```
                    ┌─────────────────────┐
                    │   Frontend (Svelte) │
                    │   /frontend         │
                    └──────────┬──────────┘
                               │ HTTP
                    ┌──────────▼──────────┐
                    │   event-service     │◄──── DynamoDB Streams
                    │   (this service)    │      (RSVP confirmations,
                    └──────────┬──────────┘       promotions)
                               │
                    ┌──────────▼──────────┐
                    │   admin-service     │
                    │   (Team Howdy)      │
                    │   /domain, /config  │
                    └─────────────────────┘
```

---

## 🧠 Core Logic & Mechanics

### 1. The Velvet Rope (Partner Early Access)

This system gates event RSVPs based on user email domain to provide partner companies with priority access.

- **How it works**: When a partner user RSVPs, the system calculates an `Unlock Time`:
  `UnlockTime = EventStartTime - EarlyAccessHours`
- **Lookup Flow**:
  1. **Domain API**: Calls Team Howdy's Admin API (`GET /domain/{domain}`) to resolve the user's email domain to a `tierId`.
  2. **Config API**: Calls `GET /config` to fetch the global `earlyAccessHours` for that tier.
- **Tier Overrides**: Admins can set event-specific overrides (e.g., "Silver gets 12 hours for this specific event") which take precedence over global defaults.
- **Exemptions**: Users in `students` or `alumni` Cognito groups, the event creator, and admins bypass the Velvet Rope entirely. Note: users in the `friends` group (non-student former members) are **subject to gating, not exempt**.
- **Fail-Closed**: If Team Howdy's API is unresponsive, the service returns `503 Service Unavailable` to prevent unauthorized early access. See [REFERENCE.md → Velvet Rope flow](REFERENCE.md#5-velvet-rope-flow) for the full sequence diagram.

### 2. Atomic Transactions & Optimistic Locking

- **RSVP Transactions**: We use `TransactWriteItems` to atomically increment `currentRsvps` and insert an RSVP record. This prevents over-booking during high-concurrency bursts.
- **Optimistic Locking**: The `Events` table uses a `version` attribute. Any `PUT /api/events/:id` request **must** include the current version. The update fails with `409 Conflict` if the version in the database changed since it was last read, protecting against concurrent edit conflicts.

### 3. Smart Waitlisting

When an event is full, users are added to a priority waitlist.

- **Prioritization**: Sorted by **Tier Rank** (Gold=1, Silver=2, Student=99) then by **Timestamp** (FIFO within tier).
- **Atomic Promotion**: When a confirmed user cancels, the service automatically identifies the highest-priority person on the waitlist and promotes them to `CONFIRMED` in a single atomic transaction (`currentRsvps` stays unchanged — one out, one in).

### 4. Calendar Export (.ics)

Two endpoints generate RFC 5545-compliant ICS files compatible with Google Calendar, Apple Calendar, and Outlook:

- `GET /api/events/:eventId/calendar` — Public, single event
- `GET /api/users/me/calendar` — Authenticated, user's full CONFIRMED schedule

WAITLISTED RSVPs are excluded from the user-schedule export. Events with malformed dates are skipped with a warning rather than failing the whole response. See [REFERENCE.md → Calendar/ICS reference](REFERENCE.md#6-calendarics-reference) for format details and sample output.

---

## 📡 Infrastructure Dependencies

### 1. DynamoDB Streams (CRITICAL)

Confirmation and promotion emails are triggered by **DynamoDB Streams** on the `EventRsvps` table.

⚠️ **Operational Risk**: If the stream is disabled or the Lambda trigger is removed in Terraform, emails will silently fail to send even if RSVPs are successful. There is no fallback — check `infrastructure/lambda.tf` and the deployed Lambda's event source mappings if emails stop working.

### 2. EventBridge Reminders

Scheduled reminders (1 hour before an event) are managed by **EventBridge Scheduler**. The application dynamically creates rules with a `SEND_EVENT_REMINDER` action.

If reminders are not firing, check the `events-core-reminder` rule prefix in the AWS console.

### 3. SES (Email Delivery)

All transactional emails (RSVP confirmation, waitlist promotion, post-event surveys) are sent via Amazon SES. The sender address is configured via the `SES_VERIFIED_SENDER` environment variable. **See [Known Issues](#known-issues--todos) below for an important production caveat.**

---

## API Routes

For complete request/response schemas and error codes, see [REFERENCE.md → HTTP API reference](REFERENCE.md#1-http-api-reference).

### Public Routes
- `GET /api/events` — List all events
- `GET /api/events/:eventId` — Get a specific event
- `GET /api/events/health` — Service health check
- `GET /api/events/:eventId/calendar` — Download ICS for a specific event
- `GET /api/surveys/:eventId/respond` — Get survey template (public response)
- `POST /api/surveys/:eventId/respond` — Submit survey response

### Authenticated User Routes
- `POST /api/events/:eventId/rsvp` — RSVP to an event (handles waitlisting + Velvet Rope)
- `DELETE /api/events/:eventId/rsvp` — Cancel an RSVP (triggers waitlist promotion)
- `GET /api/events/:eventId/waitlist/position` — Get current user's waitlist rank
- `GET /api/events/user/rsvps` — List all events the user has RSVP'd to
- `GET /api/users/me/calendar` — Download ICS for the user's full schedule

### Admin Routes
- `POST /api/events` — Create a new event
- `PUT /api/events/:eventId` — Update event details
- `DELETE /api/events/:eventId` — Remove an event
- `GET /api/events/:eventId/rsvp` — List all RSVPs for an event
- `GET /api/surveys/:eventId` — Manage survey templates
- `PUT /api/surveys/:eventId` — Update survey template
- `POST /api/events/:eventId/send-survey` — Send survey emails to checked-in attendees
- `GET /api/analytics/event-success` — View event performance metrics

---

## DynamoDB Tables

For full schemas with sample items, see [REFERENCE.md → DynamoDB schema reference](REFERENCE.md#2-dynamodb-schema-reference).

| Table | Purpose | Key | Notes |
|---|---|---|---|
| `Events-{stage}` | Event records | PK `eventId` | Uses `version` field for optimistic locking |
| `EventRsvps-{stage}` | RSVPs and waitlist entries | PK `eventId`, SK `userId`, GSI `userId-index` | Streams enabled for email triggers |
| `SurveyTemplates-{stage}` | Per-event survey questions | PK `eventId` | One template per event |
| `SurveyResponses-{stage}` | User survey submissions | PK `eventId`, SK `userId` | Duplicate-prevention via `attribute_not_exists` |

---

## Local Development

To run the service locally without AWS dependencies:

```bash
cd services/event-service
npm install
node server.js
```

The local server runs on port 3005 and intercepts AWS SDK calls with a full in-memory DynamoDB mock — including optimistic locking version checks and capacity guard simulation. Cognito verification is bypassed unless `COGNITO_USER_POOL_ID` is set.

In local dev, use `Authorization: Bearer admin-token` for admin routes and any other bearer string for authenticated-user routes.

### Required environment variables (production only)

| Variable | Purpose |
|---|---|
| `EVENTS_TABLE` | Events DynamoDB table name |
| `RSVP_TABLE` | EventRsvps DynamoDB table name |
| `COGNITO_USER_POOL_ID` | For JWT verification |
| `COGNITO_CLIENT_ID` | For JWT verification |
| `DOMAIN_API_URL` | Admin-service domain lookup endpoint |
| `CONFIG_API_URL` | Admin-service tier config endpoint |
| `SES_VERIFIED_SENDER` | Verified SES sender address (see Known Issues) |

---

## Testing

`npm test` runs the assertion-based suites (`test-waitlist.js` and `test-calendar.js`). Individual files can be run via the named scripts in `package.json`:

| Command | Covers |
|---|---|
| `npm run test:waitlist` | RSVP flow, waitlist priority, Velvet Rope time gate, atomic promotion (9 scenarios) |
| `npm run test:calendar` | ICS generation: single event, multi-event schedule, CONFIRMED-only filter, malformed date handling (4 scenarios, 7 assertions) |
| `npm run test:auth` | Auth middleware: public, unauthenticated, user-token, admin-token (4 scenarios) |
| `npm run test:lambda` | Lambda routing: health check + list-events via raw Lambda event format |
| `npm run test:lambda-prod` | API Gateway `/dev/` stage-prefix stripping logic |

All tests use Module._load interception and a global `fetch` override — zero external dependencies, no AWS account required.

> Note: `test-waitlist.js` Scenario 2 prints a `Velvet Rope: failed to fetch partner rank` stderr line. This is **expected graceful-degradation behavior**, not a bug. The waitlist path catches the error and falls back to default tier rank.

---

## Architecture Decisions

### Why two DynamoDB tables instead of one

Events and RSVPs have very different access patterns. Events are read-heavy with infrequent admin writes; RSVPs are write-heavy with high concurrency on capacity checks. Splitting them lets us put a Stream on RSVPs without flooding the event-handler Lambda with event updates, and lets us index by userId (for "my events") without bloating the event records.

### Why the GSI on `userId`

The base table is partitioned by `eventId`, which is fast for "who's coming to this event" but useless for "what events am I going to." The `userId-index` GSI inverts that — partitioned by userId, projecting all attributes — so a user's full RSVP list is one query.

### Why TransactWriteCommand for RSVP creation

Without a transaction, two simultaneous RSVPs to a near-full event could both pass the capacity check, both increment `currentRsvps`, and over-book the event. `TransactWriteCommand` makes the capacity check and the RSVP insert a single atomic operation conditioned on `currentRsvps < capacity`. Either both succeed or both fail.

### Why optimistic locking on Events

Two admins editing the same event simultaneously could overwrite each other's changes. The `version` field on Events forces every update to include the version it was based on; if it doesn't match the current stored version, the update fails with 409. The losing admin re-reads the event and tries again.

### Why a two-hop lookup for Velvet Rope

Email domains are owned by the admin-service (`/domain/{domain}` returns the tierId), and tier definitions are also owned by the admin-service (`/config` returns the tier list with `earlyAccessHours`). The event-service doesn't store either — it makes both calls on every gated RSVP. This keeps tier configuration centralized but adds two HTTP calls to the RSVP path.

---

## Deployment

The service is deployed by `infrastructure/events/terraform/`:

- `dynamodb.tf` — Both event-service tables and the GSI
- `lambda.tf` — The Lambda function and all environment variables
- `apigateway.tf` — HTTP API with all 19 routes
- `variables.tf` — Input variables (Cognito IDs, table names, admin-service URLs)

The deployed Lambda is named `twelfth-man-event-core-api-dev`.

`domain_api_url` and `config_api_url` are sourced from `module.admin_core.api_gateway_url` in `infrastructure/events-core.tf` — they're not hardcoded.

---

## Known Issues & TODOs

### 🔴 HIGH PRIORITY — `SES_VERIFIED_SENDER` is unset in production

**Current state:**
- The Terraform variable `ses_verified_sender` exists in `infrastructure/events/terraform/variables.tf` and is wired to the Lambda env in `lambda.tf`
- But `infrastructure/events-core.tf` (the module call) **never passes a value** — so the variable defaults to `""`
- AWS treats `""` as null, so the deployed Lambda has no `SES_VERIFIED_SENDER` set

**Consequences:**
- **Survey emails are silently failing in production** — the survey-email path correctly uses `process.env.SES_VERIFIED_SENDER`, which resolves to `undefined`. SES rejects the send.
- **RSVP/waitlist emails still work** — the DynamoDB Streams handler in `index.js` (around lines 344 and 368) still uses the hardcoded literal `"abhishekp1703@gmail.com"`. That literal is currently the only thing keeping any RSVP email working.

**Fix path (do these in order, do not skip step 2):**
1. In `infrastructure/events-core.tf`, pass a real value: `ses_verified_sender = "abhishekp1703@gmail.com"` (or pull from SSM Parameter Store)
2. Run `terraform apply` and verify with `aws lambda get-function-configuration --function-name twelfth-man-event-core-api-dev --query "Environment.Variables.SES_VERIFIED_SENDER"` — should return the address, not `null`
3. Only after step 2 confirms the env var is live, replace the two hardcoded strings in `index.js` with `process.env.SES_VERIFIED_SENDER || "abhishekp1703@gmail.com"`
4. Add `SES_VERIFIED_SENDER` to `services/event-service/server.js` mock environment for local dev parity

We didn't fix this during handoff because we lacked confirmed deploy access to the prod AWS account, and reordering the fix risked breaking the RSVP emails that currently work.

### 🟡 MEDIUM — `test-auth-endpoints.js` silent failure

The GET test references `JSON.parse(getRes.body).message`, but the list-events route returns a JSON array, not an object with a `.message` field. The expression throws `TypeError`, which is caught and swallowed by `runTests().catch(console.error)` — meaning the test prints an error but doesn't actually fail the script. **Five-minute fix:** replace `.message` with `Array.isArray(JSON.parse(getRes.body))` and assert against that.

### 🟡 LOW — Stale velvet-rope feature branches

The `feature/velvet-rope*` branches are 0 commits ahead of `develop` (already merged via PRs #83, #139). They should be deleted from the remote. See `MERGE_PREP_VELVET_ROPE.md` at the repo root for the full list and recommended `git push origin --delete` commands. Confirm with team before running.

---

## Where to Look First When Extending

| Goal | Start here |
|---|---|
| Adding a new event field | `src/services/eventService.js` + `EventItem` interface in `frontend/src/lib/events-api.ts` |
| Changing waitlist priority logic | `rsvpService._fetchPartnerTierRank()` — note the parse-format mismatch with `_fetchPartnerEarlyAccessHours()` documented in REFERENCE.md |
| Adding a new RSVP status | Search for `"CONFIRMED"` and `"WAITLISTED"` across the codebase — both backend and frontend |
| New email template | `index.js` DynamoDB Streams handler + add to SES verified templates |
| Changing Velvet Rope behavior | Backend: `rsvpService.rsvpToEvent()` + `_fetchPartnerEarlyAccessHours()`. Frontend: `frontend/src/lib/velvetRope.ts` + `velvetRopeStore.ts` |
| Adding a new admin route | `index.js` (route handler) + `infrastructure/events/terraform/apigateway.tf` (route registration) |

---

## Team Contacts

| Handle | Primary contributions |
|---|---|
| abhishekp1703 | RSVP core, Velvet Rope gating, email streams, tier overrides |
| jameslondrigan | Waitlist foundation, RSVP flow, calendar (feature branch) |
| siddharthkabra811 | Early contributor |

For questions, reach out via the course Slack/Discord. The next team should also feel free to file issues against the repo.