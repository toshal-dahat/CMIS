# Event Service Infrastructure (Team 12th Man)

This directory contains the Terraform configuration for the CMIS Event Service.

## File Map

| File | Purpose |
| :--- | :--- |
| `apigateway.tf` | Defines the HTTP API Gateway, stages, and all 15+ routes (Public, RSVP, Admin). |
| `cloudfront.tf` | (Optional) CDN configuration for the API Gateway endpoint. |
| `dynamodb.tf` | Defines the `Events` and `EventRsvps` tables. Streams are enabled on RSVPs for waitlist processing. |
| `eventbridge.tf` | Sets up permissions for dynamic event reminders (Bounty 4). |
| `iam.tf` | Placeholder/Header for IAM roles (roles are managed in the root infrastructure). |
| `lambda.tf` | Defines the core Lambda function, its environment variables, and stream triggers. |
| `main.tf` | Module entry point and high-level architectural overview. |
| `outputs.tf` | Exports API URLs and table names for use by other modules and the frontend. |
| `surveys.tf` | Defines tables for survey templates and attendee responses. |
| `variables.tf` | Input configuration for the module (regions, stage, cross-service URLs). |
| `versions.tf` | Provider and Terraform version constraints. |

## Key Concepts

### 1. The Velvet Rope (Bounty 6)
The infrastructure supports the Velvet Rope logic through:
- **`dynamodb.tf`**: The `EventRsvps` table uses a composite key (`eventId` + `userId`) to ensure atomicity and prevent double-booking.
- **`lambda.tf`**: Environment variables (`DOMAIN_API_URL`, `CONFIG_API_URL`) allow the Lambda to reach out to Team Howdy's Admin service to verify partner tiers.

### 2. Waitlist Promotion
When a user cancels a confirmed RSVP, the `rsvpService.js` logic (running in the Lambda) identifies the next person on the waitlist. If a promotion occurs, a DynamoDB Stream event is fired, which the Lambda processes to send a confirmation email.

### 3. Event Reminders (Bounty 4)
The system uses **EventBridge Scheduler** (via permissions in `eventbridge.tf`). When an event is created, the application code schedules a "one-time" trigger for 1 hour before the event to blast reminder emails.
