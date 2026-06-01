# Event QR Attendance Check-In

This document describes the QR-based attendance flow used to mark student attendance for events.

## High-level system architecture

The QR attendance feature spans the admin UI, student scanner UI, API Gateway/Lambda handlers, and DynamoDB.

```text
Admin Events UI
  -> GET /student/api/events/{eventId}/qr
  -> receives signed event token + QR image
  -> displays QR for attendees

Student scanner / Admin scanner
  -> scans QR payload (URL or signed token)
  -> POST check-in endpoint (self or admin path)

Student Service (eventQrAttendance handler)
  -> validates auth and role (admin for admin scanner)
  -> validates event exists and day gate (CHECKIN_TIMEZONE)
  -> validates QR token payload (eventId, evtDate)
  -> writes check-in state to RSVP_TABLE (EventRsvps)
  -> returns CHECKED_IN or ALREADY_CHECKED_IN result
```

## Endpoint inventory for this component

These are the complete runtime endpoints handled by the QR attendance component.

### 1) Generate event QR

- Method: `GET`
- Path: `/student/api/events/{eventId}/qr`
- Auth: required, admin only
- Purpose: create signed event check-in token and QR image payload

### 2) Admin scanner check-in

- Method: `POST`
- Path: `/student/api/events/{eventId}/check-in`
- Auth: required, admin only
- Purpose: check in scanned attendee to an event

### 3) Self check-in

- Method: `POST`
- Path: `/student/api/events/check-in/self`
- Auth: required
- Purpose: allow an attendee to check themselves in by scanning event QR

### 4) Mobile/web scanner page

- Method: `GET`
- Path: `/student/qr-scanner`
- Auth: required
- Purpose: render browser-based camera scanner UI

### 5) CORS preflight support

- Method: `OPTIONS`
- Paths:
  - `/student/api/events/{eventId}/qr`
  - `/student/api/events/{eventId}/check-in`
  - `/student/api/events/check-in/self`
  - `/student/qr-scanner`
- Purpose: respond to browser preflight with allowed methods/headers

## Backend location

- Handler: `services/student-service/src/handlers/eventQrAttendance.js`

## Feature summary

The system supports two check-in paths:

1. **Admin scanner check-in**
   - Admin scans attendee code and checks user in for a selected event
2. **Self check-in**
   - Student scans the event QR and checks themselves in

Check-ins are written to RSVP table rows (or created as walk-in style rows if no RSVP exists).

## Security and validation

### Admin authorization

Admin routes require Cognito group membership (`admins` variants accepted in code).

### Signed QR payload

Event QR token payload:

- `typ: "event-checkin"`
- `eventId`
- `evtDate` (calendar date for strict day check)

Token is signed with `HS256` using `QR_SIGNING_SECRET`.

### Event-day gate

Check-in is allowed **only** on the event calendar day in `CHECKIN_TIMEZONE` (default `America/Chicago`).

If not event day, endpoint returns `WRONG_CHECKIN_DAY`.

### Event consistency checks (self check-in)

- `expectedEventId` mismatch -> `EVENT_MISMATCH`
- QR token date mismatch with current event date -> `QR_DATE_MISMATCH`

## Check-in write behavior

Writes to RSVP table (`RSVP_TABLE`) keyed by `(eventId, userId)` with:

- `checkedIn = true`
- `checkedInAt = <ISO timestamp>`
- `checkedInBy = <scanner/admin or self userId>`
- `checkInSource = MOBILE_WEB_SCANNER | SELF_QR_SCAN`
- `attendanceStatus = CHECKED_IN`

If RSVP row is missing, row is upserted with defaults:

- RSVP detail sentinels use `"NA"` as placeholder
- status defaults to `WALK_IN`

Concurrency safety:

- conditional write prevents duplicate check-in timestamps
- duplicate attempts return `ALREADY_CHECKED_IN`

## Frontend integration points

- QR fetch API: `frontend/src/lib/events-api.ts` (`getEventQr`)
- Self check-in API: `frontend/src/lib/events-api.ts` (`selfCheckIn`)
- Admin event details modal requests QR in `frontend/src/lib/EventsDashboard.svelte`

## Common response statuses

- `CHECKED_IN`
- `ALREADY_CHECKED_IN`
- `CHECKIN_FAILED`
- `WRONG_CHECKIN_DAY`
- `EVENT_MISMATCH`
- `QR_DATE_MISMATCH`
