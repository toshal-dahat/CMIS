# Student Engagement Analytics Card (Admin)

This document describes how the **Student Engagement Analytics** card works in the admin UI, including data sources, calculations, and behavior.

## High-level system architecture

The student engagement card is a read-only analytics projection built in the frontend.

```text
Admin UI (EngagementAnalyticsCard.svelte)
  -> Student Service: GET /student/api/profiles
  -> Event Service:   GET /api/events
  -> Event Service:   GET /api/events/{eventId}/rsvp (for each event)
  -> Frontend aggregation:
       - filters to role=STUDENT
       - computes KPIs, top attendees, zero-attendance list, heatmap
  -> Renders analytics widgets in admin dashboard
```

The card does not persist analytics results. It recomputes metrics from live API responses on load/refresh and when scope changes.

## Resilience model (current behavior)

The card uses a stability-first refresh strategy to avoid inconsistent KPI jumps during transient API failures.

- Per-request retries with exponential backoff for source calls.
- Concurrency-limited RSVP fan-out (bounded parallelism) instead of unbounded `Promise.all`.
- Stale-response guard (`requestId`) so older refreshes cannot overwrite newer state.
- Last-known-good snapshot protection:
  - Full refresh success updates canonical cached datasets.
  - Partial RSVP refresh keeps prior snapshot and shows a warning instead of replacing totals with partial data.
- Warning path keeps dashboard usable on transient failures instead of showing only an error state.

## Endpoint inventory for this component

### Student Service endpoints

#### 1) List profiles

- Method: `GET`
- Path: `/student/api/profiles`
- Used for: Student metadata and role filtering (`role === STUDENT`)
- Called from: `listProfiles()` in `frontend/src/lib/api`

### Event Service endpoints

#### 2) List events

- Method: `GET`
- Path: `/api/events`
- Used for: Event scope picker and total event count
- Called from: `listEvents()` in `frontend/src/lib/events-api.ts`

#### 3) List RSVP/check-in rows per event

- Method: `GET`
- Path: `/api/events/{eventId}/rsvp`
- Used for: Check-in counts, RSVP counts, attendance rate, top attendees
- Called from: `getEventRsvps(eventId)` in `frontend/src/lib/events-api.ts`

## Where it lives

- UI component: `frontend/src/lib/EngagementAnalyticsCard.svelte`
- Page wrapper: `frontend/src/lib/StudentEngagementAnalyticsPage.svelte`

## Purpose

The card gives admins a fast snapshot of student event engagement by showing:

- total events in scope
- total student check-ins
- number of students with zero attendance
- top attendees
- attendance heatmap by class year and degree/major

## Data sources

The card combines data from two APIs:

1. **Events + RSVP/Check-in data**
   - `listEvents()` from `frontend/src/lib/events-api.ts`
   - `getEventRsvps(eventId)` for each event
2. **Student profile data**
   - `listProfiles()` from `frontend/src/lib/api`

## Scope behavior

The card supports two scopes:

- **All events** (`__ALL__`)
- **Single selected event**

When scope changes, analytics are recomputed from cached datasets (profiles + RSVP rows).

## Student filtering rules

Only users with profile role `STUDENT` are included in this dashboard.

- Excludes non-student roles (admin, friend, investor, etc.)
- Excludes students missing profile role mapping

## Metric definitions

### 1) Events

- All scope: count of events returned by `listEvents()`
- Single-event scope: `1` if event exists in list, otherwise `0`

### 2) Student check-ins

A row is considered checked in when either:

- `checkedIn === true`, or
- `checkedInAt` is populated

Check-ins are deduplicated by `(eventId, userId)` before counting.

### 3) Zero attendance students

Students with role `STUDENT` and **zero** check-ins in the selected scope.

### 4) Top attendees

For each student:

- `checkins` = unique checked-in rows in scope
- `rsvps` = unique RSVP rows in scope with status `CONFIRMED`
- `attendanceRate` = `checkins / rsvps * 100` (1 decimal), or `null` when `rsvps = 0`

Rank modes:

- `checkin`: sort by check-ins desc, RSVPs desc, name asc
- `rsvp`: sort by RSVPs desc, check-ins desc, name asc
- `attendanceRate`: sort by attendance rate desc, RSVPs desc, check-ins desc, name asc

### 5) Attendance heatmap

- **Rows**: class year (profile `classYear` or `gradDate` year fallback)
- **Columns**: degree + major buckets
- **Cell value**: sum of student check-ins in scope

Degree normalization:

- BS variants -> `BS`
- MS variants -> `MS`
- PhD variants -> `PhD`
- empty -> `Undeclared`
- everything else -> `Other`

## Reliability and UX behavior

- Uses retry logic for API calls (exponential backoff)
- Loads events and profiles in parallel
- Fetches RSVP rows with bounded concurrency and per-call retry handling
- Preserves a last-known-good snapshot to prevent refresh-to-refresh inconsistency on partial failures
- Shows non-blocking warning messages for partial/failed refreshes while keeping prior good analytics visible
- Provides refresh button for manual recomputation

## Known assumptions

- RSVP source provides check-in fields (`checkedIn`, `checkedInAt`)
- Profile records include role and student metadata (major, degree, gradDate/classYear)
- `CONFIRMED` RSVP is the only RSVP status counted toward attendance-rate denominator
