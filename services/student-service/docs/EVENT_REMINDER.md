# SNS Event Reminders

## Overview

This feature publishes event reminder notifications to Amazon SNS for downstream delivery.

There are two reminder delivery flows:

- **Email reminder flow**
- **SMS reminder flow**

The reminder mode is configured through the Terraform variables file (`tfvars`).
If not set, the default reminder mode is **email**.

## Scope

- Publish reminders for supported event types.
- Support configurable reminder offsets before event start time.
- Recompute reminders when an event is updated/rescheduled.
- Stop future reminders when an event is canceled.
- Route reminders through the configured mode (`email` or `sms`).

## Architecture and High-Level Flow

1. An event is created or updated through backend APIs.
2. Reminder scheduling logic computes reminder trigger times from event start time and offsets.
3. At each trigger time, backend publishes an SNS reminder message.
4. SNS subscribers consume the message and handle channel-specific delivery.
5. Logging and metrics are emitted for traceability and operational monitoring.

## Reminder Mode Configuration

Reminder type is configured in `tfvars`.

### Supported Values

- `email`
- `sms`

### Default

- `email`

### Implementation Note

Ensure reminder mode is read from `tfvars` and routes reminders to the correct flow (`email` or `sms`), with `email` as fallback/default.

## Backend Behavior

- Reminder scheduling is driven by event lifecycle actions (create, update, cancel).
- Time computations must be timezone-aware using the event timezone.
- On event **reschedule**, pending reminders are recalculated.
- On event **cancel**, pending reminders are invalidated.
- Publish logic is retry-safe and idempotent to avoid duplicate effective reminders.

## Endpoints (Event-Driven Reminder Triggers)

Reminders are typically triggered indirectly by event APIs.

### Typical Triggering Endpoints

- `POST /events` (create event)
- `PATCH /events/{eventId}` (update/reschedule event)
- `DELETE /events/{eventId}` (cancel event)

### Endpoint Docs Should Include

- Authentication and authorization requirements.
- Required fields (for example: `startTime`, `timezone`, recipient references).
- Validation errors and status codes.
- Reminder side-effects for create/update/cancel.

## Example API Requests and Responses

Replace with your exact API schema where needed.

### Create Event (Triggers Reminder Scheduling)

#### Request

```http
POST /events
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "eventType": "APPOINTMENT",
  "startTime": "2026-05-01T15:00:00Z",
  "timezone": "America/Chicago",
  "recipientId": "usr_789",
  "title": "Quarterly Check-In"
}
```

#### Response (`201`)

```json
{
  "eventId": "evt_12345",
  "status": "SCHEDULED",
  "remindersPlanned": true
}
```

### Update Event (Reschedule Reminders)

#### Request

```http
PATCH /events/evt_12345
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "startTime": "2026-05-01T16:00:00Z"
}
```

#### Response (`200`)

```json
{
  "eventId": "evt_12345",
  "status": "RESCHEDULED",
  "remindersRecomputed": true
}
```

### Cancel Event (Stop Future Reminders)

#### Request

```http
DELETE /events/evt_12345
Authorization: Bearer <token>
```

#### Response (`200`)

```json
{
  "eventId": "evt_12345",
  "status": "CANCELED",
  "pendingRemindersInvalidated": true
}
```

### Common Error Example (`400`)

```json
{
  "error": "VALIDATION_ERROR",
  "message": "timezone is required"
}
```

## SNS Topic Configuration

- Topic naming convention: `<environment>-event-reminders`
- Environments: `dev`, `staging`, `prod`
- Publisher: reminder backend service role
- Subscribers: channel delivery services (Lambda, SQS consumers, etc.)

> Keep topic ARNs in environment configuration; avoid hardcoding in application code.

## Message Schema (SNS Payload)

The SNS payload for event reminders should follow this structure:

```json
{
  "version": "1.0",
  "messageType": "EVENT_REMINDER",
  "eventId": "evt_12345",
  "eventType": "APPOINTMENT",
  "reminderId": "rem_evt_12345_2026-05-01T14:00:00Z_1h",
  "scheduledStartTime": "2026-05-01T15:00:00Z",
  "reminderOffset": "PT1H",
  "reminderTriggerTime": "2026-05-01T14:00:00Z",
  "timezone": "America/Chicago",
  "recipientId": "usr_789",
  "correlationId": "corr_abc123",
  "publishedAt": "2026-05-01T14:00:00Z"
}
```

### Required Fields

- `version`
- `messageType`
- `eventId`
- `eventType`
- `scheduledStartTime`
- `reminderOffset`
- `reminderTriggerTime`
- `timezone`
- `recipientId`
- `correlationId`
- `publishedAt`

## Idempotency and Duplicate Prevention

- `reminderId` is deterministic for (`eventId`, `reminderOffset`, `reminderTriggerTime`).
- Retry logic does not produce duplicate effective reminders.
- Downstream consumers treat `reminderId` as an idempotency key when applicable.

## Error Handling and Retry Behavior

- Transient SNS publish failures are retried with exponential backoff.
- Persistent failures are logged with context and routed to DLQ/error pipeline (if configured).
- Alerting triggers when failure thresholds are exceeded.

## Security and IAM

- Apply least-privilege IAM:
  - Publisher role: `sns:Publish` on reminder topic only.
  - Subscriber roles: only required subscribe/consume permissions.
- Enable encryption per environment standards (SNS/KMS as required).
- Avoid sending unnecessary PII in SNS payloads.
- Redact sensitive fields in logs.

## Observability

### Metrics

- Publish success count
- Publish failure count
- Retry count
- Reminder publish latency
- DLQ/error volume

### Required Log Context

- `eventId`
- `reminderId`
- `correlationId`
- `eventType`
- `reminderOffset`
- Publish outcome and error code

## Troubleshooting Guide

### 1) Reminder Not Sent

- Confirm event exists and is in a reminder-eligible state.
- Verify reminder mode in `tfvars` (`email` or `sms`).
- Check scheduler logs for computed reminder times.
- Check publish logs for `eventId` and `correlationId`.
- Verify SNS topic ARN/config for the active environment.
- Confirm topic policy and IAM permissions allow publish.
- Confirm subscriber health (Lambda/SQS consumer/channel service).

### 2) Duplicate Reminders

- Verify deterministic `reminderId` generation.
- Confirm retry behavior is idempotent.
- Validate consumer deduplication strategy by `reminderId`.

### 3) Wrong Reminder Time

- Validate event timezone value.
- Check DST-aware conversion logic.
- Verify updated event start time triggered reminder recomputation.

### 4) SMS/Email Mismatch

- Confirm `tfvars` reminder mode value.
- Check deployment environment loaded the expected variables.
- Verify subscriber bindings correspond to selected reminder mode.

## Testing Requirements

### Unit Tests

- Reminder timestamp calculation by timezone
- DST boundary behavior
- Deterministic `reminderId` generation
- Reminder mode resolution with default fallback (`email`)

### Integration Tests

- SNS publish success path
- Retry behavior on transient failures
- Publish behavior per configured mode (`email` vs `sms`)

### End-to-End Tests

- Event create -> reminders published at expected offsets
- Event reschedule -> pending reminders recomputed
- Event cancel -> pending reminders invalidated
- Missing mode config -> defaults to `email`

## Handover Notes for Next Team


### Current Defaults and Assumptions

- Reminder mode configured in `tfvars`
- Default reminder mode is `email`

### Known Limitations (Initial Version)

- Global mode configuration (no per-user reminder mode preference)
- No guarantee of cross-offset ordering unless enforced downstream
- Channel-specific personalization is handled by subscribers

### Follow-Up Candidates

- Support per-tenant or per-user reminder channel preference
- Add richer payload metadata for subscriber templating
- Add replay tooling for failed reminder batches

