# ============================================================================
# API Gateway REST API (v1)
# ============================================================================

resource "aws_api_gateway_rest_api" "cmis_admin_api" {
  name        = var.api_name
  description = "CMIS Admin REST API for Lambda integrations"

  # Requirement 1: REST protocol (v1) — enforced by using aws_api_gateway_rest_api
  # Requirement 2: TLS 1.0 security policy (applied on custom domain; REGIONAL endpoint)
  # Requirement 3: API status available — ensured via deployment + stage below
  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = {
    Name      = var.api_name
    ManagedBy = "Terraform"
  }
}

# ============================================================================
# API Gateway Resources (URL paths)
# ============================================================================

resource "aws_api_gateway_resource" "config" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_rest_api.cmis_admin_api.root_resource_id
  path_part   = "config"
}

resource "aws_api_gateway_resource" "theme" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_rest_api.cmis_admin_api.root_resource_id
  path_part   = "theme"
}

resource "aws_api_gateway_resource" "tiers" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_rest_api.cmis_admin_api.root_resource_id
  path_part   = "tiers"
}

resource "aws_api_gateway_resource" "tier_id" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_resource.tiers.id
  path_part   = "{tierId}"
}

resource "aws_api_gateway_resource" "companies" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_rest_api.cmis_admin_api.root_resource_id
  path_part   = "companies"
}

resource "aws_api_gateway_resource" "company_id" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_resource.companies.id
  path_part   = "{companyId}"
}

resource "aws_api_gateway_resource" "domain" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_rest_api.cmis_admin_api.root_resource_id
  path_part   = "domain"
}

resource "aws_api_gateway_resource" "domain_value" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  parent_id   = aws_api_gateway_resource.domain.id
  path_part   = "{domain}"
}

# ============================================================================
# Methods & Integrations - /config GET
# ============================================================================

resource "aws_api_gateway_method" "config_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.config.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "config_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.config.id
  http_method             = aws_api_gateway_method.config_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.config_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /theme GET, PUT
# ============================================================================

resource "aws_api_gateway_method" "theme_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.theme.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "theme_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.theme.id
  http_method             = aws_api_gateway_method.theme_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.theme_api.invoke_arn
}

resource "aws_api_gateway_method" "theme_put" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.theme.id
  http_method   = "PUT"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "theme_put" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.theme.id
  http_method             = aws_api_gateway_method.theme_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.theme_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /tiers GET, POST
# ============================================================================

resource "aws_api_gateway_method" "tiers_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tiers.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tiers_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.tiers.id
  http_method             = aws_api_gateway_method.tiers_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.tier_api.invoke_arn
}

resource "aws_api_gateway_method" "tiers_post" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tiers.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tiers_post" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.tiers.id
  http_method             = aws_api_gateway_method.tiers_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.tier_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /tiers/{tierId} PUT, DELETE
# ============================================================================

resource "aws_api_gateway_method" "tier_put" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tier_id.id
  http_method   = "PUT"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tier_put" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.tier_id.id
  http_method             = aws_api_gateway_method.tier_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.tier_api.invoke_arn
}

resource "aws_api_gateway_method" "tier_delete" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tier_id.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "tier_delete" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.tier_id.id
  http_method             = aws_api_gateway_method.tier_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.tier_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /companies GET, POST
# ============================================================================

resource "aws_api_gateway_method" "companies_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.companies.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "companies_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.companies.id
  http_method             = aws_api_gateway_method.companies_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

resource "aws_api_gateway_method" "companies_post" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.companies.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "companies_post" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.companies.id
  http_method             = aws_api_gateway_method.companies_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /companies/{companyId} GET, PUT, DELETE
# ============================================================================

resource "aws_api_gateway_method" "company_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.company_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "company_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.company_id.id
  http_method             = aws_api_gateway_method.company_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

resource "aws_api_gateway_method" "company_put" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.company_id.id
  http_method   = "PUT"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "company_put" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.company_id.id
  http_method             = aws_api_gateway_method.company_put.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

resource "aws_api_gateway_method" "company_delete" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.company_id.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "company_delete" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.company_id.id
  http_method             = aws_api_gateway_method.company_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

# ============================================================================
# Methods & Integrations - /domain/{domain} GET
# ============================================================================

resource "aws_api_gateway_method" "domain_get" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.domain_value.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "domain_get" {
  rest_api_id             = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id             = aws_api_gateway_resource.domain_value.id
  http_method             = aws_api_gateway_method.domain_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.company_api.invoke_arn
}

# ============================================================================
# CORS - OPTIONS method for every resource
# Each resource needs: OPTIONS method + MOCK integration +
# method response + integration response with CORS headers
# ============================================================================

# /config OPTIONS
resource "aws_api_gateway_method" "config_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.config.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "config_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.config.id
  http_method       = aws_api_gateway_method.config_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "config_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.config.id
  http_method = aws_api_gateway_method.config_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "config_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.config.id
  http_method = aws_api_gateway_method.config_options.http_method
  status_code = aws_api_gateway_method_response.config_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.config_options]
}

# /theme OPTIONS
resource "aws_api_gateway_method" "theme_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.theme.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "theme_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.theme.id
  http_method       = aws_api_gateway_method.theme_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "theme_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.theme.id
  http_method = aws_api_gateway_method.theme_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "theme_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.theme.id
  http_method = aws_api_gateway_method.theme_options.http_method
  status_code = aws_api_gateway_method_response.theme_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.theme_options]
}

# /tiers OPTIONS
resource "aws_api_gateway_method" "tiers_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tiers.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "tiers_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.tiers.id
  http_method       = aws_api_gateway_method.tiers_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "tiers_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.tiers.id
  http_method = aws_api_gateway_method.tiers_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "tiers_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.tiers.id
  http_method = aws_api_gateway_method.tiers_options.http_method
  status_code = aws_api_gateway_method_response.tiers_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.tiers_options]
}

# /tiers/{tierId} OPTIONS
resource "aws_api_gateway_method" "tier_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.tier_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "tier_id_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.tier_id.id
  http_method       = aws_api_gateway_method.tier_id_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "tier_id_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.tier_id.id
  http_method = aws_api_gateway_method.tier_id_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "tier_id_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.tier_id.id
  http_method = aws_api_gateway_method.tier_id_options.http_method
  status_code = aws_api_gateway_method_response.tier_id_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.tier_id_options]
}

# /companies OPTIONS
resource "aws_api_gateway_method" "companies_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.companies.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "companies_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.companies.id
  http_method       = aws_api_gateway_method.companies_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "companies_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.companies.id
  http_method = aws_api_gateway_method.companies_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "companies_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.companies.id
  http_method = aws_api_gateway_method.companies_options.http_method
  status_code = aws_api_gateway_method_response.companies_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.companies_options]
}

# /companies/{companyId} OPTIONS
resource "aws_api_gateway_method" "company_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.company_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "company_id_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.company_id.id
  http_method       = aws_api_gateway_method.company_id_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "company_id_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.company_id.id
  http_method = aws_api_gateway_method.company_id_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "company_id_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.company_id.id
  http_method = aws_api_gateway_method.company_id_options.http_method
  status_code = aws_api_gateway_method_response.company_id_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.company_id_options]
}

# /domain/{domain} OPTIONS
resource "aws_api_gateway_method" "domain_options" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id   = aws_api_gateway_resource.domain_value.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "domain_options" {
  rest_api_id       = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id       = aws_api_gateway_resource.domain_value.id
  http_method       = aws_api_gateway_method.domain_options.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}
resource "aws_api_gateway_method_response" "domain_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.domain_value.id
  http_method = aws_api_gateway_method.domain_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}
resource "aws_api_gateway_integration_response" "domain_options" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  resource_id = aws_api_gateway_resource.domain_value.id
  http_method = aws_api_gateway_method.domain_options.http_method
  status_code = aws_api_gateway_method_response.domain_options.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.domain_options]
}

# ============================================================================
# Gateway Responses - CORS headers on Default 4XX and 5XX
# ============================================================================

resource "aws_api_gateway_gateway_response" "default_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "default_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
  }
}

# ============================================================================
# Lambda Permissions (Resource-Based Policies)
# ============================================================================

resource "aws_lambda_permission" "config_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway-Config"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.config_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cmis_admin_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "theme_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway-Theme"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.theme_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cmis_admin_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "tier_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway-Tier"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tier_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cmis_admin_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "company_api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway-Company"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.company_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.cmis_admin_api.execution_arn}/*/*"
}

# ============================================================================
# API Gateway Deployment & Stage
# ============================================================================

resource "aws_api_gateway_deployment" "cmis_admin_api" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id

  # Only redeploy when an integration actually changes
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.config_get,
      aws_api_gateway_integration.theme_get,
      aws_api_gateway_integration.theme_put,
      aws_api_gateway_integration.tiers_get,
      aws_api_gateway_integration.tiers_post,
      aws_api_gateway_integration.tier_put,
      aws_api_gateway_integration.tier_delete,
      aws_api_gateway_integration.companies_get,
      aws_api_gateway_integration.companies_post,
      aws_api_gateway_integration.company_get,
      aws_api_gateway_integration.company_put,
      aws_api_gateway_integration.company_delete,
      aws_api_gateway_integration.domain_get,
      aws_api_gateway_integration_response.config_options,
      aws_api_gateway_integration_response.theme_options,
      aws_api_gateway_integration_response.tiers_options,
      aws_api_gateway_integration_response.tier_id_options,
      aws_api_gateway_integration_response.companies_options,
      aws_api_gateway_integration_response.company_id_options,
      aws_api_gateway_integration_response.domain_options,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  rest_api_id   = aws_api_gateway_rest_api.cmis_admin_api.id
  deployment_id = aws_api_gateway_deployment.cmis_admin_api.id
  stage_name    = var.stage_name

  # Requirement 4: Enable caching on /config GET resource
  cache_cluster_enabled = true
  cache_cluster_size    = "0.5"  # Smallest available cache size (GB)

  tags = {
    Name        = "${var.api_name}-${var.stage_name}"
    Environment = var.stage_name
    ManagedBy   = "Terraform"
  }
}

# Requirement 4: Cache settings scoped to /config GET method
resource "aws_api_gateway_method_settings" "config_cache" {
  rest_api_id = aws_api_gateway_rest_api.cmis_admin_api.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "${aws_api_gateway_resource.config.path_part}/GET"

  settings {
    caching_enabled      = true
    cache_ttl_in_seconds = 300
    cache_data_encrypted = false
  }
}


