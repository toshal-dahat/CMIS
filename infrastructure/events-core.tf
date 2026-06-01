module "events_core" {
  source = "./events/terraform"

  aws_region           = var.aws_region
  stage                = var.environment
  cognito_user_pool_id = aws_cognito_user_pool.cmis.id
  cognito_client_id    = aws_cognito_user_pool_client.cmis_spa.id
  lambda_role_arn      = aws_iam_role.lambda_role.arn

  # Path to event-service source relative to this module directory
  events_service_path = "../../../services/event-service"
}
