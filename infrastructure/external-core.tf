module "external_core" {
  source = "./external-services/terraform"

  aws_region = var.aws_region

  # Update StudentProfiles (source of truth) during alumni handover
  student_profiles_table_name = module.student_core.student_profiles_table_name
  resumes_table_name          = module.student_core.resumes_table_name
  cmis_user_pool_id           = aws_cognito_user_pool.cmis.id
  cmis_user_pool_arn          = aws_cognito_user_pool.cmis.arn

  # Use the main CloudFront URL so magic-links and CORS align with the shared frontend.
  frontend_base_url = "https://${aws_cloudfront_distribution.frontend.domain_name}"

  # Restrict CORS to the CloudFront origin (the external module currently defaults to ["*"],
  # but this makes intent explicit and future-proofs if that default tightens).
  cors_allow_origins = [
    "https://${aws_cloudfront_distribution.frontend.domain_name}",
  ]

  tags = {
    Environment = var.environment
    Project     = "cmis-external"
  }
}

