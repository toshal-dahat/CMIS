# CloudFront Origin Access Identity
resource "aws_cloudfront_origin_access_identity" "frontend" {
  count = var.enable_frontend_hosting ? 1 : 0

  comment = "OAI for ${var.project_name} frontend"
}

locals {
  frontend_aliases  = var.enable_frontend_hosting && var.frontend_domain != "" ? [var.frontend_domain, "www.${var.frontend_domain}"] : []
  frontend_cert_arn = var.enable_frontend_hosting && var.frontend_domain != "" ? aws_acm_certificate.frontend[0].arn : null
}

# ACM certificate for custom domain (CloudFront requires us-east-1)
resource "aws_acm_certificate" "frontend" {
  count = var.enable_frontend_hosting && var.frontend_domain != "" ? 1 : 0

  provider = aws.acm

  domain_name               = var.frontend_domain
  subject_alternative_names = ["www.${var.frontend_domain}"]
  validation_method         = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_distribution" "frontend" {
  count = var.enable_frontend_hosting ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Team Gig 'Em - CMIS External Frontend"
  default_root_object = "index.html"
  aliases             = local.frontend_aliases

  origin {
    domain_name = aws_s3_bucket.frontend[0].bucket_regional_domain_name
    origin_id   = "S3-${aws_s3_bucket.frontend[0].id}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.frontend[0].cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend[0].id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.frontend_cert_arn == null
    acm_certificate_arn            = local.frontend_cert_arn
    ssl_support_method             = local.frontend_cert_arn != null ? "sni-only" : null
    minimum_protocol_version       = local.frontend_cert_arn != null ? "TLSv1.2_2021" : null
  }

  tags = var.tags
}

# Route 53 (alias to CloudFront) if zone ID provided
resource "aws_route53_record" "frontend" {
  count = var.enable_frontend_hosting && var.frontend_domain != "" && var.route53_zone_id != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend[0].domain_name
    zone_id                = aws_cloudfront_distribution.frontend[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_www" {
  count = var.enable_frontend_hosting && var.frontend_domain != "" && var.route53_zone_id != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "www.${var.frontend_domain}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend[0].domain_name
    zone_id                = aws_cloudfront_distribution.frontend[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = var.enable_frontend_hosting && var.frontend_domain != "" && var.route53_zone_id != "" ? {
    for dvo in aws_acm_certificate.frontend[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.route53_zone_id
}

resource "aws_acm_certificate_validation" "frontend" {
  count = var.enable_frontend_hosting && var.frontend_domain != "" && var.route53_zone_id != "" ? 1 : 0

  provider = aws.acm

  certificate_arn         = aws_acm_certificate.frontend[0].arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}
