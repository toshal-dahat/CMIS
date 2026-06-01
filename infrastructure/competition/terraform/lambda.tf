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

# ── IAM: S3 submissions bucket access ────────────────────────────────────────
# Lambda needs PutObject (presigned upload confirm via HeadObject),
# GetObject (presigned download + Textract source), and HeadObject (size check).
# ListBucket is required so HeadObject returns 404 (not 403) for missing keys.
resource "aws_iam_role_policy" "lambda_s3_submissions" {
  name = "competition-lambda-s3-${var.stage}"
  role = local.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSubmissionsBucketObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:HeadObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.submissions.arn}/submissions/*"
      },
      {
        Sid    = "AllowSubmissionsBucketList"
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = aws_s3_bucket.submissions.arn
      }
    ]
  })
}

# ── IAM: Textract permissions ─────────────────────────────────────────────────
# summaryService.js uses the ASYNC Textract API:
#   - StartDocumentTextDetection  (start the job)
#   - GetDocumentTextDetection    (poll for results)
resource "aws_iam_role_policy" "lambda_textract" {
  name = "competition-lambda-textract-${var.stage}"
  role = local.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowTextractAsyncDetect"
        Effect   = "Allow"
        Action   = [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── IAM: Bedrock permissions ──────────────────────────────────────────────────
# summaryService.js calls bedrockClient.send(InvokeModelCommand) with
# model ID "anthropic.claude-3-haiku-20240307-v1:0".
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
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
        ]
      }
    ]
  })
}
