# CMIS External Core — Deployment Checklist

Use this before deploying or after infrastructure changes.

## Pre-deploy

- [ ] **Terraform**  
  - `terraform plan` in `infrastructure/` shows expected changes.  
  - Variables set (e.g. `terraform.tfvars` or env): `project_name`, `frontend_base_url`, `company_list_api_url`, `ses_verified_sender`, `admin_user_ids` (comma-separated Cognito user IDs for admin endpoints).

- [ ] **Backend**  
  - All Python deps are in Lambda layer or packaged (current setup uses inline deps in `services/external-service/`).  
  - No local paths or secrets in code; use env vars (e.g. `USER_POOL_ID`, `ADMIN_USER_IDS`, `HANDOVER_LOG_TABLE`).

- [ ] **Frontend**  
  - `VITE_API_BASE` points to the deployed API URL (or use proxy in dev).  
  - Build: `npm run build` in `frontend/` succeeds.

## Deploy steps

1. **Infrastructure**  
   ```bash
   cd infrastructure
   terraform init
   terraform plan
   terraform apply
   ```

2. **Lambda**  
   - Lambda is updated automatically by Terraform (zip from `services/external-service/`).  
   - After apply, verify env vars on the function: `USER_POOL_ID`, `CLIENT_ID`, `EXTERNAL_USERS_TABLE`, `STUDENTS_TABLE`, `HANDOVER_TOKENS_TABLE`, `HANDOVER_LOG_TABLE`, `ADMIN_USER_IDS`, `FRONTEND_BASE_URL`, `SES_VERIFIED_SENDER`, etc.

3. **Frontend**  
   - Deploy built assets to S3/CloudFront (or your host).  
   - Ensure CORS on the API allows your frontend origin (API Gateway is configured with `allow_origins = ["*"]` by default; restrict in production if needed).

4. **Cognito**  
   - User pool and app client are created by Terraform.  
   - If you use a custom domain or hosted UI, configure it separately.

5. **SES** (optional)  
   - If using magic-link email: verify sender in SES and set `ses_verified_sender`.  
   - Otherwise, links are logged to CloudWatch.

## Post-deploy

- [ ] **Health**  
  - `GET /` on the API returns `{"service":"external","version":"1.0"}`.

- [ ] **Auth**  
  - Register a test user (@tamu.edu), sign in, then `GET /me` with Bearer token returns profile.

- [ ] **Handover**  
  - As a non–FORMER_STUDENT user, `POST /graduation-handover` with valid body and auth succeeds (or returns expected validation errors).  
  - As FORMER_STUDENT, same request returns 403 "Already linked".

- [ ] **Admin**  
  - With a user ID in `ADMIN_USER_IDS`, `GET /graduation-handover/history` returns `{ "entries": [...] }`.  
  - With another user, same request returns 403.

- [ ] **Forgot / reset password**  
  - `POST /auth/forgot-password` and `POST /auth/reset-password` complete without 5xx.

## Rollback

- Revert Terraform state or re-apply a previous configuration.  
- Lambda version is managed by Terraform; previous zip can be restored from version history if needed.

## Security notes

- Do not commit `terraform.tfvars` with secrets.  
- Use `admin_user_ids` to restrict Handover History to admins only.  
- Restrict CORS and API keys in production as required.
