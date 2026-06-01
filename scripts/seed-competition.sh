#!/bin/bash
# ──────────────────────────────────────────────────────────────
# Seed test data for the Competition / Judge Dashboard feature.
#
# Usage:
#   ./scripts/seed-competition.sh <judge-email>
#
# What it creates:
#   1. A competition ("Spring 2026 Case Competition")
#   2. Three teams (Alpha, Beta, Gamma)
#   3. A submission for team Alpha (fake S3 key)
#   4. A judge assignment linking the given user to all 3 teams
#   5. A score from that judge for team Alpha (to show Graded state)
#
# Prerequisites:
#   - AWS CLI configured with correct credentials
#   - The judge email must be a registered Cognito user
#   - DynamoDB tables must already exist (run terraform apply first)
#
# Table names default to dev stage. Override with STAGE env var:
#   STAGE=prod ./scripts/seed-competition.sh judge@tamu.edu
# ──────────────────────────────────────────────────────────────

set -e

STAGE="${STAGE:-dev}"
USER_POOL="${USER_POOL:-us-east-1_MMG37d3WE}"

COMPETITIONS_TABLE="Competitions-${STAGE}"
TEAMS_TABLE="CompetitionTeams-${STAGE}"
SUBMISSIONS_TABLE="CompetitionSubmissions-${STAGE}"
ASSIGNMENTS_TABLE="JudgeAssignments-${STAGE}"
SCORES_TABLE="CompetitionScores-${STAGE}"

# ── Validate input ──────────────────────────────────────
if [ -z "$1" ]; then
  echo "Usage: $0 <judge-email>"
  echo ""
  echo "Seeds a test competition with 3 teams and assigns the given"
  echo "user as a judge. The user must exist in Cognito."
  echo ""
  echo "Examples:"
  echo "  $0 judge@tamu.edu"
  echo "  STAGE=prod $0 judge@tamu.edu"
  exit 1
fi

JUDGE_EMAIL="$1"

# ── Look up the judge's Cognito sub ─────────────────────
echo "Looking up Cognito user: $JUDGE_EMAIL"
JUDGE_SUB=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL" \
  --filter "email = \"$JUDGE_EMAIL\"" \
  --query "Users[0].Username" \
  --output text 2>/dev/null)

if [ -z "$JUDGE_SUB" ] || [ "$JUDGE_SUB" = "None" ]; then
  echo "ERROR: No Cognito user found for $JUDGE_EMAIL"
  echo "Register the user in the app first, then re-run this script."
  exit 1
fi
echo "Found judge sub: $JUDGE_SUB"

# ── Generate IDs ────────────────────────────────────────
# Using simple UUIDs via uuidgen or fallback to date-based IDs
if command -v uuidgen &> /dev/null; then
  COMP_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  TEAM1_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  TEAM2_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  TEAM3_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
else
  # Fallback: use timestamp-based IDs
  COMP_ID="comp-$(date +%s)-001"
  TEAM1_ID="team-$(date +%s)-001"
  TEAM2_ID="team-$(date +%s)-002"
  TEAM3_ID="team-$(date +%s)-003"
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
# Deadline 30 days from now
DEADLINE=$(date -u -d "+30 days" +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -v+30d +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || echo "2026-12-31T23:59:59.000Z")

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Seeding Competition Data (stage: $STAGE)"
echo "═══════════════════════════════════════════════════"

# ── 1. Create Competition ───────────────────────────────
echo ""
echo "1/5  Creating competition..."
aws dynamodb put-item \
  --table-name "$COMPETITIONS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"name\":          {\"S\": \"Spring 2026 Case Competition\"},
    \"description\":   {\"S\": \"Analyze a real-world business challenge and present your solution to a panel of judges.\"},
    \"submissionDeadline\":  {\"S\": \"$DEADLINE\"},
    \"feedbackReleaseDate\": {\"NULL\": true},
    \"status\":        {\"S\": \"ACTIVE\"},
    \"createdAt\":     {\"S\": \"$NOW\"},
    \"updatedAt\":     {\"S\": \"$NOW\"}
  }"
echo "     Competition: $COMP_ID"

# ── 2. Create Teams ─────────────────────────────────────
echo ""
echo "2/5  Creating 3 teams..."

aws dynamodb put-item \
  --table-name "$TEAMS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"teamId\":        {\"S\": \"$TEAM1_ID\"},
    \"teamName\":      {\"S\": \"Team Alpha\"},
    \"members\":       {\"L\": [{\"S\": \"Alice Johnson\"}, {\"S\": \"Bob Smith\"}, {\"S\": \"Carol Davis\"}]},
    \"createdAt\":     {\"S\": \"$NOW\"}
  }"
echo "     Team Alpha:  $TEAM1_ID"

aws dynamodb put-item \
  --table-name "$TEAMS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"teamId\":        {\"S\": \"$TEAM2_ID\"},
    \"teamName\":      {\"S\": \"Team Beta\"},
    \"members\":       {\"L\": [{\"S\": \"David Lee\"}, {\"S\": \"Emma Wilson\"}, {\"S\": \"Frank Garcia\"}]},
    \"createdAt\":     {\"S\": \"$NOW\"}
  }"
echo "     Team Beta:   $TEAM2_ID"

aws dynamodb put-item \
  --table-name "$TEAMS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"teamId\":        {\"S\": \"$TEAM3_ID\"},
    \"teamName\":      {\"S\": \"Team Gamma\"},
    \"members\":       {\"L\": [{\"S\": \"Grace Kim\"}, {\"S\": \"Henry Chen\"}, {\"S\": \"Iris Patel\"}, {\"S\": \"Jack Brown\"}]},
    \"createdAt\":     {\"S\": \"$NOW\"}
  }"
echo "     Team Gamma:  $TEAM3_ID"

# ── 3. Create a Submission for Team Alpha ───────────────
echo ""
echo "3/5  Creating submission for Team Alpha..."
FAKE_S3_KEY="submissions/$COMP_ID/$TEAM1_ID/sample-submission.pdf"

aws dynamodb put-item \
  --table-name "$SUBMISSIONS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"teamId\":        {\"S\": \"$TEAM1_ID\"},
    \"s3Key\":         {\"S\": \"$FAKE_S3_KEY\"},
    \"fileName\":      {\"S\": \"team-alpha-submission.pdf\"},
    \"fileType\":      {\"S\": \"application/pdf\"},
    \"submittedAt\":   {\"S\": \"$NOW\"},
    \"updatedAt\":     {\"S\": \"$NOW\"}
  }"
echo "     S3 key: $FAKE_S3_KEY"
echo "     (Note: This is a fake S3 key. Upload a real PDF to test the viewer.)"

# ── 4. Assign Judge ─────────────────────────────────────
echo ""
echo "4/5  Assigning $JUDGE_EMAIL as judge for all 3 teams..."
aws dynamodb put-item \
  --table-name "$ASSIGNMENTS_TABLE" \
  --item "{
    \"competitionId\": {\"S\": \"$COMP_ID\"},
    \"judgeUserId\":   {\"S\": \"$JUDGE_SUB\"},
    \"judgeName\":     {\"S\": \"$JUDGE_EMAIL\"},
    \"judgeEmail\":    {\"S\": \"$JUDGE_EMAIL\"},
    \"teamIds\":       {\"L\": [{\"S\": \"$TEAM1_ID\"}, {\"S\": \"$TEAM2_ID\"}, {\"S\": \"$TEAM3_ID\"}]},
    \"assignedAt\":    {\"S\": \"$NOW\"}
  }"
echo "     Assigned to teams: Alpha, Beta, Gamma"

# ── 5. Create a Score for Team Alpha (to show Graded) ──
echo ""
echo "5/5  Creating sample score for Team Alpha (shows 'Graded' badge)..."
SCORE_PK="${COMP_ID}#${TEAM1_ID}"

aws dynamodb put-item \
  --table-name "$SCORES_TABLE" \
  --item "{
    \"competitionId_teamId\": {\"S\": \"$SCORE_PK\"},
    \"competitionId\":        {\"S\": \"$COMP_ID\"},
    \"teamId\":               {\"S\": \"$TEAM1_ID\"},
    \"judgeUserId\":          {\"S\": \"$JUDGE_SUB\"},
    \"ratings\":              {\"M\": {
      \"presentation\": {\"N\": \"8\"},
      \"analysis\":     {\"N\": \"7\"},
      \"creativity\":   {\"N\": \"9\"},
      \"feasibility\":  {\"N\": \"7\"},
      \"teamwork\":     {\"N\": \"8\"}
    }},
    \"feedback\":             {\"S\": \"Strong presentation with creative solutions. Could improve feasibility analysis.\"},
    \"status\":               {\"S\": \"GRADED\"},
    \"gradedAt\":             {\"S\": \"$NOW\"},
    \"updatedAt\":            {\"S\": \"$NOW\"}
  }"

# ── Summary ─────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Seed complete!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Competition:  $COMP_ID"
echo "  Judge:        $JUDGE_EMAIL ($JUDGE_SUB)"
echo ""
echo "  Teams:"
echo "    Alpha  ($TEAM1_ID) — Submitted + Graded"
echo "    Beta   ($TEAM2_ID) — No submission, Pending"
echo "    Gamma  ($TEAM3_ID) — No submission, Pending"
echo ""
echo "  Next steps:"
echo "    1. Set VITE_COMPETITION_API_URL in frontend/.env"
echo "    2. Sign in as $JUDGE_EMAIL"
echo "    3. Click 'Judge Dashboard' on the landing page"
echo "    4. You should see all 3 teams with correct statuses"
echo ""
echo "  To upload a real PDF for testing the viewer:"
echo "    aws s3 cp sample.pdf s3://tamu-competition-submissions-${STAGE}-<account-id>/$FAKE_S3_KEY"
echo ""
