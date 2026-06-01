/**
 * S3 presigned URL service.
 * Used for secure direct upload (PUT) and download (GET) without passing binaries through Lambda.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const client = new S3Client({});
const BUCKET = process.env.RESUMES_BUCKET;

function getBucket() {
  if (!BUCKET) {
    throw new Error("RESUMES_BUCKET environment variable is not set");
  }
  return BUCKET;
}

/**
 * Generate presigned PUT URL for uploading a PDF resume.
 * @param {string} key - S3 object key
 * @param {number} expiresInSeconds - URL expiry (default 120)
 * @param {Object} metadata - Optional x-amz-meta-* headers
 * @returns {Promise<string>}
 */
async function getPresignedPutUrl(key, expiresInSeconds = 120, metadata = {}) {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: "application/pdf",
    ...(Object.keys(metadata).length > 0 && { Metadata: metadata }),
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Generate presigned GET URL for downloading a resume.
 * @param {string} key - S3 object key
 * @param {number} expiresInSeconds - URL expiry (default 300)
 * @returns {Promise<string>}
 */
async function getPresignedGetUrl(key, expiresInSeconds = 300) {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Head object to verify existence and get metadata (content-type, size, etag).
 * @param {string} key - S3 object key
 * @returns {Promise<{ contentType: string, contentLength: number, etag: string }>}
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

/**
 * Delete an object from the resumes bucket (used when replacing user's resume).
 * @param {string} key - S3 object key
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  await client.send(command);
}

module.exports = {
  getPresignedPutUrl,
  getPresignedGetUrl,
  headObject,
  deleteObject,
};
