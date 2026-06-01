# IAM is managed externally for events-core Lambdas.
# This module now expects an existing role ARN to be passed in
# via the `lambda_role_arn` variable and does not create or
# manage any IAM roles or policies itself.
