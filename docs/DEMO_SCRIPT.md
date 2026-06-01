# CMIS External Core - Demo Script

Use this script to demo the External Core (Team Gig 'Em) in order.

## Prerequisites

- Backend and frontend running (e.g. restart.sh, frontend on http://localhost:5173).
- API base URL configured (VITE_API_BASE or /api proxy).

## 1. Registration (@tamu.edu only)

1. Open the app, click Register.
2. Enter email yournetid@tamu.edu, password (at least 10 chars, mixed case, number, symbol).
3. Optionally check Former Student and enter Class year (e.g. 26).
4. Submit; expect "Registration successful" then redirect to Log in.
5. Non-@tamu.edu emails are rejected.

## 2. Log in

1. Log in with the same email and password.
2. You land on Profile (role: PARTNER / FORMER_STUDENT / FRIEND).
3. Note: Sign in uses CMIS account password; SSO is not used.

## 3. Profile and edit

1. On Profile, click Edit profile.
2. Update Class year and/or LinkedIn URL, then Save.
3. Confirm values persist after refresh.

## 4. Graduation Handover (if not already FORMER_STUDENT)

1. If role is not FORMER_STUDENT, Graduation Handover appears in the nav.
2. Go to Graduation Handover.
3. Enter Student UIN, Personal email (must match student record if present), Current password, optional Class year.
4. Submit; expect "Your account is now linked to your student history."
5. Return to Profile; role is FORMER_STUDENT, Linked UIN shown.
6. Graduation Handover no longer shown (already linked).

## 5. Handover History (admin)

1. As an admin (user ID in ADMIN_USER_IDS), click Handover History.
2. Show table of recent handover log entries (INITIATED, SUCCESS, FAILED).
3. As non-admin, same link returns 403 Forbidden.

## 6. Forgot password

1. Log out, go to Log in.
2. Click Forgot password.
3. Enter email; expect "Check your email for the reset code."
4. Enter code from email, new password, confirm; click Reset password.
5. Log in with the new password.

## 7. Graduate claim (magic link)

1. From Log in, use "I'm a graduate - get my claim link."
2. Enter personal email on file for an eligible student; request link.
3. Use "Already have a magic link? Paste it here" and paste token or URL.
4. Go to claim; enter new password; account created and linked as FORMER_STUDENT.

## 8. Reset password (direct link)

1. If user lands on /reset-password with email and code in query, Reset password view is shown with fields prefilled.
2. Enter new password and confirm; submit; expect "Password has been reset."

## Quick checklist

- Register @tamu.edu
- Log in and view Profile
- Edit profile (class year, LinkedIn)
- Graduation Handover then confirm FORMER_STUDENT and nav change
- Handover History as admin
- Forgot password flow
- Graduate claim (request link, paste token, set password)
- Reset password from URL or Forgot flow
