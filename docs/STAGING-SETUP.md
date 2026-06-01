# Staging Environment Setup

This document explains the staging environment configuration for CMIS application.

## 🎯 Overview

We now have **two separate environments**:

| Environment | Branch Trigger | State Bucket | Workflow File |
|------------|---------------|--------------|---------------|
| **Development** | `main`, `feature/deployment-testing-1` | `cmis-terraform-state-dev` | [deploy.yml](.github/workflows/deploy.yml) |
| **Staging** | `staging`, `develop` | `cmis-terraform-state-staging` | [deploy-staging.yml](.github/workflows/deploy-staging.yml) |

## 📋 Prerequisites

Before deploying to staging, you need to **manually create** the S3 bucket for Terraform state:

### AWS CLI:
```bash
aws s3api create-bucket \
  --bucket cmis-terraform-state-staging \
  --region us-east-1
```

### AWS Console:
1. Go to S3 console
2. Click "Create bucket"
3. Bucket name: `cmis-terraform-state-staging`
4. Region: `us-east-1`
5. Enable versioning (recommended)
6. Keep default settings
7. Create bucket

## 🚀 How to Deploy to Staging

### Via GitHub Actions (Automatic):

1. Push code to `staging` or `develop` branch:
   ```bash
   git checkout -b staging
   git push origin staging
   ```

2. GitHub Actions will automatically:
   - Build all services
   - Deploy infrastructure to staging environment
   - Deploy frontend with staging API URLs

### Via Local Scripts:

```bash
# Linux/Mac
./scripts/deploy.sh staging us-east-1

# Windows
.\scripts\deploy.ps1 -Environment staging -AwsRegion us-east-1
```

## 🏗️ Infrastructure Created

Staging environment will create separate resources with `-staging` suffix:

- **S3 Bucket**: `cmis-frontend-staging`
- **Lambda Functions**: 
  - `cmis-student-service-staging`
  - `cmis-admin-service-staging`
  - `cmis-external-service-staging`
  - `cmis-event-service-staging`
- **API Gateway**: `cmis-api-staging`
- **CloudFront Distribution**: New distribution for staging
- **IAM Role**: `cmis-lambda-role-staging`

## 🔗 URLs After Deployment

After deployment completes, you'll get URLs like:

- **Frontend**: `https://<cloudfront-id-staging>.cloudfront.net`
- **API Gateway**: `https://<api-id>.execute-api.us-east-1.amazonaws.com/staging`
- **Services**:
  - `/student` - Student Service
  - `/admin` - Admin Service
  - `/external` - External Service
  - `/event` - Event Service

## 🔄 Workflow

Typical development workflow:

1. **Development**: Test features on `feature/*` branches → deploys to dev
2. **Staging**: Merge to `staging` or `develop` → deploys to staging (QA testing)
3. **Production**: After QA approval, create production workflow for `main` branch

## 🗑️ Cleanup Staging

To destroy all staging resources:

```bash
cd infrastructure
terraform init -backend-config="bucket=cmis-terraform-state-staging"
terraform destroy -var="environment=staging" -var="aws_region=us-east-1"
```

⚠️ This will delete all staging resources but keep dev environment intact.

## 📝 Notes

- Dev and Staging are **completely isolated** environments
- Each has its own AWS resources
- State files are stored in separate S3 buckets
- No risk of accidentally affecting dev when deploying to staging
