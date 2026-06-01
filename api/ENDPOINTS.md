# External Service – Endpoint list

Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com` (from `terraform output -raw api_gateway_url`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| POST | `/auth/signup` | Register (email, password, formerStudent?, classYear?) |
| POST | `/auth/signin` | Sign in (email, password) |
| POST | `/auth/forgot-password` | Request reset code (email) |
| POST | `/auth/reset-password` | Reset password (email, code, newPassword) |
| GET | `/me` | Current user (Bearer token) |
| PUT | `/me` | Update profile (Bearer token) |
| GET | `/graduation-status?gradDate=` | Should UI show graduation prompt |
| GET | `/graduation-handover/lookup?uin=` | Look up student by UIN (Bearer) |
| POST | `/graduation-handover` | Link UIN to account (Bearer) |
| GET | `/graduation-handover/history` | Handover history (Bearer, admin) |

Full request/response details: see [api/README.md](README.md).
