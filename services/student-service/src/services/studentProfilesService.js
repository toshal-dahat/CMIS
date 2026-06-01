/**
 * DynamoDB service for StudentProfiles table.
 * Partition key: userId (Cognito sub)
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.STUDENT_PROFILES_TABLE;

function getTableName() {
  if (!TABLE_NAME) {
    throw new Error("STUDENT_PROFILES_TABLE environment variable is not set");
  }
  return TABLE_NAME;
}

function normalizeEmailList(value) {
  // `StudentProfiles.email` may be a CSV alias list (e.g. "tamu@tamu.edu, personal@gmail.com").
  // We normalize each email part so DynamoDB `contains(email, :loginEmail)` works reliably
  // (the match is case-sensitive in DynamoDB).
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  return parts.join(", ");
}

function emailPartsFromCsv(value) {
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.toLowerCase());
}

/**
 * Profile schema: name, uin, staffId, university, email, degree, major, gradDate (graduation month-year), linkedInUrl,
 * resumeS3Key (resume reference), resumeId, role
 */

async function getByUserId(userId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { userId },
    })
  );
  return result.Item ?? null;
}

async function exists(userId) {
  const profile = await getByUserId(userId);
  return !!profile;
}

/**
 * Find a student profile by any known email alias.
 *
 * StudentProfiles.email is a comma-separated list (e.g. "tamu@tamu.edu, personal@gmail.com").
 * DynamoDB `contains(...)` is case-sensitive, so we do a scan and compare lowercased parts in JS
 * to make matching reliable even for legacy records with different casing.
 */
async function getByAnyEmail(loginEmail) {
  const target = (loginEmail ?? "").trim().toLowerCase();
  if (!target) return null;

  // DynamoDB Scan is paginated; scan until we either find a match or exhaust pages.
  let startKey = undefined;
  while (true) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        ProjectionExpression: "userId, email",
        ExclusiveStartKey: startKey,
      })
    );
    const items = result.Items ?? [];
    for (const item of items) {
      const parts = emailPartsFromCsv(item.email);
      if (parts.includes(target)) {
        // Scan uses projection for performance; fetch full profile before returning.
        return await getByUserId(item.userId);
      }
    }
    if (!result.LastEvaluatedKey) break;
    startKey = result.LastEvaluatedKey;
  }

  return null;
}

function educationFingerprint(e) {
  const institution = String(e?.institution ?? "").trim().toLowerCase();
  const degree = String(e?.degree ?? "").trim().toLowerCase();
  const field = String(e?.field ?? "").trim().toLowerCase();
  // Education identity key: institution|degree|field
  return `${institution}|${degree}|${field}`;
}

function normalizeEducationTextOrNull(v) {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
}

function normalizeEducationGpaOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function normalizeEducationEntryForMerge(e) {
  return {
    institution: normalizeEducationTextOrNull(e?.institution),
    degree: normalizeEducationTextOrNull(e?.degree),
    field: normalizeEducationTextOrNull(e?.field),
    dates: normalizeEducationTextOrNull(e?.dates),
    details: normalizeEducationTextOrNull(e?.details),
    gpa: normalizeEducationGpaOrNull(e?.gpa),
  };
}

/**
 * Merge resume extraction into profile.
 * - GPA: always overwrite from the latest extracted resume value:
 *   - numeric when present
 *   - null when latest education has no GPA
 * - Education:
 *   - identity key: institution|degree|field
 *   - matched entry is overwritten from latest extraction fields (dates/details/gpa included, nulls allowed)
 *   - unmatched entries are appended
 *   - duplicates by key are collapsed with latest-extracted version winning
 * - Skills: union of profileSkillKeys with new keys.
 */
async function mergeExtractionIntoProfile(userId, { gpa, education, skillKeys }) {
  const existing = await getByUserId(userId);
  if (!existing) {
    return null;
  }

  const updates = {};
  if (gpa === null) {
    updates.profileGpa = null;
  } else if (gpa !== undefined) {
    const n = typeof gpa === "number" ? gpa : Number.parseFloat(String(gpa));
    updates.profileGpa = Number.isFinite(n) ? n : null;
  }

  const prevEdu = Array.isArray(existing.profileEducation) ? [...existing.profileEducation] : [];
  const mergedByKey = new Map();

  // Seed with existing entries first (dedupe legacy duplicates by key; keep first until overwritten by extracted).
  for (const row of prevEdu) {
    const key = educationFingerprint(row);
    if (!key || key === "||") continue;
    if (!mergedByKey.has(key)) {
      mergedByKey.set(key, normalizeEducationEntryForMerge(row));
    }
  }

  let educationChanged = false;
  for (const row of Array.isArray(education) ? education : []) {
    const key = educationFingerprint(row);
    if (!key || key === "||") continue;
    // Latest extracted version wins for this key.
    mergedByKey.set(key, normalizeEducationEntryForMerge(row));
    educationChanged = true;
  }

  const mergedEducation = [...mergedByKey.values()];
  const prevNormalized = prevEdu.map(normalizeEducationEntryForMerge);
  if (
    educationChanged ||
    JSON.stringify(mergedEducation) !== JSON.stringify(prevNormalized)
  ) {
    updates.profileEducation = mergedEducation;
  }

  const prevSkills = Array.isArray(existing.profileSkillKeys) ? [...existing.profileSkillKeys] : [];
  const skillSet = new Set(prevSkills.filter(Boolean));
  let addedSkill = false;
  for (const k of skillKeys ?? []) {
    if (k && !skillSet.has(k)) {
      skillSet.add(k);
      addedSkill = true;
    }
  }
  if (addedSkill) {
    updates.profileSkillKeys = [...skillSet];
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }
  return await update(userId, updates);
}

async function create(userId, profile) {
  const now = new Date().toISOString();
  const item = {
    userId,
    name: profile.name,
    uin: profile.uin ?? null,
    staffId: profile.staffId ?? null,
    university: profile.university ?? null,
    email: normalizeEmailList(profile.email) ?? null,
    degree: profile.degree ?? null,
    major: profile.major ?? null,
    gradDate: profile.gradDate ?? null,
    linkedInUrl: profile.linkedInUrl ?? null,
    resumeS3Key: profile.resumeS3Key ?? null,
    resumeId: profile.resumeId ?? null,
    mentorshipInterested: profile.mentorshipInterested ?? false,
    reminderOptIn: profile.reminderOptIn ?? false,
    mentorship: profile.mentorship ?? null,
    mentorCapacity: profile.mentorCapacity ?? null,
    mentorSkills: Array.isArray(profile.mentorSkills) ? profile.mentorSkills : [],
    mentorIndustries: Array.isArray(profile.mentorIndustries) ? profile.mentorIndustries : [],
    mentorCompany: profile.mentorCompany ?? null,
    mentorJobTitle: profile.mentorJobTitle ?? null,
    mentorYearsExperience: profile.mentorYearsExperience ?? null,
    mentorshipGoals: profile.mentorshipGoals ?? null,
    role: profile.role ?? null,
    profileGpa: profile.profileGpa ?? null,
    profileEducation: Array.isArray(profile.profileEducation) ? profile.profileEducation : [],
    profileSkillKeys: Array.isArray(profile.profileSkillKeys) ? profile.profileSkillKeys : [],
    studentGoals: profile.studentGoals ?? null,
    mentorBio: profile.mentorBio ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: item,
      ConditionExpression: "attribute_not_exists(userId)",
    })
  );
  return item;
}

async function update(userId, profile) {
  const now = new Date().toISOString();
  const updates = [];
  const exprNames = {};
  const exprValues = { ":updatedAt": now };

  const allowed = [
    "name",
    "uin",
    "staffId",
    "university",
    "email",
    "degree",
    "major",
    "gradDate",
    "linkedInUrl",
    "resumeS3Key",
    "resumeId",
    "mentorshipInterested",
    "reminderOptIn",
    "mentorship",
    "mentorCapacity",
    "mentorSkills",
    "mentorIndustries",
    "mentorCompany",
    "mentorJobTitle",
    "mentorYearsExperience",
    "mentorshipGoals",
    "role",
    "profileGpa",
    "profileEducation",
    "profileSkillKeys",
    "studentGoals",
    "mentorBio",
    "mentorshipMentorPauseUntil",
  ];
  for (const key of allowed) {
    if (profile[key] !== undefined) {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      exprNames[nameKey] = key;
      exprValues[valueKey] = key === "email" ? normalizeEmailList(profile[key]) : profile[key];
      updates.push(`${nameKey} = ${valueKey}`);
    }
  }
  if (updates.length === 0) {
    return await getByUserId(userId);
  }
  updates.push("#updatedAt = :updatedAt");
  exprNames["#updatedAt"] = "updatedAt";

  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { userId },
      UpdateExpression: "SET " + updates.join(", "),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes;
}

async function remove(userId) {
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { userId },
    })
  );
  return { deleted: true };
}

/**
 * Delete every profile row whose `email` CSV contains this login address.
 * Needed because GET /profiles/me can match via alias while duplicate rows may exist;
 * deleting only one `userId` can leave another row that still matches on GET.
 */
async function removeAllByEmailAlias(loginEmail) {
  const target = (loginEmail ?? "").trim().toLowerCase();
  if (!target) return 0;

  let deleted = 0;
  let startKey = undefined;
  while (true) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        ProjectionExpression: "userId, email",
        ExclusiveStartKey: startKey,
      })
    );
    for (const item of result.Items ?? []) {
      const parts = emailPartsFromCsv(item.email);
      if (parts.includes(target)) {
        await docClient.send(
          new DeleteCommand({
            TableName: getTableName(),
            Key: { userId: item.userId },
          })
        );
        deleted++;
      }
    }
    if (!result.LastEvaluatedKey) break;
    startKey = result.LastEvaluatedKey;
  }
  return deleted;
}

/**
 * List all student profiles except the given userId (for Students Connect).
 * Returns only public fields: name, uin, email, degree, major, gradDate, linkedInUrl.
 */
async function listAllExceptUserId(excludeUserId) {
  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName(),
      FilterExpression: "userId <> :excludeUserId",
      ExpressionAttributeValues: { ":excludeUserId": excludeUserId },
    })
  );
  const items = result.Items ?? [];
  return items.map((item) => ({
    userId: item.userId,
    name: item.name,
    uin: item.uin,
    staffId: item.staffId ?? null,
    university: item.university ?? null,
    email: item.email ?? null,
    degree: item.degree ?? null,
    major: item.major,
    gradDate: item.gradDate,
    linkedInUrl: item.linkedInUrl ?? null,
    role: item.role ?? null,
    studentGoals: item.studentGoals ?? null,
    mentorBio: item.mentorBio ?? null,
  }));
}

async function listAllExceptUserIdByRole(excludeUserId, role) {
  const targetRole = (role ?? "").trim().toUpperCase();
  if (!targetRole) return [];

  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName(),
      FilterExpression: "userId <> :excludeUserId",
      ExpressionAttributeValues: { ":excludeUserId": excludeUserId },
    })
  );

  const items = (result.Items ?? []).filter((item) => {
    const itemRole = (item.role ?? "").toString().trim().toUpperCase();
    return itemRole === targetRole;
  });

  return items.map((item) => ({
    userId: item.userId,
    name: item.name,
    uin: item.uin,
    staffId: item.staffId ?? null,
    university: item.university ?? null,
    email: item.email ?? null,
    degree: item.degree ?? null,
    major: item.major,
    gradDate: item.gradDate,
    linkedInUrl: item.linkedInUrl ?? null,
    role: item.role ?? null,
    studentGoals: item.studentGoals ?? null,
    mentorBio: item.mentorBio ?? null,
  }));
}

module.exports = {
  getByUserId,
  getByAnyEmail,
  exists,
  create,
  update,
  remove,
  removeAllByEmailAlias,
  listAllExceptUserId,
  listAllExceptUserIdByRole,
  mergeExtractionIntoProfile,
};
