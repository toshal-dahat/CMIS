module "admin_core" {
  source = "./admin/terraform"

  region           = var.aws_region
  table_name       = "cmis-admin-table-${var.environment}"
  api_name         = "cmis-admin-api-${var.environment}"
  stage_name       = var.environment
  lambda_role_arn  = aws_iam_role.lambda_role.arn
}
