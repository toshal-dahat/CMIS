# Temporary CI unblock:
# The Terraform principal in CI currently lacks EventBridge read/tag permissions
# (events:ListTagsForResource), which causes plan/apply to fail while refreshing
# previously-created mentorship scheduler resources.
#
# We intentionally stop managing these resources in Terraform state for now
# without destroying live AWS resources. Re-enable later after IAM is fixed.

removed {
  from = module.external_core.aws_cloudwatch_event_rule.mentorship_annual_batch
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.external_core.aws_cloudwatch_event_target.mentorship_annual_batch
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.external_core.aws_lambda_permission.mentorship_annual_eventbridge
  lifecycle {
    destroy = false
  }
}
