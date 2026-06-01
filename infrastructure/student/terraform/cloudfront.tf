# Optional: CloudFront in front of API Gateway (set enable_cloudfront = true)
resource "aws_cloudfront_distribution" "api" {
  count = var.enable_cloudfront && !local.use_shared_api_gateway ? 1 : 0

  enabled         = true
  is_ipv6_enabled = true
  comment         = "Student Core API - ${var.stage}"

  origin {
    domain_name = "${aws_apigatewayv2_api.main[0].id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_id   = "apigw-student-core"

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
    target_origin_id       = "apigw-student-core"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin"]

      cookies {
        forward = "none"
      }
    }

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
