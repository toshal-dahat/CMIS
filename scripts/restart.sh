#!/bin/bash
# Restart the CMIS External service after AWS shutdown.
# Recreates infrastructure (Terraform), seeds data, updates frontend config.
#
# Usage: ./scripts/restart.sh [--no-apply] [--no-frontend]
#   --no-apply   Skip terraform apply (infra already exists)
#   --no-frontend  Don't start the frontend dev server

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infrastructure"

DO_APPLY=true
DO_FRONTEND=true

for arg in "$@"; do
  case "$arg" in
    --no-apply)    DO_APPLY=false ;;
    --no-frontend) DO_FRONTEND=false ;;
    -h|--help)
      echo "Usage: $0 [--no-apply] [--no-frontend]"
      echo "  --no-apply    Skip terraform apply (infra already exists)"
      echo "  --no-frontend Don't start the frontend dev server"
      exit 0
      ;;
  esac
done

echo "=============================================="
echo "  CMIS External - Restart"
echo "=============================================="
echo ""

# 1. Terraform
cd "$INFRA_DIR"
echo "--- 1. Terraform ---"
terraform init -input=false

if [ "$DO_APPLY" = true ]; then
  echo ""
  echo "Applying Terraform (recreate/update AWS resources)..."
  terraform apply -input=false -auto-approve
else
  echo "Skipping terraform apply (--no-apply)"
fi

# 2. Get outputs
API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || terraform output -raw api_invoke_url 2>/dev/null)
STUDENTS_TABLE=$(terraform output -raw students_table_name 2>/dev/null || echo "cmis-external-students")

echo ""
echo "API URL: $API_URL"
echo "Students table: $STUDENTS_TABLE"
echo ""

# 3. Update frontend .env
echo "--- 2. Frontend config ---"
ENV_FILE="$PROJECT_ROOT/frontend/.env"
mkdir -p "$(dirname "$ENV_FILE")"
echo "VITE_API_BASE=$API_URL" > "$ENV_FILE"
echo "Updated $ENV_FILE"
echo ""

# 4. Seed students
echo "--- 3. Seed students ---"
cd "$PROJECT_ROOT"
export STUDENTS_TABLE
./scripts/seed-students.sh
echo ""

# 5. Frontend dev server
if [ "$DO_FRONTEND" = true ]; then
  echo "--- 4. Starting frontend ---"
  cd "$PROJECT_ROOT/frontend"
  if [ -d node_modules ]; then
    echo "Frontend dependencies present. Starting dev server..."
    echo ""
    echo "  Open: http://localhost:5173"
    echo "  Press Ctrl+C to stop"
    echo ""
    npm run dev
  else
    echo "Installing frontend dependencies..."
    npm install
    echo ""
    echo "  Open: http://localhost:5173"
    echo "  Press Ctrl+C to stop"
    echo ""
    npm run dev
  fi
else
  echo "--- 4. Frontend ---"
  echo "Skipped (--no-frontend). To start: cd frontend && npm run dev"
  echo ""
  echo "Restart complete. Start frontend manually: cd frontend && npm run dev"
fi
