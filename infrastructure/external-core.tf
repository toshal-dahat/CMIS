module "external_core" {
  source = "./external-services/terraform"

  aws_region = var.aws_region

  # Update StudentProfiles (source of truth) during alumni handover
  student_profiles_table_name    = module.student_core.student_profiles_table_name
  resumes_table_name             = module.student_core.resumes_table_name
  resumes_bucket_name            = module.student_core.resumes_bucket_name
  student_resumes_me_url         = "${trimsuffix(module.student_core.api_gateway_url, "/")}/student/api/resumes/me"
  cmis_user_pool_id              = aws_cognito_user_pool.cmis.id
  cmis_user_pool_arn             = aws_cognito_user_pool.cmis.arn
  mentorship_embeddings_provider = var.mentorship_embeddings_provider
  bedrock_embedding_model        = var.bedrock_embedding_model
  bedrock_embedding_dimensions   = var.bedrock_embedding_dimensions
  bedrock_llm_model              = var.bedrock_llm_model
  openai_api_key                 = local.openai_api_key_effective
  openai_embedding_model         = var.openai_embedding_model

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

