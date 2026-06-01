# Deployment package: zip student-service (run npm install there first)
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/${var.student_service_path}"
  output_path = "${path.module}/build/student-service.zip"
  excludes    = [".git", "*.md", "docs", "node_modules/.cache"]
}

# Shared environment for all Lambdas
locals {
  lambda_env = {
    STUDENT_PROFILES_TABLE = aws_dynamodb_table.student_profiles.name
    RESUMES_TABLE          = aws_dynamodb_table.resumes.name
    RESUMES_BUCKET         = aws_s3_bucket.resumes.id
    COGNITO_USER_POOL_ID   = var.cognito_user_pool_id
    COGNITO_CLIENT_ID      = var.cognito_client_id
    COMPANIES_API_URL      = var.companies_api_url
    COGNITO_GROUP_STUDENTS = "students"
    COGNITO_GROUP_INVESTORS = "investors"
    COGNITO_GROUP_FRIENDS  = "friends"
    COGNITO_GROUP_ADMINS   = "admins"
    COGNITO_GROUP_FACULTIES = "faculties"
    COGNITO_ADMIN_OVERRIDE_EMAIL = var.admin_override_email
    COGNITO_ADMIN_ROLE_ARN = var.cognito_admin_role_arn
    COGNITO_ADMIN_EXTERNAL_ID = var.cognito_admin_external_id
  }
}

# --- Student profiles: check if profile exists ---
resource "aws_lambda_function" "check_profile_exists" {
  function_name = "student-core-check-profile-exists-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/studentProfiles.checkProfileExists"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Student profiles: CRUD ---
resource "aws_lambda_function" "profiles_crud" {
  function_name = "student-core-profiles-crud-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/studentProfiles.crud"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: upload URL ---
resource "aws_lambda_function" "resumes_upload_url" {
  function_name = "student-core-resumes-upload-url-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/resumes.uploadUrl"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: complete ---
resource "aws_lambda_function" "resumes_complete" {
  function_name = "student-core-resumes-complete-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/resumes.complete"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: list ---
resource "aws_lambda_function" "resumes_list" {
  function_name = "student-core-resumes-list-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/resumes.list"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: download URL ---
resource "aws_lambda_function" "resumes_download_url" {
  function_name = "student-core-resumes-download-url-${var.stage}"
  role          = var.lambda_role_arn
  runtime       = var.lambda_node_runtime
  handler       = "src/handlers/resumes.downloadUrl"
  filename      = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}
