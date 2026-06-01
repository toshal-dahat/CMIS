locals {
  cognito_sender_is_email_identity = trimspace(var.cognito_ses_identity_name) != "" && strcontains(trimspace(var.cognito_ses_identity_name), "@")
}

# Create SES email identity for Cognito sender when an email identity is provided.
# Verification still requires clicking the email verification link sent by SES.
resource "aws_ses_email_identity" "cognito_sender" {
  count = local.cognito_sender_is_email_identity ? 1 : 0

  email = trimspace(var.cognito_ses_identity_name)
}
