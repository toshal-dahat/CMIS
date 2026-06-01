# ─── Competitions ────────────────────────────────────────
# One record per competition. Stores name, deadlines, status.
resource "aws_dynamodb_table" "competitions" {
  name         = "Competitions-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId"

  attribute {
    name = "competitionId"
    type = "S"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "Competitions-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

# ─── Teams ───────────────────────────────────────────────
# PK=competitionId, SK=teamId → query all teams in a competition.
# GSI on teamId for reverse lookups (e.g. "which competition is this team in?").
resource "aws_dynamodb_table" "teams" {
  name         = "CompetitionTeams-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId"
  range_key    = "teamId"

  attribute {
    name = "competitionId"
    type = "S"
  }
  attribute {
    name = "teamId"
    type = "S"
  }

  global_secondary_index {
    name            = "teamId-index"
    hash_key        = "teamId"
    projection_type = "ALL"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "CompetitionTeams-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

# ─── Submissions ─────────────────────────────────────────
# One submission per team per competition (PK=competitionId, SK=teamId).
# Stores the S3 key, file metadata, and timestamp.
resource "aws_dynamodb_table" "submissions" {
  name         = "CompetitionSubmissions-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId"
  range_key    = "teamId"

  attribute {
    name = "competitionId"
    type = "S"
  }
  attribute {
    name = "teamId"
    type = "S"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "CompetitionSubmissions-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

# ─── Judge Assignments ───────────────────────────────────
# PK=competitionId, SK=judgeUserId → which teams a judge grades in a competition.
# GSI on judgeUserId so a judge can query "all my assignments across competitions".
resource "aws_dynamodb_table" "judge_assignments" {
  name         = "JudgeAssignments-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId"
  range_key    = "judgeUserId"

  attribute {
    name = "competitionId"
    type = "S"
  }
  attribute {
    name = "judgeUserId"
    type = "S"
  }

  global_secondary_index {
    name            = "judgeUserId-index"
    hash_key        = "judgeUserId"
    projection_type = "ALL"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "JudgeAssignments-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

# ─── Rooms ───────────────────────────────────────────────
# Source of truth for "which judges grade which teams" within a competition.
# A room groups a set of judgeIds with a set of teamIds. A team belongs to
# AT MOST ONE room within a competition (enforced in roomService.js); a
# judge MAY belong to multiple rooms.
#
# PK=competitionId, SK=roomId → list/get rooms for a competition.
resource "aws_dynamodb_table" "competition_rooms" {
  name         = "CompetitionRooms-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId"
  range_key    = "roomId"

  attribute {
    name = "competitionId"
    type = "S"
  }
  attribute {
    name = "roomId"
    type = "S"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "CompetitionRooms-${var.stage}" }

  lifecycle { prevent_destroy = true }
}

# ─── Scores ──────────────────────────────────────────────
# Composite PK = "competitionId#teamId", SK = judgeUserId
# → query all judges' scores for a given team.
# GSI on competitionId → query all scores across a whole competition.
resource "aws_dynamodb_table" "scores" {
  name         = "CompetitionScores-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "competitionId_teamId"
  range_key    = "judgeUserId"

  attribute {
    name = "competitionId_teamId"
    type = "S"
  }
  attribute {
    name = "judgeUserId"
    type = "S"
  }
  attribute {
    name = "competitionId"
    type = "S"
  }

  global_secondary_index {
    name            = "competitionId-index"
    hash_key        = "competitionId"
    projection_type = "ALL"
  }

  server_side_encryption { enabled = true }
  tags = { Name = "CompetitionScores-${var.stage}" }

  lifecycle { prevent_destroy = true }
}
