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
