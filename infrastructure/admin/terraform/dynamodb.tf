# ============================================================================
# DynamoDB Table
# ============================================================================

resource "aws_dynamodb_table" "cmis_admin_table" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "domain"
    type = "S"
  }

  global_secondary_index {
    name            = "domain-index"
    hash_key        = "domain"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = false
  }

  deletion_protection_enabled = false

  tags = {
    Name        = "cmis-admin-table"
    Environment = "prod"
    ManagedBy   = "Terraform"
  }
}

# ============================================================================
# DynamoDB Seed Items
# Uses null_resource + local-exec so items are only inserted if they don't
# already exist (attribute_not_exists check). Safe to re-apply at any time.
# ============================================================================

resource "null_resource" "seed_dynamodb" {
  depends_on = [aws_dynamodb_table.cmis_admin_table]

  provisioner "local-exec" {
    command = <<-EOT
      pip install boto3 --quiet
      python ${path.module}/seed_dynamodb.py "${aws_dynamodb_table.cmis_admin_table.name}" "${var.region}"
    EOT
  }
}


