const crypto = require("crypto");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const mentorshipEmbeddingsStore = require("./mentorshipEmbeddingsStore");

const bedrock = new BedrockRuntimeClient({});

const EMBEDDING_MODEL_ID =
  process.env.MENTORSHIP_EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0";
const EMBEDDING_ENABLED = String(process.env.MENTORSHIP_EMBEDDINGS_ENABLED || "true").toLowerCase() !== "false";
const MAX_TEXT_CHARS = Number(process.env.MENTORSHIP_EMBEDDING_MAX_TEXT_CHARS || 6000);
const REQUEST_TIMEOUT_MS = Number(process.env.MENTORSHIP_EMBEDDING_TIMEOUT_MS || 2500);

function trimmed(v) {
  return String(v ?? "").trim();
}

function uniqueNonEmpty(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values ?? []) {
    const v = trimmed(raw);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function joinIfAny(label, values) {
  const clean = uniqueNonEmpty(values);
  if (clean.length === 0) return null;
  return `${label}: ${clean.join(", ")}`;
}

function cleanParagraph(value, max = 1000) {
  const t = trimmed(value).replace(/\s+/g, " ");
  return t ? t.slice(0, max) : "";
}

function buildMentorCanonicalText(profile) {
  const sections = [
    "Role: Mentor",
    joinIfAny("Skills", profile.mentorSkills),
    joinIfAny("Industries", profile.mentorIndustries),
    joinIfAny("Company", [profile.mentorCompany]),
    joinIfAny("Job Title", [profile.mentorJobTitle]),
    joinIfAny("Years Experience", [profile.mentorYearsExperience]),
    joinIfAny("Degree", [profile.degree]),
    joinIfAny("Major", [profile.major]),
    joinIfAny("University", [profile.university]),
    joinIfAny("Location", [profile.location]),
    joinIfAny("Profile Skill Keys", profile.profileSkillKeys),
  ].filter(Boolean);

  const bio = cleanParagraph(profile.mentorBio, 1200);
  if (bio) sections.push(`Mentor Bio: ${bio}`);

  return sections.join("\n").slice(0, MAX_TEXT_CHARS);
}

function buildMenteeCanonicalText(profile) {
  const sections = [
    "Role: Mentee",
    joinIfAny("Target Skills", profile.profileSkillKeys),
    joinIfAny("Degree", [profile.degree]),
    joinIfAny("Major", [profile.major]),
    joinIfAny("University", [profile.university]),
    joinIfAny("Grad Date", [profile.gradDate]),
    joinIfAny("Location", [profile.location]),
  ].filter(Boolean);

  const goals = cleanParagraph(profile.mentorshipGoals, 1200);
  if (goals) sections.push(`Mentorship Goals: ${goals}`);

  const studentGoals = cleanParagraph(profile.studentGoals, 1200);
  if (studentGoals) sections.push(`Student Goals: ${studentGoals}`);

  return sections.join("\n").slice(0, MAX_TEXT_CHARS);
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Embedding request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function embedText(text) {
  const body = JSON.stringify({
    inputText: text,
  });

  const command = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await withTimeout(bedrock.send(command), REQUEST_TIMEOUT_MS);
  const payload = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const vector = Array.isArray(payload.embedding) ? payload.embedding : null;
  if (!vector || vector.length === 0) {
    throw new Error("Embedding provider returned an empty vector");
  }
  return vector;
}

function shouldBuildMentorEmbedding(profile) {
  return profile?.mentorshipInterested === true && trimmed(profile?.mentorship).toLowerCase() === "mentor";
}

function shouldBuildMenteeEmbedding(profile) {
  return profile?.mentorshipInterested === true && trimmed(profile?.mentorship).toLowerCase() === "mentee";
}

async function embedAndPersistProfile(userId, profile, triggerSource = "profile_save") {
  if (!EMBEDDING_ENABLED) return { skipped: true, reason: "disabled" };
  if (!userId || !profile) return { skipped: true, reason: "missing_profile" };
  if (!mentorshipEmbeddingsStore.isConfigured()) return { skipped: true, reason: "table_not_configured" };

  const existingEmbedding = await mentorshipEmbeddingsStore.getByUserId(userId);

  const wantsMentor = shouldBuildMentorEmbedding(profile);
  const wantsMentee = shouldBuildMenteeEmbedding(profile);
  if (!wantsMentor && !wantsMentee) {
    await mentorshipEmbeddingsStore.remove(userId);
    return { ok: true, cleared: true };
  }

  const now = new Date().toISOString();
  const patch = {
    mentorshipEmbeddingMeta: {
      modelId: EMBEDDING_MODEL_ID,
      updatedAt: now,
      triggerSource,
      status: "ok",
    },
  };

  if (wantsMentor) {
    const mentorText = buildMentorCanonicalText(profile);
    patch.mentorEmbeddingText = mentorText;
    const mentorTextHash = sha256(mentorText);
    patch.mentorEmbeddingTextHash = mentorTextHash;
    if (mentorTextHash !== existingEmbedding?.mentorEmbeddingTextHash || !Array.isArray(existingEmbedding?.mentorEmbeddingVector)) {
      const mentorVector = await embedText(mentorText);
      patch.mentorEmbeddingVector = mentorVector;
      patch.mentorEmbeddingDimensions = mentorVector.length;
      patch.mentorshipEmbeddingMeta.mentorReembedded = true;
    } else {
      patch.mentorEmbeddingVector = existingEmbedding.mentorEmbeddingVector;
      patch.mentorEmbeddingDimensions =
        existingEmbedding.mentorEmbeddingDimensions ?? existingEmbedding.mentorEmbeddingVector.length;
      patch.mentorshipEmbeddingMeta.mentorReembedded = false;
    }
  } else {
    patch.mentorEmbeddingText = null;
    patch.mentorEmbeddingTextHash = null;
    patch.mentorEmbeddingVector = null;
    patch.mentorEmbeddingDimensions = null;
  }

  if (wantsMentee) {
    const menteeText = buildMenteeCanonicalText(profile);
    patch.menteeEmbeddingText = menteeText;
    const menteeTextHash = sha256(menteeText);
    patch.menteeEmbeddingTextHash = menteeTextHash;
    if (menteeTextHash !== existingEmbedding?.menteeEmbeddingTextHash || !Array.isArray(existingEmbedding?.menteeEmbeddingVector)) {
      const menteeVector = await embedText(menteeText);
      patch.menteeEmbeddingVector = menteeVector;
      patch.menteeEmbeddingDimensions = menteeVector.length;
      patch.mentorshipEmbeddingMeta.menteeReembedded = true;
    } else {
      patch.menteeEmbeddingVector = existingEmbedding.menteeEmbeddingVector;
      patch.menteeEmbeddingDimensions =
        existingEmbedding.menteeEmbeddingDimensions ?? existingEmbedding.menteeEmbeddingVector.length;
      patch.mentorshipEmbeddingMeta.menteeReembedded = false;
    }
  } else {
    patch.menteeEmbeddingText = null;
    patch.menteeEmbeddingTextHash = null;
    patch.menteeEmbeddingVector = null;
    patch.menteeEmbeddingDimensions = null;
  }

  await mentorshipEmbeddingsStore.upsert(userId, patch);
  return { ok: true };
}

async function getEmbeddingRecord(userId) {
  if (!userId || !mentorshipEmbeddingsStore.isConfigured()) return null;
  return await mentorshipEmbeddingsStore.getByUserId(userId);
}

function getEmbeddingTemplatePreview(profile) {
  return {
    mentorText: shouldBuildMentorEmbedding(profile) ? buildMentorCanonicalText(profile) : "",
    menteeText: shouldBuildMenteeEmbedding(profile) ? buildMenteeCanonicalText(profile) : "",
    modelId: EMBEDDING_MODEL_ID,
  };
}

module.exports = {
  embedAndPersistProfile,
  getEmbeddingTemplatePreview,
  getEmbeddingRecord,
};

