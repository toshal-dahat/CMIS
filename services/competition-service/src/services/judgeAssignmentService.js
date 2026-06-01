/**
 * Judge assignment service — DynamoDB operations for JudgeAssignments table.
 *
 * Table schema:
 *   PK = competitionId (S)
 *   SK = judgeUserId (S)
 *   GSI "judgeUserId-index" on judgeUserId
 *
 * Each record is a flat membership row: this person is qualified to judge in
 * this competition. Team binding lives entirely in CompetitionRooms — see
 * roomService.js. Downstream code reads req.judgeAssignment.teamIds, which
 * the requireJudge middleware computes on each request from rooms.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

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
 * Register a judge as a member of a competition. Team binding is handled by
 * rooms (roomService), not here — so teamIds is no longer required.
 *
 * For backward-compat with callers that still pass teamIds, the field is
 * accepted and stored but is no longer authoritative. New callers should
 * omit it; admins create rooms to bind judges to teams.
 */
async function assignJudge(competitionId, { judgeUserId, judgeName, judgeEmail, teamIds }) {
  if (!judgeUserId) throw Object.assign(new Error("judgeUserId is required"), { statusCode: 400 });

  const item = {
    competitionId,
    judgeUserId,
    judgeName: judgeName || "",
    judgeEmail: judgeEmail || "",
    assignedAt: new Date().toISOString(),
  };

  if (Array.isArray(teamIds) && teamIds.length > 0) {
    item.teamIds = teamIds;
  }

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Update editable fields on an assignment (name, email).
 * teamIds is ignored — rooms own that mapping.
 */
async function updateAssignment(competitionId, judgeUserId, { judgeName, judgeEmail }) {
  const existing = await getAssignment(competitionId, judgeUserId);
  if (!existing) {
    const err = new Error("Judge assignment not found");
    err.statusCode = 404;
    throw err;
  }

  const exprAttrs = {};
  const sets = [];
  if (judgeName !== undefined) {
    sets.push("judgeName = :n");
    exprAttrs[":n"] = String(judgeName || "");
  }
  if (judgeEmail !== undefined) {
    sets.push("judgeEmail = :e");
    exprAttrs[":e"] = String(judgeEmail || "");
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("updatedAt = :u");
  exprAttrs[":u"] = new Date().toISOString();

  const result = await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { competitionId, judgeUserId },
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeValues: exprAttrs,
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes;
}

/**
 * Delete a judge assignment. Caller is responsible for first removing this
 * judge from any rooms (see roomService.removeJudgeFromAllRooms).
 */
async function deleteAssignment(competitionId, judgeUserId) {
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { competitionId, judgeUserId },
  }));
  return { competitionId, judgeUserId };
}

module.exports = {
  getAssignment,
  getAssignmentsByJudge,
  listAssignments,
  assignJudge,
  updateAssignment,
  deleteAssignment,
};
