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

  # aws_iam_role_policy requires the role NAME, not the ARN.
  # Extract the name from the ARN: "arn:aws:iam::123456789:role/my-role" → "my-role"
  lambda_role_name = element(split("/", var.lambda_role_arn), length(split("/", var.lambda_role_arn)) - 1)
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

  # A5: raised from 30s → 60s to support the Textract → Bedrock summarization
  # pipeline in summaryService.js (Textract ~10-20s + Bedrock ~5-15s sequential).
  timeout = 60

  # 512 MB: Textract/Bedrock responses are buffered in-process.
  # 128 MB (the default) risks OOM when parsing large PDF text payloads.
  memory_size = 512
}

# ── IAM: Textract permissions ─────────────────────────────────────────────────
# summaryService.js calls textractClient.send(DetectDocumentTextCommand).
# The Lambda execution role needs textract:DetectDocumentText on all resources.
resource "aws_iam_role_policy" "lambda_textract" {
  name = "competition-lambda-textract-${var.stage}"
  role = local.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowTextractDetect"
        Effect   = "Allow"
        Action   = ["textract:DetectDocumentText"]
        Resource = "*"
      }
    ]
  })
}

# ── IAM: Bedrock permissions ──────────────────────────────────────────────────
# summaryService.js calls bedrockClient.send(InvokeModelCommand) with
# model ID "anthropic.claude-3-5-haiku-20241022-v1:0".
# bedrock:InvokeModel must be granted on that specific model ARN.
resource "aws_iam_role_policy" "lambda_bedrock" {
  name = "competition-lambda-bedrock-${var.stage}"
  role = local.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBedrockInvokeHaiku"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0"
        ]
      }
    ]
  })
}
