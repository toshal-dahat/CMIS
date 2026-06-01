# HTTP API (same as Serverless Framework HTTP API)
resource "aws_apigatewayv2_api" "main" {
  name          = "events-core-${var.stage}"
  protocol_type = "HTTP"
  description   = "Team Reveille Events Core API"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.main.id
  # Use an explicit stage name (e.g. dev, staging, prod) instead of $default
  # so the invoke URL includes /{stage} like the main API.
  name        = var.stage
  auto_deploy = true
}

# Integrations (one per Lambda)
resource "aws_apigatewayv2_integration" "events_crud" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.events_crud.invoke_arn
  payload_format_version = "2.0"
}

# Lambda permissions for API Gateway
resource "aws_lambda_permission" "events_crud" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.events_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Routes
resource "aws_apigatewayv2_route" "get_events" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "get_events_health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events/health"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "post_events" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/events"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "put_events" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/events/{eventId}"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_events" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/events/{eventId}"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Single event detail
resource "aws_apigatewayv2_route" "get_event_detail" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events/{eventId}"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# RSVP routes
resource "aws_apigatewayv2_route" "post_rsvp" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/events/{eventId}/rsvp"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_rsvp" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/events/{eventId}/rsvp"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "get_rsvps" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events/{eventId}/rsvp"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "get_user_rsvps" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events/user/rsvps"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Calendar routes
resource "aws_apigatewayv2_route" "get_event_calendar" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/events/{eventId}/ical"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "get_user_calendar" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/users/{userId}/ical"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Survey routes (admin template management)
resource "aws_apigatewayv2_route" "get_survey_template" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/surveys/{eventId}"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "put_survey_template" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/surveys/{eventId}"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Survey routes (public — accessed via emailed link)
resource "aws_apigatewayv2_route" "get_survey_form" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/surveys/{eventId}/respond"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

resource "aws_apigatewayv2_route" "post_survey_response" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/surveys/{eventId}/respond"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Analytics route (admin)
resource "aws_apigatewayv2_route" "get_event_success_analytics" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/analytics/event-success"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Send survey emails to attendees (admin)
resource "aws_apigatewayv2_route" "post_send_survey" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/events/{eventId}/send-survey"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}

# Test-only override: trigger reminder emails immediately (admin)
resource "aws_apigatewayv2_route" "post_send_reminder_test" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/events/{eventId}/send-reminder-test"
  target    = "integrations/${aws_apigatewayv2_integration.events_crud.id}"
}
