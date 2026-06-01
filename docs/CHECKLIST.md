# Pre-Deployment Checklist

Use this checklist before deploying your CMIS application.

## ✅ AWS Setup

- [ ] AWS account created
- [ ] IAM user created with programmatic access
- [ ] IAM user has required permissions:
  - [ ] AmazonS3FullAccess
  - [ ] AWSLambda_FullAccess
  - [ ] CloudFrontFullAccess
  - [ ] AmazonAPIGatewayAdministrator
  - [ ] IAMFullAccess
  - [ ] CloudWatchLogsFullAccess
- [ ] AWS Access Key ID obtained
- [ ] AWS Secret Access Key obtained

## ✅ GitHub Setup

- [ ] Repository created
- [ ] Code pushed to repository
- [ ] GitHub Secrets configured:
  - [ ] `AWS_ACCESS_KEY_ID` added
  - [ ] `AWS_SECRET_ACCESS_KEY` added
- [ ] Repository settings verified

## ✅ Local Development Environment

- [ ] Node.js 20.x installed
- [ ] npm installed and updated
- [ ] AWS CLI installed (optional, for manual deployment)
- [ ] Terraform installed (optional, for manual deployment)

## ✅ Code Review

- [ ] Frontend builds successfully locally (`cd frontend && npm run build`)
- [ ] Student service dependencies install (`cd services/student-service && npm install`)
- [ ] Admin service dependencies install (`cd services/admin-service && npm install`)
- [ ] External service dependencies install (`cd services/external-service && npm install`)
- [ ] Event service dependencies install (`cd services/event-service && npm install`)
- [ ] All package.json files are valid
- [ ] No syntax errors in code

## ✅ Infrastructure Review

- [ ] Terraform files reviewed
- [ ] AWS region configured (default: us-east-1)
- [ ] Environment name set (default: dev)
- [ ] Resource naming conventions acceptable

## ✅ Deployment Preparation

- [ ] .gitignore configured to exclude sensitive files
- [ ] No .env files with secrets committed
- [ ] Build artifacts excluded (.build/, dist/, *.zip)
- [ ] Branch `feature/deployment-testing` created

## 🚀 Ready to Deploy

Once all items are checked:

```bash
git checkout -b feature/deployment-testing
git add .
git commit -m "Initial CMIS deployment"
git push origin feature/deployment-testing
```

## 📊 Post-Deployment Verification

After deployment completes:

- [ ] GitHub Actions workflow completed successfully
- [ ] Frontend URL accessible
- [ ] CloudFront distribution deployed
- [ ] API Gateway URL available
- [ ] All 4 Lambda functions deployed
- [ ] Test frontend URL in browser
- [ ] Test API endpoints with curl/Postman:
  ```bash
  curl https://<api-url>/student/health
  curl https://<api-url>/admin/health
  curl https://<api-url>/company/health
  curl https://<api-url>/config/health
  ```
- [ ] Check CloudWatch logs for errors
- [ ] Verify S3 bucket contains frontend files

## 🔍 Troubleshooting

If deployment fails:

1. Check GitHub Actions logs
2. Verify AWS credentials
3. Check IAM permissions
4. Review Terraform errors
5. Validate code syntax
6. Check AWS service quotas

## 📝 Notes

- First deployment typically takes 5-10 minutes
- CloudFront distribution can take up to 15 minutes to fully deploy
- Subsequent deployments are faster (~3-5 minutes)
- Monitor AWS costs in Cost Explorer after deployment

## 🎯 Next Steps After Successful Deployment

- [ ] Test all functionality
- [ ] Configure custom domain (optional)
- [ ] Set up monitoring alerts
- [ ] Configure staging environment
- [ ] Add DynamoDB tables
- [ ] Implement authentication
- [ ] Add comprehensive tests
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure CI/CD for other branches
- [ ] Document API endpoints
