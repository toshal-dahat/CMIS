# CMIS CI/CD Pipeline Configuration

This document explains the GitHub Actions workflow and how to configure it.

## Workflow Trigger

The pipeline triggers on pushes to:
- `feature/deployment-testing`
- `main`
- `develop`

## Required Secrets

Configure these in GitHub Repository Settings → Secrets and variables → Actions:

```
AWS_ACCESS_KEY_ID          # Your AWS access key ID
AWS_SECRET_ACCESS_KEY      # Your AWS secret access key
```

## Workflow Steps

### 1. Checkout and Setup
- Checks out the code
- Sets up Node.js 20.x
- Sets up Terraform 1.7.0
- Configures AWS credentials

### 2. Build Frontend
- Installs dependencies
- Builds Svelte app with Vite
- Output: `frontend/dist/`

### 3. Build Backend Services
- Packages each service as a Lambda-ready ZIP file
- Includes all dependencies
- Excludes dev dependencies and tests
- Output: `.build/*.zip`

### 4. Terraform Deployment
- Initializes Terraform
- Validates configuration
- Creates execution plan
- Applies infrastructure changes
- Creates/Updates:
  - S3 bucket for frontend
  - CloudFront distribution
  - 4 Lambda functions
  - API Gateway
  - IAM roles and policies

### 5. Deploy Frontend
- Syncs build files to S3
- Sets appropriate cache headers
- Invalidates CloudFront cache

### 6. Summary
- Outputs all deployment URLs
- Creates GitHub Actions summary

## Customization

### Change AWS Region

Edit `.github/workflows/deploy.yml`:

```yaml
env:
  AWS_REGION: your-region  # Change from us-east-1
```

### Change Environment Name

The default environment is `dev`. To use a different environment:

```yaml
- name: Terraform Plan
  run: |
    terraform plan \
      -var="environment=staging" \    # Change from dev
      -var="aws_region=${{ env.AWS_REGION }}" \
      -out=tfplan
```

### Add Environment Variables

To add environment variables to Lambda functions, edit `infrastructure/lambda.tf`:

```hcl
environment {
  variables = {
    ENVIRONMENT = var.environment
    NODE_ENV    = "production"
    # Add your variables here
    DATABASE_URL = "your-db-url"
  }
}
```

## Monitoring

### GitHub Actions
- Check the Actions tab for workflow runs
- View detailed logs for each step
- See deployment summary in each run

### AWS Console
- **CloudWatch Logs**: `/aws/lambda/cmis-*-dev`
- **Lambda Metrics**: Invocations, Duration, Errors
- **API Gateway**: Request count, latency
- **CloudFront**: Cache hits, requests

## Troubleshooting

### Workflow Fails at Terraform Apply

**Possible causes:**
- AWS credentials invalid or expired
- Insufficient IAM permissions
- Resource naming conflict
- Region quota exceeded

**Solutions:**
- Verify AWS credentials in GitHub Secrets
- Check IAM permissions include Lambda, S3, CloudFront, API Gateway
- Change resource names in `infrastructure/variables.tf`
- Try different AWS region

### Lambda Function Size Too Large

If your service dependencies are too large:

1. Exclude unnecessary packages
2. Use Lambda Layers for large dependencies
3. Optimize package.json

### CloudFront Cache Not Updating

The workflow includes cache invalidation, but it can take 5-10 minutes to propagate. To force update:

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

## Performance Optimization

### Frontend Build
- Uses Vite for fast builds
- Assets are fingerprinted for long-term caching
- index.html has no cache for instant updates

### Lambda Deployment
- Only production dependencies included
- ZIP files compressed for faster uploads
- Excludes AWS SDK (already available in Lambda environment)

## Security Best Practices

1. **Never commit secrets** to the repository
2. **Use GitHub Secrets** for AWS credentials
3. **Rotate AWS credentials** regularly
4. **Use least privilege** IAM policies
5. **Enable CloudTrail** for audit logging

## Cost Considerations

The pipeline itself is free (GitHub Actions free tier), but AWS resources have costs:

- **S3**: Storage and requests
- **CloudFront**: Data transfer out
- **Lambda**: Invocations and compute time
- **API Gateway**: API requests

Monitor costs in AWS Cost Explorer.

## Manual Deployment

If you need to deploy manually (bypass GitHub Actions):

### Windows
```powershell
.\scripts\deploy.ps1 -Environment dev -AwsRegion us-east-1
```

### Linux/Mac
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh dev us-east-1
```
