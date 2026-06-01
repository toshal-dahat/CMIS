#!/bin/bash
# Quick manual test script for Team Reveille Student Core APIs.
# Uses the endpoints documented in services/student-service/docs/API.md.
#
# Usage:
#   export ID_TOKEN="<your_cognito_id_token>"
#   # Optional override; defaults to dev base from API.md
#   # export STUDENT_API_BASE="https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev"
#   ./scripts/test-student-api.sh
#
# This script does NOT create or modify any AWS resources; it only calls the HTTP APIs.

set -euo pipefail

BASE="${STUDENT_API_BASE:-https://2gzy1e8qga.execute-api.us-east-1.amazonaws.com/dev}"

if [[ -z "${ID_TOKEN:-}" ]]; then
  echo "ERROR: ID_TOKEN environment variable is not set."
  echo "Get a Cognito ID token from the student SSO flow, then run:"
  echo "  export ID_TOKEN='eyJ...'"
  echo "  ./scripts/test-student-api.sh"
  exit 1
fi

auth_header() {
  echo "Authorization: Bearer ${ID_TOKEN}"
}

call_get() {
  local path="$1"
  echo
  echo "=== GET ${path} ==="
  curl -s -w "\nHTTP:%{http_code}\n" \
    -H "$(auth_header)" \
    "${BASE}${path}" | sed 's/^/  /'
}

call_post() {
  local path="$1"
  local json_body="$2"
  echo
  echo "=== POST ${path} ==="
  echo "  Body: ${json_body}"
  curl -s -w "\nHTTP:%{http_code}\n" \
    -H "$(auth_header)" \
    -H "Content-Type: application/json" \
    -d "${json_body}" \
    "${BASE}${path}" | sed 's/^/  /'
}

echo "Using STUDENT_API_BASE=${BASE}"

# 1. Check Profile Exists
call_get "/api/users/me/profile-exists"

# 2. Get My Profile
call_get "/api/profiles/me"

# 3. List Student Profiles (Students Connect)
call_get "/api/profiles"

# 4. Create Profile (example payload; may fail with 409 if profile already exists)
call_post "/api/profiles" '{
  "name": "Test Student",
  "uin": "123456789",
  "email": "test.student@example.com",
  "degree": "BS",
  "major": "Computer Science",
  "gradDate": "2026-05",
  "linkedInUrl": "https://linkedin.com/in/test-student",
  "resumeS3Key": null
}'

# 5. Update Profile (partial)
call_post "/api/profiles/me" '{
  "linkedInUrl": "https://linkedin.com/in/test-student-updated"
}'

# 6. Delete Profile
echo
echo "=== DELETE /api/profiles/me ==="
curl -s -w "\nHTTP:%{http_code}\n" \
  -X DELETE \
  -H "$(auth_header)" \
  "${BASE}/api/profiles/me" | sed 's/^/  /'

# 7. Resume Upload URL (example)
call_post "/api/resumes/upload-url" '{
  "fileName": "resume.pdf",
  "contentType": "application/pdf"
}'

# 8. Complete Resume Upload (dummy resumeId; adjust when testing real uploads)
call_post "/api/resumes/complete" '{
  "resumeId": "dummy-resume-id"
}'

# 9. List My Resumes
call_get "/api/resumes/me"

# 10. Download URL (dummy resumeId; adjust when testing real uploads)
call_get "/api/resumes/dummy-resume-id/download-url"

echo
echo "Done. Review HTTP status codes and responses above to validate behavior."

