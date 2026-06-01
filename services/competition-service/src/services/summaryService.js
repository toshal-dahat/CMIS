/**
 * Summary service — Textract text extraction + Bedrock AI summarization + DynamoDB caching.
 *
 * Pipeline: S3 (PDF) → Textract (extract text) → Bedrock Claude 3.5 Haiku (summarize) → DynamoDB (cache)
 *
 * Summaries are cached on the CompetitionSubmissions table item (summaryText, summaryAt, summaryModelId).
 * Shared across judges — first judge to request generates it, subsequent judges get the cached version.
 */

const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const textractClient = new TextractClient({});
const bedrockClient = new BedrockRuntimeClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const BUCKET = process.env.SUBMISSIONS_BUCKET;
const SUBMISSIONS_TABLE = process.env.SUBMISSIONS_TABLE;

// ── Config ─────────────────────────────────────────────
const BEDROCK_MODEL_ID = "anthropic.claude-3-5-haiku-20241022-v1:0";
const BEDROCK_MAX_OUTPUT_TOKENS = 600;

// ── Limits ─────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TEXT_CHARS = 600000;                  // ~150k tokens — well within Haiku's 200k limit
const MIN_TEXT_LENGTH = 50;                     // reject if Textract returns near-empty text
const RATE_LIMIT_MS = 60 * 1000;                // 60 seconds between regenerations per team

/**
 * Extract text from a PDF stored in S3 using Amazon Textract.
 *
 * Textract's DetectDocumentText works with text-based and scanned/image PDFs.
 * It reads the document directly from S3 (no download to Lambda /tmp needed).
 *
 * @param {string} s3Key - S3 object key of the PDF
 * @returns {Promise<string>} - Extracted text content
 * @throws {Error} with statusCode 413 if file too large, 422 if no text extracted
 */
async function extractTextFromPdf(s3Key) {
  const response = await textractClient.send(new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: BUCKET,
        Name: s3Key,
      },
    },
  }));

  // Textract returns Blocks — filter for LINE blocks and join them
  const lines = (response.Blocks || [])
    .filter(block => block.BlockType === "LINE")
    .map(block => block.Text || "");

  const text = lines.join("\n");

  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    const err = new Error(
      "Could not extract meaningful text from this PDF. " +
      "The document may be image-heavy with minimal text content."
    );
    err.statusCode = 422;
    throw err;
  }

  // Truncate if extremely long (unlikely for typical submissions)
  if (text.length > MAX_TEXT_CHARS) {
    console.warn(`Extracted text truncated from ${text.length} to ${MAX_TEXT_CHARS} chars for s3Key: ${s3Key}`);
    return text.slice(0, MAX_TEXT_CHARS);
  }

  return text;
}

/**
 * Generate a concise summary of submission text using Bedrock Claude 3.5 Haiku.
 *
 * The prompt includes the competition's rubric criteria so the summary
 * focuses on aspects relevant to what judges are actually scoring.
 *
 * @param {string} extractedText - Text content from Textract
 * @param {string[]} rubricLabels - e.g. ["Presentation Quality", "Analysis & Research", ...]
 * @returns {Promise<string>} - AI-generated summary text
 * @throws {Error} with statusCode 502 if Bedrock call fails
 */
async function generateSummary(extractedText, rubricLabels) {
  const criteriaList = rubricLabels.length > 0
    ? rubricLabels.join(", ")
    : "Presentation Quality, Analysis & Research, Creativity & Innovation, Feasibility of Solution, Teamwork & Delivery";

  const prompt = [
    "You are assisting judges in a university case competition.",
    "Summarize the following team submission concisely in one page.",
    "Focus on aspects relevant to these judging criteria: " + criteriaList + ".",
    "",
    "For each criterion, briefly highlight what the submission demonstrates (or lacks).",
    "Be objective and factual — do not assign scores or make subjective judgments.",
    "If the document contains diagrams or charts, note that visual content exists but could not be analyzed.",
    "",
    "Note: This summary is based on the text content of the submission only.",
    "",
    "--- SUBMISSION TEXT ---",
    extractedText,
  ].join("\n");

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: BEDROCK_MAX_OUTPUT_TOKENS,
    temperature: 0,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  let response;
  try {
    response = await bedrockClient.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body,
    }));
  } catch (bedrockErr) {
    console.error("Bedrock InvokeModel failed:", bedrockErr.name, bedrockErr.message);
    const err = new Error("AI summary generation failed. Please try again later.");
    err.statusCode = 502;
    throw err;
  }

  const parsed = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const summaryText = parsed?.content?.[0]?.text ?? "";

  if (!summaryText) {
    const err = new Error("AI returned an empty summary. Please try again.");
    err.statusCode = 502;
    throw err;
  }

  // Log metadata for observability (not the full text)
  console.log("Bedrock summary generated:", {
    modelId: BEDROCK_MODEL_ID,
    inputChars: extractedText.length,
    outputChars: summaryText.length,
    inputTokens: parsed?.usage?.input_tokens,
    outputTokens: parsed?.usage?.output_tokens,
  });

  return summaryText;
}

// ════════════════════════════════════════════════════════
// CACHE — read/write summary on CompetitionSubmissions item
// ════════════════════════════════════════════════════════

/**
 * Get the cached summary for a team's submission.
 *
 * @param {string} competitionId
 * @param {string} teamId
 * @returns {Promise<{ summaryText: string, summaryAt: string, summaryModelId: string } | null>}
 */
async function getCachedSummary(competitionId, teamId) {
  const result = await docClient.send(new GetCommand({
    TableName: SUBMISSIONS_TABLE,
    Key: { competitionId, teamId },
    ProjectionExpression: "summaryText, summaryAt, summaryModelId",
  }));

  const item = result.Item;
  if (!item || !item.summaryText) return null;

  return {
    summaryText: item.summaryText,
    summaryAt: item.summaryAt,
    summaryModelId: item.summaryModelId,
  };
}

/**
 * Save a generated summary onto the existing submission record.
 * Uses UpdateCommand so we don't overwrite s3Key, fileName, etc.
 *
 * @param {string} competitionId
 * @param {string} teamId
 * @param {string} summaryText
 * @param {string} modelId
 */
async function saveSummary(competitionId, teamId, summaryText, modelId) {
  await docClient.send(new UpdateCommand({
    TableName: SUBMISSIONS_TABLE,
    Key: { competitionId, teamId },
    UpdateExpression: "SET summaryText = :st, summaryAt = :sa, summaryModelId = :mid",
    ExpressionAttributeValues: {
      ":st": summaryText,
      ":sa": new Date().toISOString(),
      ":mid": modelId,
    },
  }));
}

/**
 * Check if a regeneration is rate-limited.
 * Returns true if the last summary was generated less than RATE_LIMIT_MS ago.
 *
 * @param {string | undefined} summaryAt - ISO timestamp of last generation
 * @returns {boolean}
 */
function isRateLimited(summaryAt) {
  if (!summaryAt) return false;
  const elapsed = Date.now() - new Date(summaryAt).getTime();
  return elapsed < RATE_LIMIT_MS;
}

// ════════════════════════════════════════════════════════
// ORCHESTRATOR — the main function called by the route handler
// ════════════════════════════════════════════════════════

/**
 * Generate or retrieve a cached summary for a team's submission.
 *
 * Flow:
 *   1. Check cache → return if exists and refresh not requested
 *   2. If refresh requested → check rate limit → return cached if too soon
 *   3. Validate file size via headObject
 *   4. Extract text via Textract
 *   5. Generate summary via Bedrock
 *   6. Save to cache
 *   7. Return result
 *
 * @param {Object} params
 * @param {string} params.competitionId
 * @param {string} params.teamId
 * @param {string} params.s3Key - S3 key from the submission record
 * @param {string[]} params.rubricLabels - competition rubric criterion labels
 * @param {boolean} params.refresh - if true, regenerate even if cached
 * @param {Function} params.headObject - s3PresignService.headObject for size check
 * @returns {Promise<{ summaryText: string, summaryAt: string, cached: boolean, truncated: boolean }>}
 */
async function generateOrGetSummary({ competitionId, teamId, s3Key, rubricLabels, refresh, headObject }) {
  // 1. Check cache
  const cached = await getCachedSummary(competitionId, teamId);

  if (cached && !refresh) {
    return {
      summaryText: cached.summaryText,
      summaryAt: cached.summaryAt,
      cached: true,
      truncated: false,
    };
  }

  // 2. Rate limit check on refresh
  if (cached && refresh && isRateLimited(cached.summaryAt)) {
    console.log(`Summary regeneration rate-limited for ${competitionId}/${teamId}`);
    return {
      summaryText: cached.summaryText,
      summaryAt: cached.summaryAt,
      cached: true,
      truncated: false,
    };
  }

  // 3. Validate file size
  const fileInfo = await headObject(s3Key);
  if (fileInfo.contentLength > MAX_FILE_SIZE_BYTES) {
    const err = new Error(
      `File is too large to summarize (${Math.round(fileInfo.contentLength / 1024 / 1024)}MB). ` +
      `Maximum allowed size is ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.`
    );
    err.statusCode = 413;
    throw err;
  }

  // 4. Extract text
  const extractedText = await extractTextFromPdf(s3Key);
  const truncated = extractedText.length >= MAX_TEXT_CHARS;

  // 5. Generate summary
  const summaryText = await generateSummary(extractedText, rubricLabels);

  // 6. Save to cache
  await saveSummary(competitionId, teamId, summaryText, BEDROCK_MODEL_ID);

  // 7. Return
  return {
    summaryText,
    summaryAt: new Date().toISOString(),
    cached: false,
    truncated,
  };
}

module.exports = {
  extractTextFromPdf,
  generateSummary,
  getCachedSummary,
  saveSummary,
  isRateLimited,
  generateOrGetSummary,
  BEDROCK_MODEL_ID,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_CHARS,
  MIN_TEXT_LENGTH,
  RATE_LIMIT_MS,
};
