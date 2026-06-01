# Terraform moved blocks to handle resource renaming
# This tells Terraform that resources were renamed, not deleted and recreated

# Lambda Functions
moved {
  from = aws_lambda_function.company_service
  to   = aws_lambda_function.external_service
}

moved {
  from = aws_lambda_function.config_service
  to   = aws_lambda_function.event_service
}

# Lambda Permissions
moved {
  from = aws_lambda_permission.company_service
  to   = aws_lambda_permission.external_service
}

moved {
  from = aws_lambda_permission.config_service
  to   = aws_lambda_permission.event_service
}

# API Gateway Integrations
moved {
  from = aws_apigatewayv2_integration.company_service
  to   = aws_apigatewayv2_integration.external_service
}

moved {
  from = aws_apigatewayv2_integration.config_service
  to   = aws_apigatewayv2_integration.event_service
}

# API Gateway Routes
moved {
  from = aws_apigatewayv2_route.company_service
  to   = aws_apigatewayv2_route.external_service
}

moved {
  from = aws_apigatewayv2_route.company_service_root
  to   = aws_apigatewayv2_route.external_service_root
}

moved {
  from = aws_apigatewayv2_route.config_service
  to   = aws_apigatewayv2_route.event_service
}

moved {
  from = aws_apigatewayv2_route.config_service_root
  to   = aws_apigatewayv2_route.event_service_root
}

