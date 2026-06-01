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

variable "ses_verified_sender" {
  description = "Verified SES sender email for survey and notification emails (leave empty to disable sending)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "frontend_url" {
  description = "Frontend base URL used for constructing survey email links"
  type        = string
  default     = ""
}

variable "student_profiles_table_name" {
  description = "StudentProfiles DynamoDB table name from student-core module"
  type        = string
}

variable "reminder_rule_prefix" {
  description = "Prefix for dynamic EventBridge reminder rules"
  type        = string
  default     = "events-core-reminder"
}

variable "reminder_notification_mode" {
  description = "Reminder delivery channel for EventBridge reminders: email (default) or sms"
  type        = string
  default     = "email"
  validation {
    condition     = contains(["email", "sms"], lower(var.reminder_notification_mode))
    error_message = "reminder_notification_mode must be either 'email' or 'sms'."
  }
}
