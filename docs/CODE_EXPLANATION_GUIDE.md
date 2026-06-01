# CMIS Event Core & Velvet Rope — Code Explanation Guide

This document explains the architecture, data flows, and key files for the Event Core and Velvet Rope features built by Team 12th Man.

---

## 1. Event Core

The **Event Service** (`services/event-service/`) is a standalone Node.js Express microservice responsible for the Event Catalog and RSVP logic.

### 1.1 Architecture & Flow
- **API Gateway Routing**: Requests to `/api/events/*` are proxied to the Node.js Lambda function via a separate Terraform configuration (`infrastructure/events/terraform`).
- **DynamoDB Schema (`Events-dev`)**: 
  - PK: `eventId` (String, UUID)
  - Attributes: `title`, `date`, `category`, `capacity`, `currentRsvps`, `version` (Number).

### 1.2 RSVP Logic & Optimistic Locking
To prevent overbooking (race conditions) during high-traffic RSVPs, the backend uses **DynamoDB Conditional Writes**:
1. When a user RSVPs, the backend fetches the event to check `currentRsvps < capacity`.
2. It attempts to increment `currentRsvps` and `version`, with the condition `ConditionExpression: "version = :expectedVersion"`.
3. If another request modified the event simultaneously, the condition fails (`ConditionalCheckFailedException`), returning a `409 Conflict`.
4. If successful, the user is added to the `EventRsvps` table.

### 1.3 Catalog UI (`EventsDashboard.svelte`)
- Displays all upcoming events.
- Implements **Client-Side Filtering** by Category and Date using reactive Svelte derivations (`$derived`).

---

## 2. The Velvet Rope (Tiered Gating)

The Velvet Rope implements exclusive early access to events based on a user's Tier (e.g., Gold, Silver) queried from the global Config API.

### 2.1 Backend Middleware API Gating
- When a user requests to RSVP, the backend queries the user's tier and the configured `EarlyAccessHours` for that tier.
- The RSVP is rejected with `403 Forbidden` if `Now < (EventTime - TierEarlyAccessHours)`.

### 2.2 Frontend State Management & UI
- **`velvetRope.ts`**: The math engine that transforms ISO timestamps and tier configurations into actionable data. It calculates the exact `myUnlockTs` for the current user.
- **UI Feedback (`EventsDashboard.svelte`)**: 
  - If the event is locked for the user, the "RSVP" button is explicitly disabled.
  - A visual badge displays a countdown, evaluated dynamically (e.g., "Opens for Silver Partners in 2 days").
