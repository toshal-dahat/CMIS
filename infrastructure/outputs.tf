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
  value       = "${module.events_core.api_gateway_url}/api/events"
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID used by student-core and frontend"
  value       = aws_cognito_user_pool.cmis.id
}

output "cognito_client_id" {
  description = "Cognito App Client ID used by student-core and frontend"
  value       = aws_cognito_user_pool_client.cmis_spa.id
}

output "cognito_region" {
  description = "AWS region where Cognito is deployed"
  value       = var.aws_region
}

output "cognito_oauth_domain" {
  description = "Cognito Hosted UI domain (without https://)"
  value       = "${aws_cognito_user_pool_domain.cmis.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "student_core_api_gateway_url" {
  description = "Student Core API Gateway HTTP API invoke URL"
  value       = module.student_core.api_gateway_url
}

output "student_core_cloudfront_url" {
  description = "Student Core CloudFront URL (if enabled)"
  value       = module.student_core.cloudfront_url
}

output "admin_core_api_gateway_url" {
  description = "Admin Core API Gateway REST API invoke URL"
  value       = module.admin_core.api_gateway_url
}

output "external_core_api_gateway_url" {
  description = "External Core API Gateway HTTP API invoke URL"
  value       = module.external_core.api_invoke_url
}

output "competition_core_api_gateway_url" {
  description = "Competition Core API Gateway HTTP API invoke URL"
  value       = module.competition_core.api_gateway_url
}

output "student_sms_scheduled_reminder_lambda_name" {
  description = "Student SMS scheduled reminder Lambda name"
  value       = module.student_core.sms_send_scheduled_reminder_lambda_name
}

output "student_sms_scheduled_reminder_lambda_arn" {
  description = "Student SMS scheduled reminder Lambda ARN"
  value       = module.student_core.sms_send_scheduled_reminder_lambda_arn
}
