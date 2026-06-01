# Deployment package: zip competition-service
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/${var.competition_service_path}"
  output_path = "${path.module}/build/competition-service.zip"
  excludes    = [".git", "*.md", "docs", "node_modules/.cache"]
}

# Environment variables for the Lambda
locals {
  lambda_env = {
    COMPETITIONS_TABLE      = aws_dynamodb_table.competitions.name
    TEAMS_TABLE             = aws_dynamodb_table.teams.name
    SUBMISSIONS_TABLE       = aws_dynamodb_table.submissions.name
    JUDGE_ASSIGNMENTS_TABLE = aws_dynamodb_table.judge_assignments.name
    SCORES_TABLE            = aws_dynamodb_table.scores.name
    SUBMISSIONS_BUCKET      = aws_s3_bucket.submissions.id
    COGNITO_USER_POOL_ID    = var.cognito_user_pool_id
    COGNITO_CLIENT_ID       = var.cognito_client_id
  }
}

# Single Lambda handling all competition-service routes
resource "aws_lambda_function" "competition_crud" {
  function_name    = "competition-core-crud-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}
