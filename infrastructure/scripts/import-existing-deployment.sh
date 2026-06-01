#!/bin/bash
# Adopt an existing AWS deployment into this Terraform state.
# Use when you already have Cognito, DynamoDB, Lambda, API Gateway, etc. and want
# Terraform to manage them instead of creating new ones.
#
# Run from repo root: ./infrastructure/scripts/import-existing-deployment.sh
# Or from infrastructure/: ./scripts/import-existing-deployment.sh
# Optional: PROJECT_NAME=my-prefix (default prefix is cmis-external)
#
# Important: Set project_name in terraform.tfvars (in external-services/terraform/) to match your existing prefix.

set -e
cd "$(dirname "$0")/../external-services/terraform"
PROJECT_NAME="${PROJECT_NAME:-cmis-external}"
REGION="${AWS_REGION:-us-east-1}"

echo "=============================================="
echo "  Import existing deployment (prefix: $PROJECT_NAME)"
echo "=============================================="

# 1. DynamoDB tables (by table name)
for table in external-users students handover-tokens handover-log; do
  name="${PROJECT_NAME}-${table}"
  echo "Import DynamoDB: $name"
  case "$table" in
    external-users) terraform import -input=false aws_dynamodb_table.external_users   "$name" ;;
    students)       terraform import -input=false aws_dynamodb_table.students         "$name" ;;
    handover-tokens) terraform import -input=false aws_dynamodb_table.handover_tokens  "$name" ;;
    handover-log)   terraform import -input=false aws_dynamodb_table.handover_log     "$name" ;;
  esac
done

# 2. IAM role and Lambda (by name)
echo "Import IAM role: ${PROJECT_NAME}-external-lambda-role"
terraform import -input=false aws_iam_role.external_lambda "${PROJECT_NAME}-external-lambda-role"
echo "Import Lambda: ${PROJECT_NAME}-external-service"
terraform import -input=false aws_lambda_function.external_service "${PROJECT_NAME}-external-service"

# 3. Cognito (resolve pool and client ID by name)
POOL_NAME="${PROJECT_NAME}-external-pool"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 20 --region "$REGION" --query "UserPools[?Name=='$POOL_NAME'].Id" --output text 2>/dev/null | head -1)
if [ -n "$POOL_ID" ]; then
  echo "Import Cognito user pool: $POOL_ID"
  terraform import -input=false aws_cognito_user_pool.external "$POOL_ID"
  CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --region "$REGION" --query "UserPoolClients[?ClientName=='${PROJECT_NAME}-external-client'].ClientId" --output text 2>/dev/null | head -1)
  if [ -n "$CLIENT_ID" ]; then
    echo "Import Cognito client: $POOL_ID/$CLIENT_ID"
    terraform import -input=false aws_cognito_user_pool_client.external "${POOL_ID}/${CLIENT_ID}"
  fi
else
  echo "Skip Cognito (pool named '$POOL_NAME' not found; set PROJECT_NAME or import manually)"
fi

# 4. API Gateway HTTP API (by name -> id)
API_NAME="${PROJECT_NAME}-external-api"
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId" --output text 2>/dev/null | head -1)
if [ -n "$API_ID" ]; then
  echo "Import API Gateway: $API_ID"
  terraform import -input=false aws_apigatewayv2_api.external "$API_ID"
  # Stage $default
  terraform import -input=false aws_apigatewayv2_stage.default "${API_ID}/\$default"
  # Integration (one per API; get first integration id)
  INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" --query "Items[0].IntegrationId" --output text 2>/dev/null)
  if [ -n "$INTEGRATION_ID" ] && [ "$INTEGRATION_ID" != "None" ]; then
    terraform import -input=false aws_apigatewayv2_integration.external "${API_ID}/${INTEGRATION_ID}"
  fi
  # Routes (ANY / and ANY /{proxy+})
  while read -r route_id route_key; do
    [ -z "$route_id" ] && continue
    if [ "$route_key" = "ANY /" ]; then
      terraform import -input=false aws_apigatewayv2_route.external_root "${API_ID}/${route_id}"
    elif [ "$route_key" = 'ANY /{proxy+}' ]; then
      terraform import -input=false aws_apigatewayv2_route.external_any "${API_ID}/${route_id}"
    fi
  done < <(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" --query "Items[].[RouteId,RouteKey]" --output text 2>/dev/null)
else
  echo "Skip API Gateway (API named '$API_NAME' not found)"
fi

# 5. EventBridge rule and target
RULE_NAME="${PROJECT_NAME}-graduation-scan"
echo "Import EventBridge rule: $RULE_NAME"
terraform import -input=false aws_cloudwatch_event_rule.graduation_scan "$RULE_NAME"
terraform import -input=false aws_cloudwatch_event_target.graduation_scan "${RULE_NAME}/external-service"

# 6. Lambda permissions (function name + statement id)
echo "Import Lambda permission (API GW)"
terraform import -input=false aws_lambda_permission.api_gw "${PROJECT_NAME}-external-service/AllowAPIGatewayInvoke"
echo "Import Lambda permission (EventBridge)"
terraform import -input=false aws_lambda_permission.eventbridge "${PROJECT_NAME}-external-service/AllowEventBridgeInvoke"

# 7. IAM role policy and attachment (optional; may already exist after role import)
terraform import -input=false 'aws_iam_role_policy.external_lambda' "${PROJECT_NAME}-external-lambda-role:external-lambda-policy" 2>/dev/null || true
terraform import -input=false 'aws_iam_role_policy_attachment.lambda_basic' "${PROJECT_NAME}-external-lambda-role/arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>/dev/null || true

echo ""
echo "Done. Run: terraform plan  (then terraform apply -input=false -auto-approve if desired)"
echo "If any import failed (e.g. resource not found), fix names or PROJECT_NAME and re-run."
