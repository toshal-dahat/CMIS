# Events table (eventId as partition key)
resource "aws_dynamodb_table" "events" {
  name         = "Events-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "eventId"

  attribute {
    name = "eventId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "Events-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# RSVP table (eventId + userId composite key)
resource "aws_dynamodb_table" "rsvps" {
  name         = "EventRsvps-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "eventId"
  range_key = "userId"

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "EventRsvps-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}
