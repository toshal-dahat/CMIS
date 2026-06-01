/**
 * Synthesis Feedback Service — Bedrock AI aggregation of judge critiques.
 *
 * Pipeline: CompetitionScores (all judges' feedback for a team)
 *           → Bedrock Claude 3 Haiku (rewrite into kind, constructive narrative)
 *           → CompetitionTeams (cache as synthesizedFeedback)
 *
 * The synthesized result is stored on the team record so it can be
 * retrieved later and gated by the competition's feedbackReleaseDate.
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const scoreService = require("./scoreService");

const bedrockClient = new BedrockRuntimeClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TEAMS_TABLE = process.env.TEAMS_TABLE;
const SCORES_TABLE = process.env.SCORES_TABLE;

const BEDROCK_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const BEDROCK_MAX_OUTPUT_TOKENS = 1000;

/**
 * Fetch all judge scores for a team and extract feedback strings.
 * Returns both the raw scores (for average calculation) and feedback texts.
 */
async function getJudgeData(competitionId, teamId) {
  const scores = await scoreService.getScoresByTeam(competitionId, teamId);
  const feedbacks = scores
    .filter(s => s.feedback && s.feedback.trim())
    .map(s => s.feedback.trim());
  return { scores, feedbacks };
}

/**
 * Calculate average rating per criterion across all judges.
 * Returns e.g. { presentation: 8.2, analysis: 7.5, ... }
 */
function calculateAverageScores(scores) {
  const totals = {};
  const counts = {};
  for (const score of scores) {
    if (!score.ratings) continue;
    for (const [key, value] of Object.entries(score.ratings)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      totals[key] = (totals[key] || 0) + num;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const averages = {};
  for (const key of Object.keys(totals)) {
    averages[key] = Math.round((totals[key] / counts[key]) * 10) / 10;
  }
  return averages;
}

/**
 * Call Bedrock Claude 3 Haiku to synthesize multiple judge critiques into
 * a single kind, constructive narrative addressed to the team.
 */
async function invokeBedrock(feedbacks, averageScores) {
  const judgeList = feedbacks
    .map((f, i) => `Judge ${i + 1}:\n${f}`)
    .join("\n\n");

  const scoreLines = Object.entries(averageScores)
    .map(([k, v]) => `  - ${k}: ${v}/10`)
    .join("\n");

  const scoreContext = Object.keys(averageScores).length > 0
    ? `\nAverage scores across all judges:\n${scoreLines}\n`
    : "";

  const prompt = [
    "You are synthesizing evaluation comments from a panel of judges for a student team.",
    `You have received written comments from ${feedbacks.length} judge(s) for their case competition submission.`,
    scoreContext,
    "Synthesize these comments into a single cohesive, kind, and constructive narrative in well-structured Markdown format from the collective perspective of the judges.",
    "",
    "Guidelines:",
    "- Merge overlapping points into unified themes and avoid any redundancy.",
    "- Do NOT repeat a point if it has already been covered in a previous section of the synthesis.",
    "- Frame all criticism constructively — focus on growth opportunities, not deficiencies.",
    "- Highlight genuine strengths enthusiastically.",
    "- Suggest specific, actionable improvements referencing the scored criteria where relevant.",
    "- Use an encouraging, supportive tone throughout.",
    "- Write in the third person for the judges (e.g., \"The judges noted…\", \"The panel observed…\") while addressing the team in the second person (e.g., \"Your team demonstrated…\").",
    "- Structure the response with:",
    "  - A brief ## Overview.",
    "  - A section for ### Performance Summary. In this section, you MUST include a Markdown table showing each criterion and its average score (e.g., | Criterion | Score |).",
    "  - A section for ### Key Strengths (identifying unique and noteworthy accomplishments).",
    "  - A section for ### Areas for Growth (identifying distinct opportunities for future improvement).",
    "  - A brief #### Closing Encouragement from the panel.",
    "- Length: Approximately 400-600 words.",
    "",
    "--- JUDGE COMMENTS ---",
    judgeList,
    "--- END COMMENTS ---",
    "",
    "Write the synthesized feedback now from the judges' perspective (ensure the Performance Summary table is included and redundancy is avoided):",
  ].join("\n");

  let response;
  try {
    response = await bedrockClient.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: BEDROCK_MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      }),
    }));
  } catch (bedrockErr) {
    console.error("Bedrock InvokeModel failed (feedback synthesis):", {
      name: bedrockErr.name,
      message: bedrockErr.message,
      httpStatusCode: bedrockErr.$metadata?.httpStatusCode,
      requestId: bedrockErr.$metadata?.requestId,
      modelId: BEDROCK_MODEL_ID,
    });
    const err = new Error(`Feedback synthesis failed: ${bedrockErr.name} - ${bedrockErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const parsed = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const synthesizedText = parsed?.content?.[0]?.text ?? "";

  if (!synthesizedText) {
    const err = new Error("AI returned an empty synthesis. Please try again.");
    err.statusCode = 502;
    throw err;
  }

  console.log("Bedrock feedback synthesis generated:", {
    modelId: BEDROCK_MODEL_ID,
    judgeCount: feedbacks.length,
    outputChars: synthesizedText.length,
    inputTokens: parsed?.usage?.input_tokens,
    outputTokens: parsed?.usage?.output_tokens,
  });

  return synthesizedText;
}

/**
 * Persist synthesized feedback onto the CompetitionTeams item.
 * Uses UpdateCommand so existing team fields (teamName, members, etc.) are not overwritten.
 */
async function saveSynthesizedFeedback(competitionId, teamId, synthesizedFeedback, averageScores) {
  await docClient.send(new UpdateCommand({
    TableName: TEAMS_TABLE,
    Key: { competitionId, teamId },
    UpdateExpression: "SET synthesizedFeedback = :sf, synthesizedAt = :sa, synthesisModelId = :mid, averageScores = :as",
    ExpressionAttributeValues: {
      ":sf": synthesizedFeedback,
      ":sa": new Date().toISOString(),
      ":mid": BEDROCK_MODEL_ID,
      ":as": averageScores,
    },
  }));
}

/**
 * Retrieve the stored synthesized feedback for a team.
 * Returns null if synthesis has not been run yet for this team.
 */
async function getSynthesizedFeedback(competitionId, teamId) {
  const result = await docClient.send(new GetCommand({
    TableName: TEAMS_TABLE,
    Key: { competitionId, teamId },
    ProjectionExpression: "synthesizedFeedback, synthesizedAt, synthesisModelId, averageScores",
  }));

  const item = result.Item;
  if (!item || !item.synthesizedFeedback) return null;
  return item;
}

/**
 * Main orchestrator — fetch all judge feedbacks for a team, call Bedrock
 * to produce a synthesized narrative, persist it, and return the result.
 *
 * @param {string} competitionId
 * @param {string} teamId
 * @param {boolean} refresh - if true, regenerate even if cached
 * @returns {Promise<{ synthesizedFeedback: string, synthesizedAt: string, judgeCount: number }>}
 * @throws 422 if no judge feedback exists for this team
 * @throws 502 if Bedrock call fails
 */
async function synthesize(competitionId, teamId, refresh = false) {
  // 1. Check cache first
  const cached = await getSynthesizedFeedback(competitionId, teamId);
  if (cached && !refresh) {
    console.log(`Using cached synthesized feedback for ${competitionId}/${teamId}`);
    return {
      synthesizedFeedback: cached.synthesizedFeedback,
      synthesizedAt: cached.synthesizedAt,
      judgeCount: -1, // Unknown from cache alone without querying scores
      averageScores: cached.averageScores,
      cached: true
    };
  }

  const { scores, feedbacks } = await getJudgeData(competitionId, teamId);

  if (feedbacks.length === 0) {
    const err = new Error(
      "No judge feedback found for this team. " +
      "Judges must submit written comments before synthesis can run."
    );
    err.statusCode = 422;
    throw err;
  }

  const averageScores = calculateAverageScores(scores);
  const synthesizedFeedback = await invokeBedrock(feedbacks, averageScores);
  await saveSynthesizedFeedback(competitionId, teamId, synthesizedFeedback, averageScores);

  return {
    synthesizedFeedback,
    synthesizedAt: new Date().toISOString(),
    judgeCount: feedbacks.length,
    averageScores,
    cached: false
  };
}

module.exports = { synthesize, getSynthesizedFeedback, BEDROCK_MODEL_ID };
