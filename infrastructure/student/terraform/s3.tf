# Resumes S3 bucket for presigned uploads
resource "aws_s3_bucket" "resumes" {
  bucket = "tamu-resumes-${var.stage}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "tamu-resumes-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

resource "aws_lambda_permission" "allow_resumes_bucket_invoke_extract" {
  statement_id  = "AllowResumesBucketInvokeExtract"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_extract_on_upload.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.resumes.arn
}

resource "aws_s3_bucket_notification" "resumes_pdf_upload_events" {
  bucket = aws_s3_bucket.resumes.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.resumes_extract_on_upload.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "resumes/"
    filter_suffix       = ".pdf"
  }

  depends_on = [aws_lambda_permission.allow_resumes_bucket_invoke_extract]
}

data "aws_caller_identity" "current" {}
