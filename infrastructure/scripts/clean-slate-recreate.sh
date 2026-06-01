#!/bin/bash
# Delete existing AWS resources and Terraform state, then recreate everything from scratch.
# Use when imports/state are messy and you want a fresh deployment.
#
# Run from repo root: ./infrastructure/scripts/clean-slate-recreate.sh
# Or from infrastructure: ./scripts/clean-slate-recreate.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(cd "$SCRIPT_DIR/../external-services/terraform" && pwd)"
cd "$TERRAFORM_DIR"

PROJECT_NAME="${PROJECT_NAME:-cmis-external}"
REGION="${AWS_REGION:-us-east-1}"

echo "=============================================="
echo "  Clean slate: destroy → wipe state → recreate"
echo "  Prefix: $PROJECT_NAME"
echo "=============================================="
echo ""

# Step 1: Try to destroy via Terraform (so state and AWS stay in sync)
echo "--- 1. Terraform destroy (removes resources Terraform knows about) ---"
terraform init -input=false
DESTROY_OK=false
if terraform destroy -input=false -auto-approve 2>/dev/null; then
  echo "Destroy succeeded. State is empty."
  DESTROY_OK=true
else
  echo "Destroy failed or partially ran (e.g. state lock / missing resources)."
  echo "We will wipe state and delete AWS resources by name, then recreate."
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Step 2: Wipe local state so Terraform thinks nothing exists
echo ""
echo "--- 2. Wipe local state ---"
for f in terraform.tfstate terraform.tfstate.backup .terraform.tfstate.lock.info; do
  [ -f "$f" ] && rm -f "$f" && echo "  Removed $f"
done
echo "  State cleared."

# Step 3: If destroy failed, delete AWS resources by name so apply doesn't hit "already exists"
if [ "$DESTROY_OK" = false ]; then
  echo ""
  echo "--- 3. Delete leftover AWS resources (by name) ---"
  if [ -f "$SCRIPT_DIR/delete-aws-resources-by-name.sh" ]; then
    PROJECT_NAME="$PROJECT_NAME" AWS_REGION="$REGION" "$SCRIPT_DIR/delete-aws-resources-by-name.sh"
  else
    echo "Run manually: ./scripts/delete-aws-resources-by-name.sh"
  fi
fi
echo ""

# Step 4: Re-init and apply
echo "--- 4. Re-init and apply (create new resources) ---"
terraform init -input=false
terraform apply -input=false -auto-approve

echo ""
echo "Done. New deployment is up. Get API URL: terraform output -raw api_gateway_url"
