module "student_core" {
  source = "./student/terraform"

  aws_region                          = var.aws_region
  stage                               = var.environment
  cognito_user_pool_id                = aws_cognito_user_pool.cmis.id
  cognito_client_id                   = aws_cognito_user_pool_client.cmis_spa.id
  cognito_admin_role_arn              = var.cognito_admin_role_arn
  cognito_admin_external_id           = var.cognito_admin_external_id
  admin_override_email                = var.admin_override_email
  lambda_role_arn                     = aws_iam_role.lambda_role.arn
  shared_api_gateway_id               = aws_apigatewayv2_api.main.id
  shared_api_gateway_execution_arn    = aws_apigatewayv2_api.main.execution_arn
  shared_api_gateway_stage_invoke_url = aws_apigatewayv2_stage.default.invoke_url

  # Path to student-service source relative to this module directory
  student_service_path = "../../../services/student-service"

  # Keep CloudFront disabled by default; can be enabled via module var if desired
  # enable_cloudfront = true
}

