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
    key_schema {
      attribute_name = "email"
      key_type       = "HASH"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "linked-uin-index"
    key_schema {
      attribute_name = "linked_uin"
      key_type       = "HASH"
    }
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
    key_schema {
      attribute_name = "account_status"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "grad_date"
      key_type       = "RANGE"
    }
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
