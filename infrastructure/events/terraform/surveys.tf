# Survey Templates Table: Stores custom survey questions/config for each event.
resource "aws_dynamodb_table" "survey_templates" {
  name         = "SurveyTemplates-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId" # Each event has exactly one template.

  attribute {
    name = "eventId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "SurveyTemplates-${var.stage}"
  }
}

# Survey Responses Table: Stores feedback submitted by event attendees.
resource "aws_dynamodb_table" "survey_responses" {
  name         = "SurveyResponses-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId" # Partition: Group by event
  range_key    = "userId"  # Sort: Ensure one response per attendee

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "SurveyResponses-${var.stage}"
  }
}
