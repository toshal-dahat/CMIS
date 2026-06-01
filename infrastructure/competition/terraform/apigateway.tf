# ─── HTTP API ────────────────────────────────────────────
resource "aws_apigatewayv2_api" "main" {
  name          = "competition-core-${var.stage}"
  protocol_type = "HTTP"
  description   = "CMIS Competition Service API"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.stage
  auto_deploy = true
}

# ─── Integration (single Lambda) ────────────────────────
resource "aws_apigatewayv2_integration" "competition_crud" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.competition_crud.invoke_arn
  payload_format_version = "2.0"
}

# ─── Lambda permission for API Gateway ──────────────────
resource "aws_lambda_permission" "competition_crud" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.competition_crud.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── Health ─────────────────────────────────────────────
resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/health"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Competition CRUD ───────────────────────────────────
resource "aws_apigatewayv2_route" "list_competitions" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "create_competition" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "get_competition" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "update_competition" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/competitions/{competitionId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_competition" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/competitions/{competitionId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Teams ──────────────────────────────────────────────
resource "aws_apigatewayv2_route" "list_teams" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/teams"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "create_team" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/teams"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "get_team" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/teams/{teamId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "update_team" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/competitions/{competitionId}/teams/{teamId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_team" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/competitions/{competitionId}/teams/{teamId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Judge Assignments (Admin) ──────────────────────────
resource "aws_apigatewayv2_route" "assign_judge" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/judges"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "list_judges" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/judges"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "get_judge" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/judges/{judgeUserId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "update_judge" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/competitions/{competitionId}/judges/{judgeUserId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_judge" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/competitions/{competitionId}/judges/{judgeUserId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Rooms (Admin) ──────────────────────────────────────
# Rooms are the source of truth for judge↔team binding within a competition.
# Each room contains a set of judgeIds and a set of teamIds. A team belongs
# to AT MOST ONE room (enforced server-side); judges may serve in multiple
# rooms. Downstream code derives a judge's teamIds[] from the union of
# their rooms via the requireJudge middleware.
resource "aws_apigatewayv2_route" "list_rooms" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/rooms"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "get_room" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/rooms/{roomId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "create_room" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/rooms"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "update_room" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PUT /api/competitions/{competitionId}/rooms/{roomId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "delete_room" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /api/competitions/{competitionId}/rooms/{roomId}"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Submissions ────────────────────────────────────────
resource "aws_apigatewayv2_route" "submission_upload_url" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/submissions/upload-url"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "submission_complete" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/submissions/complete"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "submission_download" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/submissions/{teamId}/download-url"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Judge-specific routes ──────────────────────────────
resource "aws_apigatewayv2_route" "judge_assignments" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/judge/assignments"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "judge_teams" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/judge/competitions/{competitionId}/teams"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "judge_get_score" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/judge/competitions/{competitionId}/teams/{teamId}/score"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "judge_submit_score" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/judge/competitions/{competitionId}/teams/{teamId}/score"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Admin scores overview ──────────────────────────────
resource "aws_apigatewayv2_route" "admin_scores" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/scores"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── AI Summary route (summaryService.js) — A5 ───────────────────────────────
resource "aws_apigatewayv2_route" "judge_summary" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/judge/competitions/{competitionId}/teams/{teamId}/summary"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

# ─── Feedback & Synthesis routes (Bounty 19) ────────────────────────────────
# GET  /feedback            — raw judge feedback, gated by feedbackReleaseDate
# GET  /synthesized-feedback — AI narrative + avg scores, auto-generates on first access
# POST /synthesize           — admin-triggered synthesis (also fires on judge score submit)
resource "aws_apigatewayv2_route" "team_feedback" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/teams/{teamId}/feedback"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "team_synthesized_feedback" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/competitions/{competitionId}/teams/{teamId}/synthesized-feedback"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}

resource "aws_apigatewayv2_route" "team_synthesize" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /api/competitions/{competitionId}/teams/{teamId}/synthesize"
  target    = "integrations/${aws_apigatewayv2_integration.competition_crud.id}"
}
