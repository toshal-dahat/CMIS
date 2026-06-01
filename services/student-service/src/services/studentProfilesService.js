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

/**
 * Profile schema: name, uin, email, degree, major, gradDate (graduation month-year), linkedInUrl,
 * resumeS3Key (resume reference), role.
 *
 * The "email" field may contain multiple comma-separated email addresses (e.g. TAMU + personal)
 * so that alumni can log in with any of them and still reuse the same profile.
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

/**
 * Fallback lookup used when a new Cognito user (e.g. personal email) logs in
 * after graduation handover. We search by membership of the login email inside
 * the comma-separated "email" field so the new user can reuse the existing
 * StudentProfiles record created under the original student account.
 *
 * This is a conservative scan, only called when getByUserId() returns null.
 */
async function getByAnyEmail(loginEmail) {
  if (!loginEmail) return null;
  const result = await docClient.send(
    new ScanCommand({
      TableName: getTableName(),
      // Use contains() on the email string; the stored value is a CSV like:
      // "tamu@tamu.edu, personal@example.com"
      FilterExpression: "contains(email, :e)",
      ExpressionAttributeValues: { ":e": loginEmail },
      Limit: 1,
    })
  );
  const items = result.Items ?? [];
  return items.length > 0 ? items[0] : null;
}

async function exists(userId) {
  const profile = await getByUserId(userId);
  return !!profile;
}

async function create(userId, profile) {
  const now = new Date().toISOString();
  const item = {
    userId,
    name: profile.name,
    uin: profile.uin,
    email: profile.email ?? null,
    degree: profile.degree ?? null,
    major: profile.major,
    gradDate: profile.gradDate,
    linkedInUrl: profile.linkedInUrl ?? null,
    resumeS3Key: profile.resumeS3Key ?? null,
    role: profile.role ?? null,
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
    "email",
    "degree",
    "major",
    "gradDate",
    "linkedInUrl",
    "resumeS3Key",
    "role",
  ];
  for (const key of allowed) {
    if (profile[key] !== undefined) {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      exprNames[nameKey] = key;
      exprValues[valueKey] = profile[key];
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
    name: item.name,
    uin: item.uin,
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
  listAllExceptUserId,
};
