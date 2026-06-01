# Deployment package: zip competition-service
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/${var.competition_service_path}"
  output_path = "${path.module}/build/competition-service.zip"
  excludes    = [".git", "*.md", "docs", "node_modules/.cache"]
}

# Environment variables for the Lambda
locals {
  lambda_env = merge(
    {
      COMPETITIONS_TABLE      = aws_dynamodb_table.competitions.name
      TEAMS_TABLE             = aws_dynamodb_table.teams.name
      SUBMISSIONS_TABLE       = aws_dynamodb_table.submissions.name
      JUDGE_ASSIGNMENTS_TABLE = aws_dynamodb_table.judge_assignments.name
      SCORES_TABLE            = aws_dynamodb_table.scores.name
      COMPETITION_ROOMS_TABLE = aws_dynamodb_table.competition_rooms.name
      SUBMISSIONS_BUCKET      = aws_s3_bucket.submissions.id
      COGNITO_USER_POOL_ID    = var.cognito_user_pool_id
      COGNITO_CLIENT_ID       = var.cognito_client_id
    },
    var.enable_pptx_extractor_lambda ? {
      PPTX_EXTRACTOR_FUNCTION_NAME = aws_lambda_function.pptx_extractor[0].function_name
    } : {}
  )

  # aws_iam_role_policy requires the role NAME, not the ARN.
  # Extract the name from the ARN: "arn:aws:iam::123456789:role/my-role" → "my-role"
  lambda_role_name = element(split("/", var.lambda_role_arn), length(split("/", var.lambda_role_arn)) - 1)
}

# ── Public LibreOffice Lambda Layer (shelf.io) ───────────────────────────────
# Used by libreOfficeConverter.js to convert PPT/PPTX submissions to PDF
# before Textract. The brotli variant is ~95MB compressed; extraction happens
# lazily on first invocation into /tmp.
# Source: https://github.com/shelfio/libreoffice-lambda-layer
variable "libreoffice_layer_arn" {
  description = "ARN of the public shelf.io LibreOffice (brotli) Lambda layer"
  type        = string
  default     = "arn:aws:lambda:us-east-1:764866452798:layer:libreoffice-brotli:1"
}

# Single Lambda handling all competition-service routes
resource "aws_lambda_function" "competition_crud" {
  function_name    = "competition-core-crud-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  layers = [var.libreoffice_layer_arn]

  environment {
    variables = local.lambda_env
  }

  # 120s: LibreOffice conversion (first PPTX: ~15-30s) + Textract async
  # (~10-20s) + Bedrock (~5-15s). Also accommodates the first-ever cold start
  # where LibreOffice is extracted from the layer archive (~10s).
  timeout = 120

  # 2048 MB: LibreOffice is memory-hungry during PPT/PPTX → PDF conversion.
  # Larger memory also grants more CPU share, which speeds up conversion.
  memory_size = 2048

  # 1024 MB /tmp: the LibreOffice layer is extracted to /tmp/instdir (~200MB),
  # plus per-conversion workspace for source + PDF output.
  ephemeral_storage {
    size = 1024
  }
}

# ── IAM: S3 submissions bucket access ────────────────────────────────────────
# Lambda needs:
#   - submissions/*  : PUT/GET original team uploads (PDF/PPT/PPTX)
#   - converted/*    : PUT/GET LibreOffice-converted PDF copies (for Textract)
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
        Resource = [
          "${aws_s3_bucket.submissions.arn}/submissions/*",
          "${aws_s3_bucket.submissions.arn}/converted/*"
        ]
      },
      {
        Sid      = "AllowSubmissionsBucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
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
        Sid    = "AllowTextractAsyncDetect"
        Effect = "Allow"
        Action = [
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
