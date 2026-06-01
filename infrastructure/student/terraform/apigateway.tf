# Purpose: Define Student Service HTTP API resources and route wiring.
# Logic: Reuse a shared API Gateway when IDs are provided; otherwise create a dedicated API.
# Edge cases: Shared API mode depends on externally supplied execution ARN for Lambda permissions.
# HTTP API (same as Serverless Framework HTTP API)
locals {
  use_shared_api_gateway = var.shared_api_gateway_id != ""
  api_gateway_id         = local.use_shared_api_gateway ? var.shared_api_gateway_id : aws_apigatewayv2_api.main[0].id
  api_execution_arn      = local.use_shared_api_gateway ? var.shared_api_gateway_execution_arn : aws_apigatewayv2_api.main[0].execution_arn
}

resource "aws_apigatewayv2_api" "main" {
  count         = local.use_shared_api_gateway ? 0 : 1
  name          = "student-core-${var.stage}"
  protocol_type = "HTTP"
  description   = "Team Reveille Student Core API"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  count  = local.use_shared_api_gateway ? 0 : 1
  api_id = aws_apigatewayv2_api.main[0].id
  # Use an explicit stage name (e.g. dev, staging, prod) instead of $default
  # so the invoke URL includes /{stage} like the main API.
  name        = var.stage
  auto_deploy = true
}

# Purpose: Bind each logical API surface area to its owning Lambda function.
# Logic: Use AWS_PROXY integrations so Lambda receives the full request context.
# Edge cases: payload_format_version remains 1.0 to match existing handler event parsing.
# Integrations (one per Lambda)
resource "aws_apigatewayv2_integration" "check_profile_exists" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.check_profile_exists.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "profiles_crud" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.profiles_crud.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_upload_url" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resumes_upload_url.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_complete" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resumes_complete.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_list" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resumes_list.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_download_url" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resumes_download_url.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_extracted_data" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resumes_extracted_data.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "skills_list" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.skills_list.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "event_qr_generate" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.event_qr_generate.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "event_qr_checkin" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.event_qr_checkin.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "event_qr_scanner_page" {
  api_id                 = local.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.event_qr_scanner_page.invoke_arn
  payload_format_version = "1.0"
}

# Purpose: Grant API Gateway permission to invoke each Lambda integration target.
# Logic: source_arn scopes invocation to this API execution ARN across methods/routes.
# Edge cases: Missing permission causes runtime 500/403 from API Gateway even if routes exist.
# Lambda permissions for API Gateway
resource "aws_lambda_permission" "check_profile_exists" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.check_profile_exists.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "profiles_crud" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.profiles_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_upload_url" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_complete" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_complete.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_list" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_download_url" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_download_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_extracted_data" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_extracted_data.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "skills_list" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.skills_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "event_qr_generate" {
  statement_id  = "AllowAPIGatewayInvokeEventQrGenerate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.event_qr_generate.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "event_qr_checkin" {
  statement_id  = "AllowAPIGatewayInvokeEventQrCheckin"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.event_qr_checkin.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "event_qr_scanner_page" {
  statement_id  = "AllowAPIGatewayInvokeEventQrScannerPage"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.event_qr_scanner_page.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

# Purpose: Map concrete HTTP method/path combinations to integrations.
# Logic: Route keys stay under /student to align with service basePath and frontend expectations.
# Edge cases: Unmapped method/path combinations return API Gateway 404 without invoking Lambda.
# Routes
resource "aws_apigatewayv2_route" "get_profile_exists" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/users/me/profile-exists"
  target    = "integrations/${aws_apigatewayv2_integration.check_profile_exists.id}"
}

resource "aws_apigatewayv2_route" "get_profiles" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/profiles"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "post_profiles" {
  api_id    = local.api_gateway_id
  route_key = "POST /student/api/profiles"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "get_profiles_me" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "put_profiles_me" {
  api_id    = local.api_gateway_id
  route_key = "PUT /student/api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "put_profiles_userid" {
  api_id    = local.api_gateway_id
  route_key = "PUT /student/api/profiles/{userId}"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_profiles_me" {
  api_id    = local.api_gateway_id
  route_key = "DELETE /student/api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "post_resumes_upload_url" {
  api_id    = local.api_gateway_id
  route_key = "POST /student/api/resumes/upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_upload_url.id}"
}

resource "aws_apigatewayv2_route" "post_resumes_complete" {
  api_id    = local.api_gateway_id
  route_key = "POST /student/api/resumes/complete"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_complete.id}"
}

resource "aws_apigatewayv2_route" "get_resumes_me" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/resumes/me"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_list.id}"
}

resource "aws_apigatewayv2_route" "get_resumes_download" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/resumes/{resumeId}/download-url"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_download_url.id}"
}

resource "aws_apigatewayv2_route" "get_resumes_extracted_data" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/resumes/{resumeId}/extracted-data"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_extracted_data.id}"
}

resource "aws_apigatewayv2_route" "get_skills" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/skills"
  target    = "integrations/${aws_apigatewayv2_integration.skills_list.id}"
}

resource "aws_apigatewayv2_route" "get_event_qr" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/api/events/{eventId}/qr"
  target    = "integrations/${aws_apigatewayv2_integration.event_qr_generate.id}"
}

resource "aws_apigatewayv2_route" "post_event_checkin" {
  api_id    = local.api_gateway_id
  route_key = "POST /student/api/events/{eventId}/check-in"
  target    = "integrations/${aws_apigatewayv2_integration.event_qr_checkin.id}"
}

resource "aws_apigatewayv2_route" "post_event_self_checkin" {
  api_id    = local.api_gateway_id
  route_key = "POST /student/api/events/check-in/self"
  target    = "integrations/${aws_apigatewayv2_integration.event_qr_checkin.id}"
}

resource "aws_apigatewayv2_route" "get_qr_scanner_page" {
  api_id    = local.api_gateway_id
  route_key = "GET /student/qr-scanner"
  target    = "integrations/${aws_apigatewayv2_integration.event_qr_scanner_page.id}"
}

# Purpose: Handle explicit CORS preflight requests for wildcard student API paths.
# Logic: Route OPTIONS /student/api/{proxy+} to an existing integration to return CORS headers.
# Edge cases: Needed in shared API setups where default CORS handling may not cover all proxy paths.
# Explicit preflight route for shared student API paths.
resource "aws_apigatewayv2_route" "options_student_api_proxy" {
  api_id    = local.api_gateway_id
  route_key = "OPTIONS /student/api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

