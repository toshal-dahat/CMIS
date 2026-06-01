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

# Canonical skills for resume normalization (seeded from data/default_master_skills.json)
resource "aws_dynamodb_table" "master_skills" {
  name         = "MasterSkills-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "skillId"

  attribute {
    name = "skillId"
    type = "S"
  }

  attribute {
    name = "normalizedKey"
    type = "S"
  }

  global_secondary_index {
    name            = "normalizedKey-index"
    hash_key        = "normalizedKey"
    projection_type = "ALL"
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

# Seed default MS-MIS oriented skills; safe to re-apply (skips existing skillId).
resource "null_resource" "seed_master_skills" {
  depends_on = [aws_dynamodb_table.master_skills]

  triggers = {
    table_name  = aws_dynamodb_table.master_skills.name
    script_hash = filesha256("${path.module}/seed_master_skills.py")
    data_hash   = filesha256("${path.module}/data/default_master_skills.json")
  }

  provisioner "local-exec" {
    command = <<-EOT
      pip install boto3 --quiet
      python "${path.module}/seed_master_skills.py" "${aws_dynamodb_table.master_skills.name}" "${var.aws_region}"
    EOT
  }
}
