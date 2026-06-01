# SES Magic-Link Email Setup

Magic-link emails for graduation handover are sent via **AWS SES** when a verified sender is configured. Without it, the API returns the link in the response (or logs it to CloudWatch) for dev testing.

## 1. Set the sender in Terraform

In `infrastructure/terraform.tfvars`, set your sender email (one you can receive mail at for verification):

```hcl
ses_verified_sender = "your-email@gmail.com"
```

Or apply with a variable:

```bash
cd infrastructure
terraform apply -var="ses_verified_sender=your-email@gmail.com"
```

## 2. Apply and verify the sender

When you run `terraform apply`, Terraform creates an **SES email identity** for that address. AWS then sends a **verification email** to it.

- Open that email and click the verification link.
- Until the identity is **Verified** in SES, Lambda cannot send from it.

Check status in **AWS Console → SES → Verified identities**.

## 3. SES sandbox and recipient verification

New AWS accounts use SES in **sandbox** mode. In sandbox:

- You can only **send to** addresses that are also verified in SES.
- To receive the magic link at e.g. `yashassuresh775@gmail.com`:
  - **Option A:** Add `yashassuresh775@gmail.com` as another verified identity in SES (SES → Verified identities → Create identity → Email address), then complete the verification email.
  - **Option B:** Use the same verified address as both sender and as `personal_email` in the students table so you receive the link at that inbox.

To send to any recipient (no recipient verification), request **production access** for SES in the AWS Console (SES → Account dashboard → Request production access).

## 4. Test

1. Ensure a student record exists with `personal_email` = the address that will receive the link (and that address is verified in SES if in sandbox).
2. Request the magic link from the app (Login → “I’m a graduate — get my claim link”) or via API:

   ```bash
   curl -X POST "https://YOUR_API_URL/graduation-handover/request-link" \
     -H "Content-Type: application/json" \
     -d '{"email":"recipient@example.com"}'
   ```

3. Check the recipient inbox for the email with subject **Confirm your email address - CMIS graduate account** and the magic link.

## Summary

| Step | Action |
|------|--------|
| 1 | Set `ses_verified_sender` in tfvars and run `terraform apply` |
| 2 | Verify the sender email via the link AWS sends |
| 3 | (Sandbox) Verify recipient email in SES or use same as sender |
| 4 | Request magic link and check inbox |
