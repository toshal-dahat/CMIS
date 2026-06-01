# ============================================================================
# IAM Role - Use Existing LabRole
# ============================================================================
# The LabRole is a pre-existing IAM role provisioned by AWS Learner Lab.
# It is referenced by all Lambda functions for execution permissions.
# We use a data source (not a resource) since we do not manage this role —
# it already exists in the account and cannot be created or destroyed here.
# ============================================================================

data "aws_iam_role" "lab_role" {
  name = "LabRole"
}
