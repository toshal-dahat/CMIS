data "aws_caller_identity" "events_account" {}

resource "aws_lambda_permission" "eventbridge_reminders" {
  statement_id  = "AllowEventBridgeReminderInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.events_crud.function_name
  principal     = "events.amazonaws.com"
  source_arn    = "arn:aws:events:${var.aws_region}:${data.aws_caller_identity.events_account.account_id}:rule/${var.reminder_rule_prefix}*"
}

