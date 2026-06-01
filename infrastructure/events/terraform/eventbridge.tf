data "aws_caller_identity" "events_account" {}

# Permissions: Allow EventBridge to invoke the service Lambda for scheduled reminders.
# Rules are created dynamically by the application to fire 1 hour before an event.
resource "aws_lambda_permission" "eventbridge_reminders" {
  statement_id  = "AllowEventBridgeReminderInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.events_crud.function_name
  principal     = "events.amazonaws.com"
  
  # Restricted to rules matching the service's prefix.
  source_arn    = "arn:aws:events:${var.aws_region}:${data.aws_caller_identity.events_account.account_id}:rule/${var.reminder_rule_prefix}*"
}

