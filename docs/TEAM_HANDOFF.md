# CMIS External Core — Team Handoff

For the next team or maintainer taking over the External Core (Team Gig 'Em).

## What this repo contains

- **External Core** only: external user auth (Cognito), roles (PARTNER / FORMER_STUDENT / FRIEND), graduation handover (popup + direct link), and related APIs.
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
7. **services/event-service/README.md** — Event Service logic, local dev, and testing.
8. **infrastructure/events/terraform/README.md** — Event Service infrastructure map.

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

---

# Event Core — Team 12th Man Section

This section provides a deep technical handoff for the **Event Service**. This service is responsible for managing the entire lifecycle of recruitment events, attendee RSVPs, and priority-based waitlisting.

## 🧠 Deep Dive: RSVP & Capacity Logic

The heart of this service is `src/services/rsvpService.js`. It is designed to handle high-concurrency "bidding wars" (RSVP bursts) without over-booking.

### 1. Atomic Transactions (The "Brain")
We use DynamoDB `TransactWriteItems` to perform two operations as a single unit of work. This ensures data consistency even when 100+ users hit the RSVP button at the same millisecond.
1.  **Event Table Update**: Increments `currentRsvps` and the `version` field.
    - **Condition**: `currentRsvps < capacity`. If this fails, the transaction is cancelled.
2.  **RSVP Table Insert**: Creates a record with `status: "CONFIRMED"`.
    - **Condition**: `attribute_not_exists(eventId)`. This prevents a user from RSVPing twice to the same event.

**Failure Flow**:
- If the **Capacity check fails**: The code catches the `TransactionCanceledException`, identifies that the event was full, and automatically calls `_addToWaitlist`.
- If the **Duplicate check fails**: The code identifies that the user is already registered and returns a `409 Conflict`.

### 2. The Velvet Rope 
The time-gate logic is implemented as a mathematical "unlock window". Instead of simple "Is it open?" booleans, the backend calculates a dynamic timestamp.
- **Formula**: `UnlockTime = EventStartTime - EarlyAccessHours`.
- **The Tier Lookup**:
    1.  Extract domain from user email (e.g., `apple.com`).
    2.  Query Team Howdy's **Domain API**: `GET /domain/apple.com` → returns `tierId: "gold"`.
    3.  Query Team Howdy's **Config API**: `GET /config` → finds the `earlyAccessHours` for the "gold" tier (e.g., 48 hours).
- **Overrides**: The event object can store `tierOverrides` (e.g., "Silver gets 4 hours for this specific event"). The code checks for these before falling back to the global config.
- **Exemptions**: Users in `students` or `alumni` groups, as well as the event creator and admins, are exempt from gating and can RSVP as soon as the event is created.

### 3. Smart Waitlisting & Prioritization (The "Queue")
The waitlist is **not** a simple FIFO queue. It is sorted by **Priority Rank**, then by **Time**.
- **Tier Rank**: When a user joins the waitlist, we resolve their domain to a `tierRank` (Gold = 1, Silver = 2, Student = 99).
- **Promotion Logic**: When a confirmed user cancels (`cancelRsvp`), the code:
    1.  Queries the waitlist for the event.
    2.  Identifies the highest-priority person (lowest rank, earliest time).
    3.  Performs an **atomic cancel-and-promote transaction**: deletes the cancelling user's record and updates the waitlisted user to `CONFIRMED` in a single stroke. This prevents "double-promotion" races.

### 4. Optimistic Locking (The "Safety")
Every update to an event record increments a `version` field.
- **Requirement**: When updating an event (PUT `/api/events/{id}`), the requester must provide the version they are looking at.
- **Enforcement**: The database check `#version = :expectedVersion` ensures that if Admin A and Admin B edit the same event simultaneously, only the first one succeeds. The second admin will receive a `409 Conflict` and must refresh.

## 🏗️ Architecture: The Dual-Purpose Lambda

The entry point (`index.js`) is a hybrid handler that handles both API requests and background tasks:
- **REST API**: Using `serverless-http`, it routes all `/api/*` traffic to an internal Express app.
- **Background Processor**: It intercepts `aws:dynamodb` stream records for RSVP/Waitlist emails and `SEND_EVENT_REMINDER` actions for scheduled notifications.
- **Modular Services**: Logic is split into `calendarService.js`, `surveyService.js`, and `analyticsService.js` for maintainability.

## 🛠️ Local Development & Workflow

### The Mocking Strategy (`server.js`)
We use a custom **monkey-patching** technique to intercept AWS SDK calls. This is the secret sauce for our local productivity:
- It routes all DynamoDB calls to an in-memory JS object.
- It supports `TransactWriteItems`, `QueryCommand` (with filters), and `ScanCommand`.
- **Benefit**: You can run the entire service logic, including complex transactions and waitlist promotions, locally without an AWS account or a live Internet connection.

### Integration Testing (`test-waitlist.js`)
This is the ultimate source of truth. Running `npm test` executes a suite of 9 scenarios that stress-test every edge case. It is the best way to see the service in action.

## 📌 Maintenance Notes
- **Domain API Downtime**: If Team Howdy's API is unresponsive, the Velvet Rope "fails closed" (returns 503) to ensure no unauthorized access occurs.
- **Email Notifications**: Confirmation emails are triggered via **DynamoDB Streams**. The Lambda handler (`index.js`) processes the stream; if emails stop working, check that the Stream is enabled on the `EventRsvps` table in Terraform.
- **Calendar Files**: The `.ics` generation is handled purely in memory by the `ics` library and returned as a stream/buffer.

## 📖 API Reference (Event Service)

All endpoints are prefixed with `/api`. Authentication is required via Cognito JWT for most routes.

### 📅 Event Management (Admin)

#### `POST /events`
Create a new recruitment event.
- **Request Body**:
  ```json
  {
    "title": "Spring Career Fair",
    "date": "2026-05-20T14:00:00Z",
    "category": "CAREER",
    "capacity": 100,
    "description": "Annual career fair for CMIS students.",
    "location": "MSC Ballroom",
    "rsvpDeadline": "2026-05-18T23:59:59Z",
    "velvetRopeBypass": false,
    "tierOverrides": { "gold": 72 }
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "eventId": "uuid-v4-string",
    "version": 1,
    "currentRsvps": 0,
    "createdAt": "2026-04-26T..."
  }
  ```

#### `PUT /events/{eventId}`
Update event details. Requires the current `version` for optimistic locking.
- **Request Body**:
  ```json
  {
    "title": "Updated Title",
    "version": 1
  }
  ```
- **Response (200 OK)**: The fully updated event object.
- **Error (409 Conflict)**: Returned if the version has changed in the DB.

---

### 🎟️ RSVPs & Waitlist

#### `POST /events/{eventId}/rsvp`
Register for an event. Triggers the Velvet Rope time-gate and Waitlist logic.
- **Headers**: `Authorization: Bearer <JWT>`
- **Response (200 OK - Confirmed)**:
  ```json
  {
    "status": "CONFIRMED",
    "eventId": "...",
    "userId": "...",
    "rsvpAt": "2026-04-26T..."
  }
  ```
- **Response (200 OK - Waitlisted)**:
  ```json
  {
    "status": "WAITLISTED",
    "position": 5,
    "queueSize": 20,
    "message": "Event is full. You've been added to the waitlist at position 5."
  }
  ```
- **Error (403 Forbidden)**: Returned if the Velvet Rope gate is locked for your tier.

#### `DELETE /events/{eventId}/rsvp`
Cancel an RSVP. If the user was `CONFIRMED`, it triggers an automatic promotion of the next person in the waitlist.
- **Response (200 OK)**:
  ```json
  {
    "status": "cancelled",
    "promoted": "userId-of-next-person"
  }
  ```

---

### 📊 Surveys & Analytics

#### `GET /analytics/event-success`
Admin dashboard data comparing RSVPs vs Check-ins by category.
- **Response (200 OK)**:
  ```json
  [
    {
      "category": "WORKSHOP",
      "totalEvents": 5,
      "totalRsvps": 200,
      "totalCheckedIn": 180,
      "successRate": 0.9
    }
  ]
  ```

#### `POST /events/{eventId}/send-survey`
Manually trigger feedback requests to all checked-in attendees.
- **Response (200 OK)**:
  ```json
  {
    "eventId": "...",
    "sent": 45,
    "total": 50
  }
  ```

---

### 🗓️ Calendar Integration

#### `GET /events/{eventId}/ical`
Download an `.ics` file for a single event. (Public access)

#### `GET /users/{userId}/ical`
Download a combined `.ics` file for all of a user's confirmed RSVPs. (Public access)
