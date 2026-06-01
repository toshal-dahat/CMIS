# Events Table: Stores event metadata and current capacity counts.
resource "aws_dynamodb_table" "events" {
  name         = "Events-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "eventId" # Partition key for event lookup

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

# RSVP Table: Manages event registrations and waitlist entries.
# Implements the 'Velvet Rope' access control foundation.
resource "aws_dynamodb_table" "rsvps" {
  name         = "EventRsvps-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "eventId" # Partition key: Group RSVPs by event
  range_key = "userId"  # Sort key: Unique entry per user per event

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  # Global Secondary Index for listing all RSVPs for a specific user.
  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled = true
  }

  # DynamoDB Streams: Triggers Lambda for RSVP confirmation and waitlist promotion emails.
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"


  tags = {
    Name = "EventRsvps-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}
