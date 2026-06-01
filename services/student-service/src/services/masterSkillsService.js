/**
 * DynamoDB MasterSkills: canonical skills (PK = normalizedKey).
 *
 * This service is the single persistence layer for the master skills catalog.
 * It is used by:
 * - `skillResolutionService` to match extracted resume skills and insert newly discovered ones
 * - `handlers/skills` to seed and return the canonical list for the profile/API UI
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { normalizeSkillKey } = require("../lib/skillKey");
const seedCanonicalNames = require("../data/masterSkillsSeed.json");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.MASTER_SKILLS_TABLE;

function getTableName() {
  // Fail fast at call time so misconfiguration is obvious in logs/tests.
  if (!TABLE_NAME) {
    throw new Error("MASTER_SKILLS_TABLE environment variable is not set");
  }
  return TABLE_NAME;
}

let seededPromise = null;
// In-process memoization prevents duplicate seeding during warm Lambda invocations.

/**
 * @param {string} canonicalName
 * @returns {{ normalizedKey: string, canonicalName: string }}
 */
function itemFromCanonicalName(canonicalName) {
  // Normalize incoming labels into the canonical storage shape.
  const name = String(canonicalName ?? "").trim();
  const normalizedKey = normalizeSkillKey(name);
  if (!normalizedKey) return null;
  return {
    normalizedKey,
    canonicalName: name,
  };
}

async function getByNormalizedKey(normalizedKey) {
  // Null-safe lookup helper used by matching/ingestion flows.
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
 * Returns true when inserted, false when the row already exists.
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
        // Conditional write keeps first writer and avoids overwriting canonical data.
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      // Duplicate key is expected in concurrent extraction; treat as no-op.
      return false;
    }
    throw e;
  }
}

/**
 * Load all skills for matching (table is small).
 * Returns only the fields needed by matching and list APIs.
 */
async function scanAllKeysAndNames() {
  // Paginate full table scan (acceptable because this table stays small).
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
 * Safe to call repeatedly; at most one seed attempt runs per warm process.
 */
async function ensureSeeded() {
  if (seededPromise) return seededPromise;
  seededPromise = (async () => {
    // Lightweight probe: only seed defaults if table appears empty.
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
            // Idempotent insert so repeated seeding attempts stay safe.
          })
        );
      } catch (e) {
        if (e.name !== "ConditionalCheckFailedException") throw e;
        // Ignore races with other writers/instances attempting the same seed row.
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
  // Case-insensitive sort keeps API output stable for UI dropdowns/search.
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
