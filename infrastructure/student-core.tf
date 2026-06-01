module "student_core" {
  source = "./student/terraform"

  aws_region           = var.aws_region
  stage                = var.environment
  cognito_user_pool_id = var.cognito_user_pool_id
  cognito_client_id    = var.cognito_client_id
  lambda_role_arn      = aws_iam_role.lambda_role.arn

  # Path to student-service source relative to this module directory
  student_service_path = "../../../services/student-service"

  # Keep CloudFront disabled by default; can be enabled via module var if desired
  # enable_cloudfront = true
}

