# -----------------------------------------------------------------------------
# SES - Magic link sender identity (optional)
# When ses_verified_sender is set, Terraform creates the identity; AWS sends
# a verification email to that address. After you verify, Lambda can send from it.
# -----------------------------------------------------------------------------
resource "aws_ses_email_identity" "magic_link_sender" {
  count  = var.ses_verified_sender != "" ? 1 : 0
  email  = var.ses_verified_sender
}
