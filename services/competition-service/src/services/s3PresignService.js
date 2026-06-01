/**
 * S3 presigned URL service for competition submissions.
 * Same pattern as student-service's s3PresignService, pointing at SUBMISSIONS_BUCKET.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const client = new S3Client({});
const BUCKET = process.env.SUBMISSIONS_BUCKET;

function getBucket() {
  if (!BUCKET) {
    throw new Error("SUBMISSIONS_BUCKET environment variable is not set");
  }
  return BUCKET;
}

/**
 * Presigned PUT URL for uploading a PDF submission.
 */
async function getPresignedPutUrl(key, expiresInSeconds = 120) {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: "application/pdf",
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Presigned GET URL for downloading/viewing a submission PDF.
 */
async function getPresignedGetUrl(key, expiresInSeconds = 300) {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Head object to verify a file exists in S3.
 */
async function headObject(key) {
  const command = new HeadObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  const response = await client.send(command);
  return {
    contentType: response.ContentType,
    contentLength: response.ContentLength ?? 0,
    etag: response.ETag ?? "",
  };
}

module.exports = { getPresignedPutUrl, getPresignedGetUrl, headObject };
