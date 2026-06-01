# -----------------------------------------------------------------------------
# DynamoDB - External users and graduation handover link
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "external_users" {
  name         = "${var.project_name}-external-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "email"
    type = "S"
  }
  attribute {
    name = "linked_uin"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "linked-uin-index"
    hash_key        = "linked_uin"
    projection_type = "ALL"
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# DynamoDB - Students table (dummy data for graduation automation)
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "students" {
  name         = "${var.project_name}-students"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "uin"

  attribute {
    name = "uin"
    type = "S"
  }
  attribute {
    name = "account_status"
    type = "S"
  }
  attribute {
    name = "grad_date"
    type = "S"
  }

  global_secondary_index {
    name            = "grad-status-index"
    hash_key        = "account_status"
    range_key       = "grad_date"
    projection_type = "ALL"
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# DynamoDB - Handover magic-link tokens
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "handover_tokens" {
  name         = "${var.project_name}-handover-tokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token_hash"

  attribute {
    name = "token_hash"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# DynamoDB - HandoverLog (audit: INITIATED | SUCCESS | FAILED, TTL 90 days)
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "handover_log" {
  name         = "${var.project_name}-handover-log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "handover_id"
  range_key    = "timestamp"

  attribute {
    name = "handover_id"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }

  ttl {
    attribute_name = "ttl_expiry"
    enabled        = true
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# DynamoDB - Mentorship matches (mentor -> mentee status + score + channel)
# PK: mentorUserId, SK: menteeUserId
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "mentorship_matches" {
  name         = "${var.project_name}-mentorship-matches"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "mentorUserId"
  range_key    = "menteeUserId"

  attribute {
    name = "mentorUserId"
    type = "S"
  }

  attribute {
    name = "menteeUserId"
    type = "S"
  }

  global_secondary_index {
    name            = "menteeUserId-mentorUserId-index"
    hash_key        = "menteeUserId"
    range_key       = "mentorUserId"
    projection_type = "ALL"
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Mentorship profile embeddings (per-user canonical mentor + mentee vectors)
# PK: userId, SK: profileKind ("mentor" | "mentee")
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "mentorship_profile_embeddings" {
  name         = "${var.project_name}-mentorship-profile-embeddings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "profileKind"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "profileKind"
    type = "S"
  }

  tags = var.tags
}
