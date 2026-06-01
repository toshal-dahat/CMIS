/**
 * Summary service for competition submissions.
 *
 * Active flows:
 * - PDF  -> Textract -> Bedrock summary
 * - PPT  -> LibreOffice -> PDF -> Textract -> Bedrock summary
 * - PPTX -> dedicated PPTX extractor Lambda -> Bedrock multimodal summary
 *
 * Legacy PPTX conversion logic is intentionally kept in comments near the
 * PPTX branch so we can fall back quickly during debugging if needed.
 */

const { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const libreOfficeConverter = require("./libreOfficeConverter");
const pptxExtractionService = require("./pptxExtractionService");

const textractClient = new TextractClient({});
const bedrockClient = new BedrockRuntimeClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BUCKET = process.env.SUBMISSIONS_BUCKET;
const SUBMISSIONS_TABLE = process.env.SUBMISSIONS_TABLE;

const BEDROCK_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const BEDROCK_MAX_OUTPUT_TOKENS = 700;

const PDF_MIME_TYPE = "application/pdf";
const PPT_MIME_TYPE = "application/vnd.ms-powerpoint";
const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPT_MIME_TYPES = new Set([PPT_MIME_TYPE, PPTX_MIME_TYPE]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 600000;
const MIN_TEXT_LENGTH = 50;
const RATE_LIMIT_MS = 60 * 1000;
const TEXTRACT_POLL_INTERVAL_MS = 1500;
const TEXTRACT_MAX_POLL_ATTEMPTS = 30;
const MAX_PPTX_IMAGES_IN_PROMPT = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractTextFromPdf(s3Key) {
  const startResponse = await textractClient.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: BUCKET,
          Name: s3Key,
        },
      },
    })
  );

  const jobId = startResponse.JobId;
  if (!jobId) {
    const err = new Error("Textract failed to start text detection job.");
    err.statusCode = 502;
    throw err;
  }

  let status = "IN_PROGRESS";
  let attempts = 0;
  let allBlocks = [];

  while (status === "IN_PROGRESS" && attempts < TEXTRACT_MAX_POLL_ATTEMPTS) {
    await sleep(TEXTRACT_POLL_INTERVAL_MS);
    attempts += 1;

    const getResponse = await textractClient.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
      })
    );

    status = getResponse.JobStatus;

    if (status === "SUCCEEDED") {
      allBlocks = getResponse.Blocks || [];

      let nextToken = getResponse.NextToken;
      while (nextToken) {
        const nextPage = await textractClient.send(
          new GetDocumentTextDetectionCommand({
            JobId: jobId,
            NextToken: nextToken,
          })
        );
        allBlocks = allBlocks.concat(nextPage.Blocks || []);
        nextToken = nextPage.NextToken;
      }
    } else if (status === "FAILED") {
      const msg = getResponse.StatusMessage || "Unknown Textract error";
      const err = new Error(`Text extraction failed: ${msg}`);
      err.statusCode = 422;
      throw err;
    }
  }

  if (status === "IN_PROGRESS") {
    const err = new Error("Text extraction timed out. The document may be too complex. Please try again.");
    err.statusCode = 504;
    throw err;
  }

  const lines = allBlocks
    .filter((block) => block.BlockType === "LINE")
    .map((block) => block.Text || "");
  const text = lines.join("\n");

  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    const err = new Error(
      "Could not extract meaningful text from this file. The submission may be mostly visual content."
    );
    err.statusCode = 422;
    throw err;
  }

  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

function buildCriteriaList(rubricLabels) {
  if (Array.isArray(rubricLabels) && rubricLabels.length > 0) {
    return rubricLabels.join(", ");
  }
  return "Presentation Quality, Analysis & Research, Creativity & Innovation, Feasibility of Solution, Teamwork & Delivery";
}

async function invokeBedrock(content) {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: BEDROCK_MAX_OUTPUT_TOKENS,
    temperature: 0,
    messages: [{ role: "user", content }],
  });

  let response;
  try {
    response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body,
      })
    );
  } catch (bedrockErr) {
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

  return summaryText;
}

async function generateSummary(extractedText, rubricLabels) {
  const criteriaList = buildCriteriaList(rubricLabels);
  const prompt = [
    "You are assisting judges in a university case competition.",
    "Summarize the following team submission concisely in Markdown.",
    `Focus on these judging criteria: ${criteriaList}.`,
    "",
    "Structure the response with:",
    "- A brief ## Overview section.",
    "- One ### section per judging criterion.",
    "- Bullet points for specific findings.",
    "",
    "Be objective and factual. Do not assign scores.",
    "If the document contains diagrams or charts, note that visual content exists but could not be analyzed directly.",
    "",
    "--- SUBMISSION TEXT ---",
    extractedText,
  ].join("\n");

  return invokeBedrock([{ type: "text", text: prompt }]);
}

function buildPptxContext(extraction) {
  const sections = [];

  for (const slide of extraction.slides || []) {
    sections.push(`## Slide ${slide.slideNumber}: ${slide.title || `Slide ${slide.slideNumber}`}`);

    if (slide.textBlocks?.length) {
      sections.push("Text:");
      slide.textBlocks.forEach((block) => sections.push(`- ${block}`));
    }

    if (slide.tableRows?.length) {
      sections.push("Tables:");
      slide.tableRows.forEach((row) => sections.push(`- ${row}`));
    }

    if (slide.chartSummaries?.length) {
      sections.push("Charts:");
      slide.chartSummaries.forEach((summary) => sections.push(`- ${summary}`));
    }

    if (slide.notes) {
      sections.push("Speaker notes:");
      sections.push(slide.notes);
    }

    if (slide.images?.length) {
      sections.push(`Images on slide: ${slide.images.length}`);
    }

    sections.push("");
  }

  const joined = sections.join("\n").trim();
  return joined.length > MAX_TEXT_CHARS ? joined.slice(0, MAX_TEXT_CHARS) : joined;
}

async function generatePptxSummary(extraction, rubricLabels) {
  const contextText = buildPptxContext(extraction);
  if (!contextText && !(extraction.images || []).length) {
    const err = new Error("Could not extract usable text or images from this PPTX.");
    err.statusCode = 422;
    throw err;
  }

  const criteriaList = buildCriteriaList(rubricLabels);
  const prompt = [
    "You are assisting judges in a university case competition.",
    "Summarize this PowerPoint submission in Markdown using both the extracted slide content and the provided slide images.",
    `Focus on these judging criteria: ${criteriaList}.`,
    "",
    "Structure the response with:",
    "- A brief ## Overview section.",
    "- One ### section per judging criterion.",
    "- Bullet points for evidence-based observations.",
    "",
    "You may reference charts, layouts, and images if visible, but do not invent details that are not present.",
    "Do not assign scores.",
    "",
    "--- EXTRACTED SLIDE CONTENT ---",
    contextText || "No extractable slide text was found.",
  ].join("\n");

  const content = [{ type: "text", text: prompt }];
  for (const image of (extraction.images || []).slice(0, MAX_PPTX_IMAGES_IN_PROMPT)) {
    if (!image.base64Data || !image.contentType) {
      continue;
    }

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.contentType,
        data: image.base64Data,
      },
    });
  }

  return invokeBedrock(content);
}

async function getCachedSummary(competitionId, teamId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: SUBMISSIONS_TABLE,
      Key: { competitionId, teamId },
      ProjectionExpression: "summaryText, summaryAt, summaryModelId",
    })
  );

  const item = result.Item;
  if (!item || !item.summaryText) {
    return null;
  }

  return {
    summaryText: item.summaryText,
    summaryAt: item.summaryAt,
    summaryModelId: item.summaryModelId,
  };
}

async function saveSummary(competitionId, teamId, summaryText, modelId) {
  await docClient.send(
    new UpdateCommand({
      TableName: SUBMISSIONS_TABLE,
      Key: { competitionId, teamId },
      UpdateExpression: "SET summaryText = :st, summaryAt = :sa, summaryModelId = :mid",
      ExpressionAttributeValues: {
        ":st": summaryText,
        ":sa": new Date().toISOString(),
        ":mid": modelId,
      },
    })
  );
}

function isRateLimited(summaryAt) {
  if (!summaryAt) {
    return false;
  }
  const elapsed = Date.now() - new Date(summaryAt).getTime();
  return elapsed < RATE_LIMIT_MS;
}

async function getConvertedPdfKey(competitionId, teamId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: SUBMISSIONS_TABLE,
      Key: { competitionId, teamId },
      ProjectionExpression: "convertedPdfKey",
    })
  );
  return result.Item?.convertedPdfKey || null;
}

async function saveConvertedPdfKey(competitionId, teamId, convertedPdfKey) {
  await docClient.send(
    new UpdateCommand({
      TableName: SUBMISSIONS_TABLE,
      Key: { competitionId, teamId },
      UpdateExpression: "SET convertedPdfKey = :ck, convertedPdfAt = :ca",
      ExpressionAttributeValues: {
        ":ck": convertedPdfKey,
        ":ca": new Date().toISOString(),
      },
    })
  );
}

async function resolvePdfS3Key({ competitionId, teamId, s3Key, fileType }) {
  if (fileType === PDF_MIME_TYPE) {
    return { pdfS3Key: s3Key, wasConverted: false };
  }

  if (fileType === PPT_MIME_TYPE) {
    const cachedKey = await getConvertedPdfKey(competitionId, teamId);
    if (cachedKey) {
      return { pdfS3Key: cachedKey, wasConverted: false };
    }

    const convertedKey = await libreOfficeConverter.convertToPdf({
      sourceS3Key: s3Key,
      fileType,
      competitionId,
      teamId,
    });
    await saveConvertedPdfKey(competitionId, teamId, convertedKey);
    return { pdfS3Key: convertedKey, wasConverted: true };
  }

  const err = new Error(
    `Cannot generate summary for file type '${fileType}'. Only PDF, PPT, and PPTX are supported.`
  );
  err.statusCode = 400;
  throw err;
}

async function summarize({ competitionId, teamId, s3Key, fileType, rubricLabels, refresh, headObject }) {
  const cached = await getCachedSummary(competitionId, teamId);

  if (cached && !refresh) {
    return {
      summaryText: cached.summaryText,
      summaryAt: cached.summaryAt,
      cached: true,
      truncated: false,
    };
  }

  if (cached && refresh && isRateLimited(cached.summaryAt)) {
    return {
      summaryText: cached.summaryText,
      summaryAt: cached.summaryAt,
      cached: true,
      truncated: false,
    };
  }

  const fileInfo = await headObject(s3Key);
  if (fileInfo.contentLength > MAX_FILE_SIZE_BYTES) {
    const err = new Error(
      `File is too large to summarize (${Math.round(fileInfo.contentLength / 1024 / 1024)}MB). ` +
      `Maximum allowed size is ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.`
    );
    err.statusCode = 413;
    throw err;
  }

  const resolvedType = fileType || PDF_MIME_TYPE;

  if (resolvedType === PPTX_MIME_TYPE) {
    const extraction = await pptxExtractionService.extractPptx({
      bucket: BUCKET,
      s3Key,
      competitionId,
      teamId,
    });

    const summaryText = await generatePptxSummary(extraction, rubricLabels);
    await saveSummary(competitionId, teamId, summaryText, BEDROCK_MODEL_ID);

    return {
      summaryText,
      summaryAt: new Date().toISOString(),
      cached: false,
      truncated: (extraction.allText || "").length >= MAX_TEXT_CHARS,
    };
  }

  // Legacy PPTX fallback retained for quick rollback during debugging.
  // const { pdfS3Key } = await resolvePdfS3Key({
  //   competitionId,
  //   teamId,
  //   s3Key,
  //   fileType: PPTX_MIME_TYPE,
  // });

  const { pdfS3Key } = await resolvePdfS3Key({
    competitionId,
    teamId,
    s3Key,
    fileType: resolvedType,
  });

  const extractedText = await extractTextFromPdf(pdfS3Key);
  const summaryText = await generateSummary(extractedText, rubricLabels);
  await saveSummary(competitionId, teamId, summaryText, BEDROCK_MODEL_ID);

  return {
    summaryText,
    summaryAt: new Date().toISOString(),
    cached: false,
    truncated: extractedText.length >= MAX_TEXT_CHARS,
  };
}

module.exports = {
  extractTextFromPdf,
  generateSummary,
  generatePptxSummary,
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
  PPTX_MIME_TYPE,
};
