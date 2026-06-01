#!/bin/bash
# Shutdown AWS resources for CMIS External service.
# Runs terraform destroy to remove all infrastructure and avoid charges.
#
# Usage: ./scripts/shutdown.sh [--auto-approve]
#   --auto-approve  Skip confirmation prompt (for automation)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infrastructure"

AUTO_APPROVE=""

for arg in "$@"; do
  case "$arg" in
    --auto-approve|-y) AUTO_APPROVE="-auto-approve" ;;
    -h|--help)
      echo "Usage: $0 [--auto-approve]"
      echo "  --auto-approve  Skip confirmation (destroy without prompting)"
      echo ""
      echo "This removes: Cognito, DynamoDB, Lambda, API Gateway, EventBridge."
      echo "To bring everything back: ./scripts/restart.sh"
      exit 0
      ;;
  esac
done

echo "=============================================="
echo "  CMIS External - Shutdown"
echo "=============================================="
echo ""
echo "This will destroy all AWS resources:"
echo "  - Cognito User Pool"
echo "  - DynamoDB tables (external_users, students, handover_tokens)"
echo "  - Lambda function"
echo "  - API Gateway"
echo "  - EventBridge rule"
echo ""
echo "To restore later: ./scripts/restart.sh"
echo ""

cd "$INFRA_DIR"
terraform init -input=false
terraform destroy -input=false $AUTO_APPROVE

echo ""
echo "Shutdown complete. AWS resources removed."
