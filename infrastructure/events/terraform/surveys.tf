# SurveyTemplates table — one configurable template per event (eventId as PK)
resource "aws_dynamodb_table" "survey_templates" {
  name         = "SurveyTemplates-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"

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

# SurveyResponses table — one response per (eventId + userId)
resource "aws_dynamodb_table" "survey_responses" {
  name         = "SurveyResponses-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"
  range_key    = "userId"

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
