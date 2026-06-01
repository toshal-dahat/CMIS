/**
 * Submission service — DynamoDB operations for CompetitionSubmissions table.
 *
 * Table schema:
 *   PK = competitionId (S)
 *   SK = teamId (S)
 *
 * One submission per team per competition. Stores { s3Key, fileName, fileType, submittedAt }.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.SUBMISSIONS_TABLE;

/**
 * Get a team's submission for a competition.
 */
async function getSubmission(competitionId, teamId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId, teamId },
  }));
  return result.Item || null;
}

/**
 * Create or replace a team's submission.
 */
async function upsertSubmission(competitionId, teamId, { s3Key, fileName, fileType }) {
  const now = new Date().toISOString();
  const item = {
    competitionId,
    teamId,
    s3Key,
    fileName: fileName || "submission.pdf",
    fileType: fileType || "application/pdf",
    submittedAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Delete a team's submission record. S3 object cleanup is intentionally
 * out of scope here — it's safer to leave the file behind than risk an
 * inconsistent delete. Caller can clean S3 separately if desired.
 */
async function deleteSubmission(competitionId, teamId) {
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { competitionId, teamId },
  }));
  return { competitionId, teamId };
}

module.exports = { getSubmission, upsertSubmission, deleteSubmission };
