# ============================================================================
# DynamoDB Outputs
# ============================================================================

output "dynamodb_table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.cmis_admin_table.name
}

output "dynamodb_table_arn" {
  description = "DynamoDB table ARN"
  value       = aws_dynamodb_table.cmis_admin_table.arn
}

# ============================================================================
# Lambda Outputs
# ============================================================================

output "lambda_config_api_arn" {
  description = "Config API Lambda function ARN"
  value       = aws_lambda_function.config_api.arn
}

output "lambda_theme_api_arn" {
  description = "Theme API Lambda function ARN"
  value       = aws_lambda_function.theme_api.arn
}

output "lambda_tier_api_arn" {
  description = "Tier API Lambda function ARN"
  value       = aws_lambda_function.tier_api.arn
}

output "lambda_company_api_arn" {
  description = "Company API Lambda function ARN"
  value       = aws_lambda_function.company_api.arn
}

# ============================================================================
# API Gateway Outputs
# ============================================================================

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_api_gateway_rest_api.cmis_admin_api.id
}

output "api_gateway_endpoint" {
  description = "API Gateway base URL"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "api_gateway_invoke_url" {
  description = "API Gateway invoke URL for prod stage"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "api_gateway_url" {
  description = "API Gateway URL (alias for invoke_url)"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "api_endpoints" {
  description = "Available API endpoints"
  value = {
    config_get     = "${aws_api_gateway_stage.prod.invoke_url}/config"
    theme_get      = "${aws_api_gateway_stage.prod.invoke_url}/theme"
    theme_put      = "${aws_api_gateway_stage.prod.invoke_url}/theme"
    tiers_get      = "${aws_api_gateway_stage.prod.invoke_url}/tiers"
    tiers_post     = "${aws_api_gateway_stage.prod.invoke_url}/tiers"
    tier_delete    = "${aws_api_gateway_stage.prod.invoke_url}/tiers/{tierId}"
    companies_get  = "${aws_api_gateway_stage.prod.invoke_url}/companies"
    companies_post = "${aws_api_gateway_stage.prod.invoke_url}/companies"
    company_delete = "${aws_api_gateway_stage.prod.invoke_url}/companies/{companyId}"
    domain_get     = "${aws_api_gateway_stage.prod.invoke_url}/domain/{domain}"
  }
}
