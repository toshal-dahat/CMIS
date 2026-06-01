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

variable "external_services_project_name" {
  description = "Terraform project_name for the external-services module (Lambda name = {this}-external-service). Must match student-service MENTORSHIP_EXTERNAL_LAMBDA_NAME."
  type        = string
  default     = "cmis-external"
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

variable "mentorship_embeddings_provider" {
  description = "Embeddings provider for external-service: bedrock-titan (default) or bedrock-cohere."
  type        = string
  default     = "bedrock-titan"
}

variable "bedrock_embedding_model" {
  description = "Bedrock model id for mentorship embeddings (Titan v2 or Cohere v3)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "bedrock_embedding_dimensions" {
  description = "Titan v2 output dimensions (256 | 512 | 1024)."
  type        = string
  default     = "1024"
}

variable "bedrock_llm_model" {
  description = "Bedrock model id for mentorship LLM narration (e.g. Nova Lite)."
  type        = string
  default     = "amazon.nova-lite-v1:0"
}

variable "enable_mentorship_annual_eventbridge" {
  description = "When true, external-core module creates the Sept 1 EventBridge rule for the mentorship annual batch. Requires events:PutRule / events:PutTargets (and related) on the Terraform IAM user or role."
  type        = bool
  default     = false
}

variable "enable_competition_feedback_scheduler" {
  description = "When true, competition-core creates the 1-minute EventBridge release checker for AI feedback synthesis."
  type        = bool
  default     = false
}
