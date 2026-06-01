#!/bin/bash

# CMIS Admin Infrastructure Deployment Script
# This script helps you deploy the Terraform configuration to AWS Learner Lab

set -e  # Exit on any error

echo "=========================================="
echo "CMIS Admin Infrastructure Deployment"
echo "=========================================="
echo ""

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "Error: Terraform is not installed"
    echo "Please install Terraform from: https://www.terraform.io/downloads"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Please install AWS CLI from: https://aws.amazon.com/cli/"
    exit 1
fi

echo "Terraform and AWS CLI are installed"
echo ""

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: AWS credentials are not configured"
    echo ""
    echo "For Learner Lab, export these environment variables:"
    echo "  export AWS_ACCESS_KEY_ID='your-access-key'"
    echo "  export AWS_SECRET_ACCESS_KEY='your-secret-key'"
    echo "  export AWS_SESSION_TOKEN='your-session-token'"
    echo ""
    echo "Or run: aws configure"
    exit 1
fi

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS credentials configured"
echo "   Account ID: $ACCOUNT_ID"
echo ""

# Check if terraform.tfvars needs to be updated
if grep -q "<YOUR_12_DIGIT_ACCOUNT_ID>" terraform.tfvars 2>/dev/null; then
    echo "terraform.tfvars needs to be updated"
    echo "   Updating account_id automatically..."
    sed -i.bak "s/<YOUR_12_DIGIT_ACCOUNT_ID>/$ACCOUNT_ID/" terraform.tfvars
    echo "Updated terraform.tfvars with Account ID: $ACCOUNT_ID"
    echo ""
fi

# Initialize Terraform
echo "Initializing Terraform..."
terraform init
echo ""

# Validate configuration
echo "Validating Terraform configuration..."
terraform validate
echo "Configuration is valid"
echo ""

# Plan deployment
echo "Creating deployment plan..."
terraform plan -out=tfplan
echo ""

# Ask for confirmation
read -p "Do you want to deploy this infrastructure? (yes/no): " confirmation
if [ "$confirmation" != "yes" ]; then
    echo "Deployment cancelled"
    rm -f tfplan
    exit 0
fi

# Apply configuration
echo ""
echo "Deploying infrastructure..."
terraform apply tfplan
rm -f tfplan
echo ""

# Show outputs
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
terraform output
echo ""

# Get API endpoint
API_ENDPOINT=$(terraform output -raw api_gateway_invoke_url 2>/dev/null || echo "")
if [ -n "$API_ENDPOINT" ]; then
    echo "Your API is available at:"
    echo "   $API_ENDPOINT"
    echo ""
    echo "Test your endpoints:"
    echo "   curl $API_ENDPOINT/config"
    echo "   curl $API_ENDPOINT/theme"
    echo "   curl $API_ENDPOINT/companies"
    echo ""
fi

echo "Next steps:"
echo "   1. Update Lambda function code in main.tf"
echo "   2. Test your API endpoints"
echo "   3. Monitor logs: aws logs tail /aws/lambda/cmis-config-api --follow"
echo ""
echo "To destroy all resources, run: terraform destroy"
echo ""