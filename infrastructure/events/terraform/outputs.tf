# --- API Endpoints ---

output "api_gateway_url" {
  description = "The primary HTTP API URL for the Event Service."
  # Includes the stage (e.g., /dev) to match the main application routing.
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "api_base_path" {
  description = "Standard prefix for all Event Service API routes."
  value       = "/api"
}

# --- Distribution Endpoints ---

output "cloudfront_url" {
  description = "Public URL for the Event API via CloudFront (if enabled)."
  value       = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.api[0].domain_name}" : null
}

output "cloudfront_domain_name" {
  description = "Domain name for the CloudFront distribution."
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.api[0].domain_name : null
}

# --- Resource Names ---

output "events_table_name" {
  description = "The name of the DynamoDB table storing event records."
  value       = aws_dynamodb_table.events.name
}
