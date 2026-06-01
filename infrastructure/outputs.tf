output "frontend_bucket_name" {
  description = "S3 bucket name for frontend"
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_url" {
  description = "Frontend URL"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "api_gateway_url" {
  description = "API Gateway URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "student_service_url" {
  description = "Student Service URL"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/student"
}

output "admin_service_url" {
  description = "Admin Service URL"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/admin"
}

output "external_service_url" {
  description = "External Service URL"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/external"
}

output "event_service_url" {
  description = "Event Service URL"
  value       = "${module.events_core.api_gateway_url}/event"
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID used by student-core and frontend"
  value       = var.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID used by student-core and frontend"
  value       = var.cognito_client_id
}

output "cognito_region" {
  description = "AWS region where Cognito is deployed"
  value       = var.aws_region
}

output "student_core_api_gateway_url" {
  description = "Student Core API Gateway HTTP API invoke URL"
  value       = module.student_core.api_gateway_url
}

output "student_core_cloudfront_url" {
  description = "Student Core CloudFront URL (if enabled)"
  value       = module.student_core.cloudfront_url
}
