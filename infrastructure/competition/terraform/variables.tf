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

variable "lambda_node_runtime" {
  description = "Node.js runtime for Lambda"
  type        = string
  default     = "nodejs20.x"
}

variable "competition_service_path" {
  description = "Path to competition-service source relative to this module"
  type        = string
  default     = "../../../services/competition-service"
}

variable "lambda_role_arn" {
  description = "ARN of the shared IAM role for Lambda functions"
  type        = string
}
