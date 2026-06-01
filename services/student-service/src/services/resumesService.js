/**
 * DynamoDB service for Resumes table.
 * Tracks resume uploads: UPLOADING -> UPLOADED.
 * Partition key: userSub (Cognito sub), Sort key: resumeId
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.RESUMES_TABLE;

function getTableName() {
  if (!TABLE_NAME) {
    throw new Error("RESUMES_TABLE environment variable is not set");
  }
  return TABLE_NAME;
}

/**
 * Create a resume record with status UPLOADING.
 */
async function create(userSub, { resumeId, s3Key, fileName, contentType }) {
  const now = new Date().toISOString();
  const item = {
    userSub,
    resumeId,
    s3Key,
    fileName: fileName ?? null,
    contentType: contentType ?? "application/pdf",
    status: "UPLOADING",
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: item,
    })
  );
  return item;
}

/**
 * Get a single resume by userSub and resumeId.
 */
async function get(userSub, resumeId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { userSub, resumeId },
    })
  );
  return result.Item ?? null;
}

/**
 * Update resume to UPLOADED with size and etag.
 */
async function markUploaded(userSub, resumeId, { fileSize, etag }) {
  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { userSub, resumeId },
      UpdateExpression:
        "SET #status = :status, #fileSize = :fileSize, #etag = :etag, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
        "#fileSize": "fileSize",
        "#etag": "etag",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":status": "UPLOADED",
        ":fileSize": fileSize,
        ":etag": etag,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes;
}

/**
 * Delete a resume record by userSub and resumeId.
 */
async function deleteRecord(userSub, resumeId) {
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { userSub, resumeId },
    })
  );
}

/**
 * List all resumes for a user (metadata only, no presigned URLs).
 */
async function listByUser(userSub) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "userSub = :userSub",
      ExpressionAttributeValues: { ":userSub": userSub },
    })
  );
  return (result.Items ?? []).map((item) => ({
    resumeId: item.resumeId,
    s3Key: item.s3Key,
    fileName: item.fileName,
    status: item.status,
    fileSize: item.fileSize,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

module.exports = {
  create,
  get,
  markUploaded,
  deleteRecord,
  listByUser,
};
