# API Reference: Event Core & Velvet Rope

This document details the REST APIs managed by the **Event Service** (Node.js/Express) built by Team 12th Man.

All endpoints are prefixed with `/api` and routed via API Gateway to the Event Service Lambda.

---

## Event Catalog (CRUD)

### `GET /api/events`
Returns a list of all upcoming events.
- **Auth**: Optional (publicly viewable catalog).
- **Response `200 OK`**:
  ```json
  [
    {
      "eventId": "uuid",
      "title": "Corporate Mixer",
      "date": "2026-05-10T18:00:00Z",
      "category": "NETWORKING",
      "capacity": 100,
      "currentRsvps": 45,
      "version": 3
    }
  ]
  ```

### `POST /api/events`
Create a new event.
- **Auth**: Required (Admin only).
- **Body**:
  ```json
  {
    "title": "New Event",
    "date": "2026-06-01T10:00:00Z",
    "category": "WORKSHOP",
    "capacity": 50
  }
  ```
- **Response `201 Created`**: Returns the created event object.

### `PUT /api/events/:eventId`
Update an existing event.
- **Auth**: Required (Admin only).
- **Body**: Partial updates allowed (e.g., `{"capacity": 75}`).
- **Response `200 OK`**: Returns the updated event.
- **Response `409 Conflict`**: If the `version` condition fails (Optimistic Locking).

### `DELETE /api/events/:eventId`
Delete an event.
- **Auth**: Required (Admin only).
- **Response `204 No Content`**.

---

## RSVP Transactions & Velvet Rope

### `POST /api/events/:eventId/rsvp`
RSVP to an event as the authenticated user.
- **Auth**: Required.
- **Velvet Rope Gating**:
  - The backend queries the user's Tier Config to find `TierEarlyAccessHours`.
  - Calculates: `UnlockTime = EventTime - TierEarlyAccessHours`.
  - **Response `403 Forbidden`**: If `CurrentTime < UnlockTime`, returns `{"message": "Early access not yet open for your tier."}`
- **Optimistic Locking**:
  - The backend attempts to increment `currentRsvps` conditionally (`currentRsvps < capacity`).
  - **Response `409 Conflict`**: If the event is overbooked or modified simultaneously by another transaction.
- **Response `200 OK`**: Returns `{"status": "success", "message": "RSVP confirmed"}`.

### `DELETE /api/events/:eventId/rsvp`
Cancel an existing RSVP.
- **Auth**: Required.
- **Response `200 OK`**.

