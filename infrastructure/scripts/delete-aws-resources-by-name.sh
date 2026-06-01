#!/bin/bash
# Delete CMIS external AWS resources by name (when Terraform state is gone or broken).
# Run from repo root: ./infrastructure/scripts/delete-aws-resources-by-name.sh
# Optional: PROJECT_NAME=my-prefix

set -e
cd "$(dirname "$0")/../external-services/terraform"
PROJECT_NAME="${PROJECT_NAME:-cmis-external}"
REGION="${AWS_REGION:-us-east-1}"

echo "Deleting AWS resources with prefix: $PROJECT_NAME (region: $REGION)"

# EventBridge: remove target then delete rule
echo "EventBridge rule and target..."
aws events remove-targets --rule "${PROJECT_NAME}-graduation-scan" --ids "external-service" --region "$REGION" 2>/dev/null || true
aws events delete-rule --name "${PROJECT_NAME}-graduation-scan" --region "$REGION" 2>/dev/null || true

# API Gateway HTTP API (get id by name, then delete; take first ID only)
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='${PROJECT_NAME}-external-api'].ApiId" --output text 2>/dev/null | awk '{print $1}')
if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
  echo "API Gateway: $API_ID"
  aws apigatewayv2 delete-api --api-id "$API_ID" --region "$REGION"
fi

# Lambda
echo "Lambda function..."
aws lambda delete-function --function-name "${PROJECT_NAME}-external-service" --region "$REGION" 2>/dev/null || true

# IAM role (detach managed policy, delete inline policy, then delete role)
echo "IAM role..."
aws iam delete-role-policy --role-name "${PROJECT_NAME}-external-lambda-role" --policy-name "external-lambda-policy" 2>/dev/null || true
aws iam detach-role-policy --role-name "${PROJECT_NAME}-external-lambda-role" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>/dev/null || true
aws iam delete-role --role-name "${PROJECT_NAME}-external-lambda-role" 2>/dev/null || true

# Cognito: delete user pool(s) with this name (deletes clients too)
POOL_IDS=$(aws cognito-idp list-user-pools --max-results 20 --region "$REGION" --query "UserPools[?Name=='${PROJECT_NAME}-external-pool'].Id" --output text 2>/dev/null | tr '\t' '\n')
for POOL_ID in $POOL_IDS; do
  [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ] && continue
  echo "Cognito user pool: $POOL_ID"
  aws cognito-idp delete-user-pool --user-pool-id "$POOL_ID" --region "$REGION" 2>/dev/null || true
done

# DynamoDB tables
for table in "${PROJECT_NAME}-external-users" "${PROJECT_NAME}-students" "${PROJECT_NAME}-handover-tokens" "${PROJECT_NAME}-handover-log"; do
  echo "DynamoDB table: $table"
  aws dynamodb delete-table --table-name "$table" --region "$REGION" 2>/dev/null || true
done

echo "Done. Run terraform init && terraform apply to create new resources."
