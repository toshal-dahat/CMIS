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

variable "student_service_path" {
  description = "Path to student-service source (relative to infrastructure/terraform/ or absolute)"
  type        = string
  default     = "../../services/student-service"
}

variable "lambda_role_arn" {
  description = "ARN of an existing IAM role for student-core Lambda functions"
  type        = string
}
