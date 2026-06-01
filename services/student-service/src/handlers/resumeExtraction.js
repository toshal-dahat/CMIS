/**
 * S3-triggered resume extraction pipeline.
 *
 * Flow:
 * 1) S3 ObjectCreated on uploaded PDF
 * 2) OCR with Textract (DetectDocumentText)
 * 3) LLM extraction to strict JSON (skills, gpa, location, education, experience, projects, achievements)
 * 4) Persist extraction back to Resumes record
 */
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const resumesService = require("../services/resumesService");
const studentProfilesService = require("../services/studentProfilesService");
const skillResolutionService = require("../services/skillResolutionService");

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

function asTrimmedString(v) {
  if (v == null) return "";
  return String(v).trim();
}

function parseOptionalGpa(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function normalizeExtraction(parsed) {
  const skills = Array.isArray(parsed?.skills)
    ? parsed.skills.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const loc = asTrimmedString(parsed?.location);
  const location = loc || null;

  const education = Array.isArray(parsed?.education)
    ? parsed.education
        .map((e) => ({
          institution: asTrimmedString(e?.institution),
          degree: asTrimmedString(e?.degree),
          field: asTrimmedString(e?.field),
          dates: asTrimmedString(e?.dates),
          details: asTrimmedString(e?.details),
          gpa: parseOptionalGpa(e?.gpa),
        }))
        .filter((e) => e.institution || e.degree || e.field || e.details || e.dates || e.gpa != null)
    : [];

  const experience = Array.isArray(parsed?.experience)
    ? parsed.experience
        .map((x) => ({
          company: asTrimmedString(x?.company),
          title: asTrimmedString(x?.title),
          dates: asTrimmedString(x?.dates),
          highlights: Array.isArray(x?.highlights)
            ? x.highlights.map((h) => String(h).trim()).filter(Boolean)
            : [],
        }))
        .filter((x) => x.company || x.title || x.highlights.length || x.dates)
    : [];

  const projects = Array.isArray(parsed?.projects)
    ? parsed.projects
        .map((p) => ({
          name: asTrimmedString(p?.name),
          description: asTrimmedString(p?.description),
          dates: asTrimmedString(p?.dates),
          technologies: Array.isArray(p?.technologies)
            ? p.technologies.map((t) => String(t).trim()).filter(Boolean)
            : [],
        }))
        .filter((p) => p.name || p.description)
    : [];

  const achievements = Array.isArray(parsed?.achievements)
    ? parsed.achievements.map((a) => String(a).trim()).filter(Boolean)
    : [];

  return {
    skills,
    location,
    education,
    experience,
    projects,
    achievements,
  };
}

/**
 * Strip common markdown code fences from model output.
 */
function stripMarkdownFences(text) {
  const t = (text ?? "").trim();
  const wrapped = t.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i);
  if (wrapped) return wrapped[1].trim();
  return t;
}

/**
 * Extract a top-level {...} substring (first { through last }) for prose-prefixed replies.
 */
function extractJsonObjectSubstring(text) {
  const t = (text ?? "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + 1);
}

/**
 * Parse JSON from LLM text that may include preamble, markdown, or labels.
 */
function parseModelJsonOutput(outputText) {
  const raw = (outputText ?? "").trim();
  if (!raw) {
    const err = new Error("Empty model output");
    err.code = "JSON_PARSE";
    throw err;
  }

  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(stripMarkdownFences(raw)),
    () => {
      const sub = extractJsonObjectSubstring(stripMarkdownFences(raw)) || extractJsonObjectSubstring(raw);
      if (!sub) throw new Error("No JSON object found in model output");
      return JSON.parse(sub);
    },
  ];

  let lastErr;
  for (const fn of attempts) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(lastErr?.message || "Failed to parse model JSON");
  err.code = "JSON_PARSE";
  err.cause = lastErr;
  throw err;
}

async function invokeBedrockUserPrompt(prompt) {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
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
  return parsedBody?.content?.[0]?.text ?? "";
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

function buildPrimaryExtractionPrompt(ocrText) {
  return [
    "Extract structured resume data from the OCR text below. Infer sections from headings and layout when labels are missing.",
    "Output requirements (strict):",
    "- Respond with ONE JSON object only — the first character must be { and the last must be }.",
    "Required keys (use null or [] when unknown):",
    '- skills: string[] — every distinct professional/technical skill; split comma-separated lists (including under category lines like "Product Management: a, b").',
    "- education: array of objects { institution, degree, field, dates, details, gpa } — strings for text fields and number|null for gpa.",
    "  - gpa should be the GPA for that specific education entry only (if explicitly present for that school/program).",
    "  - if GPA is not tied to a specific education entry, leave gpa as null.",
    '- location: string | null — city/region/country or mailing location if clearly stated; else null.',
    "- experience: array of objects { company, title, dates, highlights: string[] } — one entry per role; highlights are bullet achievements.",
    "- projects: array of objects { name, description, dates, technologies: string[] }.",
    "- achievements: string[] — awards, honors, certifications summary lines not already captured elsewhere.",
    "Do not use markdown fences, labels, or sentences (do not write 'Here is', 'JSON', or ```).",
    "Do not add keys other than: skills, location, education, experience, projects, achievements.",
    "",
    "OCR_TEXT:",
    ocrText || "",
  ].join("\n");
}

function buildRetryExtractionPrompt(ocrText) {
  return [
    "Your previous reply was not valid JSON.",
    "Reply with ONLY a single JSON object and nothing else — no prose, no markdown.",
    "Include keys: skills, location, education, experience, projects, achievements (same rules as the primary prompt).",
    "Use [] or null for empty sections.",
    "",
    "OCR_TEXT:",
    ocrText || "",
  ].join("\n");
}

async function runLlmExtraction(ocrText) {
  let outputText = await invokeBedrockUserPrompt(buildPrimaryExtractionPrompt(ocrText));
  try {
    return normalizeExtraction(parseModelJsonOutput(outputText));
  } catch (firstErr) {
    console.warn("[resume-extract] primary JSON parse failed, retrying:", firstErr?.message || firstErr);
  }

  outputText = await invokeBedrockUserPrompt(buildRetryExtractionPrompt(ocrText));
  return normalizeExtraction(parseModelJsonOutput(outputText));
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

    let skillKeys = [];
    try {
      skillKeys = await skillResolutionService.resolveRawSkillsToKeys(extracted.skills);
    } catch (skillErr) {
      console.warn("[resume-extract] skill resolution failed:", skillErr?.message || skillErr);
    }

    try {
      await studentProfilesService.mergeExtractionIntoProfile(userSub, {
        education: extracted.education,
        skillKeys,
      });
    } catch (mergeErr) {
      console.warn("[resume-extract] profile merge failed:", mergeErr?.message || mergeErr);
    }
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
