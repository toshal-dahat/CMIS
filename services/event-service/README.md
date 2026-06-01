# Event Service

The Event Service is a core microservice of the CMIS platform, responsible for managing event lifecycles, RSVPs, waitlists, and attendee notifications.

## Features

- **Event Management**: CRUD operations for events with optimistic locking.
- **RSVP & Waitlist (Velvet Rope)**: Sophisticated RSVP logic with atomic capacity management and priority waitlists.
- **Partner Early Access**: Domain-based early access gating for partner companies.
- **Notifications**: 
  - Automated RSVP confirmation emails via DynamoDB Streams and SES.
  - Waitlist promotion notifications.
  - Event reminders (triggered by EventBridge/Lambda).
- **Calendar Integration**: ICS file generation for single events and full user schedules.
- **Surveys & Analytics**: Post-event feedback collection and RSVP-vs-Check-in success metrics.

## Architecture

The service is designed to run as an AWS Lambda function behind an API Gateway, but it can also be run locally as an Express server.

- **Entry Point**: `index.js` (Lambda handler & Express app definition).
- **Local Dev**: `server.js` (Express server with full in-memory DynamoDB mock).
- **Core Logic**: Located in `src/services/`.
- **Middleware**: JWT/Cognito authentication in `src/lib/jwt.js`.

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
