# CMIS Deployment Guide

## Quick Start

### 1. Configure AWS Credentials in GitHub

Go to your GitHub repository settings and add these secrets:

- `AWS_ACCESS_KEY_ID`: Your AWS access key
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret key

### 2. Deploy Automatically

Push to the deployment branch:

```bash
git checkout -b feature/deployment-testing
git add .
git commit -m "Initial deployment"
git push origin feature/deployment-testing
```

The GitHub Actions workflow will automatically:
- Build frontend and backend
- Deploy infrastructure
- Upload frontend to S3
- Deploy Lambda functions
- Output all URLs

### 3. Access Your Application

After deployment completes (~ 5-10 minutes), check the Actions tab for:
- **Frontend URL**: The CloudFront URL for your Svelte app
- **API Endpoints**: URLs for all 4 backend services

## Local Deployment

### Windows

```powershell
.\scripts\deploy.ps1 -Environment dev -AwsRegion us-east-1
```

### Linux/Mac

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh dev us-east-1
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    CloudFront                        │
│           (CDN + HTTPS + Caching)                   │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│                  S3 Bucket                          │
│            (Static Frontend)                        │
│              Svelte App                             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│               API Gateway (HTTP)                     │
│                  /student                           │
│                  /admin                             │
│                  /company                           │
│                  /config                            │
└──────┬─────────┬──────────┬──────────┬──────────────┘
       │         │          │          │
       ▼         ▼          ▼          ▼
    ┌────┐   ┌────┐    ┌────┐    ┌────┐
    │ λ  │   │ λ  │    │ λ  │    │ λ  │
    └────┘   └────┘    └────┘    └────┘
   Student   Admin   Company   Config
   Service   Service Service   Service
```

## Service Structure

### Frontend (Svelte)
- **Location**: `frontend/`
- **Build**: Vite
- **Deployment**: S3 + CloudFront
- **URL**: `https://<cloudfront-id>.cloudfront.net`

### Backend Services (Lambda)

1. **Student Service**
   - Endpoint: `/student`
   - Source: `services/student-service/`
   
2. **Admin Service**
   - Endpoint: `/admin`
   - Source: `services/admin-service/`
   
3. **External Service**
   - Endpoint: `/external`
   - Source: `services/external-service/`
   
4. **Event Service**
   - Endpoint: `/event`
   - Source: `services/event-service/`

## Terraform Resources Created

- **S3 Bucket**: Frontend hosting
- **CloudFront Distribution**: CDN for frontend
- **API Gateway**: HTTP API for backend services
- **4 Lambda Functions**: One for each service
- **IAM Roles**: Lambda execution roles
- **CloudWatch Log Groups**: Logging for all services

## Environment Variables

### Required GitHub Secrets
```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

### Optional Frontend Variables

Create `frontend/.env`:
```env
VITE_STUDENT_API_URL=
VITE_ADMIN_API_URL=
VITE_COMPANY_API_URL=
VITE_CONFIG_API_URL=
```

These will be populated after first deployment.

## Troubleshooting

### Build Fails
- Ensure all `package.json` files are valid
- Check Node.js version (should be 20.x)
- Verify all dependencies are listed

### Terraform Errors
- Check AWS credentials are configured
- Ensure AWS region is valid
- Verify no resource naming conflicts

### Lambda Function Errors
- Check CloudWatch logs in AWS Console
- Verify handler function exports correctly
- Check IAM permissions

### Frontend Not Loading
- Wait for CloudFront cache invalidation (~5 mins)
- Check S3 bucket has files
- Verify CloudFront distribution is deployed

## Cost Estimation

### Free Tier (First 12 months)
- S3: 5GB storage
- CloudFront: 50GB data transfer
- Lambda: 1M requests/month
- API Gateway: 1M requests/month

### Estimated Monthly Cost (After Free Tier)
- **Low Usage**: $1-5/month
- **Medium Usage**: $10-30/month
- **High Usage**: $50+/month

## Cleanup

To remove all resources:

```bash
cd infrastructure
terraform destroy -var="environment=dev"
```

## Next Steps

1. ✅ Test the deployment
2. Add custom domain (Route53 + ACM)
3. Set up DynamoDB tables
4. Configure authentication (Cognito)
5. Add monitoring and alerts
6. Set up staging environment

## Support

For issues or questions:
1. Check GitHub Actions logs
2. Review CloudWatch logs in AWS Console
3. Verify Terraform state
4. Check this documentation
