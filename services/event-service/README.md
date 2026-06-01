# Event Service

The Event Service is a core microservice of the CMIS platform, responsible for managing event lifecycles, RSVPs, waitlists, and attendee notifications.

## 🧠 Core Logic & Mechanics

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

## 📡 Infrastructure Dependencies

### 1. DynamoDB Streams (CRITICAL)
- Confirmation and promotion emails are triggered by **DynamoDB Streams** on the `EventRsvps` table.
- **Operational Risk**: If the stream is disabled or the Lambda trigger is removed in Terraform, emails will silently fail to send even if RSVPs are successful.

### 2. EventBridge Reminders
- Scheduled reminders (1 hour before an event) are managed by **EventBridge Scheduler**.
- The application dynamically creates rules with a `SEND_EVENT_REMINDER` action. If reminders are not firing, check the `events-core-reminder` rule prefix in the AWS console.

## API Routes

### Public Routes
- `GET /api/events`: List all upcoming events.
- `GET /api/events/:eventId`: Get detailed information about a specific event.
- `GET /api/events/health`: Service health check.
- `GET /api/events/:eventId/ical`: Download ICS for a specific event.
- `GET /api/users/:userId/ical`: Download ICS for a user's full schedule.
- `GET /api/surveys/:eventId/respond`: Get survey template (for public response).
- `POST /api/surveys/:eventId/respond`: Submit survey response.

### Authenticated User Routes
- `POST /api/events/:eventId/rsvp`: RSVP to an event (handles waitlisting).
- `DELETE /api/events/:eventId/rsvp`: Cancel an existing RSVP (triggers waitlist promotion).
- `GET /api/events/:eventId/waitlist/position`: Get current user's waitlist rank.
- `GET /api/events/user/rsvps`: List all events the user has RSVP'd to.

### Admin Routes
- `POST /api/events`: Create a new event.
- `PUT /api/events/:eventId`: Update event details.
- `DELETE /api/events/:eventId`: Remove an event and its schedules.
- `GET /api/events/:eventId/rsvp`: List all RSVPs for an event.
- `GET /api/surveys/:eventId`: Manage survey templates.
- `GET /api/analytics/event-success`: View event performance metrics.

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
