# Resolve OpenAI API key for external_core: explicit TF var (e.g. GitHub secret) or SSM SecureString.
data "aws_ssm_parameter" "openai_api_key" {
  count = trimspace(var.openai_api_key) == "" && trimspace(var.openai_api_key_ssm_parameter_name) != "" ? 1 : 0

  name            = var.openai_api_key_ssm_parameter_name
  with_decryption = true
}

locals {
  openai_api_key_effective = trimspace(var.openai_api_key) != "" ? trimspace(var.openai_api_key) : (
    length(data.aws_ssm_parameter.openai_api_key) > 0 ? data.aws_ssm_parameter.openai_api_key[0].value : ""
  )
}
