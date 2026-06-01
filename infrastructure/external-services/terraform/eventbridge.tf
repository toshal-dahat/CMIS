# Mentorship scheduler resources are intentionally disabled in Terraform for now.
# Reason: CI deploy principal lacks EventBridge read/tag permissions and cannot
# safely refresh these resources.
#
# Temporary cleanup is handled from root with:
# `infrastructure/eventbridge_scheduler_temporarily_unmanaged.tf`
#
# Re-enable later by restoring the EventBridge rule/target/permission resources
# in this file and removing the temporary root `removed` blocks after IAM is fixed.
