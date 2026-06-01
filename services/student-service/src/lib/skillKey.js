/**
 * Normalize a resume skill string for lookup in MasterSkills (partition key).
 * Lowercase, collapse whitespace, strip punctuation except + and # (e.g. C++, C#).
 */
function normalizeSkillKey(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  return s
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9+#]/g, "");
}

module.exports = { normalizeSkillKey };
