# Mentorship operator scheduler tick (every minute).
# Lambda validates admin-configured date/time/timezone and only executes when due.
# Enable with enable_mentorship_annual_eventbridge = true once IAM allows EventBridge rule management.
# Variable is declared in variables.tf (input for this module).

resource "aws_cloudwatch_event_rule" "mentorship_annual_batch" {
  count               = var.enable_mentorship_annual_eventbridge ? 1 : 0
  name                = "${var.project_name}-mentorship-schedule-tick"
  description         = "Mentorship schedule tick (run-if-due gate executes from stored admin schedule)"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "mentorship_annual_batch" {
  count     = var.enable_mentorship_annual_eventbridge ? 1 : 0
  rule      = aws_cloudwatch_event_rule.mentorship_annual_batch[0].name
  target_id = "external-service-mentorship-batch"
  arn       = aws_lambda_function.external_service.arn
  input = jsonencode({
    source    = "cmis.mentorship.batch"
    batchType = "schedule-tick"
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
