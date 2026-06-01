/**
 * Judge assignment service — DynamoDB operations for JudgeAssignments table.
 *
 * Table schema:
 *   PK = competitionId (S)
 *   SK = judgeUserId (S)
 *   GSI "judgeUserId-index" on judgeUserId
 *
 * Each record holds { competitionId, judgeUserId, judgeName, judgeEmail, teamIds[], assignedAt }
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.JUDGE_ASSIGNMENTS_TABLE;

/**
 * Get a specific assignment (one judge + one competition).
 */
async function getAssignment(competitionId, judgeUserId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId, judgeUserId },
  }));
  return result.Item || null;
}

/**
 * Get all assignments for a judge across all competitions (via GSI).
 * This powers the "GET /api/judge/assignments" endpoint.
 */
async function getAssignmentsByJudge(judgeUserId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "judgeUserId-index",
    KeyConditionExpression: "judgeUserId = :uid",
    ExpressionAttributeValues: { ":uid": judgeUserId },
  }));
  return result.Items || [];
}

/**
 * List all judge assignments for a given competition.
 */
async function listAssignments(competitionId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "competitionId = :cid",
    ExpressionAttributeValues: { ":cid": competitionId },
  }));
  return result.Items || [];
}

/**
 * Assign a judge to a competition with specific team IDs.
 */
async function assignJudge(competitionId, { judgeUserId, judgeName, judgeEmail, teamIds }) {
  if (!judgeUserId) throw Object.assign(new Error("judgeUserId is required"), { statusCode: 400 });
  if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0) {
    throw Object.assign(new Error("teamIds array is required and must not be empty"), { statusCode: 400 });
  }

  const item = {
    competitionId,
    judgeUserId,
    judgeName: judgeName || "",
    judgeEmail: judgeEmail || "",
    teamIds,
    assignedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

module.exports = { getAssignment, getAssignmentsByJudge, listAssignments, assignJudge };
