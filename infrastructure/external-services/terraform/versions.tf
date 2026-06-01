# Terraform and provider versions
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM for CloudFront must be in us-east-1 (only used when frontend_domain is set)
provider "aws" {
  alias  = "acm"
  region = "us-east-1"
}
