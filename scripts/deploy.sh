#!/bin/bash

# Local deployment script
# This script helps you deploy the application locally

set -e

echo "============================================"
echo "CMIS Local Deployment Script"
echo "============================================"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed. Please install it first."
    exit 1
fi

# Set environment
ENVIRONMENT=${1:-dev}
AWS_REGION=${2:-us-east-1}

echo "📋 Configuration:"
echo "   Environment: $ENVIRONMENT"
echo "   AWS Region: $AWS_REGION"
echo ""

# Build frontend
echo "🏗️  Building frontend..."
cd frontend
npm install
npm run build
cd ..
echo "✅ Frontend built successfully"
echo ""

# Build services
echo "🏗️  Building backend services..."
mkdir -p .build

# Student Service
echo "   📦 Packaging Student Service..."
cd services/student-service
npm ci --production
cd ../..
cp -r services/student-service .build/student-service-temp
cd .build/student-service-temp
zip -rq ../student-service.zip . -x "*.git*" "node_modules/@aws-sdk/*" "tests/*"
cd ../..
rm -rf .build/student-service-temp

# Admin Service
echo "   📦 Packaging Admin Service..."
cd services/admin-service
npm ci --production
cd ../..
cp -r services/admin-service .build/admin-service-temp
cd .build/admin-service-temp
zip -rq ../admin-service.zip . -x "*.git*" "tests/*"
cd ../..
rm -rf .build/admin-service-temp

# External Service
echo "   📦 Packaging External Service..."
cd services/external-service
npm ci --production
cd ../..
cp -r services/external-service .build/external-service-temp
cd .build/external-service-temp
zip -rq ../external-service.zip . -x "*.git*" "tests/*"
cd ../..
rm -rf .build/external-service-temp

# Event Service
echo "   📦 Packaging Event Service..."
cd services/event-service
npm ci --production
cd ../..
cp -r services/event-service .build/event-service-temp
cd .build/event-service-temp
zip -rq ../event-service.zip . -x "*.git*" "tests/*"
cd ../..
rm -rf .build/event-service-temp

echo "✅ All services packaged successfully"
echo ""

# Deploy infrastructure
echo "🌍 Deploying infrastructure with Terraform..."
cd infrastructure
terraform init -backend-config="bucket=cmis-terraform-state-$ENVIRONMENT"
terraform plan -var="environment=$ENVIRONMENT" -var="aws_region=$AWS_REGION" -out=tfplan
terraform apply -auto-approve tfplan

# Get outputs
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket_name)
CLOUDFRONT_ID=$(terraform output -raw cloudfront_distribution_id)
CLOUDFRONT_URL=$(terraform output -raw cloudfront_domain_name)
API_GATEWAY_URL=$(terraform output -raw api_gateway_url)
EVENT_SERVICE_URL=$(terraform output -raw event_service_url)

cd ..
echo "✅ Infrastructure deployed successfully"
echo ""

# Deploy frontend to S3
echo "☁️  Deploying frontend to S3..."
aws s3 sync frontend/dist/ s3://$FRONTEND_BUCKET/ --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "index.html"

aws s3 cp frontend/dist/index.html s3://$FRONTEND_BUCKET/index.html \
    --cache-control "public, max-age=0, must-revalidate"

echo "✅ Frontend deployed to S3"
echo ""

# Invalidate CloudFront
echo "🔄 Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_ID --paths "/*" > /dev/null
echo "✅ CloudFront cache invalidated"
echo ""

# Output summary
echo "============================================"
echo "🚀 DEPLOYMENT SUCCESSFUL!"
echo "============================================"
echo ""
echo "📱 Frontend URL:"
echo "   https://$CLOUDFRONT_URL"
echo ""
echo "🔌 API Gateway URL:"
echo "   $API_GATEWAY_URL"
echo ""
echo "🔗 Service Endpoints:"
echo "   Student Service:  $API_GATEWAY_URL/student"
echo "   Admin Service:    $API_GATEWAY_URL/admin"
echo "   External Service: $API_GATEWAY_URL/external"
echo "   Event Service:    $EVENT_SERVICE_URL"
echo ""
echo "============================================"
