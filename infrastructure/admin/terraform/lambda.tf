# ============================================================================
# Lambda Function: cmis-config-api
# ============================================================================

data "archive_file" "lambda_config_api" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_code/config-api"
  output_path = "${path.module}/lambda_packages/cmis-config-api.zip"
}

resource "aws_lambda_function" "config_api" {
  filename         = data.archive_file.lambda_config_api.output_path
  function_name    = "cmis-config-api"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "cmis-config-api.handler"
  source_code_hash = data.archive_file.lambda_config_api.output_base64sha256
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 10
  architectures    = ["x86_64"]
  publish          = true

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cmis_admin_table.name
      REGION     = var.region
    }
  }

  depends_on = [aws_dynamodb_table.cmis_admin_table]

  tags = {
    Name      = "cmis-config-api"
    ManagedBy = "Terraform"
  }
}

# ============================================================================
# Lambda Function: cmis-theme-api
# ============================================================================

data "archive_file" "lambda_theme_api" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_code/theme-api"
  output_path = "${path.module}/lambda_packages/cmis-theme-api.zip"
}

resource "aws_lambda_function" "theme_api" {
  filename         = data.archive_file.lambda_theme_api.output_path
  function_name    = "cmis-theme-api"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "cmis-theme-api.handler"
  source_code_hash = data.archive_file.lambda_theme_api.output_base64sha256
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 10
  architectures    = ["x86_64"]
  publish          = true

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cmis_admin_table.name
      REGION     = var.region
    }
  }

  depends_on = [aws_dynamodb_table.cmis_admin_table]

  tags = {
    Name      = "cmis-theme-api"
    ManagedBy = "Terraform"
  }
}

# ============================================================================
# Lambda Function: cmis-tier-api
# ============================================================================

data "archive_file" "lambda_tier_api" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_code/tier-api"
  output_path = "${path.module}/lambda_packages/cmis-tier-api.zip"
}

resource "aws_lambda_function" "tier_api" {
  filename         = data.archive_file.lambda_tier_api.output_path
  function_name    = "cmis-tier-api"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "cmis-tier-api.handler"
  source_code_hash = data.archive_file.lambda_tier_api.output_base64sha256
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 10
  architectures    = ["x86_64"]
  publish          = true

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cmis_admin_table.name
      REGION     = var.region
    }
  }

  depends_on = [aws_dynamodb_table.cmis_admin_table]

  tags = {
    Name      = "cmis-tier-api"
    ManagedBy = "Terraform"
  }
}

# ============================================================================
# Lambda Function: cmis-company-api
# ============================================================================

data "archive_file" "lambda_company_api" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_code/company-api"
  output_path = "${path.module}/lambda_packages/cmis-company-api.zip"
}

resource "aws_lambda_function" "company_api" {
  filename         = data.archive_file.lambda_company_api.output_path
  function_name    = "cmis-company-api"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "cmis-company-api.handler"
  source_code_hash = data.archive_file.lambda_company_api.output_base64sha256
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 10
  architectures    = ["x86_64"]
  publish          = true

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.cmis_admin_table.name
      REGION     = var.region
    }
  }

  depends_on = [aws_dynamodb_table.cmis_admin_table]

  tags = {
    Name      = "cmis-company-api"
    ManagedBy = "Terraform"
  }
}
