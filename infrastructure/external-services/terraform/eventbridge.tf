# Annual mentorship batch (Sept 1, 06:00 UTC) — optional; requires events:* on the Terraform IAM principal.
# Enable with enable_mentorship_annual_eventbridge = true once IAM allows EventBridge rule management.
# Variable is declared in variables.tf (input for this module).

resource "aws_cloudwatch_event_rule" "mentorship_annual_batch" {
  count               = var.enable_mentorship_annual_eventbridge ? 1 : 0
  name                = "${var.project_name}-mentorship-annual-batch"
  description         = "Greedy mentorship suggestion batch (professor annual matching requirement)"
  schedule_expression = "cron(0 6 1 9 ? *)"
}

resource "aws_cloudwatch_event_target" "mentorship_annual_batch" {
  count     = var.enable_mentorship_annual_eventbridge ? 1 : 0
  rule      = aws_cloudwatch_event_rule.mentorship_annual_batch[0].name
  target_id = "external-service-mentorship-batch"
  arn       = aws_lambda_function.external_service.arn
  input = jsonencode({
    source    = "scheduled-batch"
    batchType = "annual"
  })
}

resource "aws_lambda_permission" "mentorship_annual_eventbridge" {
  count         = var.enable_mentorship_annual_eventbridge ? 1 : 0
  statement_id  = "AllowEventBridgeMentorshipAnnualBatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.external_service.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.mentorship_annual_batch[0].arn
}
