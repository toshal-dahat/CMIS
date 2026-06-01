variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
  default     = "dev"
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID for JWT verification"
  type        = string
  default     = ""
}

variable "cognito_client_id" {
  description = "Cognito App Client ID"
  type        = string
  default     = ""
}

variable "enable_cloudfront" {
  description = "Create CloudFront distribution in front of API Gateway"
  type        = bool
  default     = false
}

variable "lambda_node_runtime" {
  description = "Node.js runtime for Lambda"
  type        = string
  default     = "nodejs20.x"
}

variable "events_service_path" {
  default = "../../services/event-service"
}

variable "lambda_role_arn" {
  description = "ARN of an existing IAM role for events-core Lambda functions"
  type        = string
}

variable "domain_api_url" {
  description = "API endpoint for company domain lookup"
  type        = string
}

variable "config_api_url" {
  description = "API endpoint for config/tiers data"
  type        = string
}

variable "student_profiles_table_name" {
  description = "StudentProfiles table name for SMS preference lookups"
  type        = string
}
