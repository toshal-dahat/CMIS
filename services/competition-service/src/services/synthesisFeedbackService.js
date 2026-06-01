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
 * Fetch all judge feedback strings for a specific team.
 * Queries CompetitionScores via the competitionId GSI, then filters by teamId.
 * Only includes records where the judge wrote a non-empty feedback string.
 */
async function getJudgeFeedbacks(competitionId, teamId) {
  const scores = await scoreService.getScoresByTeam(competitionId, teamId);

  return scores
    .filter(s => s.feedback && s.feedback.trim())
    .map(s => s.feedback.trim());
}

/**
 * Call Bedrock Claude 3 Haiku to synthesize multiple judge critiques into
 * a single kind, constructive narrative addressed to the team.
 */
async function invokeBedrock(feedbacks) {
  const judgeList = feedbacks
    .map((f, i) => `Judge ${i + 1}:\n${f}`)
    .join("\n\n");

  const prompt = [
    "You are a competition coordinator preparing written feedback for a student team.",
    `You have received written comments from ${feedbacks.length} judge(s) for their case competition submission.`,
    "Synthesize these comments into a single cohesive, kind, and constructive narrative.",
    "",
    "Guidelines:",
    "- Merge overlapping points into unified themes.",
    "- Frame all criticism constructively — focus on growth opportunities, not deficiencies.",
    "- Highlight genuine strengths enthusiastically.",
    "- Suggest specific, actionable improvements.",
    "- Use an encouraging, supportive tone throughout.",
    "- Write in second person (\"Your team…\", \"You demonstrated…\").",
    "- Structure: brief opening → key strengths → areas for growth → closing encouragement.",
    "- Length: 3–5 paragraphs, plain prose (no bullet lists).",
    "",
    "--- JUDGE COMMENTS ---",
    judgeList,
    "--- END COMMENTS ---",
    "",
    "Write the synthesized feedback now:",
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
async function saveSynthesizedFeedback(competitionId, teamId, synthesizedFeedback) {
  await docClient.send(new UpdateCommand({
    TableName: TEAMS_TABLE,
    Key: { competitionId, teamId },
    UpdateExpression: "SET synthesizedFeedback = :sf, synthesizedAt = :sa, synthesisModelId = :mid",
    ExpressionAttributeValues: {
      ":sf": synthesizedFeedback,
      ":sa": new Date().toISOString(),
      ":mid": BEDROCK_MODEL_ID,
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
    ProjectionExpression: "synthesizedFeedback, synthesizedAt, synthesisModelId",
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
 * @returns {Promise<{ synthesizedFeedback: string, synthesizedAt: string, judgeCount: number }>}
 * @throws 422 if no judge feedback exists for this team
 * @throws 502 if Bedrock call fails
 */
async function synthesize(competitionId, teamId) {
  const feedbacks = await getJudgeFeedbacks(competitionId, teamId);

  if (feedbacks.length === 0) {
    const err = new Error(
      "No judge feedback found for this team. " +
      "Judges must submit written comments before synthesis can run."
    );
    err.statusCode = 422;
    throw err;
  }

  const synthesizedFeedback = await invokeBedrock(feedbacks);
  await saveSynthesizedFeedback(competitionId, teamId, synthesizedFeedback);

  return {
    synthesizedFeedback,
    synthesizedAt: new Date().toISOString(),
    judgeCount: feedbacks.length,
  };
}

module.exports = { synthesize, getSynthesizedFeedback, BEDROCK_MODEL_ID };
