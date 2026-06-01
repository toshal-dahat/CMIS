# API Gateway HTTP API
resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["*"]
    max_age       = 300
  }
}

# API Gateway Stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  # Logging disabled due to IAM restrictions
  # Uncomment below if CloudWatch Logs permissions are added
  # access_log_settings {
  #   destination_arn = aws_cloudwatch_log_group.api_gateway.arn
  #   format = jsonencode({
  #     requestId      = "$context.requestId"
  #     ip             = "$context.identity.sourceIp"
  #     requestTime    = "$context.requestTime"
  #     httpMethod     = "$context.httpMethod"
  #     routeKey       = "$context.routeKey"
  #     status         = "$context.status"
  #     protocol       = "$context.protocol"
  #     responseLength = "$context.responseLength"
  #   })
  # }
}

# CloudWatch Log Group for API Gateway
# Commented out due to IAM restrictions
# resource "aws_cloudwatch_log_group" "api_gateway" {
#   name              = "/aws/apigateway/${var.project_name}-${var.environment}"
#   retention_in_days = 7
# }

# Lambda Permissions for API Gateway
resource "aws_lambda_permission" "student_service" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.student_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_service" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "external_service" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.external_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "event_service" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.event_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Student Service Integration
resource "aws_apigatewayv2_integration" "student_service" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.student_service.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "student_service" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /student/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.student_service.id}"
}

resource "aws_apigatewayv2_route" "student_service_root" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /student"
  target    = "integrations/${aws_apigatewayv2_integration.student_service.id}"
}

# Admin Service Integration
resource "aws_apigatewayv2_integration" "admin_service" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin_service.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin_service" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /admin/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.admin_service.id}"
}

resource "aws_apigatewayv2_route" "admin_service_root" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /admin"
  target    = "integrations/${aws_apigatewayv2_integration.admin_service.id}"
}

# External Service Integration
resource "aws_apigatewayv2_integration" "external_service" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.external_service.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "external_service" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /external/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.external_service.id}"
}

resource "aws_apigatewayv2_route" "external_service_root" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /external"
  target    = "integrations/${aws_apigatewayv2_integration.external_service.id}"
}

# Event Service Integration
resource "aws_apigatewayv2_integration" "event_service" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.event_service.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "event_service" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /event/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.event_service.id}"
}

resource "aws_apigatewayv2_route" "event_service_root" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /event"
  target    = "integrations/${aws_apigatewayv2_integration.event_service.id}"
}
