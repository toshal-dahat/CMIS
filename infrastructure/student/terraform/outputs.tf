output "api_gateway_url" {
  description = "API Gateway HTTP API invoke URL"
  # Use shared stage URL when provided; otherwise use module-managed stage URL.
  value = local.use_shared_api_gateway ? var.shared_api_gateway_stage_invoke_url : aws_apigatewayv2_stage.default[0].invoke_url
}

output "api_base_path" {
  description = "Base path for student API routes"
  value       = "/student/api"
}

output "cloudfront_url" {
  description = "CloudFront distribution URL (if enable_cloudfront is true)"
  value       = var.enable_cloudfront && !local.use_shared_api_gateway ? "https://${aws_cloudfront_distribution.api[0].domain_name}" : null
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = var.enable_cloudfront && !local.use_shared_api_gateway ? aws_cloudfront_distribution.api[0].domain_name : null
}

output "student_profiles_table_name" {
  description = "DynamoDB StudentProfiles table name"
  value       = aws_dynamodb_table.student_profiles.name
}

output "resumes_table_name" {
  description = "DynamoDB Resumes table name"
  value       = aws_dynamodb_table.resumes.name
}

output "resumes_bucket_name" {
  description = "S3 Resumes bucket name"
  value       = aws_s3_bucket.resumes.id
}
