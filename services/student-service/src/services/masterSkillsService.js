/**
 * DynamoDB MasterSkills: canonical skills (PK = normalizedKey).
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { normalizeSkillKey } = require("../lib/skillKey");
const seedCanonicalNames = require("../data/masterSkillsSeed.json");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.MASTER_SKILLS_TABLE;

function getTableName() {
  if (!TABLE_NAME) {
    throw new Error("MASTER_SKILLS_TABLE environment variable is not set");
  }
  return TABLE_NAME;
}

let seededPromise = null;

/**
 * @param {string} canonicalName
 * @returns {{ normalizedKey: string, canonicalName: string }}
 */
function itemFromCanonicalName(canonicalName) {
  const name = String(canonicalName ?? "").trim();
  const normalizedKey = normalizeSkillKey(name);
  if (!normalizedKey) return null;
  return {
    normalizedKey,
    canonicalName: name,
  };
}

async function getByNormalizedKey(normalizedKey) {
  if (!normalizedKey) return null;
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { normalizedKey },
    })
  );
  return result.Item ?? null;
}

/**
 * Create a skill row (extracted from resume). Fails silently if duplicate key (race).
 */
async function putExtractedSkill({ normalizedKey, canonicalName }) {
  const now = new Date().toISOString();
  try {
    await docClient.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          normalizedKey,
          canonicalName: String(canonicalName ?? "").trim() || normalizedKey,
          source: "extracted",
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(normalizedKey)",
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw e;
  }
}

/**
 * Load all skills for matching (table is small).
 */
async function scanAllKeysAndNames() {
  const items = [];
  let startKey;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        ProjectionExpression: "normalizedKey, canonicalName",
        ExclusiveStartKey: startKey,
      })
    );
    for (const it of result.Items ?? []) {
      if (it.normalizedKey) items.push(it);
    }
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/**
 * Seed default MS-MIS skills if table is empty.
 */
async function ensureSeeded() {
  if (seededPromise) return seededPromise;
  seededPromise = (async () => {
    const probe = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        Limit: 1,
        ProjectionExpression: "normalizedKey",
      })
    );
    if ((probe.Items ?? []).length > 0) return;

    const now = new Date().toISOString();
    for (const name of seedCanonicalNames) {
      const row = itemFromCanonicalName(name);
      if (!row) continue;
      try {
        await docClient.send(
          new PutCommand({
            TableName: getTableName(),
            Item: {
              normalizedKey: row.normalizedKey,
              canonicalName: row.canonicalName,
              source: "seed",
              createdAt: now,
            },
            ConditionExpression: "attribute_not_exists(normalizedKey)",
          })
        );
      } catch (e) {
        if (e.name !== "ConditionalCheckFailedException") throw e;
      }
    }
  })();
  return seededPromise;
}

/**
 * List all skills for API (canonicalName sorted).
 */
async function listAll() {
  const rows = await scanAllKeysAndNames();
  rows.sort((a, b) =>
    String(a.canonicalName ?? "").localeCompare(String(b.canonicalName ?? ""), undefined, {
      sensitivity: "base",
    })
  );
  return rows.map((r) => ({
    normalizedKey: r.normalizedKey,
    canonicalName: r.canonicalName,
  }));
}

module.exports = {
  getByNormalizedKey,
  putExtractedSkill,
  scanAllKeysAndNames,
  ensureSeeded,
  listAll,
  itemFromCanonicalName,
};
