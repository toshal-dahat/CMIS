/**
 * Competition service — DynamoDB operations for Competitions table.
 *
 * Table schema:
 *   PK = competitionId (S)
 *
 * Each record holds { competitionId, name, description, submissionDeadline,
 *                      feedbackReleaseDate, status, createdAt, updatedAt }
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.COMPETITIONS_TABLE;

// Default rubric (5 criteria, 1-10 scale)
const DEFAULT_RUBRIC = [
  { key: "presentation", label: "Presentation Quality", min: 1, max: 10 },
  { key: "analysis", label: "Analysis & Research", min: 1, max: 10 },
  { key: "creativity", label: "Creativity & Innovation", min: 1, max: 10 },
  { key: "feasibility", label: "Feasibility of Solution", min: 1, max: 10 },
  { key: "teamwork", label: "Teamwork & Delivery", min: 1, max: 10 },
];

function normalizeRubric(rubric) {
  if (!Array.isArray(rubric) || rubric.length === 0) return DEFAULT_RUBRIC;

  const seen = new Set();
  const cleaned = rubric
    .map((r) => ({
      key: r.key,
      label: r.label || r.key,
      min: Number.isFinite(r.min) ? r.min : 1,
      max: Number.isFinite(r.max) ? r.max : 10,
      ...(r.weight ? { weight: r.weight } : {}),
    }))
    .filter((r) => r.key);

  const unique = cleaned.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });

  return unique.length ? unique : DEFAULT_RUBRIC;
}

/**
 * List all competitions (small table, scan is acceptable).
 */
async function listCompetitions() {
  const result = await docClient.send(new ScanCommand({ TableName: TABLE }));
  return result.Items || [];
}

/**
 * Get a single competition by ID.
 */
async function getCompetition(competitionId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId },
  }));
  return result.Item || null;
}

/**
 * Create a new competition.
 */
async function createCompetition({ name, description, submissionDeadline, feedbackReleaseDate, rubric }) {
  if (!name) throw Object.assign(new Error("name is required"), { statusCode: 400 });

  const normalizedRubric = normalizeRubric(rubric);
  const item = {
    competitionId: uuidv4(),
    name,
    description: description || "",
    submissionDeadline: submissionDeadline || null,
    feedbackReleaseDate: feedbackReleaseDate || null,
    autoSynthesisCompletedForReleaseDate: null,
    autoSynthesisLastRunAt: null,
    autoSynthesisLastError: null,
    rubric: normalizedRubric,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Update an existing competition (admin only fields).
 */
async function updateCompetition(competitionId, updates) {
  const existing = await getCompetition(competitionId);
  if (!existing) {
    const err = new Error("Competition not found");
    err.statusCode = 404;
    throw err;
  }

  const allowed = ["name", "description", "submissionDeadline", "feedbackReleaseDate", "status", "rubric"];
  const payload = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      payload[key] = key === "rubric" ? normalizeRubric(updates[key]) : updates[key];
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "feedbackReleaseDate") &&
    payload.feedbackReleaseDate !== existing.feedbackReleaseDate
  ) {
    payload.autoSynthesisCompletedForReleaseDate = null;
    payload.autoSynthesisLastRunAt = null;
    payload.autoSynthesisLastError = null;
  }

  const item = {
    ...existing,
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function recordAutoSynthesisSuccess(competitionId, feedbackReleaseDate, summary = {}) {
  const now = new Date().toISOString();
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { competitionId },
    UpdateExpression: [
      "SET autoSynthesisCompletedForReleaseDate = :releaseDate",
      "autoSynthesisLastRunAt = :now",
      "autoSynthesisLastError = :noError",
      "autoSynthesisSummary = :summary",
      "updatedAt = :now",
    ].join(", "),
    ExpressionAttributeValues: {
      ":releaseDate": feedbackReleaseDate || null,
      ":now": now,
      ":noError": null,
      ":summary": summary,
    },
  }));
}

async function recordAutoSynthesisFailure(competitionId, errorMessage, summary = {}) {
  const now = new Date().toISOString();
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { competitionId },
    UpdateExpression: [
      "SET autoSynthesisLastRunAt = :now",
      "autoSynthesisLastError = :errorMessage",
      "autoSynthesisSummary = :summary",
      "updatedAt = :now",
    ].join(", "),
    ExpressionAttributeValues: {
      ":now": now,
      ":errorMessage": errorMessage || "Automatic feedback synthesis failed",
      ":summary": summary,
    },
  }));
}

module.exports = {
  listCompetitions,
  getCompetition,
  createCompetition,
  updateCompetition,
  recordAutoSynthesisSuccess,
  recordAutoSynthesisFailure,
  normalizeRubric,
  DEFAULT_RUBRIC,
};
