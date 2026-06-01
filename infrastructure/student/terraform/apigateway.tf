# HTTP API (same as Serverless Framework HTTP API)
resource "aws_apigatewayv2_api" "main" {
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
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

# Integrations (one per Lambda)
resource "aws_apigatewayv2_integration" "check_profile_exists" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.check_profile_exists.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "profiles_crud" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.profiles_crud.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_upload_url" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.resumes_upload_url.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_complete" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.resumes_complete.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_list" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.resumes_list.invoke_arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_integration" "resumes_download_url" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.resumes_download_url.invoke_arn
  payload_format_version = "1.0"
}

# Lambda permissions for API Gateway
resource "aws_lambda_permission" "check_profile_exists" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.check_profile_exists.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "profiles_crud" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.profiles_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_upload_url" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_complete" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_complete.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_list" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "resumes_download_url" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resumes_download_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Routes
resource "aws_apigatewayv2_route" "get_profile_exists" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/users/me/profile-exists"
  target    = "integrations/${aws_apigatewayv2_integration.check_profile_exists.id}"
}

resource "aws_apigatewayv2_route" "get_profiles" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/profiles"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "post_profiles" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/profiles"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "get_profiles_me" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "put_profiles_me" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_profiles_me" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/profiles/me"
  target    = "integrations/${aws_apigatewayv2_integration.profiles_crud.id}"
}

resource "aws_apigatewayv2_route" "post_resumes_upload_url" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/resumes/upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_upload_url.id}"
}

resource "aws_apigatewayv2_route" "post_resumes_complete" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/resumes/complete"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_complete.id}"
}

resource "aws_apigatewayv2_route" "get_resumes_me" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/resumes/me"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_list.id}"
}

resource "aws_apigatewayv2_route" "get_resumes_download" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/resumes/{resumeId}/download-url"
  target    = "integrations/${aws_apigatewayv2_integration.resumes_download_url.id}"
}
