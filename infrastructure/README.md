# Infrastructure

Terraform and scripts live in team-specific subdirectories. Use the one for your service:

| Path | Team / Service |
|------|----------------|
| **external-services/terraform/** | Team Gig 'Em – External Core (Cognito, DynamoDB, Lambda, API Gateway, S3/CloudFront) |
| **student/terraform/** | Team Reveille – Student Core |

Run Terraform from the relevant directory, for example:

```bash
cd infrastructure/external-services/terraform
terraform init
terraform plan
terraform apply
```

Helper scripts (import, delete, clean-slate) are in `infrastructure/scripts/` and target **external-services/terraform**. Copy `terraform.tfvars.example` to `terraform.tfvars` inside the terraform directory you use; do not rely on any `terraform.tfvars` at the infrastructure root.
