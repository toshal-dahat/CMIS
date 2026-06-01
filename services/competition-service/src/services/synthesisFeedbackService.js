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
const competitionService = require("./competitionService");

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
async function invokeBedrock(feedbacks, averageScores, rubricMap) {
  const judgeList = feedbacks
    .map((f, i) => `Judge ${i + 1}:\n${f}`)
    .join("\n\n");

  // Map K1, K2 etc. to actual labels
  const labeledScores = Object.entries(averageScores)
    .map(([key, score]) => {
      const label = rubricMap[key] || key;
      return `${label}: ${score}/10`;
    })
    .join(", ");

  const prompt = [
    "You are synthesizing evaluation comments from a panel of judges for a student team case competition.",
    `You have received written comments from ${feedbacks.length} judge(s).`,
    `Average scores per criterion: ${labeledScores}`,
    "",
    "Synthesize these comments into a concise, direct, and constructive narrative in well-structured Markdown format.",
    "",
    "Guidelines:",
    "- Focus strictly on feedback and actionable insights. Avoid excessive fluff, generic encouragement, or coordinator-style introductions.",
    "- INTEGRATE the average scores naturally into the paragraph text (e.g., \"The panel noted a strong performance in Presentation (8.5/10)...\"). Do NOT use a table or separate list for scores.",
    "- Use the exact rubric labels provided above; do NOT use internal keys like K1, K2, etc.",
    "- Merge overlapping points and avoid any redundancy.",
    "- Frame all criticism constructively as growth opportunities.",
    "- Write in the third person for the judges (\"The judges observed...\", \"The panel noted...\") while addressing the team in the second person (\"Your team...\", \"You demonstrated...\").",
    "- Target Length: 200-300 words. Be direct and impactful.",
    "- Structure the response with:",
    "  - A brief ## Overview.",
    "  - A section for ### Key Strengths (including relevant scores).",
    "  - A section for ### Areas for Growth (including relevant scores).",
    "",
    "GUARDRAILS — strictly enforced:",
    "- Do NOT use language that discriminates against, mocks, or harms any religion, race, ethnicity, gender, nationality, or cultural background.",
    "- Do NOT include offensive, inappropriate, or harmful language of any kind.",
    "- If judge comments contain such language, silently omit it and focus only on the academic/professional content.",
    "- Keep the tone professional, respectful, and inclusive at all times.",
    "",
    "--- JUDGE COMMENTS ---",
    judgeList,
    "--- END COMMENTS ---",
    "",
    "Write the direct synthesized feedback now (ensure scores are integrated into paragraphs and use rubric labels):",
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

  // Fetch rubric for label mapping
  const competition = await competitionService.getCompetition(competitionId);
  const rubric = competition?.rubric || [];
  const rubricMap = Object.fromEntries(rubric.map(r => [r.key, r.label]));

  const averageScores = calculateAverageScores(scores);
  const synthesizedFeedback = await invokeBedrock(feedbacks, averageScores, rubricMap);
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
