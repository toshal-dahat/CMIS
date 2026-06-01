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
  description = "Embeddings provider for external-service: bedrock-titan (default), bedrock-cohere, or openai."
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

variable "openai_api_key" {
  description = "OpenAI API key for mentorship embeddings."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key_ssm_parameter_name" {
  description = "When openai_api_key is empty, load the key from this SSM Parameter Store name (SecureString). IAM running Terraform needs ssm:GetParameter."
  type        = string
  default     = ""
}

variable "openai_embedding_model" {
  description = "OpenAI embeddings model for mentorship matching."
  type        = string
  default     = "text-embedding-3-large"
}
