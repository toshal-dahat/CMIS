#!/bin/bash
# Seed a test record in DynamoDB for the external users table.
# Usage: ./scripts/seed-dynamodb.sh <email>
#   - If the email exists in Cognito, fetches sub and creates the record.
#   - Then you can log in with that user and test Profile.
#
# Or manually with AWS CLI:
#   aws dynamodb put-item --table-name cmis-external-external-users \
#     --item '{"user_id":{"S":"YOUR_COGNITO_SUB"},"email":{"S":"you@example.com"},"role":{"S":"FRIEND"}}'

set -e
TABLE="cmis-external-external-users"
USER_POOL="us-east-1_MMG37d3WE"

if [ -z "$1" ]; then
  echo "Usage: $0 <email>"
  echo "  Creates DynamoDB record for existing Cognito user."
  echo "  Example: $0 test@example.com"
  exit 1
fi

EMAIL="$1"
echo "Looking up Cognito user: $EMAIL"
SUB=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL" \
  --filter "email = \"$EMAIL\"" \
  --query "Users[0].Username" \
  --output text 2>/dev/null)

if [ -z "$SUB" ] || [ "$SUB" = "None" ]; then
  echo "No Cognito user found for $EMAIL."
  echo "Register the user in the app first, or use put-item with a known sub."
  exit 1
fi

echo "Found sub: $SUB"
aws dynamodb put-item \
  --table-name "$TABLE" \
  --item "{
    \"user_id\": {\"S\": \"$SUB\"},
    \"email\": {\"S\": \"$EMAIL\"},
    \"role\": {\"S\": \"FRIEND\"}
  }"

echo "Created record. Log in with $EMAIL and visit Profile to test."
