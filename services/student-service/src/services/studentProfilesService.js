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
  const dates = String(e?.dates ?? "").trim().toLowerCase();
  // Include per-education GPA so same program with different GPA is treated as a distinct entry.
  const gpaRaw = e?.gpa;
  const gpa =
    gpaRaw == null || String(gpaRaw).trim() === ""
      ? "null"
      : String(Number.parseFloat(String(gpaRaw))).toLowerCase();
  return `${institution}|${degree}|${field}|${dates}|${gpa}`;
}

/**
 * Merge resume extraction into profile.
 * - GPA: always overwrite from the latest extracted resume value:
 *   - numeric when present
 *   - null when latest education has no GPA
 * - Education: append entries not already present (by fingerprint).
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
  const fingerprints = new Set(prevEdu.map(educationFingerprint));
  const toAdd = (Array.isArray(education) ? education : []).filter((e) => {
    const fp = educationFingerprint(e);
    if (!fp || fp === "||||") return false;
    if (fingerprints.has(fp)) return false;
    fingerprints.add(fp);
    return true;
  });
  if (toAdd.length > 0) {
    updates.profileEducation = [...prevEdu, ...toAdd];
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
    mentorship: profile.mentorship ?? null,
    mentorCapacity: profile.mentorCapacity ?? null,
    mentorSkills: Array.isArray(profile.mentorSkills) ? profile.mentorSkills : [],
    mentorIndustries: Array.isArray(profile.mentorIndustries) ? profile.mentorIndustries : [],
    mentorCompany: profile.mentorCompany ?? null,
    mentorJobTitle: profile.mentorJobTitle ?? null,
    mentorYearsExperience: profile.mentorYearsExperience ?? null,
    role: profile.role ?? null,
    profileGpa: profile.profileGpa ?? null,
    profileEducation: Array.isArray(profile.profileEducation) ? profile.profileEducation : [],
    profileSkillKeys: Array.isArray(profile.profileSkillKeys) ? profile.profileSkillKeys : [],
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
    "mentorship",
    "mentorCapacity",
    "mentorSkills",
    "mentorIndustries",
    "mentorCompany",
    "mentorJobTitle",
    "mentorYearsExperience",
    "role",
    "profileGpa",
    "profileEducation",
    "profileSkillKeys",
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
