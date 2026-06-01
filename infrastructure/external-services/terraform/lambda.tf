# Lambda - External Service (single handler with path routing)
data "archive_file" "external_service" {
  type        = "zip"
  source_dir  = "${path.module}/../../../services/external-service"
  output_path = "${path.module}/build/external-service.zip"
  excludes    = ["__pycache__", "*.pyc", ".pytest_cache", "tests", "*.zip"]
}

resource "aws_lambda_function" "external_service" {
  filename         = data.archive_file.external_service.output_path
  function_name    = "${var.project_name}-external-service"
  role             = aws_iam_role.external_lambda.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.external_service.output_base64sha256
  runtime          = "python3.12"
  timeout          = 900
  memory_size      = 1024

  environment {
    variables = {
      USER_POOL_ID                       = aws_cognito_user_pool.external.id
      CLIENT_ID                          = aws_cognito_user_pool_client.external.id
      EXTERNAL_USERS_TABLE               = aws_dynamodb_table.external_users.name
      STUDENTS_TABLE                     = aws_dynamodb_table.students.name
      HANDOVER_TOKENS_TABLE              = aws_dynamodb_table.handover_tokens.name
      HANDOVER_LOG_TABLE                 = aws_dynamodb_table.handover_log.name
      MENTORSHIP_MATCHES_TABLE           = aws_dynamodb_table.mentorship_matches.name
      MENTORSHIP_MATCHING_RUNS_TABLE      = aws_dynamodb_table.mentorship_matching_runs.name
      MENTORSHIP_MENTEE_GSI_NAME         = "menteeUserId-mentorUserId-index"
      MENTORSHIP_EMBEDDINGS_TABLE        = aws_dynamodb_table.mentorship_profile_embeddings.name
      STUDENT_PROFILES_TABLE             = var.student_profiles_table_name
      RESUMES_TABLE                      = var.resumes_table_name
      RESUMES_BUCKET                     = var.resumes_bucket_name
      STUDENT_RESUMES_ME_URL             = var.student_resumes_me_url
      MENTORSHIP_TOP_K                   = "20"
      MENTORSHIP_NARRATOR_TOP_K          = "5"
      MENTORSHIP_SCORING_SEMANTIC_WEIGHT = "0.75"
      MENTORSHIP_SCORING_RULE_WEIGHT     = "0.25"
      MENTORSHIP_EMBEDDINGS_PROVIDER     = "bedrock-titan"
      BEDROCK_EMBEDDING_MODEL            = var.bedrock_embedding_model
      BEDROCK_EMBEDDING_DIMENSIONS       = var.bedrock_embedding_dimensions
      BEDROCK_LLM_MODEL                  = var.bedrock_llm_model
      CMIS_USER_POOL_ID                  = var.cmis_user_pool_id
      CMIS_GROUP_FRIENDS                 = "friends"
      CMIS_GROUP_ALUMNI                  = "alumni"
      ADMIN_USER_IDS                     = var.admin_user_ids
      COMPANY_LIST_API_URL               = var.company_list_api_url
      FRONTEND_BASE_URL                  = var.frontend_base_url
      SES_VERIFIED_SENDER                = var.ses_verified_sender
      MENTEE_MAX_MATCHES                 = "1"
      MENTORSHIP_BATCH_MAX_MENTEES       = "500"
      MENTORSHIP_BOARD_COMPANY_CACHE_SEC = "300"
    }
  }

  tags = var.tags
}
