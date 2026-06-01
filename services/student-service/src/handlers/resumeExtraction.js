/**
 * S3-triggered resume extraction pipeline.
 *
 * Flow:
 * 1) S3 ObjectCreated on uploaded PDF
 * 2) OCR with Textract (DetectDocumentText)
 * 3) LLM extraction to strict JSON: { skills: string[], gpa: number|null }
 * 4) Persist extraction back to Resumes record
 */
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const resumesService = require("../services/resumesService");

const s3 = new S3Client({});
const textract = new TextractClient({});
const bedrock = new BedrockRuntimeClient({});

const BEDROCK_MODEL_ID = process.env.RESUME_PARSER_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";
const MAX_TEXT_CHARS = 12000;

function parseS3Key(s3Key) {
  const m = /^resumes\/USER#([^/]+)\/([^/.]+)\.pdf$/i.exec(s3Key || "");
  if (!m) return null;
  return { userSub: m[1], resumeId: m[2] };
}

function normalizeExtraction(parsed) {
  const skills = Array.isArray(parsed?.skills)
    ? parsed.skills.map((s) => String(s).trim()).filter(Boolean)
    : [];

  let gpa = null;
  const rawGpa = parsed?.gpa;
  if (typeof rawGpa === "number" && Number.isFinite(rawGpa)) gpa = rawGpa;
  if (typeof rawGpa === "string") {
    const n = Number.parseFloat(rawGpa);
    if (Number.isFinite(n)) gpa = n;
  }

  return { skills, gpa };
}

async function extractTextFromPdf(bucket, key) {
  const resp = await textract.send(
    new DetectDocumentTextCommand({
      Document: { S3Object: { Bucket: bucket, Name: key } },
    })
  );
  const lines = (resp.Blocks || [])
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text);
  const text = lines.join("\n").trim();
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

async function runLlmExtraction(ocrText) {
  const prompt = [
    "Extract structured resume data from OCR text.",
    "Return JSON only with this exact shape:",
    '{"skills": ["..."], "gpa": 3.5}',
    "Rules:",
    "- skills: list technical/professional skills found in text",
    "- gpa: number if explicitly present, else null",
    "- no markdown, no commentary, no extra keys",
    "",
    "OCR_TEXT:",
    ocrText || "",
  ].join("\n");

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 400,
    temperature: 0,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body,
    })
  );

  const parsedBody = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const outputText = parsedBody?.content?.[0]?.text || "{}";
  return normalizeExtraction(JSON.parse(outputText));
}

async function processRecord(bucket, s3Key) {
  const parsedKey = parseS3Key(s3Key);
  if (!parsedKey) {
    console.warn("[resume-extract] key did not match expected pattern:", s3Key);
    return;
  }

  const { userSub, resumeId } = parsedKey;
  const existing = await resumesService.get(userSub, resumeId);
  if (!existing) {
    console.warn("[resume-extract] no resume record found for key:", s3Key);
    return;
  }

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
    await resumesService.markUploaded(userSub, resumeId, {
      fileSize: head.ContentLength ?? 0,
      etag: head.ETag ?? "",
    });

    const text = await extractTextFromPdf(bucket, s3Key);
    const extracted = await runLlmExtraction(text);
    await resumesService.markExtracted(userSub, resumeId, extracted);
  } catch (err) {
    await resumesService.markExtractionFailed(userSub, resumeId, err?.message || "extraction_failed");
    throw err;
  }
}

async function onS3Upload(event) {
  const records = event?.Records || [];
  for (const record of records) {
    const bucket = record?.s3?.bucket?.name;
    const key = decodeURIComponent((record?.s3?.object?.key || "").replace(/\+/g, " "));
    if (!bucket || !key.toLowerCase().endsWith(".pdf")) continue;
    await processRecord(bucket, key);
  }
  return { processed: records.length };
}

module.exports = {
  onS3Upload,
};
