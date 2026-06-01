# CMIS External – Infrastructure (Team Gig 'Em)

Terraform for the External Core: Cognito, DynamoDB, Lambda, API Gateway, optional S3/CloudFront frontend hosting.

## Layout

| File | Contents |
|------|----------|
| `versions.tf` | Terraform & provider versions, AWS provider config |
| `variables.tf` | Input variables |
| `terraform.tfvars` | Your values (copy from `terraform.tfvars.example`; do not commit secrets) |
| `cognito.tf` | Cognito User Pool + app client (email/password) |
| `dynamodb.tf` | DynamoDB tables (external-users, students, handover-tokens, handover-log) |
| `ses.tf` | SES email identity for magic-link sender (optional) |
| `iam.tf` | IAM role and policies for Lambda |
| `lambda.tf` | Lambda function, EventBridge schedule for graduation scan |
| `apigateway.tf` | API Gateway HTTP API + Lambda integration |
| `s3.tf` | S3 bucket for frontend (when hosting enabled) |
| `cloudfront.tf` | CloudFront, ACM cert, Route53 (when hosting + domain set) |
| `outputs.tf` | Output values (API URL, table names, frontend URL, etc.) |

## Prerequisites

- Terraform >= 1.0
- AWS CLI configured (credentials in env or `~/.aws/credentials`)
- Copy `terraform.tfvars.example` to `terraform.tfvars` and set variables as needed

## Commands

```bash
cd infrastructure/external-services/terraform
terraform init
terraform plan
terraform apply
```

After apply, set the frontend `VITE_API_BASE` to the `api_gateway_url` output (or use `terraform output api_gateway_url`).
