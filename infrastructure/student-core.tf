module "student_core" {
  source = "./student/terraform"

  aws_region                          = var.aws_region
  stage                               = var.environment
  mentorship_external_lambda_name     = "${var.external_services_project_name}-external-service"
  companies_api_url                   = "${module.admin_core.api_gateway_url}/companies"
  cognito_user_pool_id                = aws_cognito_user_pool.cmis.id
  cognito_client_id                   = aws_cognito_user_pool_client.cmis_spa.id
  cognito_admin_role_arn              = var.cognito_admin_role_arn
  twilio_account_sid                  = var.twilio_account_sid
  twilio_auth_token                   = var.twilio_auth_token
  twilio_from_number                  = var.twilio_from_number
  cognito_admin_external_id           = var.cognito_admin_external_id
  admin_override_email                = var.admin_override_email
  lambda_role_arn                     = aws_iam_role.lambda_role.arn
  shared_api_gateway_id               = aws_apigatewayv2_api.main.id
  shared_api_gateway_execution_arn    = aws_apigatewayv2_api.main.execution_arn
  shared_api_gateway_stage_invoke_url = aws_apigatewayv2_stage.default.invoke_url
  events_table_stream_arn             = module.events_core.events_table_stream_arn
  rsvps_table_stream_arn              = module.events_core.rsvps_table_stream_arn

  # Path to student-service source relative to this module directory
  student_service_path = "../../../services/student-service"

  # Keep CloudFront disabled by default; can be enabled via module var if desired
  # enable_cloudfront = true
}

