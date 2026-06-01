resource "aws_cloudwatch_event_rule" "competition_feedback_release_tick" {
  count               = var.enable_competition_feedback_scheduler ? 1 : 0
  name                = "competition-feedback-release-tick-${var.stage}"
  description         = "Runs automatic competition feedback synthesis checks every minute"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "competition_feedback_release_tick" {
  count     = var.enable_competition_feedback_scheduler ? 1 : 0
  rule      = aws_cloudwatch_event_rule.competition_feedback_release_tick[0].name
  target_id = "competition-feedback-release-lambda"
  arn       = aws_lambda_function.competition_crud.arn

  input = jsonencode({
    source        = "cmis.competition.feedback"
    "detail-type" = "Scheduled Release Check"
  })
}

resource "aws_lambda_permission" "competition_feedback_release_tick" {
  count         = var.enable_competition_feedback_scheduler ? 1 : 0
  statement_id  = "AllowCompetitionFeedbackReleaseEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.competition_crud.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.competition_feedback_release_tick[0].arn
}
