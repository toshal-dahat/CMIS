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
    STUDENT_PROFILES_TABLE       = aws_dynamodb_table.student_profiles.name
    RESUMES_TABLE                = aws_dynamodb_table.resumes.name
    MASTER_SKILLS_TABLE          = aws_dynamodb_table.master_skills.name
    MENTORSHIP_EMBEDDINGS_TABLE  = var.mentorship_embeddings_table_name
    RESUMES_BUCKET               = aws_s3_bucket.resumes.id
    COGNITO_USER_POOL_ID         = var.cognito_user_pool_id
    COGNITO_CLIENT_ID            = var.cognito_client_id
    COMPANIES_API_URL            = var.companies_api_url
    COGNITO_GROUP_STUDENTS       = "students"
    COGNITO_GROUP_INVESTORS      = "investors"
    COGNITO_GROUP_FRIENDS        = "friends"
    COGNITO_GROUP_ADMINS         = "admins"
    COGNITO_GROUP_FACULTIES      = "faculties"
    COGNITO_ADMIN_OVERRIDE_EMAIL = var.admin_override_email
    COGNITO_ADMIN_ROLE_ARN       = var.cognito_admin_role_arn
    COGNITO_ADMIN_EXTERNAL_ID    = var.cognito_admin_external_id
    RESUME_PARSER_MODEL_ID       = var.resume_parser_model_id
    EVENTS_TABLE                 = "Events-${var.stage}"
    RSVP_TABLE                   = "EventRsvps-${var.stage}"
    QR_SIGNING_SECRET            = var.qr_signing_secret
    CHECKIN_TIMEZONE             = var.checkin_timezone
  }
}

# --- Student profiles: check if profile exists ---
resource "aws_lambda_function" "check_profile_exists" {
  function_name    = "student-core-check-profile-exists-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/studentProfiles.checkProfileExists"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Student profiles: CRUD ---
resource "aws_lambda_function" "profiles_crud" {
  function_name    = "student-core-profiles-crud-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/studentProfiles.crud"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = merge(local.lambda_env, {
      MENTORSHIP_EXTERNAL_LAMBDA_NAME = var.mentorship_external_lambda_name
      EXTERNAL_SERVICE_LAMBDA_NAME    = var.mentorship_external_lambda_name
    })
  }

  timeout = 30
}

# --- Resumes: upload URL ---
resource "aws_lambda_function" "resumes_upload_url" {
  function_name    = "student-core-resumes-upload-url-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumes.uploadUrl"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: complete ---
resource "aws_lambda_function" "resumes_complete" {
  function_name    = "student-core-resumes-complete-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumes.complete"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: list ---
resource "aws_lambda_function" "resumes_list" {
  function_name    = "student-core-resumes-list-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumes.list"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: download URL ---
resource "aws_lambda_function" "resumes_download_url" {
  function_name    = "student-core-resumes-download-url-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumes.downloadUrl"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: extracted data ---
resource "aws_lambda_function" "resumes_extracted_data" {
  function_name    = "student-core-resumes-extracted-data-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumes.extractedData"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Resumes: extraction worker (S3 trigger) ---
resource "aws_lambda_function" "resumes_extract_on_upload" {
  function_name    = "student-core-resumes-extract-on-upload-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/resumeExtraction.onS3Upload"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 180
}

# --- Master skills list (for profile form) ---
resource "aws_lambda_function" "skills_list" {
  function_name    = "student-core-skills-list-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/skills.list"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

# --- Event QR + RSVP attendance check-in ---
resource "aws_lambda_function" "event_qr_generate" {
  function_name    = "student-core-event-qr-generate-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/eventQrAttendance.generateEventQr"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

resource "aws_lambda_function" "event_qr_checkin" {
  function_name    = "student-core-event-qr-checkin-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/eventQrAttendance.checkInAttendance"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}

resource "aws_lambda_function" "event_qr_scanner_page" {
  function_name    = "student-core-event-qr-scanner-page-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_node_runtime
  handler          = "src/handlers/eventQrAttendance.scannerPage"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = local.lambda_env
  }

  timeout = 30
}
