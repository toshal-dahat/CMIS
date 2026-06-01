/**
 * Team service — DynamoDB operations for CompetitionTeams table.
 *
 * Table schema:
 *   PK = competitionId (S)
 *   SK = teamId (S)
 *   GSI "teamId-index" on teamId
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TEAMS_TABLE;

/**
 * List all teams in a competition.
 */
async function listTeams(competitionId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "competitionId = :cid",
    ExpressionAttributeValues: { ":cid": competitionId },
  }));
  return result.Items || [];
}

/**
 * Get a single team by competition + team ID.
 */
async function getTeam(competitionId, teamId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId, teamId },
  }));
  return result.Item || null;
}

function normalizeMember(member) {
  if (typeof member === "string") {
    const email = member.trim().toLowerCase();
    return email ? { name: "", email } : null;
  }

  if (member && typeof member === "object") {
    const email = String(member.email || "").trim().toLowerCase();
    const name = String(member.name || "").trim();
    return email ? { name, email } : null;
  }

  return null;
}

function normalizeMembers({ members, memberDetails }) {
  const source = Array.isArray(memberDetails) && memberDetails.length > 0
    ? memberDetails
    : Array.isArray(members)
      ? members
      : [];
  const seen = new Set();
  const details = [];

  for (const member of source) {
    const normalized = normalizeMember(member);
    if (!normalized || seen.has(normalized.email)) continue;
    seen.add(normalized.email);
    details.push(normalized);
  }

  return {
    members: details.map((member) => member.email),
    memberDetails: details,
  };
}

/**
 * Create a team in a competition.
 */
async function createTeam(competitionId, { teamName, members, memberDetails }) {
  if (!teamName) throw Object.assign(new Error("teamName is required"), { statusCode: 400 });
  const normalizedMembers = normalizeMembers({ members, memberDetails });

  const item = {
    competitionId,
    teamId: uuidv4(),
    teamName,
    members: normalizedMembers.members,
    memberDetails: normalizedMembers.memberDetails,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

module.exports = { listTeams, getTeam, createTeam };
