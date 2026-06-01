locals {
  pptx_extractor_source_dir   = "${path.module}/${var.pptx_extractor_service_path}"
  pptx_extractor_requirements = "${path.module}/${var.pptx_extractor_requirements_path}"
  pptx_extractor_build_dir    = "${path.module}/build/pptx-extractor-package"
  pptx_extractor_zip_path     = "${path.module}/build/pptx-extractor.zip"
  pptx_extractor_source_hash = sha256(join("", [
    for file_name in sort(fileset(local.pptx_extractor_source_dir, "**")) :
    filesha256("${local.pptx_extractor_source_dir}/${file_name}")
  ]))
}

resource "terraform_data" "pptx_extractor_build" {
  count = var.enable_pptx_extractor_lambda ? 1 : 0

  triggers_replace = [
    local.pptx_extractor_source_hash,
    filesha256(local.pptx_extractor_requirements),
    filesha256("${path.module}/scripts/build_pptx_extractor_package.py"),
  ]

  provisioner "local-exec" {
    command = "python \"${path.module}/scripts/build_pptx_extractor_package.py\" \"${local.pptx_extractor_source_dir}\" \"${local.pptx_extractor_build_dir}\" \"${local.pptx_extractor_requirements}\""
  }
}

data "archive_file" "pptx_extractor_zip" {
  count = var.enable_pptx_extractor_lambda ? 1 : 0

  type        = "zip"
  source_dir  = local.pptx_extractor_build_dir
  output_path = local.pptx_extractor_zip_path

  depends_on = [terraform_data.pptx_extractor_build]
}

resource "aws_lambda_function" "pptx_extractor" {
  count = var.enable_pptx_extractor_lambda ? 1 : 0

  function_name    = "competition-pptx-extractor-${var.stage}"
  role             = var.lambda_role_arn
  runtime          = var.lambda_python_runtime
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.pptx_extractor_zip[0].output_path
  source_code_hash = data.archive_file.pptx_extractor_zip[0].output_base64sha256

  environment {
    variables = {
      PPTX_MAX_IMAGES_RETURNED = "6"
      PPTX_MAX_IMAGE_BYTES     = tostring(400 * 1024)
    }
  }

  timeout     = 60
  memory_size = 1024

  ephemeral_storage {
    size = 1024
  }
}

resource "aws_iam_role_policy" "lambda_pptx_extractor_invoke" {
  count = var.enable_pptx_extractor_lambda ? 1 : 0

  name = "competition-lambda-pptx-invoke-${var.stage}"
  role = local.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowInvokePptxExtractor"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          aws_lambda_function.pptx_extractor[0].arn
        ]
      }
    ]
  })
}
