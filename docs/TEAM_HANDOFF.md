# CMIS Platform — Team 12th Man Handoff

For the next team or maintainer taking over the Event Core and Velvet Rope features.

## What this repo contains

- **Event Core & Velvet Rope (Team 12th Man):** Event catalog, RSVP logic, Optimistic Locking, and tiered access gating (Velvet Rope).
- **Backend:** Node.js Express Lambda in `services/event-service/` (Events CRUD, RSVP logic).
- **Frontend:** Svelte + Vite in `frontend/` (Events Catalog, Velvet Rope UI in `EventsDashboard.svelte`).

## Where to start

1. **README.md** — Event Core Architecture & Setup.
2. **docs/CODE_EXPLANATION_GUIDE.md** — In-depth guide on Optimistic Locking & Velvet Rope math.
3. **docs/API_REFERENCE_EVENTS.md** — All Event/RSVP HTTP endpoints and error formats.
4. **demo_script.md** — Step-by-step demo script for the Event Core handover.

## Key config

- **Frontend:** `VITE_EVENT_API_URL` for the Event Service API URL (or dev proxy).
- **Backend:** Ensure your AWS environment has DynamoDB Streams enabled on `EventRsvps-dev` if you plan to extend the RSVP flows.

## Decisions to be aware of

- **Optimistic Locking:** All event updates (PUT) must include the `version` attribute to prevent concurrency issues.
- **Fail-Closed Gating:** If the Velvet Rope cannot fetch global Tier configs from Team Howdy's API, RSVPs will fail securely (503) rather than accidentally granting early access.
- **Event-Specific Overrides:** Admins can override the global Tier access hours on a per-event basis. The Svelte math engine (`velvetRope.ts`) checks for these overrides first before falling back to the global defaults.

## Running locally

- **Backend:** `cd services/event-service && npm install && node server.js`
- **Frontend:** `cd frontend && npm install && npm run dev`

## Contacts and links

- Project: CMIS Engagement Platform (ISTM 665) — Team 12th Man.

## Handover checklist for outgoing team

- [x] README and docs are up to date and pruned to Team 12th Man features.
- [x] API Reference is accurate and includes locking/gating HTTP codes.
- [x] Code Explanation Guide covers Velvet Rope math engine in detail.
- [x] Demo walkthrough script covers the architecture flow.
