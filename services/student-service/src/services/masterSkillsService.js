/**
 * DynamoDB MasterSkills table: canonical resume skills (GSI normalizedKey-index).
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { normalizeKey, skillIdFromNormalizedKey } = require("../lib/skillNormalization");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

function getTableName() {
  const t = process.env.MASTER_SKILLS_TABLE;
  if (!t) throw new Error("MASTER_SKILLS_TABLE environment variable is not set");
  return t;
}

async function getByNormalizedKey(normalizedKey) {
  const nk = String(normalizedKey ?? "").trim();
  if (!nk) return null;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: "normalizedKey-index",
      KeyConditionExpression: "normalizedKey = :nk",
      ExpressionAttributeValues: { ":nk": nk },
      Limit: 1,
    })
  );
  const item = (result.Items ?? [])[0];
  return item ?? null;
}

/**
 * Insert a new canonical skill (idempotent on skillId).
 */
async function putSkill({ canonicalName, source = "runtime" }) {
  const cn = String(canonicalName ?? "").trim();
  if (!cn) {
    const err = new Error("canonicalName required");
    err.code = "BAD_REQUEST";
    throw err;
  }
  const normalizedKey = normalizeKey(cn);
  if (!normalizedKey) {
    const err = new Error("Invalid canonicalName");
    err.code = "BAD_REQUEST";
    throw err;
  }
  const skillId = skillIdFromNormalizedKey(normalizedKey);
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        skillId,
        canonicalName: cn,
        normalizedKey,
        source,
        createdAt: now,
      },
      ConditionExpression: "attribute_not_exists(skillId)",
    })
  );
  return { skillId, canonicalName: cn, normalizedKey };
}

/**
 * Return all skills for UI pickers (scan; table is small).
 */
async function listAll() {
  const out = [];
  let startKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        ProjectionExpression: "skillId, canonicalName, normalizedKey",
        ExclusiveStartKey: startKey,
      })
    );
    for (const item of result.Items ?? []) {
      out.push({
        skillId: item.skillId,
        canonicalName: item.canonicalName,
        normalizedKey: item.normalizedKey,
      });
    }
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  out.sort((a, b) => String(a.canonicalName).localeCompare(String(b.canonicalName), undefined, { sensitivity: "base" }));
  return out;
}

module.exports = {
  getByNormalizedKey,
  putSkill,
  listAll,
};
