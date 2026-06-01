output "api_gateway_url" {
  description = "Competition API Gateway HTTP API invoke URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "competitions_table_name" {
  description = "DynamoDB Competitions table name"
  value       = aws_dynamodb_table.competitions.name
}

output "submissions_bucket_name" {
  description = "S3 bucket for competition submissions"
  value       = aws_s3_bucket.submissions.id
}

output "submissions_bucket_arn" {
  description = "ARN of the S3 submissions bucket"
  value       = aws_s3_bucket.submissions.arn
}

# ── Added outputs ─────────────────────────────────────────────────────────────

output "lambda_function_name" {
  description = "Competition service Lambda function name"
  value       = aws_lambda_function.competition_crud.function_name
}

output "judge_assignments_table_name" {
  description = "DynamoDB JudgeAssignments table name"
  value       = aws_dynamodb_table.judge_assignments.name
}

output "scores_table_name" {
  description = "DynamoDB CompetitionScores table name"
  value       = aws_dynamodb_table.scores.name
}

output "competition_rooms_table_name" {
  description = "DynamoDB CompetitionRooms table name"
  value       = aws_dynamodb_table.competition_rooms.name
}
