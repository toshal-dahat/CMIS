/**
 * S3-triggered resume extraction pipeline.
 *
 * Flow:
 * 1) S3 ObjectCreated on uploaded PDF
 * 2) OCR with Textract (DetectDocumentText)
 * 3) LLM extraction to strict JSON
 * 4) Resolve skills against MasterSkills (+ Bedrock for unknowns)
 * 5) Persist extraction on Resumes; merge into StudentProfiles when profile exists
 */
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
const resumesService = require("../services/resumesService");
const studentProfilesService = require("../services/studentProfilesService");
const { parseModelJsonOutput } = require("../lib/resumeExtractionJson");
const { pickMostRecentGpa, parseGpaValue } = require("../lib/educationGpa");
const { resolveSkills } = require("../lib/skillResolution");

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

function normalizeEducationEntry(e) {
  const institution = asTrimmedString(e?.institution);
  const degreeDiploma = asTrimmedString(e?.degreeDiploma ?? e?.degree);
  const specialization = asTrimmedString(e?.specialization ?? e?.field);
  const dates = asTrimmedString(e?.dates);
  const details = asTrimmedString(e?.details);
  let gpa = null;
  const rawGpa = e?.gpa;
  if (typeof rawGpa === "number" && Number.isFinite(rawGpa)) gpa = rawGpa;
  else if (typeof rawGpa === "string" && rawGpa.trim()) {
    const n = parseGpaValue(rawGpa);
    gpa = n;
  }
  return {
    institution,
    degreeDiploma,
    specialization,
    gpa,
    dates,
    details,
  };
}

function normalizeExtra(parsed) {
  const ex = parsed?.extra && typeof parsed.extra === "object" ? parsed.extra : {};
  const projects = Array.isArray(ex?.projects)
    ? ex.projects
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

  const asStringList = (v) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

  return {
    projects,
    extracurricular: asStringList(ex?.extracurricular),
    achievements: asStringList(ex?.achievements),
    other: asStringList(ex?.other),
  };
}

function normalizeExtraction(parsed) {
  const skills = Array.isArray(parsed?.skills)
    ? parsed.skills.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const loc = asTrimmedString(parsed?.location);
  const location = loc || null;

  const education = Array.isArray(parsed?.education)
    ? parsed.education.map(normalizeEducationEntry).filter(
        (e) =>
          e.institution ||
          e.degreeDiploma ||
          e.specialization ||
          e.details ||
          e.dates ||
          e.gpa != null
      )
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

  const extra = normalizeExtra(parsed);

  const profileGpa = pickMostRecentGpa(education);

  return {
    skills,
    profileGpa,
    location,
    education,
    experience,
    extra,
  };
}

async function invokeBedrockUserPrompt(prompt) {
  const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
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
    '- skills: string[] — every distinct professional/technical skill; split comma-separated lists.',
    '- location: string | null — city/region/country if clearly stated; else null.',
    "- education: array of objects. Each object MUST use these string fields (use \"\" if unknown):",
    '  institution, degreeDiploma, specialization, gpa (number or string per school if listed), dates, details',
    "- experience: array of objects { company, title, dates, highlights: string[] } — one entry per role.",
    "- extra: object with keys: projects, extracurricular, achievements, other.",
    "  - projects: array of { name, description, dates, technologies: string[] }",
    "  - extracurricular: string[] (clubs, leadership, volunteer lines)",
    "  - achievements: string[] (awards, honors, certifications not under education)",
    "  - other: string[] (anything else not covered above)",
    "Do not use markdown fences or prose outside JSON.",
    "Do not add keys other than: skills, location, education, experience, extra.",
    "",
    "OCR_TEXT:",
    ocrText || "",
  ].join("\n");
}

function buildRetryExtractionPrompt(ocrText) {
  return [
    "Your previous reply was not valid JSON.",
    "Reply with ONLY a single JSON object and nothing else — no prose, no markdown.",
    "Include keys: skills, location, education, experience, extra (same rules as the primary prompt).",
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

async function mergeExtractedIntoProfile(userSub, extracted, skillsResolved) {
  const profile = await studentProfilesService.getByUserId(userSub);
  if (!profile) return;

  const payload = {
    education: extracted.education ?? [],
    skillIds: skillsResolved.map((s) => s.skillId),
    experience: extracted.experience ?? [],
    resumeExtra: extracted.extra ?? {},
  };
  if (extracted.profileGpa != null) {
    payload.gpa = String(extracted.profileGpa);
  }

  await studentProfilesService.update(userSub, payload);
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

    let skillsResolved = [];
    try {
      skillsResolved = await resolveSkills({ bedrock, modelId: BEDROCK_MODEL_ID }, extracted.skills);
    } catch (e) {
      console.warn("[resume-extract] skill resolution failed:", e?.message || e);
    }

    await resumesService.markExtracted(userSub, resumeId, {
      ...extracted,
      skillsResolved,
    });

    try {
      await mergeExtractedIntoProfile(userSub, extracted, skillsResolved);
    } catch (e) {
      console.warn("[resume-extract] profile merge failed:", e?.message || e);
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
