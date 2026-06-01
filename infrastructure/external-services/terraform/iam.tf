locals {
  external_lambda_cognito_arns = compact([
    aws_cognito_user_pool.external.arn,
    var.cmis_user_pool_arn,
  ])
}

# IAM role for External Service Lambda
resource "aws_iam_role" "external_lambda" {
  name = "${var.project_name}-external-lambda-role"

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

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.external_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "external_lambda" {
  name = "external-lambda-policy"
  role = aws_iam_role.external_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:ConditionCheckItem"
        ]
        Resource = [
          aws_dynamodb_table.external_users.arn,
          "${aws_dynamodb_table.external_users.arn}/index/*",
          aws_dynamodb_table.students.arn,
          "${aws_dynamodb_table.students.arn}/index/*",
          aws_dynamodb_table.handover_tokens.arn,
          aws_dynamodb_table.handover_log.arn,
          aws_dynamodb_table.mentorship_matches.arn,
          "${aws_dynamodb_table.mentorship_matches.arn}/index/*",
          aws_dynamodb_table.mentorship_profile_embeddings.arn,
          # StudentProfiles table (owned by student-core)
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.student_profiles_table_name}",
          # Resumes table (owned by student-service)
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${var.resumes_table_name}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:SignUp",
          "cognito-idp:InitiateAuth",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:GetUser",
          "cognito-idp:AdminConfirmSignUp",
          "cognito-idp:ListUsers"
        ]
        Resource = local.external_lambda_cognito_arns
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:Converse",
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/cohere.embed-english-v3",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:0",
        ]
      }
    ]
  })
}
