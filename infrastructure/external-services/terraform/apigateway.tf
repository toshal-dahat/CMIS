# API Gateway HTTP API for External Service
resource "aws_apigatewayv2_api" "external" {
  name          = "${var.project_name}-external-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_headers = ["content-type", "x-amz-date", "authorization", "x-api-key"]
    allow_methods = ["*"]
    allow_origins = ["*"]
  }
  tags = var.tags
}

resource "aws_apigatewayv2_integration" "external" {
  api_id                 = aws_apigatewayv2_api.external.id
  integration_type       = "AWS_PROXY"
  integration_uri         = aws_lambda_function.external_service.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "external_any" {
  api_id    = aws_apigatewayv2_api.external.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.external.id}"
}

resource "aws_apigatewayv2_route" "external_root" {
  api_id    = aws_apigatewayv2_api.external.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.external.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.external.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.external_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.external.execution_arn}/*/*"
}
