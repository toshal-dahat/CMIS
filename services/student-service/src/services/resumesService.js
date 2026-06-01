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

function buildExtractedDataPayload(extracted) {
  const ex = extracted && typeof extracted === "object" ? extracted : {};
  const emptyExtra = {
    projects: [],
    extracurricular: [],
    achievements: [],
    other: [],
  };
  const extra =
    ex.extra && typeof ex.extra === "object"
      ? {
          projects: Array.isArray(ex.extra.projects) ? ex.extra.projects : [],
          extracurricular: Array.isArray(ex.extra.extracurricular) ? ex.extra.extracurricular : [],
          achievements: Array.isArray(ex.extra.achievements) ? ex.extra.achievements : [],
          other: Array.isArray(ex.extra.other) ? ex.extra.other : [],
        }
      : emptyExtra;

  return {
    skills: Array.isArray(ex.skills) ? ex.skills : [],
    skillsResolved: Array.isArray(ex.skillsResolved) ? ex.skillsResolved : [],
    profileGpa: ex.profileGpa ?? null,
    location: ex.location ?? null,
    education: Array.isArray(ex.education) ? ex.education : [],
    experience: Array.isArray(ex.experience) ? ex.experience : [],
    extra,
  };
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
 * Persist successful OCR/LLM extraction result.
 */
async function markExtracted(userSub, resumeId, extracted) {
  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { userSub, resumeId },
      UpdateExpression:
        "SET #status = :status, #extractedData = :extractedData, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
        "#extractedData": "extractedData",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":status": "EXTRACTED",
        ":extractedData": buildExtractedDataPayload(extracted),
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes;
}

/**
 * Persist extraction failure diagnostics.
 */
async function markExtractionFailed(userSub, resumeId, errorMessage) {
  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { userSub, resumeId },
      UpdateExpression:
        "SET #status = :status, #extractionError = :extractionError, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
        "#extractionError": "extractionError",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":status": "EXTRACTION_FAILED",
        ":extractionError": errorMessage || "extraction_failed",
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
    extractedData: item.extractedData ?? null,
    extractionError: item.extractionError ?? null,
  }));
}

module.exports = {
  create,
  get,
  markUploaded,
  markExtracted,
  markExtractionFailed,
  deleteRecord,
  listByUser,
  buildExtractedDataPayload,
};
