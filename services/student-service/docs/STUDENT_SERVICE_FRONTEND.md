# Student Service Frontend Implementation Guide

This document is the frontend handover for Student Service and reflects the current behavior of `ProfileForm.svelte` and the edited profile modal in `ProfilePanel.svelte`.

## Scope

1. Student Identity and Profile system
2. Resume parser integration
3. Profile auto-fill
4. QR code generator
5. QR scanner
6. Student engagement analytics

---

## Frontend Surface Area

- Framework: Svelte
- Auth: Amplify + Cognito Hosted UI + Google redirect + non-TAMU OTP fallback
- Main files:
  - `frontend/src/lib/LandingPage.svelte`
  - `frontend/src/lib/ProfileForm.svelte`
  - `frontend/src/lib/ProfilePanel.svelte`
  - `frontend/src/lib/ResumeSection.svelte`
  - `frontend/src/lib/api.ts`
  - `frontend/src/lib/resumes.ts`
  - `frontend/src/lib/events-api.ts`
  - `frontend/src/lib/EventCheckinScanner.svelte`
  - `frontend/src/lib/EventsDashboard.svelte`
  - `frontend/src/lib/EngagementAnalyticsCard.svelte`

---

## 1) Student Identity and Profile System

### A. Google SSO (Cognito Federated Login)

Status: **Implemented**

- `@tamu.edu` login path redirects to Google via Cognito (`signInWithGoogle()`).
- No separate student password form in the student path.
- Non-TAMU users can still use OTP flows (friend/investor/admin paths).

### B. Profile Form + Edited Profile Modal (Current UI)

Status: **Implemented**

#### First-time form (`ProfileForm.svelte`)

- Heading labels:
  - student -> `Student Profile`
  - friend -> `Profile`
  - investor -> `Investor Profile`
  - admin -> `Admin Profile`
- Captures: name, email, major, gradDate, linkedInUrl, plus UIN/degree/role-specific fields.
- Derives class year from gradDate in API payload construction.

#### Edit modal (`ProfilePanel.svelte`) — updated behavior

- Modal title is always: `My Profile`
- Subtitle is role-aware:
  - admin -> `View and edit your admin profile.`
  - student -> `View and edit your student profile. Recruiters use this to discover you.`
  - friend/investor -> `View and edit your profile.`
- Modal open behavior:
  - fetches latest profile (`fetchUserProfile()`)
  - resolves role from Cognito groups
  - hydrates local form state
  - loads master skills for non-admins
- Save behavior:
  - validates required fields and role-specific constraints
  - can upload selected resume through `ResumeSection`
  - calls `updateProfile(payload)`; if profile missing, falls back to `createProfile(payload)`
  - shows “Profile changes saved!” banner and closes modal on success
- Close behavior:
  - close button and backdrop click both dismiss modal
  - separate Sign Out action available in footer

### C. Resume Upload (Presigned URL Direct-to-S3)

Status: **Implemented (primary path)**

- Backend URL request: `POST /student/api/resumes/upload-url`
- Browser uploads PDF directly to S3 presigned URL (`PUT`)
- `resumeS3Key` is persisted through profile create/update payloads
- Client-side guidance enforces not sending Authorization header to S3 presigned PUT

### D. Validation

Status: **Implemented**

- File type restricted to PDF (`application/pdf` or `.pdf`)
- File size restricted to 5MB (`5 * 1024 * 1024`) in UI

### E. Persistence (Profile + Resume reference)

Status: **Implemented**

- Profile create: `POST /student/api/profiles`
- Profile update: `PUT /student/api/profiles/me`
- Profile fetch: `GET /student/api/profiles/me`
- Payload includes `resumeS3Key` (and profile fields) for DynamoDB persistence via backend

---

## 2) Resume Parser

Requirement: S3 upload triggers OCR/LLM and stores extracted JSON.

Status: **Partially Implemented in frontend**

Implemented:
- Upload path exists and resume records can be listed.
- Profile UI supports parser-related fields (`profileGpa`, `profileEducation`, `profileSkillKeys`).

Current frontend gaps:
- No explicit parser progress/status timeline UI.
- No polling loop for extraction completion in profile/resume surfaces.
- `completeUpload()` client helper exists, but main upload UI path should explicitly confirm it is invoked in flow after PUT.

---

## 3) Profile Auto-Fill

Requirement: poll until parsing complete and auto-populate skills/GPA/experience.

Status: **Partially Implemented**

Implemented:
- Editable GPA, education, and skill keys are present in both form and modal.
- Master skills are loaded from `/student/api/skills`.

Gaps:
- No explicit “parsing complete” polling loop in profile surfaces.
- No dedicated auto-fill review state for parser deltas.
- No dedicated “experience tags” section yet in profile UI.

---

## 4) QR Code Generator

Requirement: generate signed unique QR per event and display in admin event details.

Status: **Implemented**

- `GET /student/api/events/{eventId}/qr`
- Event Details modal in `EventsDashboard.svelte` renders `qrCodeDataUrl`.

---

## 5) QR Scanner App

Requirement: mobile scanner checks in users against event context.

Status: **Implemented (self-check-in flow)**

- `EventCheckinScanner.svelte` uses `html5-qrcode` and mobile camera.
- Calls `POST /student/api/events/check-in/self` with scanned payload + expected event ID.
- Includes duplicate scan cooldown and success/failure UX.

Note:
- Current implementation is self-check-in oriented; separate admin attendee-scanner behavior may be added if required.

---

## 6) Student Engagement Analytics

Requirement: top attendees, zero attendance, heatmap by major/class year.

Status: **Implemented**

- `EngagementAnalyticsCard.svelte` computes:
  - top attendees (check-ins / RSVPs / attendance rate modes)
  - zero-attendance students
  - heatmap by class year x degree-major
- Data sources:
  - `/student/api/profiles`
  - `/api/events`
  - `/api/events/{eventId}/rsvp`
- Includes retry, bounded concurrency, stale-response guards, and snapshot stability behavior.

---

## Endpoint Inventory Used by Frontend

- `GET /student/api/users/me/profile-exists`
- `GET /student/api/profiles/me`
- `POST /student/api/profiles`
- `PUT /student/api/profiles/me`
- `GET /student/api/profiles`
- `GET /student/api/skills`
- `POST /student/api/resumes/upload-url`
- `POST /student/api/resumes/complete` (implemented in `resumes.ts` helper; currently not invoked by `ResumeSection.svelte`)
- `GET /student/api/resumes/me`
- `GET /student/api/resumes/{resumeId}/download-url`
- `GET /student/api/events/{eventId}/qr`
- `POST /student/api/events/check-in/self`
- `GET /api/events`
- `GET /api/events/{eventId}/rsvp`

---

## Priority Follow-ups

1. Add explicit parser status polling (`UPLOADED` -> `EXTRACTED`) in profile/resume UX.
2. Add parser delta review UI (what changed in skills/GPA/education/experience).
3. Confirm and enforce `resumes/complete` invocation in the resume upload submit path.
4. Add admin-specific attendee scanner mode if product requires non-self check-in flows.

---

## Quick Traceability

- Login + routing: `frontend/src/lib/LandingPage.svelte`, `frontend/src/lib/auth.ts`
- First-time profile form: `frontend/src/lib/ProfileForm.svelte`
- Edited profile modal: `frontend/src/lib/ProfilePanel.svelte`
- Resume upload/download client: `frontend/src/lib/resumes.ts`, `frontend/src/lib/ResumeSection.svelte`
- Profile API client: `frontend/src/lib/api.ts`
- QR + check-in: `frontend/src/lib/events-api.ts`, `frontend/src/lib/EventsDashboard.svelte`, `frontend/src/lib/EventCheckinScanner.svelte`
- Analytics: `frontend/src/lib/EngagementAnalyticsCard.svelte`
