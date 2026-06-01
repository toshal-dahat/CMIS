# Deployment package: zip events-service (run npm install there first)
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/${var.events_service_path}"
  output_path = "${path.module}/build/event-service.zip"
  excludes    = [".git", "*.md", "docs", "node_modules/.cache"]
}

# Shared environment for all Lambdas
locals {
  lambda_env = {
    EVENTS_TABLE            = aws_dynamodb_table.events.name
    RSVP_TABLE              = aws_dynamodb_table.rsvps.name
    COGNITO_USER_POOL_ID    = var.cognito_user_pool_id
    COGNITO_CLIENT_ID       = var.cognito_client_id
    COMPANIES_API_URL       = var.companies_api_url
    COGNITO_GROUP_STUDENTS  = "students"
    COGNITO_GROUP_INVESTORS = "investors"
    COGNITO_GROUP_FRIENDS   = "friends"
  }
}

# --- Events: CRUD ---
resource "aws_lambda_function" "events_crud" {
  function_name    = "events-core-crud-${var.stage}"
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

resource "aws_lambda_event_source_mapping" "rsvp_stream" {
  event_source_arn  = aws_dynamodb_table.rsvps.stream_arn
  function_name     = aws_lambda_function.events_crud.arn
  starting_position = "LATEST"
}

