/**
 * Normalized skill keys must match infrastructure/student/terraform/seed_master_skills.py
 * and UUID v5 namespace below.
 */
const { v5: uuidv5 } = require("uuid");

const SKILL_NAMESPACE = "a3bb189e-8bf9-3888-8fa9-aa6088a1fc2d";

function normalizeKey(canonical) {
  let s = String(canonical ?? "")
    .toLowerCase()
    .trim();
  const replacements = [
    ["c++", "cplusplus"],
    ["c#", "csharp"],
    ["f#", "fsharp"],
    [".net", "dotnet"],
  ];
  for (const [old, neu] of replacements) {
    s = s.split(old).join(neu);
  }
  s = s.replace(/[^a-z0-9]+/g, "");
  return s;
}

function skillIdFromNormalizedKey(normalizedKey) {
  return uuidv5(normalizedKey, SKILL_NAMESPACE);
}

module.exports = {
  SKILL_NAMESPACE,
  normalizeKey,
  skillIdFromNormalizedKey,
};
