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
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.COMPETITIONS_TABLE;

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
async function createCompetition({ name, description, submissionDeadline, feedbackReleaseDate }) {
  if (!name) throw Object.assign(new Error("name is required"), { statusCode: 400 });

  const item = {
    competitionId: uuidv4(),
    name,
    description: description || "",
    submissionDeadline: submissionDeadline || null,
    feedbackReleaseDate: feedbackReleaseDate || null,
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

module.exports = { listCompetitions, getCompetition, createCompetition };
