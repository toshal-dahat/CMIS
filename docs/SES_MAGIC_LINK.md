# SES Note (Deprecated Doc)

This file previously documented magic-link email setup for a graduation claim flow.

That flow is no longer part of the current documented CMIS graduation handover UX.

Current flow:
- Frontend checks `GET /graduation-status?gradDate=...` for popup visibility.
- User confirms graduation and completes authenticated `POST /graduation-handover`.

If you still enable SES in your environment, treat it as optional notification infrastructure rather than a required graduation-handover step.
