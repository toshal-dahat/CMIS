# ============================================================================
# IAM Role - Use Shared Lambda Role
# ============================================================================
# The Lambda role is created in the main infrastructure and passed to this
# module via the lambda_role_arn variable. This ensures all Lambda functions
# across the infrastructure use the same role with consistent permissions.
# ============================================================================

# No data source needed - we use the ARN passed from the parent module
