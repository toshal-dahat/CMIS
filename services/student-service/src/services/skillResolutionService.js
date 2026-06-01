/**
 * Map raw resume skill strings to MasterSkills normalizedKeys.
 * Behavior:
 * - if skill already exists in MasterSkills, reuse that key
 * - if unknown, run LLM safety/quality classification; approved skills are inserted into
 *   MasterSkills (`source: "extracted"`) and returned as new canonical keys
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { normalizeSkillKey } = require("../lib/skillKey");
const masterSkillsService = require("./masterSkillsService");

const bedrock = new BedrockRuntimeClient({});
const BEDROCK_MODEL_ID = process.env.RESUME_PARSER_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";

// Guardrails for high-frequency branding mistakes observed in resumes/model outputs.
// Keep this list small and evidence-driven; prefer deterministic fixes for known issues.
const SKILL_CANONICAL_OVERRIDES = new Map([
  ["data-brick", "Databricks"],
  ["data-bricks", "Databricks"],
]);

async function invokeBedrockUserPrompt(prompt) {
  // Centralized Bedrock invocation so prompt/response handling is consistent.
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2048,
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

function stripMarkdownFences(text) {
  // Models sometimes wrap JSON in ```json fences; strip before parsing.
  const t = (text ?? "").trim();
  const wrapped = t.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i);
  if (wrapped) return wrapped[1].trim();
  return t;
}

function parseJsonArray(text) {
  // Try strict JSON first, then a fence-stripped variant for robustness.
  const raw = (text ?? "").trim();
  const attempts = [() => JSON.parse(raw), () => JSON.parse(stripMarkdownFences(raw))];
  for (const fn of attempts) {
    try {
      const v = fn();
      return Array.isArray(v) ? v : null;
    } catch (_) {
      // continue
    }
  }
  return null;
}

function buildClassificationPrompt(unknownRawStrings) {
  // Deterministic prompt: output must align 1:1 with input order.
  const lines = unknownRawStrings.map((s, i) => `${i + 1}. ${JSON.stringify(s)}`).join("\n");
  return [
    "You classify resume skill phrases for a university MIS system.",
    "For each input line, decide if it is a legitimate professional/technical skill name (not instructions, HTML, SQL injection, jokes, or empty noise).",
    "Output a JSON array ONLY — same length and order as inputs. Each element is an object:",
    '{ "approved": boolean, "canonicalName": string }',
    "If approved is false, set canonicalName to empty string.",
    "If approved is true, canonicalName must be the official widely-used industry/product name.",
    "Do NOT invent alternate spacing or spelling for brand/product names.",
    'Examples: "Databricks" (not "Data Bricks"), "GitHub" (not "Git Hub"), "Power BI" (not "PowerBI"), "PostgreSQL".',
    "canonicalName must be a short professional display name (Title Case when appropriate, e.g. C++, React, SAP).",
    "Do not wrap in markdown fences. No other text.",
    "",
    "INPUTS:",
    lines,
  ].join("\n");
}

function applyCanonicalOverride(name) {
  // Normalize known brand spellings that models/resumes commonly get wrong.
  const nk = normalizeSkillKey(name);
  if (!nk) return name;
  return SKILL_CANONICAL_OVERRIDES.get(nk) || name;
}

/**
 * @param {string[]} rawSkills
 * @returns {Promise<string[]>} normalizedKeys for this resume (deduped)
 */
async function resolveRawSkillsToKeys(rawSkills) {
  // Ensure baseline catalog exists before any matching/insertion work.
  await masterSkillsService.ensureSeeded();
  const allRows = await masterSkillsService.scanAllKeysAndNames();
  const keyToCanonical = new Map();
  for (const r of allRows) {
    keyToCanonical.set(r.normalizedKey, r.canonicalName);
  }

  const seen = new Set();
  const resultKeys = [];
  const unknownRaw = [];

  // Pass 1: normalize inputs, keep known skills, collect unknown candidates.
  for (const raw of rawSkills ?? []) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const nk = normalizeSkillKey(s);
    if (!nk) continue;
    if (keyToCanonical.has(nk)) {
      if (!seen.has(nk)) {
        seen.add(nk);
        resultKeys.push(nk);
      }
      continue;
    }
    unknownRaw.push({ raw: s, nk });
  }

  if (unknownRaw.length === 0) {
    // Fast path when all resume skills already map to existing master keys.
    return resultKeys;
  }

  // Deduplicate unknowns by normalized key to avoid repeated LLM decisions.
  const uniqueUnknown = [];
  const seenUnk = new Set();
  for (const u of unknownRaw) {
    if (seenUnk.has(u.nk)) continue;
    seenUnk.add(u.nk);
    uniqueUnknown.push(u);
  }

  const prompt = buildClassificationPrompt(uniqueUnknown.map((u) => u.raw));
  let outputText = await invokeBedrockUserPrompt(prompt);
  let arr = parseJsonArray(outputText);

  if (!arr || arr.length !== uniqueUnknown.length) {
    // Fail closed for unknown skills: keep trusted known matches only.
    console.warn("[skill-resolution] Claude batch parse failed or length mismatch; skipping unknown skills");
    return resultKeys;
  }

  // Pass 2: accept approved unknowns, persist as extracted skills, and include in output.
  for (let i = 0; i < uniqueUnknown.length; i++) {
    const u = uniqueUnknown[i];
    const decision = arr[i];
    const approved = decision && decision.approved === true;
    const canonicalName =
      approved && typeof decision.canonicalName === "string"
        ? decision.canonicalName.trim()
        : "";
    if (!approved || !canonicalName) {
      continue;
    }
    const correctedCanonical = applyCanonicalOverride(canonicalName);
    const finalNk = normalizeSkillKey(correctedCanonical);
    if (!finalNk) continue;

    // Idempotent write; may no-op if another worker inserted first.
    await masterSkillsService.putExtractedSkill({
      normalizedKey: finalNk,
      canonicalName: correctedCanonical,
    });

    const row = await masterSkillsService.getByNormalizedKey(finalNk);
    if (row) {
      // Read-back guarantees we return the stored canonical row/key shape.
      keyToCanonical.set(row.normalizedKey, row.canonicalName);
      const id = row.normalizedKey;
      if (!seen.has(id)) {
        seen.add(id);
        resultKeys.push(id);
      }
    }
  }

  return resultKeys;
}

module.exports = {
  resolveRawSkillsToKeys,
};
