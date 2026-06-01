# ─── Competition Submissions S3 Bucket ───────────────────
# Private bucket for team submission PDFs. No public access.
# Presigned URLs are used for both upload (PUT) and download (GET).
resource "aws_s3_bucket" "submissions" {
  bucket = "tamu-competition-submissions-${var.stage}-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "tamu-competition-submissions-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "submissions" {
  bucket = aws_s3_bucket.submissions.id

  versioning_configuration {
    status = "Disabled"
  }
}

# Server-side encryption (AES-256)
resource "aws_s3_bucket_server_side_encryption_configuration" "submissions" {
  bucket = aws_s3_bucket.submissions.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block ALL public access
resource "aws_s3_bucket_public_access_block" "submissions" {
  bucket = aws_s3_bucket.submissions.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS: allow presigned PUT (upload), GET (download), and HEAD (verify)
resource "aws_s3_bucket_cors_configuration" "submissions" {
  bucket = aws_s3_bucket.submissions.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

data "aws_caller_identity" "current" {}
