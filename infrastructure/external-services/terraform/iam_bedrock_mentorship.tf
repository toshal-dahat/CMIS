data "aws_iam_policy_document" "external_lambda_bedrock_mentorship" {
  statement {
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
    ]
    resources = [
      "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0",
      "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:0",
      "arn:aws:bedrock:${var.aws_region}::foundation-model/cohere.embed-english-v3",
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "bedrock:ListFoundationModels",
      "bedrock:GetFoundationModel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "external_lambda_bedrock_mentorship" {
  name   = "external-lambda-bedrock-mentorship"
  role   = aws_iam_role.external_lambda.id
  policy = data.aws_iam_policy_document.external_lambda_bedrock_mentorship.json
}
