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
