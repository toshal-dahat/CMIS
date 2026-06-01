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
    STUDENT_PROFILES_TABLE  = var.student_profiles_table_name
    COGNITO_USER_POOL_ID    = var.cognito_user_pool_id
    COGNITO_CLIENT_ID       = var.cognito_client_id
    DOMAIN_API_URL          = var.domain_api_url
    CONFIG_API_URL          = var.config_api_url
    COGNITO_GROUP_STUDENTS  = "students"
    COGNITO_GROUP_INVESTORS = "investors"
    COGNITO_GROUP_FRIENDS   = "friends"
    // SMS reminder configuration for one-hour RSVP notifications.
    SMS_ENABLED             = "true"
    SMS_SCHEDULE_GROUP      = "default"
    SMS_TARGET_LAMBDA_ARN   = aws_lambda_function.events_crud.arn
    SMS_SCHEDULER_ROLE_ARN  = aws_iam_role.sms_scheduler_invoke_role.arn
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

resource "aws_iam_role" "sms_scheduler_invoke_role" {
  name = "events-core-sms-scheduler-invoke-${var.stage}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "sms_scheduler_invoke_policy" {
  name = "events-core-sms-scheduler-invoke-${var.stage}"
  role = aws_iam_role.sms_scheduler_invoke_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.events_crud.arn
      }
    ]
  })
}

resource "aws_lambda_permission" "allow_scheduler_invoke_events_crud" {
  statement_id  = "AllowSchedulerInvokeEventsCrud"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.events_crud.function_name
  principal     = "scheduler.amazonaws.com"
}

resource "aws_lambda_event_source_mapping" "rsvp_stream" {
  event_source_arn  = aws_dynamodb_table.rsvps.stream_arn
  function_name     = aws_lambda_function.events_crud.arn
  starting_position = "LATEST"
}

