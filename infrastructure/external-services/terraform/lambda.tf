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
  timeout          = 30

  environment {
    variables = {
      USER_POOL_ID                       = aws_cognito_user_pool.external.id
      CLIENT_ID                          = aws_cognito_user_pool_client.external.id
      EXTERNAL_USERS_TABLE               = aws_dynamodb_table.external_users.name
      STUDENTS_TABLE                     = aws_dynamodb_table.students.name
      HANDOVER_TOKENS_TABLE              = aws_dynamodb_table.handover_tokens.name
      HANDOVER_LOG_TABLE                 = aws_dynamodb_table.handover_log.name
      MENTORSHIP_MATCHES_TABLE           = aws_dynamodb_table.mentorship_matches.name
      STUDENT_PROFILES_TABLE             = var.student_profiles_table_name
      RESUMES_TABLE                      = var.resumes_table_name
      STUDENT_RESUMES_ME_URL             = "https://peux35p02a.execute-api.us-east-1.amazonaws.com/dev/student/api/resumes/me"
      MENTORSHIP_TOP_K                   = "20"
      MENTORSHIP_SCORING_SEMANTIC_WEIGHT = "0.75"
      MENTORSHIP_SCORING_RULE_WEIGHT     = "0.25"
      CMIS_USER_POOL_ID                  = var.cmis_user_pool_id
      CMIS_GROUP_FRIENDS                 = "friends"
      CMIS_GROUP_ALUMNI                  = "alumni"
      ADMIN_USER_IDS                     = var.admin_user_ids
      COMPANY_LIST_API_URL               = var.company_list_api_url
      FRONTEND_BASE_URL                  = var.frontend_base_url
      SES_VERIFIED_SENDER                = var.ses_verified_sender
    }
  }

  tags = var.tags
}
