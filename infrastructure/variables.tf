variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS Account ID (12-digit account number)"
  type        = string
  default     = ""
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "cmis"
}

variable "domain_name" {
  description = "Custom domain name for frontend (optional)"
  type        = string
  default     = ""
}

variable "enable_google_sso" {
  description = "Whether to configure Google as a Cognito federated IdP"
  type        = bool
  default     = true
}

variable "google_oauth_client_id" {
  description = "Google OAuth Client ID used by Cognito Google IdP"
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google OAuth Client Secret used by Cognito Google IdP"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cognito_domain_prefix" {
  description = "Unique Cognito hosted UI domain prefix"
  type        = string
  default     = "cmis-auth-dev"
}

variable "enable_localhost_auth_callback" {
  description = "Include localhost callback/logout URLs for local development"
  type        = bool
  default     = true
}

variable "additional_cognito_callback_urls" {
  description = "Additional callback URLs for Cognito app client"
  type        = list(string)
  default     = []
}

variable "additional_cognito_logout_urls" {
  description = "Additional logout URLs for Cognito app client"
  type        = list(string)
  default     = []
}

variable "enable_cognito_ses_email" {
  description = "Use Amazon SES (DEVELOPER mode) for Cognito email sending, including login OTP"
  type        = bool
  default     = false
}

variable "cognito_ses_source_arn" {
  description = "Optional explicit SES identity ARN (email/domain identity) used by Cognito; if empty, ARN is derived from cognito_ses_identity_name"
  type        = string
  default     = ""
}

variable "cognito_ses_identity_name" {
  description = "SES identity name (domain or sender email) used to auto-derive source ARN when cognito_ses_source_arn is empty"
  type        = string
  default     = ""
}

variable "cognito_from_email_address" {
  description = "From address for Cognito emails when using SES (for example: no-reply@example.com)"
  type        = string
  default     = ""
}

variable "cognito_reply_to_email_address" {
  description = "Optional reply-to address for Cognito emails when using SES"
  type        = string
  default     = ""
}

# Deprecated/ignored (kept for compatibility with existing tfvars files).
variable "cognito_user_pool_id" {
  description = "Deprecated: Cognito user pool is now managed by Terraform in this stack"
  type        = string
  default     = ""
}

variable "cognito_client_id" {
  description = "Deprecated: Cognito app client is now managed by Terraform in this stack"
  type        = string
  default     = ""
}

variable "cognito_admin_role_arn" {
  description = "Optional cross-account role ARN that student-core assumes for Cognito Admin APIs"
  type        = string
  default     = ""
}

variable "cognito_admin_external_id" {
  description = "Optional external ID for cross-account role assumption"
  type        = string
  default     = ""
}

variable "admin_override_email" {
  description = "Optional comma-separated email list forced into Cognito admins group in student-service"
  type        = string
  default     = ""
}
