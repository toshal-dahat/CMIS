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

variable "pptx_extractor_service_path" {
  description = "Path to the dedicated Python PPTX extractor Lambda source relative to this module"
  type        = string
  default     = "../../../services/pptx-extractor"
}

variable "pptx_extractor_requirements_path" {
  description = "Path to the Python requirements file for the PPTX extractor Lambda relative to this module"
  type        = string
  default     = "../../../services/competition-service/requirements-pptx.txt"
}

variable "enable_pptx_extractor_lambda" {
  description = "When true, creates the separate Python Lambda for PPTX extraction."
  type        = bool
  default     = true
}

variable "lambda_python_runtime" {
  description = "Python runtime for the PPTX extractor Lambda"
  type        = string
  default     = "python3.12"
}

variable "lambda_role_arn" {
  description = "ARN of the shared IAM role for Lambda functions"
  type        = string
}

variable "enable_competition_feedback_scheduler" {
  description = "When true, creates a 1-minute EventBridge rule that checks for due competition feedback releases."
  type        = bool
  default     = false
}
