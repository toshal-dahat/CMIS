const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.MENTORSHIP_EMBEDDINGS_TABLE;

function getTableName() {
  if (!TABLE_NAME) {
    throw new Error("MENTORSHIP_EMBEDDINGS_TABLE environment variable is not set");
  }
  return TABLE_NAME;
}

function isConfigured() {
  return !!TABLE_NAME;
}

async function getByUserId(userId) {
  const res = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { userId },
    })
  );
  return res.Item ?? null;
}

async function upsert(userId, item) {
  const now = new Date().toISOString();
  const record = {
    userId,
    ...item,
    updatedAt: now,
  };
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: record,
    })
  );
  return record;
}

async function remove(userId) {
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { userId },
    })
  );
}

module.exports = {
  isConfigured,
  getByUserId,
  upsert,
  remove,
};

