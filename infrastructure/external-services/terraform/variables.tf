variable "admin_user_ids" {
  description = "Cognito user IDs (sub) allowed to access admin endpoints (e.g. GET /graduation-handover/history). Comma-separated."
  type        = string
  default     = ""
}

variable "ses_verified_sender" {
  description = "SES verified sender email for magic-link notifications. Leave empty to log links to CloudWatch."
  type        = string
  default     = ""
  sensitive   = true
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for resource names"
  type        = string
  default     = "cmis-external"
}

variable "company_list_api_url" {
  description = "Team Howdy Company List API base URL (optional; stub if not available)"
  type        = string
  default     = ""
}

variable "student_profiles_table_name" {
  description = "StudentProfiles DynamoDB table name (owned by student-core). Used to update role to FORMER_STUDENT on handover."
  type        = string
}

variable "resumes_table_name" {
  description = "Resumes DynamoDB table name (owned by student-service). Used to enrich mentorship matching with extracted resume data."
  type        = string
  default     = ""
}

variable "resumes_bucket_name" {
  description = "S3 bucket for student resumes (same as student-service RESUMES_BUCKET). Used to presign mentor resume downloads. Leave empty to omit presigned URLs."
  type        = string
  default     = ""
}

variable "mentorship_embeddings_provider" {
  description = "Embeddings provider: bedrock-titan | bedrock-cohere | openai"
  type        = string
  default     = "bedrock-titan"
}

variable "student_resumes_me_url" {
  description = "GET URL for student resumes/me (parsed resume JSON). Must match deployed student API."
  type        = string
}

variable "bedrock_embedding_model" {
  description = "Bedrock foundation model id for embeddings (Titan v2 or Cohere English v3)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "bedrock_embedding_dimensions" {
  description = "Titan v2 embedding dimensions: 256, 512, or 1024."
  type        = string
  default     = "1024"
}

variable "bedrock_llm_model" {
  description = "Bedrock model id for mentorship narration (Nova Lite Converse)."
  type        = string
  default     = "amazon.nova-lite-v1:0"
}

variable "openai_api_key" {
  description = "OpenAI API key used when mentorship_embeddings_provider is openai."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_embedding_model" {
  description = "OpenAI embeddings model for mentorship matching."
  type        = string
  default     = "text-embedding-3-large"
}

variable "cmis_user_pool_id" {
  description = "CMIS Cognito user pool id (main app pool). Used to change login email on graduation handover so the same userId/sub is preserved."
  type        = string
}

variable "cmis_user_pool_arn" {
  description = "CMIS Cognito user pool ARN (main app pool). Used for IAM scoping on admin_update_user_attributes."
  type        = string
}

variable "frontend_base_url" {
  description = "Frontend base URL for magic-link claim (e.g. https://app.example.com or http://localhost:5173). Set to CloudFront URL or custom domain after hosting."
  type        = string
  default     = "http://localhost:5173"
}

# --- Frontend hosting (off by default; turn on when project is ready) ---
variable "enable_frontend_hosting" {
  description = "Set to true to create S3 + CloudFront (and optional custom domain) for hosting the frontend. Off by default until the project is ready."
  type        = bool
  default     = false
}

variable "frontend_domain" {
  description = "Custom domain for the frontend (e.g. app.teamgigem.com). Only used when enable_frontend_hosting is true. Leave empty to use CloudFront URL only."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for frontend_domain (to create A record). Leave empty if you manage DNS elsewhere."
  type        = string
  default     = ""
}

variable "cors_allow_origins" {
  description = "CORS allowed origins for API (e.g. frontend URL)"
  type        = list(string)
  default     = ["*"]
}

variable "tags" {
  description = "Tags for all resources"
  type        = map(string)
  default     = {}
}

variable "enable_mentorship_annual_eventbridge" {
  description = <<-EOT
    When true, creates the Sept 1 EventBridge rule + Lambda target + permission for the annual mentorship batch.
    Requires IAM on the Terraform principal: events:PutRule, events:PutTargets, events:DescribeRule, lambda:AddPermission (and delete/remove on destroy).
    Set false if your deploy user lacks EventBridge permissions (batch can still be invoked manually with the cmis.mentorship.batch payload).
  EOT
  type        = bool
  default     = false
}
