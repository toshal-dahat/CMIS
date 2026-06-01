module "events_core" {
  source = "./events/terraform"

  aws_region           = var.aws_region
  stage                = var.environment
  cognito_user_pool_id = var.cognito_user_pool_id
  cognito_client_id    = var.cognito_client_id
  lambda_role_arn      = aws_iam_role.lambda_role.arn
}
