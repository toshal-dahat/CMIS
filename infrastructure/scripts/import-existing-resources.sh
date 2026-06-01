#!/bin/bash
# One-time: import existing AWS resources into Terraform state after a partial apply.
# Run from repo root: ./infrastructure/scripts/import-existing-resources.sh

set -e
cd "$(dirname "$0")/../external-services/terraform"

echo "Importing existing resources into Terraform state..."

terraform import -input=false aws_dynamodb_table.external_users   cmis-external-external-users
terraform import -input=false aws_dynamodb_table.students         cmis-external-students
terraform import -input=false aws_dynamodb_table.handover_tokens  cmis-external-handover-tokens
terraform import -input=false aws_dynamodb_table.handover_log     cmis-external-handover-log
terraform import -input=false aws_iam_role.external_lambda       cmis-external-external-lambda-role
terraform import -input=false aws_lambda_function.external_service cmis-external-external-service

echo "Done. Run: terraform apply -input=false -auto-approve"
