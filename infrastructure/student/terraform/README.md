# Student Core – Terraform

This directory contains Terraform that replaces the **Serverless Framework** deployment in the repo root (`serverless.yml`). It provisions the same resources: DynamoDB, S3, Lambda, API Gateway HTTP API, and optionally CloudFront.

## What’s included

| Resource | Terraform file |
|----------|----------------|
| AWS provider, versions | `versions.tf` |
| Variables | `variables.tf` |
| Outputs | `outputs.tf` |
| DynamoDB (StudentProfiles, Resumes) | `dynamodb.tf` |
| S3 Resumes bucket (encryption, CORS) | `s3.tf` |
| IAM role and policies for Lambda | `iam.tf` |
| Lambda functions (6) | `lambda.tf` |
| API Gateway HTTP API + routes | `apigateway.tf` |
| Optional CloudFront in front of API | `cloudfront.tf` |

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) >= 1.0
- AWS CLI configured (or env vars `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)
- Node 20 in `services/student-service`: run `npm install` there before applying (Lambda zip includes `node_modules`)

## Quick start

1. **Install dependencies in student-service** (required for Lambda package):

   ```bash
   cd services/student-service && npm install && cd ../..
   ```

2. **Copy and edit variables** (optional):

   ```bash
   cd terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars: set cognito_user_pool_id, cognito_client_id, stage, etc.
   ```

3. **Initialize and apply**:

   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

4. **Use the API**:

   - API Gateway URL (after apply): see output `api_gateway_url`, e.g.  
     `https://<api-id>.execute-api.<region>.amazonaws.com`
   - If `enable_cloudfront = true`, use output `cloudfront_url` instead.

## Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `aws_region` | AWS region | `us-east-1` |
| `stage` | Stage name (e.g. dev, prod) | `dev` |
| `cognito_user_pool_id` | Cognito User Pool ID for JWT | `""` |
| `cognito_client_id` | Cognito App Client ID | `""` |
| `enable_cloudfront` | Create CloudFront in front of API | `false` |
| `lambda_node_runtime` | Lambda Node runtime | `nodejs20.x` |
| `student_service_path` | Path to student-service from `terraform/` | `../services/student-service` |

## Mapping from Serverless

- **Tables**: `StudentProfiles-${stage}`, `Resumes-${stage}` (same names and keys).
- **Bucket**: `tamu-resumes-${stage}-${account_id}` (same naming, encryption, CORS, public access block).
- **Routes**: Registered under shared student prefix (e.g. `GET /student/api/users/me/profile-exists`, `GET/POST /student/api/profiles`, `GET/PUT/DELETE /student/api/profiles/me`, `/student/api/resumes/*`).
- **Lambda env**: `STUDENT_PROFILES_TABLE`, `RESUMES_TABLE`, `RESUMES_BUCKET`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`.

## Optional: CloudFront

Set `enable_cloudfront = true` in `terraform.tfvars` (or via `-var`) to create a CloudFront distribution with the API Gateway as origin. After apply, use the `cloudfront_url` output as the public API base URL.

## Notes

- DynamoDB and S3 bucket use `prevent_destroy = true` to avoid accidental deletion.
- Lambda package is built from `student_service_path`; ensure `node_modules` is present (run `npm install` in `services/student-service` before `terraform apply`).
- After code changes in student-service, run `terraform apply` again so the zip is rebuilt and Lambdas updated.
