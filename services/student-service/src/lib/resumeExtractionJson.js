/**
 * Parse JSON from LLM text (shared by resume extraction and skill batching).
 */

function stripMarkdownFences(text) {
  const t = (text ?? "").trim();
  const wrapped = t.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i);
  if (wrapped) return wrapped[1].trim();
  return t;
}

function extractJsonObjectSubstring(text) {
  const t = (text ?? "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + 1);
}

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

module.exports = {
  stripMarkdownFences,
  extractJsonObjectSubstring,
  parseModelJsonOutput,
};
