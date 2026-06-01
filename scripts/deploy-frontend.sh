#!/usr/bin/env bash
# Deploy frontend build to S3 and invalidate CloudFront (Team Gig 'Em hosting).
# Prereqs: terraform applied, VITE_API_BASE set for production API, npm run build works.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
INFRA_DIR="$REPO_ROOT/infrastructure"

# Get S3 bucket and CloudFront ID from Terraform (only exist when enable_frontend_hosting = true)
cd "$INFRA_DIR"
if ! command -v terraform &>/dev/null; then
  echo "terraform not found. Install Terraform and run 'terraform apply' first."
  exit 1
fi
BUCKET=$(terraform output -raw frontend_s3_bucket 2>/dev/null) || true
CF_ID=$(terraform output -raw frontend_cloudfront_id 2>/dev/null) || true

if [ -z "$BUCKET" ] || [ "$BUCKET" = "null" ]; then
  echo "Frontend hosting is off. To enable: set enable_frontend_hosting = true in Terraform (e.g. terraform.tfvars), then run 'terraform apply'."
  echo "Use this script later when the project is ready to be hosted."
  exit 1
fi

# Build frontend (use production API URL from .env or Terraform output)
cd "$FRONTEND_DIR"
if [ ! -f .env ]; then
  echo "Creating frontend/.env from Terraform API URL..."
  API_URL=$(cd "$INFRA_DIR" && terraform output -raw api_gateway_url 2>/dev/null) || true
  if [ -n "$API_URL" ]; then
    echo "VITE_API_BASE=$API_URL" > .env
  fi
fi
# Use npm install so optional deps (e.g. @rollup/rollup-darwin-arm64) are installed; npm ci can skip them
npm install
npm run build

# Upload to S3 (cache-control for index.html: no cache; assets: long cache)
aws s3 sync dist/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.html"
aws s3 cp "dist/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache, no-store, must-revalidate"

# Invalidate CloudFront so changes are visible immediately
if [ -n "$CF_ID" ]; then
  aws cloudfront create-invalidation --distribution-id "$CF_ID" --paths "/*"
  echo "CloudFront invalidation created."
fi

echo "Frontend deployed to s3://$BUCKET"
echo "URL: $(cd "$INFRA_DIR" && terraform output -raw frontend_url 2>/dev/null)"
