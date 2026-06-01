# PowerShell deployment script for Windows
# This script helps you deploy the application locally on Windows

param(
    [string]$Environment = "dev",
    [string]$AwsRegion = "us-east-1"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "CMIS Local Deployment Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is installed
try {
    aws --version | Out-Null
} catch {
    Write-Host "❌ AWS CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if Terraform is installed
try {
    terraform --version | Out-Null
} catch {
    Write-Host "❌ Terraform is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

Write-Host "📋 Configuration:" -ForegroundColor Yellow
Write-Host "   Environment: $Environment"
Write-Host "   AWS Region: $AwsRegion"
Write-Host ""

# Build frontend
Write-Host "🏗️  Building frontend..." -ForegroundColor Yellow
Set-Location frontend
npm install
npm run build
Set-Location ..
Write-Host "✅ Frontend built successfully" -ForegroundColor Green
Write-Host ""

# Build services
Write-Host "🏗️  Building backend services..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path .build | Out-Null

# Student Service
Write-Host "   📦 Packaging Student Service..." -ForegroundColor Cyan
Set-Location services\student-service
npm ci --production
Set-Location ..\..
Copy-Item -Path services\student-service -Destination .build\student-service-temp -Recurse -Force
Set-Location .build\student-service-temp
Compress-Archive -Path * -DestinationPath ..\student-service.zip -Force
Set-Location ..\..
Remove-Item -Path .build\student-service-temp -Recurse -Force

# Admin Service
Write-Host "   📦 Packaging Admin Service..." -ForegroundColor Cyan
Set-Location services\admin-service
npm ci --production
Set-Location ..\..
Copy-Item -Path services\admin-service -Destination .build\admin-service-temp -Recurse -Force
Set-Location .build\admin-service-temp
Compress-Archive -Path * -DestinationPath ..\admin-service.zip -Force
Set-Location ..\..
Remove-Item -Path .build\admin-service-temp -Recurse -Force

# External Service
Write-Host "   📦 Packaging External Service..." -ForegroundColor Cyan
Set-Location services\external-service
npm ci --production
Set-Location ..\..
Copy-Item -Path services\external-service -Destination .build\external-service-temp -Recurse -Force
Set-Location .build\external-service-temp
Compress-Archive -Path * -DestinationPath ..\external-service.zip -Force
Set-Location ..\..
Remove-Item -Path .build\external-service-temp -Recurse -Force

# Event Service
Write-Host "   📦 Packaging Event Service..." -ForegroundColor Cyan
Set-Location services\event-service
npm ci --production
Set-Location ..\..
Copy-Item -Path services\event-service -Destination .build\event-service-temp -Recurse -Force
Set-Location .build\event-service-temp
Compress-Archive -Path * -DestinationPath ..\event-service.zip -Force
Set-Location ..\..
Remove-Item -Path .build\event-service-temp -Recurse -Force

Write-Host "✅ All services packaged successfully" -ForegroundColor Green
Write-Host ""

# Deploy infrastructure
Write-Host "🌍 Deploying infrastructure with Terraform..." -ForegroundColor Yellow
Set-Location infrastructure
terraform init -backend-config="bucket=cmis-terraform-state-$Environment"
terraform plan -var="environment=$Environment" -var="aws_region=$AwsRegion" -out=tfplan
terraform apply -auto-approve tfplan

# Get outputs
$frontendBucket = terraform output -raw frontend_bucket_name
$cloudfrontId = terraform output -raw cloudfront_distribution_id
$cloudfrontUrl = terraform output -raw cloudfront_domain_name
$apiGatewayUrl = terraform output -raw api_gateway_url

Set-Location ..
Write-Host "✅ Infrastructure deployed successfully" -ForegroundColor Green
Write-Host ""

# Deploy frontend to S3
Write-Host "☁️  Deploying frontend to S3..." -ForegroundColor Yellow
aws s3 sync frontend/dist/ "s3://$frontendBucket/" --delete --cache-control "public, max-age=31536000, immutable" --exclude "index.html"
aws s3 cp frontend/dist/index.html "s3://$frontendBucket/index.html" --cache-control "public, max-age=0, must-revalidate"
Write-Host "✅ Frontend deployed to S3" -ForegroundColor Green
Write-Host ""

# Invalidate CloudFront
Write-Host "🔄 Invalidating CloudFront cache..." -ForegroundColor Yellow
aws cloudfront create-invalidation --distribution-id $cloudfrontId --paths "/*" | Out-Null
Write-Host "✅ CloudFront cache invalidated" -ForegroundColor Green
Write-Host ""

# Output summary
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "🚀 DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📱 Frontend URL:" -ForegroundColor Yellow
Write-Host "   https://$cloudfrontUrl" -ForegroundColor White
Write-Host ""
Write-Host "🔌 API Gateway URL:" -ForegroundColor Yellow
Write-Host "   $apiGatewayUrl" -ForegroundColor White
Write-Host ""
Write-Host "🔗 Service Endpoints:" -ForegroundColor Yellow
Write-Host "   Student Service:  $apiGatewayUrl/student" -ForegroundColor White
Write-Host "   Admin Service:    $apiGatewayUrl/admin" -ForegroundColor White
Write-Host "   External Service: $apiGatewayUrl/external" -ForegroundColor White
Write-Host "   Event Service:    $apiGatewayUrl/event" -ForegroundColor White
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
