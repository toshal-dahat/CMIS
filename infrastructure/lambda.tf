# IAM Role for Lambda Functions
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Attach basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Additional policy for DynamoDB, S3, etc.
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy-${var.environment}"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "aws-marketplace:ViewSubscriptions",
          "aws-marketplace:Subscribe"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminDeleteUser"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "sts:AssumeRole"
        ]
        Resource = var.cognito_admin_role_arn != "" ? var.cognito_admin_role_arn : "*"
      },

      {
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      },

      {
        Effect = "Allow"
        Action = [
          "apigateway:FlushStageCache"
        ]
        Resource = "*"
      }
    ]
  })
}

# Student Service Lambda
resource "aws_lambda_function" "student_service" {
  filename         = "${path.module}/../.build/student-service.zip"
  function_name    = "${var.project_name}-student-service-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = fileexists("${path.module}/../.build/student-service.zip") ? filebase64sha256("${path.module}/../.build/student-service.zip") : ""
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ENVIRONMENT = var.environment
      NODE_ENV    = "production"
    }
  }
}

# Admin Service Lambda
resource "aws_lambda_function" "admin_service" {
  filename         = "${path.module}/../.build/admin-service.zip"
  function_name    = "${var.project_name}-admin-service-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = fileexists("${path.module}/../.build/admin-service.zip") ? filebase64sha256("${path.module}/../.build/admin-service.zip") : ""
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ENVIRONMENT = var.environment
      NODE_ENV    = "production"
    }
  }
}

# External Service Lambda
resource "aws_lambda_function" "external_service" {
  filename         = "${path.module}/../.build/external-service.zip"
  function_name    = "${var.project_name}-external-service-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = fileexists("${path.module}/../.build/external-service.zip") ? filebase64sha256("${path.module}/../.build/external-service.zip") : ""
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ENVIRONMENT = var.environment
      NODE_ENV    = "production"
    }
  }
}

# Event Service Lambda
resource "aws_lambda_function" "event_service" {
  filename         = "${path.module}/../.build/event-service.zip"
  function_name    = "${var.project_name}-event-service-${var.environment}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = fileexists("${path.module}/../.build/event-service.zip") ? filebase64sha256("${path.module}/../.build/event-service.zip") : ""
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ENVIRONMENT = var.environment
      NODE_ENV    = "production"
    }
  }
}

# CloudWatch Log Groups
# Commented out due to IAM restrictions - Lambda will auto-create these
# resource "aws_cloudwatch_log_group" "student_service" {
#   name              = "/aws/lambda/${aws_lambda_function.student_service.function_name}"
#   retention_in_days = 7
# }

# resource "aws_cloudwatch_log_group" "admin_service" {
#   name              = "/aws/lambda/${aws_lambda_function.admin_service.function_name}"
#   retention_in_days = 7
# }

# resource "aws_cloudwatch_log_group" "external_service" {
#   name              = "/aws/lambda/${aws_lambda_function.external_service.function_name}"
#   retention_in_days = 7
# }

# resource "aws_cloudwatch_log_group" "event_service" {
#   name              = "/aws/lambda/${aws_lambda_function.event_service.function_name}"
#   retention_in_days = 7
# }

# -----------------------------------------------------
# SES Email Identity (For RSVP Notifications)
# Automatically verified via IaC as requested by PM.
# -----------------------------------------------------
resource "aws_ses_email_identity" "event_mailer" {
  email = "abhishekp1703@gmail.com"
}
