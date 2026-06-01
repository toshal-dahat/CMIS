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

/**
 * Create a team in a competition.
 */
async function createTeam(competitionId, { teamName, members }) {
  if (!teamName) throw Object.assign(new Error("teamName is required"), { statusCode: 400 });

  const item = {
    competitionId,
    teamId: uuidv4(),
    teamName,
    members: members || [],
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

module.exports = { listTeams, getTeam, createTeam };
