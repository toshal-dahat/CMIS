# StudentProfiles table (userId as partition key)
resource "aws_dynamodb_table" "student_profiles" {
  name         = "StudentProfiles-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "StudentProfiles-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Resumes table (userSub + resumeId composite key)
resource "aws_dynamodb_table" "resumes" {
  name         = "Resumes-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "userSub"
  range_key = "resumeId"

  attribute {
    name = "userSub"
    type = "S"
  }

  attribute {
    name = "resumeId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "Resumes-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Master skills catalog (partition key = normalizedKey)
resource "aws_dynamodb_table" "master_skills" {
  name         = "MasterSkills-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "normalizedKey"

  attribute {
    name = "normalizedKey"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "MasterSkills-${var.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}
