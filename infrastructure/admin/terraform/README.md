# CMIS Admin – Terraform

This directory contains the Terraform configuration that provisions all AWS infrastructure for the **CMIS Admin** platform. It deploys DynamoDB, Lambda, and API Gateway using modular service-based `.tf` files.

## What's included

| Resource | Terraform file |
|----------|----------------|
| AWS provider, versions, all variables | `variables.tf` |
| IAM role (LabRole data source) | `iam.tf` |
| DynamoDB table + seed data | `dynamodb.tf` |
| Lambda functions (4) | `lambda.tf` |
| API Gateway REST API + routes + CORS | `api_gateway.tf` |
| All resource outputs | `outputs.tf` |
| Variable values | `terraform.tfvars` |

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) >= 1.0
- AWS Learner Lab account with `LabRole` IAM role available
- AWS credentials exported from the Learner Lab session (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- Node.js 20 Lambda source code present under `lambda_code/` directory
- Python + boto3 installed locally (required for DynamoDB seed script)

## Directory Structure

```
.
├── variables.tf              # Terraform block, provider, and all variable declarations
├── terraform.tfvars          # Actual variable values (region, account_id, etc.)
├── iam.tf                    # IAM LabRole data source
├── dynamodb.tf               # DynamoDB table and seed resource
├── lambda.tf                 # All 4 Lambda functions and archive packaging
├── api_gateway.tf            # REST API, routes, methods, CORS, deployment, stage
├── outputs.tf                # All outputs grouped by service
├── lambda_code/
│   ├── config-api/           # Source for cmis-config-api Lambda
│   ├── theme-api/            # Source for cmis-theme-api Lambda
│   ├── tier-api/             # Source for cmis-tier-api Lambda
│   └── company-api/          # Source for cmis-company-api Lambda
├── lambda_packages/          # Auto-generated zip files (do not edit manually)
└── seed_dynamodb.py          # DynamoDB seed script (runs on terraform apply)
```

## Quick Start

1. **Load AWS Learner Lab credentials** — copy credentials from the Lab panel into `creds.ps1` and run:

   ```powershell
   . .\creds.ps1
   ```

2. **Initialize Terraform** — downloads provider plugins:

   ```powershell
   terraform init
   ```

3. **Preview changes**:

   ```powershell
   terraform plan
   ```

4. **Deploy**:

   ```powershell
   terraform apply -auto-approve
   ```

5. **Use the API** — after apply, the API base URL is available in the outputs:

   ```
   api_gateway_invoke_url = https://<api-id>.execute-api.us-east-1.amazonaws.com/prod
   ```

## Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `region` | AWS region for deployment | `us-east-1` |
| `account_id` | AWS Learner Lab Account ID (12-digit) | Required |
| `table_name` | DynamoDB table name | `cmis-admin-table` |
| `lambda_role_name` | IAM role name for Lambda execution | `cmis-admin-lambda-role` |
| `api_name` | API Gateway name | `cmis-admin-api` |
| `stage_name` | API Gateway stage name | `prod` |

## Lambda Functions

| Function | Handler | Description |
|----------|---------|-------------|
| `cmis-config-api` | `cmis-config-api.handler` | Handles system config retrieval (`/config`) |
| `cmis-theme-api` | `cmis-theme-api.handler` | Manages UI theme settings (`/theme`) |
| `cmis-tier-api` | `cmis-tier-api.handler` | CRUD operations for tiers (`/tiers`) |
| `cmis-company-api` | `cmis-company-api.handler` | CRUD operations for companies (`/companies`, `/domain`) |

## API Endpoints

| Method | Path | Lambda |
|--------|------|--------|
| `GET` | `/config` | cmis-config-api |
| `GET` | `/theme` | cmis-theme-api |
| `PUT` | `/theme` | cmis-theme-api |
| `GET` | `/tiers` | cmis-tier-api |
| `POST` | `/tiers` | cmis-tier-api |
| `PUT` | `/tiers/{tierId}` | cmis-tier-api |
| `DELETE` | `/tiers/{tierId}` | cmis-tier-api |
| `GET` | `/companies` | cmis-company-api |
| `POST` | `/companies` | cmis-company-api |
| `GET` | `/companies/{companyId}` | cmis-company-api |
| `PUT` | `/companies/{companyId}` | cmis-company-api |
| `DELETE` | `/companies/{companyId}` | cmis-company-api |
| `GET` | `/domain/{domain}` | cmis-company-api |

## Outputs

| Output | Description |
|--------|-------------|
| `dynamodb_table_name` | DynamoDB table name |
| `dynamodb_table_arn` | DynamoDB table ARN |
| `lambda_config_api_arn` | Config API Lambda ARN |
| `lambda_theme_api_arn` | Theme API Lambda ARN |
| `lambda_tier_api_arn` | Tier API Lambda ARN |
| `lambda_company_api_arn` | Company API Lambda ARN |
| `iam_role_arn` | LabRole ARN used by all Lambdas |
| `iam_role_name` | LabRole name |
| `api_gateway_id` | API Gateway REST API ID |
| `api_gateway_invoke_url` | Full invoke URL for the prod stage |
| `api_endpoints` | Map of all available API endpoint URLs |

## Updating Lambda Code

After making changes to any Lambda source file under `lambda_code/`:

1. Delete the stale zip files so they are regenerated fresh:

   ```powershell
   Remove-Item -Recurse -Force .\lambda_packages\
   ```

2. Re-apply:

   ```powershell
   . .\creds.ps1
   terraform apply -auto-approve
   ```

## Notes

- **Credentials expire** at the end of every Learner Lab session. Always run `. .\creds.ps1` with fresh credentials before running any Terraform commands.
- **LabRole** is a pre-existing IAM role managed by the Learner Lab — it is referenced via a `data` source and is never created or destroyed by Terraform.
- **API Gateway** will only redeploy when an integration actually changes, determined by a SHA hash of all integrations in the deployment `triggers` block.
- **DynamoDB seed** runs automatically on `terraform apply` via a `null_resource` local-exec provisioner using `seed_dynamodb.py`.
- All Lambda functions run on `nodejs20.x` with a 10-second timeout and 128MB memory.