/**
 * Room service — DynamoDB operations for CompetitionRooms table.
 *
 * Rooms are the source of truth for "which judges grade which teams" within
 * a competition. Each room groups a set of judges with a set of teams, and
 * the judges in that room evaluate exactly those teams.
 *
 * Table schema:
 *   PK = competitionId (S)
 *   SK = roomId (S)
 *
 * Each record holds { competitionId, roomId, roomName, judgeIds[], teamIds[],
 *                      createdAt, updatedAt }
 *
 * Invariants:
 *   - A team belongs to AT MOST ONE room within a competition (enforced here).
 *   - A judge MAY belong to multiple rooms within a competition.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.COMPETITION_ROOMS_TABLE;

function uniqueStringArray(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function notFound(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

/**
 * List all rooms for a competition.
 */
async function listRooms(competitionId) {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "competitionId = :cid",
    ExpressionAttributeValues: { ":cid": competitionId },
  }));
  return result.Items || [];
}

/**
 * Get a single room by composite key.
 */
async function getRoom(competitionId, roomId) {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { competitionId, roomId },
  }));
  return result.Item || null;
}

/**
 * Reject if any of the candidate teamIds is already placed in another room
 * of this competition. `excludeRoomId` lets updateRoom skip itself.
 */
function assertTeamsExclusive(rooms, candidateTeamIds, excludeRoomId = null) {
  if (candidateTeamIds.length === 0) return;
  const claimedBy = new Map();
  for (const room of rooms) {
    if (excludeRoomId && room.roomId === excludeRoomId) continue;
    for (const tid of room.teamIds || []) {
      claimedBy.set(tid, room);
    }
  }
  for (const tid of candidateTeamIds) {
    if (claimedBy.has(tid)) {
      const owner = claimedBy.get(tid);
      throw conflict(`Team ${tid} is already in room "${owner.roomName || owner.roomId}".`);
    }
  }
}

/**
 * Create a new room. Validates that no candidate team is already roomed.
 */
async function createRoom(competitionId, { roomName, judgeIds, teamIds }) {
  if (!roomName || typeof roomName !== "string" || !roomName.trim()) {
    throw badRequest("roomName is required");
  }
  const cleanJudges = uniqueStringArray(judgeIds);
  const cleanTeams = uniqueStringArray(teamIds);

  const existingRooms = await listRooms(competitionId);
  assertTeamsExclusive(existingRooms, cleanTeams);

  const now = new Date().toISOString();
  const item = {
    competitionId,
    roomId: uuidv4(),
    roomName: roomName.trim(),
    judgeIds: cleanJudges,
    teamIds: cleanTeams,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/**
 * Update a room's name, judges, or teams. Validates team-exclusivity
 * across all OTHER rooms in the competition.
 */
async function updateRoom(competitionId, roomId, patch) {
  const existing = await getRoom(competitionId, roomId);
  if (!existing) throw notFound("Room not found");

  const next = { ...existing };
  if (patch.roomName !== undefined) {
    if (typeof patch.roomName !== "string" || !patch.roomName.trim()) {
      throw badRequest("roomName must be a non-empty string");
    }
    next.roomName = patch.roomName.trim();
  }
  if (patch.judgeIds !== undefined) {
    next.judgeIds = uniqueStringArray(patch.judgeIds);
  }
  if (patch.teamIds !== undefined) {
    const cleanTeams = uniqueStringArray(patch.teamIds);
    const allRooms = await listRooms(competitionId);
    assertTeamsExclusive(allRooms, cleanTeams, roomId);
    next.teamIds = cleanTeams;
  }
  next.updatedAt = new Date().toISOString();

  await docClient.send(new PutCommand({ TableName: TABLE, Item: next }));
  return next;
}

/**
 * Delete a room. Does not cascade — judges remain as competition members,
 * teams become unrooted (and cannot be scored until placed again).
 */
async function deleteRoom(competitionId, roomId) {
  const existing = await getRoom(competitionId, roomId);
  if (!existing) throw notFound("Room not found");
  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { competitionId, roomId },
  }));
  return { competitionId, roomId };
}

/**
 * Remove a teamId from every room in a competition that contains it.
 * Used when a team is deleted.
 */
async function removeTeamFromAllRooms(competitionId, teamId) {
  const rooms = await listRooms(competitionId);
  const affected = rooms.filter((r) => (r.teamIds || []).includes(teamId));
  for (const room of affected) {
    const nextTeamIds = (room.teamIds || []).filter((tid) => tid !== teamId);
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { competitionId, roomId: room.roomId },
      UpdateExpression: "SET teamIds = :t, updatedAt = :u",
      ExpressionAttributeValues: {
        ":t": nextTeamIds,
        ":u": new Date().toISOString(),
      },
    }));
  }
  return affected.length;
}

/**
 * Remove a judgeUserId from every room in a competition that contains them.
 * Used when a judge is deleted.
 */
async function removeJudgeFromAllRooms(competitionId, judgeUserId) {
  const rooms = await listRooms(competitionId);
  const affected = rooms.filter((r) => (r.judgeIds || []).includes(judgeUserId));
  for (const room of affected) {
    const nextJudgeIds = (room.judgeIds || []).filter((jid) => jid !== judgeUserId);
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { competitionId, roomId: room.roomId },
      UpdateExpression: "SET judgeIds = :j, updatedAt = :u",
      ExpressionAttributeValues: {
        ":j": nextJudgeIds,
        ":u": new Date().toISOString(),
      },
    }));
  }
  return affected.length;
}

/**
 * List rooms in a competition that contain this judge.
 */
async function listRoomsForJudge(competitionId, judgeUserId) {
  const rooms = await listRooms(competitionId);
  return rooms.filter((r) => (r.judgeIds || []).includes(judgeUserId));
}

/**
 * Union the teamIds across all rooms a judge belongs to in a competition.
 * Used by requireJudge middleware to populate req.judgeAssignment.teamIds.
 */
async function getTeamIdsForJudge(competitionId, judgeUserId) {
  const rooms = await listRoomsForJudge(competitionId, judgeUserId);
  const seen = new Set();
  for (const room of rooms) {
    for (const tid of room.teamIds || []) {
      seen.add(tid);
    }
  }
  return Array.from(seen);
}

/**
 * Find rooms in a competition that contain this teamId.
 * Used by the feedback endpoint to count judges responsible for a team.
 */
async function listRoomsForTeam(competitionId, teamId) {
  const rooms = await listRooms(competitionId);
  return rooms.filter((r) => (r.teamIds || []).includes(teamId));
}

/**
 * Union the judgeIds across all rooms containing this team in a competition.
 */
async function getJudgeIdsForTeam(competitionId, teamId) {
  const rooms = await listRoomsForTeam(competitionId, teamId);
  const seen = new Set();
  for (const room of rooms) {
    for (const jid of room.judgeIds || []) {
      seen.add(jid);
    }
  }
  return Array.from(seen);
}

module.exports = {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  removeTeamFromAllRooms,
  removeJudgeFromAllRooms,
  listRoomsForJudge,
  getTeamIdsForJudge,
  listRoomsForTeam,
  getJudgeIdsForTeam,
};
