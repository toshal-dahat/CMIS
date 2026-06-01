module "competition_core" {
  source = "./competition/terraform"

  aws_region           = var.aws_region
  stage                = var.environment
  cognito_user_pool_id = aws_cognito_user_pool.cmis.id
  cognito_client_id    = aws_cognito_user_pool_client.cmis_spa.id
  lambda_role_arn      = aws_iam_role.lambda_role.arn

  competition_service_path              = "../../../services/competition-service"
  enable_competition_feedback_scheduler = var.enable_competition_feedback_scheduler
}
