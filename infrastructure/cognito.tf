locals {
  cognito_callback_urls = distinct(compact(concat(
    ["https://${aws_cloudfront_distribution.frontend.domain_name}/"],
    var.enable_localhost_auth_callback ? ["http://localhost:5173/"] : [],
    var.additional_cognito_callback_urls
  )))

  cognito_logout_urls = distinct(compact(concat(
    ["https://${aws_cloudfront_distribution.frontend.domain_name}/"],
    var.enable_localhost_auth_callback ? ["http://localhost:5173/"] : [],
    var.additional_cognito_logout_urls
  )))

  cognito_supported_identity_providers = var.enable_google_sso ? ["COGNITO", "Google"] : ["COGNITO"]
}

resource "aws_cognito_user_pool" "cmis" {
  name = "${var.project_name}-user-pool-${var.environment}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Enables Cognito choice-based auth with Email OTP as first factor.
  sign_in_policy {
    allowed_first_auth_factors = ["EMAIL_OTP", "PASSWORD"]
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  username_configuration {
    case_sensitive = false
  }
}

resource "aws_cognito_user_pool_client" "cmis_spa" {
  name         = "${var.project_name}-spa-${var.environment}"
  user_pool_id = aws_cognito_user_pool.cmis.id

  generate_secret = false

  # Needed for modern OTP/auth step selection in Amplify.
  explicit_auth_flows = [
    "ALLOW_USER_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = local.cognito_callback_urls
  logout_urls                          = local.cognito_logout_urls
  supported_identity_providers         = local.cognito_supported_identity_providers
  depends_on                           = [aws_cognito_identity_provider.google]

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30
}

resource "aws_cognito_identity_provider" "google" {
  count = var.enable_google_sso ? 1 : 0

  user_pool_id  = aws_cognito_user_pool.cmis.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_oauth_client_id
    client_secret    = var.google_oauth_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

resource "aws_cognito_user_pool_domain" "cmis" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.cmis.id
}

resource "aws_cognito_user_group" "students" {
  user_pool_id = aws_cognito_user_pool.cmis.id
  name         = "students"
  description  = "TAMU student users"
  precedence   = 10
}

resource "aws_cognito_user_group" "investors" {
  user_pool_id = aws_cognito_user_pool.cmis.id
  name         = "investors"
  description  = "Users with known company domains"
  precedence   = 20
}

resource "aws_cognito_user_group" "friends" {
  user_pool_id = aws_cognito_user_pool.cmis.id
  name         = "friends"
  description  = "All other non-TAMU users"
  precedence   = 30
}

resource "aws_cognito_user_group" "admins" {
  user_pool_id = aws_cognito_user_pool.cmis.id
  name         = "admins"
  description  = "Administrative users"
  precedence   = 5
}
