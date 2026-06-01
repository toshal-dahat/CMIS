output "cognito_user_pool_id" {
  description = "Cognito User Pool ID for external auth"
  value       = aws_cognito_user_pool.external.id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = aws_cognito_user_pool_client.external.id
  sensitive   = false
}

output "external_users_table_name" {
  description = "DynamoDB table name for external users"
  value       = aws_dynamodb_table.external_users.name
}

output "api_gateway_url" {
  description = "External API base URL"
  value       = "${aws_apigatewayv2_api.external.api_endpoint}"
}

output "api_invoke_url" {
  description = "Full API invoke URL (with stage)"
  value       = "${aws_apigatewayv2_api.external.api_endpoint}"
}

output "students_table_name" {
  description = "DynamoDB table name for students (graduation scan)"
  value       = aws_dynamodb_table.students.name
}

# --- Frontend hosting (only when enable_frontend_hosting = true) ---
output "frontend_url" {
  description = "Frontend URL (CloudFront or custom domain). Set when enable_frontend_hosting is true."
  value       = var.enable_frontend_hosting ? (var.frontend_domain != "" ? "https://${var.frontend_domain}" : "https://${aws_cloudfront_distribution.frontend[0].domain_name}") : null
}

output "frontend_cloudfront_domain" {
  description = "CloudFront distribution domain (use if no custom domain)"
  value       = var.enable_frontend_hosting ? aws_cloudfront_distribution.frontend[0].domain_name : null
}

output "frontend_cloudfront_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = var.enable_frontend_hosting ? aws_cloudfront_distribution.frontend[0].id : null
}

output "frontend_s3_bucket" {
  description = "S3 bucket name for frontend build upload"
  value       = var.enable_frontend_hosting ? aws_s3_bucket.frontend[0].id : null
}

output "frontend_domain" {
  description = "Custom domain for frontend (if set)"
  value       = var.enable_frontend_hosting && var.frontend_domain != "" ? var.frontend_domain : null
}
