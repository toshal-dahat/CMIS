/**
 * Lambda handlers for Resume Upload via S3 Presigned URL.
 * PDF never passes through Lambda.
 */

const { v4: uuidv4 } = require("uuid");
const { requireAuthWithClaims } = require("../lib/auth");
const resumesService = require("../services/resumesService");
const s3PresignService = require("../services/s3PresignService");
const studentProfilesService = require("../services/studentProfilesService");
const { ensureUserGrouped } = require("../services/userGroupService");

const PRESIGN_PUT_EXPIRY = 120;
const PRESIGN_GET_EXPIRY = 300;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: "",
  };
}

function handleError(err) {
  const code = err.code ?? "INTERNAL_ERROR";
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? "Internal server error";
  return jsonResponse(statusCode, { error: code, message });
}

/**
 * POST /api/resumes/upload-url
 * Input: { fileName: string, contentType: "application/pdf" }
 * Returns: { uploadUrl, resumeId, s3Key, expiresInSeconds }
 */
async function uploadUrl(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    const body = JSON.parse(event.body ?? "{}");
    const fileName = body.fileName;
    const contentType = body.contentType;

    if (!fileName || typeof fileName !== "string" || fileName.trim() === "") {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "fileName is required and must be non-empty" });
    }
    if (contentType !== "application/pdf") {
      return jsonResponse(400, {
        error: "BAD_REQUEST",
        message: "contentType must be application/pdf",
      });
    }

    // One resume per user: delete any existing resume (S3 object + DynamoDB record) before creating new one
    const existingResumes = await resumesService.listByUser(userId);
    for (const item of existingResumes) {
      try {
        await s3PresignService.deleteObject(item.s3Key);
      } catch (e) {
        // Ignore S3 delete errors (e.g. object never uploaded or already deleted)
      }
      await resumesService.deleteRecord(userId, item.resumeId);
    }

    const resumeId = uuidv4();
    const s3Key = `resumes/USER#${userId}/${resumeId}.pdf`;

    await resumesService.create(userId, {
      resumeId,
      s3Key,
      fileName: fileName.trim(),
      contentType,
    });

    const metadata = { "x-amz-meta-user-sub": userId };
    const uploadUrl = await s3PresignService.getPresignedPutUrl(
      s3Key,
      PRESIGN_PUT_EXPIRY,
      metadata
    );

    return jsonResponse(200, {
      uploadUrl,
      resumeId,
      s3Key,
      expiresInSeconds: PRESIGN_PUT_EXPIRY,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/resumes/complete
 * Input: { resumeId: string }
 * Behavior: HeadObject S3, confirm PDF, update DynamoDB, update StudentProfiles resume references
 */
async function complete(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    const body = JSON.parse(event.body ?? "{}");
    const resumeId = body.resumeId;

    if (!resumeId || typeof resumeId !== "string" || resumeId.trim() === "") {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "resumeId is required" });
    }

    const record = await resumesService.get(userId, resumeId.trim());
    if (!record) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Resume record not found" });
    }
    if (record.status !== "UPLOADING") {
      return jsonResponse(400, {
        error: "BAD_REQUEST",
        message: `Resume is not in UPLOADING status (current: ${record.status})`,
      });
    }

    const { contentType, contentLength, etag } = await s3PresignService.headObject(record.s3Key);

    const ct = (contentType || "").toLowerCase();
    if (!ct.includes("pdf")) {
      return jsonResponse(400, {
        error: "BAD_REQUEST",
        message: "Uploaded file is not a PDF",
      });
    }

    const updated = await resumesService.markUploaded(userId, record.resumeId, {
      fileSize: contentLength,
      etag,
    });

    // Store resume reference in StudentProfiles (if profile exists)
    const profile = await studentProfilesService.getByUserId(userId);
    if (profile) {
      await studentProfilesService.update(userId, {
        resumeS3Key: record.s3Key,
        resumeId: record.resumeId,
      });
    }

    return jsonResponse(200, {
      resumeId: updated.resumeId,
      status: "UPLOADED",
      s3Key: updated.s3Key,
    });
  } catch (err) {
    const status = err.$metadata?.httpStatusCode ?? err.statusCode;
    if (status === 404 || err.name === "NotFound" || err.code === "NotFound") {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Resume file not found in S3" });
    }
    return handleError(err);
  }
}

/**
 * GET /api/resumes/me
 * Returns list of resume metadata (no presigned URLs).
 */
async function list(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    const items = await resumesService.listByUser(userId);
    return jsonResponse(200, { resumes: items });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/resumes/{resumeId}/download-url
 * Returns presigned GET URL for download.
 */
async function downloadUrl(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    const resumeId = event.pathParameters?.resumeId;
    if (!resumeId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "resumeId path parameter is required" });
    }

    const record = await resumesService.get(userId, resumeId);
    if (!record) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Resume not found" });
    }

    const downloadUrl = await s3PresignService.getPresignedGetUrl(
      record.s3Key,
      PRESIGN_GET_EXPIRY
    );

    return jsonResponse(200, {
      downloadUrl,
      expiresInSeconds: PRESIGN_GET_EXPIRY,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/resumes/{resumeId}/extracted-data
 * Returns extracted data when available, otherwise state-specific message.
 * Profile Auto-Fill contract:
 * - frontend polls this endpoint until status becomes EXTRACTED
 * - when EXTRACTED, extractedData is non-null and safe to prefill reviewable form fields
 */
async function extractedData(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    const resumeId = event.pathParameters?.resumeId;
    if (!resumeId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "resumeId path parameter is required" });
    }

    const record = await resumesService.get(userId, resumeId);
    if (!record) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Resume not found" });
    }

    const status = record.status;
    if (status === "EXTRACTED") {
      const empty = {
        skills: [],
        gpa: null,
        location: null,
        education: [],
        experience: [],
        projects: [],
        achievements: [],
      };
      return jsonResponse(200, {
        resumeId: record.resumeId,
        status,
        extractedData: { ...empty, ...(record.extractedData ?? {}) },
        message: "Resume extracted data fetched successfully.",
      });
    }

    if (status === "UPLOADING") {
      return jsonResponse(200, {
        resumeId: record.resumeId,
        status,
        extractedData: null,
        message: "Resume is still uploading. Please complete upload and try again shortly.",
      });
    }

    if (status === "UPLOADED") {
      return jsonResponse(200, {
        resumeId: record.resumeId,
        status,
        extractedData: null,
        message: "Resume uploaded successfully. Extraction is in progress.",
      });
    }

    if (status === "EXTRACTION_FAILED") {
      return jsonResponse(200, {
        resumeId: record.resumeId,
        status,
        extractedData: null,
        message: record.extractionError || "Resume extraction failed.",
      });
    }

    return jsonResponse(200, {
      resumeId: record.resumeId,
      status,
      extractedData: null,
      message: "Resume is in an intermediate state. Please try again later.",
    });
  } catch (err) {
    return handleError(err);
  }
}

module.exports = {
  uploadUrl,
  complete,
  list,
  downloadUrl,
  extractedData,
};
