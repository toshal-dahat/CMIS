/**
 * Score service — DynamoDB operations for CompetitionScores table.
 *
 * Table schema:
 *   PK = competitionId_teamId (S)  — composite: "{competitionId}#{teamId}"
 *   SK = judgeUserId (S)
 *   GSI "competitionId-index" on competitionId
 *
 * Each record holds { competitionId_teamId, competitionId, teamId, judgeUserId,
 *                      ratings{}, feedback, status, gradedAt, updatedAt }
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.SCORES_TABLE;

/**
 * Get a specific score (one judge's score for one team in one competition).
 */
async function getScore(competitionId, teamId, judgeUserId) {
  const pk = `${competitionId}#${teamId}`;
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId_teamId: pk, judgeUserId },
  }));
  return result.Item || null;
}

/**
 * Create or update a score.
 */
async function upsertScore(competitionId, teamId, judgeUserId, { ratings, feedback }) {
  const pk = `${competitionId}#${teamId}`;
  const now = new Date().toISOString();

  const item = {
    competitionId_teamId: pk,
    competitionId,
    teamId,
    judgeUserId,
    ratings: ratings || {},
    feedback: feedback || "",
    status: "GRADED",
    gradedAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Get all scores for a competition (via GSI). Used by admin overview.
 */
async function getScoresByCompetition(competitionId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "competitionId-index",
    KeyConditionExpression: "competitionId = :cid",
    ExpressionAttributeValues: { ":cid": competitionId },
  }));
  return result.Items || [];
}

module.exports = { getScore, upsertScore, getScoresByCompetition };
