# ============================================================================
# Terraform & Provider Configuration
# ============================================================================

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ============================================================================
# Variables
# ============================================================================

variable "region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "lambda_role_arn" {
  description = "ARN of the IAM role for Lambda execution"
  type        = string
}

variable "table_name" {
  description = "DynamoDB table name"
  type        = string
  default     = "cmis-admin-table"
}

variable "api_name" {
  description = "API Gateway name"
  type        = string
  default     = "cmis-admin-api"
}

variable "stage_name" {
  description = "API Gateway stage name"
  type        = string
  default     = "prod"
}
