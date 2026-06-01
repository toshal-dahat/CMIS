/**
 * Summary service — Textract text extraction + Bedrock AI summarization + DynamoDB caching.
 *
 * Pipeline: S3 (PDF) → Textract (extract text) → Bedrock Claude 3.5 Haiku (summarize) → DynamoDB (cache)
 *
 * Summaries are cached on the CompetitionSubmissions table item (summaryText, summaryAt, summaryModelId).
 * Shared across judges — first judge to request generates it, subsequent judges get the cached version.
 */

const { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const libreOfficeConverter = require("./libreOfficeConverter");

const textractClient = new TextractClient({});
const bedrockClient = new BedrockRuntimeClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const BUCKET = process.env.SUBMISSIONS_BUCKET;
const SUBMISSIONS_TABLE = process.env.SUBMISSIONS_TABLE;

// ── Config ─────────────────────────────────────────────
const BEDROCK_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const BEDROCK_MAX_OUTPUT_TOKENS = 600;

// ── Limits ─────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TEXT_CHARS = 600000;                  // ~150k tokens — well within Haiku's 200k limit
const MIN_TEXT_LENGTH = 50;                     // reject if Textract returns near-empty text
const RATE_LIMIT_MS = 60 * 1000;                // 60 seconds between regenerations per team
const TEXTRACT_POLL_INTERVAL_MS = 1500;          // poll every 1.5 seconds
const TEXTRACT_MAX_POLL_ATTEMPTS = 30;           // max 45 seconds waiting (30 * 1.5s)

// ── MIME types that need PPT/PPTX → PDF conversion before Textract ───────────
const PPT_MIME_TYPES = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * Sleep helper for polling.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract text from a multi-page PDF stored in S3 using Amazon Textract (async API).
 *
 * Uses StartDocumentTextDetection → poll GetDocumentTextDetection.
 * Supports PDFs of any page count (not limited to single page like the sync API).
 * Textract reads the document directly from S3.
 *
 * @param {string} s3Key - S3 object key of the PDF
 * @returns {Promise<string>} - Extracted text content
 * @throws {Error} with statusCode 422 if no text extracted, 504 if Textract times out
 */
async function extractTextFromPdf(s3Key) {
  // 1. Start the async text detection job
  const startResponse = await textractClient.send(new StartDocumentTextDetectionCommand({
    DocumentLocation: {
      S3Object: {
        Bucket: BUCKET,
        Name: s3Key,
      },
    },
  }));

  const jobId = startResponse.JobId;
  if (!jobId) {
    const err = new Error("Textract failed to start text detection job");
    err.statusCode = 502;
    throw err;
  }

  console.log(`Textract job started: ${jobId} for s3Key: ${s3Key}`);

  // 2. Poll until complete
  let status = "IN_PROGRESS";
  let attempts = 0;
  let allBlocks = [];

  while (status === "IN_PROGRESS" && attempts < TEXTRACT_MAX_POLL_ATTEMPTS) {
    await sleep(TEXTRACT_POLL_INTERVAL_MS);
    attempts++;

    const getResponse = await textractClient.send(new GetDocumentTextDetectionCommand({
      JobId: jobId,
    }));

    status = getResponse.JobStatus;

    if (status === "SUCCEEDED") {
      allBlocks = getResponse.Blocks || [];

      // Handle pagination — Textract may return results across multiple pages
      let nextToken = getResponse.NextToken;
      while (nextToken) {
        const nextPage = await textractClient.send(new GetDocumentTextDetectionCommand({
          JobId: jobId,
          NextToken: nextToken,
        }));
        allBlocks = allBlocks.concat(nextPage.Blocks || []);
        nextToken = nextPage.NextToken;
      }
    } else if (status === "FAILED") {
      const msg = getResponse.StatusMessage || "Unknown error";
      console.error(`Textract job failed: ${jobId} - ${msg}`);
      const err = new Error(`Text extraction failed: ${msg}`);
      err.statusCode = 422;
      throw err;
    }
  }

  if (status === "IN_PROGRESS") {
    console.error(`Textract job timed out after ${attempts} attempts: ${jobId}`);
    const err = new Error("Text extraction timed out. The document may be too complex. Please try again.");
    err.statusCode = 504;
    throw err;
  }

  // 3. Assemble text from LINE blocks (preserves reading order)
  const lines = allBlocks
    .filter(block => block.BlockType === "LINE")
    .map(block => block.Text || "");

  const text = lines.join("\n");

  console.log(`Textract completed: ${jobId}, ${lines.length} lines, ${text.length} chars`);

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
    "Summarize the following team submission concisely in a well-structured Markdown format.",
    "Focus on aspects relevant to these judging criteria: " + criteriaList + ".",
    "",
    "Structure the response with:",
    " - A brief ## Overview.",
    " - A section for each judging criterion using ### Heading levels.",
    " - Bullet points for specific findings.",
    "",
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
    console.error("Bedrock InvokeModel failed:", {
      name: bedrockErr.name,
      message: bedrockErr.message,
      code: bedrockErr.$metadata?.httpStatusCode,
      requestId: bedrockErr.$metadata?.requestId,
      modelId: BEDROCK_MODEL_ID,
    });
    const err = new Error(`AI summary generation failed: ${bedrockErr.name} - ${bedrockErr.message}`);
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
// PDF CONVERSION CACHE — PPT/PPTX get converted once, then reused
// ════════════════════════════════════════════════════════

/**
 * Get a previously-converted PDF key from the submission record (if any).
 */
async function getConvertedPdfKey(competitionId, teamId) {
  const result = await docClient.send(new GetCommand({
    TableName: SUBMISSIONS_TABLE,
    Key: { competitionId, teamId },
    ProjectionExpression: "convertedPdfKey",
  }));
  return result.Item?.convertedPdfKey || null;
}

/**
 * Persist the converted PDF's S3 key onto the submission record.
 * Uses UpdateCommand so it doesn't overwrite any other fields.
 */
async function saveConvertedPdfKey(competitionId, teamId, convertedPdfKey) {
  await docClient.send(new UpdateCommand({
    TableName: SUBMISSIONS_TABLE,
    Key: { competitionId, teamId },
    UpdateExpression: "SET convertedPdfKey = :ck, convertedPdfAt = :ca",
    ExpressionAttributeValues: {
      ":ck": convertedPdfKey,
      ":ca": new Date().toISOString(),
    },
  }));
}

/**
 * Resolve which S3 key to feed into Textract for this submission.
 *
 * - PDFs are used as-is.
 * - PPT/PPTX are converted via LibreOffice (cached after first conversion).
 * - Any other type throws 400.
 *
 * @param {Object} params
 * @param {string} params.competitionId
 * @param {string} params.teamId
 * @param {string} params.s3Key - Original submission key
 * @param {string} params.fileType - MIME type of the original submission
 * @returns {Promise<{ pdfS3Key: string, wasConverted: boolean }>}
 */
async function resolvePdfS3Key({ competitionId, teamId, s3Key, fileType }) {
  // PDF: nothing to do
  if (fileType === "application/pdf") {
    return { pdfS3Key: s3Key, wasConverted: false };
  }

  // PPT/PPTX: check conversion cache, else convert now
  if (PPT_MIME_TYPES.has(fileType)) {
    const cachedKey = await getConvertedPdfKey(competitionId, teamId);
    if (cachedKey) {
      console.log(`Using cached converted PDF for ${competitionId}/${teamId}: ${cachedKey}`);
      return { pdfS3Key: cachedKey, wasConverted: false };
    }

    console.log(`Converting ${fileType} to PDF for ${competitionId}/${teamId}...`);
    const convertedKey = await libreOfficeConverter.convertToPdf({
      sourceS3Key: s3Key,
      fileType,
      competitionId,
      teamId,
    });

    await saveConvertedPdfKey(competitionId, teamId, convertedKey);
    return { pdfS3Key: convertedKey, wasConverted: true };
  }

  // Anything else: reject clearly
  const err = new Error(
    `Cannot generate summary for file type '${fileType}'. Only PDF, PPT, and PPTX are supported.`
  );
  err.statusCode = 400;
  throw err;
}

// ════════════════════════════════════════════════════════
// ORCHESTRATOR — the main function called by the route handler
// ════════════════════════════════════════════════════════

/**
 * Generate or retrieve a cached summary for a team's submission.
 *
 * Flow:
 *   1. Check summary cache → return if exists and refresh not requested
 *   2. If refresh requested → check rate limit → return cached if too soon
 *   3. Validate ORIGINAL file size via headObject
 *   4. Resolve PDF key (convert PPT/PPTX → PDF if needed, or use cached conversion)
 *   5. Extract text via Textract on the PDF
 *   6. Generate summary via Bedrock
 *   7. Save summary to cache
 *   8. Return result
 *
 * @param {Object} params
 * @param {string} params.competitionId
 * @param {string} params.teamId
 * @param {string} params.s3Key - Original submission S3 key
 * @param {string} params.fileType - MIME type of the original submission
 * @param {string[]} params.rubricLabels - competition rubric criterion labels
 * @param {boolean} params.refresh - if true, regenerate even if cached
 * @param {Function} params.headObject - s3PresignService.headObject for size check
 * @returns {Promise<{ summaryText: string, summaryAt: string, cached: boolean, truncated: boolean }>}
 */
async function summarize({ competitionId, teamId, s3Key, fileType, rubricLabels, refresh, headObject }) {
  // 1. Check summary cache
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

  // 3. Validate ORIGINAL file size (applied to whatever the team uploaded)
  const fileInfo = await headObject(s3Key);
  if (fileInfo.contentLength > MAX_FILE_SIZE_BYTES) {
    const err = new Error(
      `File is too large to summarize (${Math.round(fileInfo.contentLength / 1024 / 1024)}MB). ` +
      `Maximum allowed size is ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.`
    );
    err.statusCode = 413;
    throw err;
  }

  // 4. Resolve to a PDF key (convert PPT/PPTX if necessary, cache the result)
  const resolvedType = fileType || "application/pdf";
  const { pdfS3Key, wasConverted } = await resolvePdfS3Key({
    competitionId,
    teamId,
    s3Key,
    fileType: resolvedType,
  });
  if (wasConverted) {
    console.log(`Converted ${resolvedType} to PDF: ${pdfS3Key}`);
  }

  // 5. Extract text via Textract (always runs on a PDF now)
  const extractedText = await extractTextFromPdf(pdfS3Key);
  const truncated = extractedText.length >= MAX_TEXT_CHARS;

  // 6. Generate summary
  const summaryText = await generateSummary(extractedText, rubricLabels);

  // 7. Save to cache
  await saveSummary(competitionId, teamId, summaryText, BEDROCK_MODEL_ID);

  // 8. Return
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
  getConvertedPdfKey,
  saveConvertedPdfKey,
  resolvePdfS3Key,
  summarize,
  BEDROCK_MODEL_ID,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_CHARS,
  MIN_TEXT_LENGTH,
  RATE_LIMIT_MS,
  PPT_MIME_TYPES,
};
