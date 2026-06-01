# CloudFront Distribution: Optional edge caching layer for the API.
# Enabled via the 'enable_cloudfront' variable.
resource "aws_cloudfront_distribution" "api" {
  count = var.enable_cloudfront ? 1 : 0

  enabled         = true
  is_ipv6_enabled = true
  comment         = "Events Core API - ${var.stage}"

  origin {
    # Point to the API Gateway regional endpoint.
    domain_name = "${aws_apigatewayv2_api.main.id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_id   = "apigw-events-core"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "apigw-events-core"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      # Forward Authorization and Origin headers for JWT and CORS support.
      headers      = ["Authorization", "Origin"]

      cookies {
        forward = "none"
      }
    }

    # TTLs set to 0 to ensure real-time dynamic data for the API.
    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
