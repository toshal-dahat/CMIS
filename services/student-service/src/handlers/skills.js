/**
 * GET /api/skills — list canonical master skills (for profile form).
 */

const { requireAuthWithClaims } = require("../lib/auth");
const { ensureUserGrouped } = require("../services/userGroupService");
const masterSkillsService = require("../services/masterSkillsService");

function jsonResponse(statusCode, body) {
  // Standard API Gateway/Lambda JSON response envelope with permissive CORS.
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function preflightResponse() {
  // Browser CORS preflight response for GET /api/skills.
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: "",
  };
}

function handleError(err) {
  // Normalize thrown errors from auth/services into a stable client payload.
  const code = err.code ?? "INTERNAL_ERROR";
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? "Internal server error";
  return jsonResponse(statusCode, { error: code, message });
}

/**
 * GET /api/skills
 */
async function list(event) {
  try {
    // Short-circuit CORS preflight requests before auth/service work.
    if (event?.httpMethod === "OPTIONS") return preflightResponse();

    // Require a valid identity; this endpoint allows non-TAMU emails.
    const { claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      // Best-effort user grouping bootstrap. Failure here should not block skill reads.
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    // Ensure master skill data exists before reading (idempotent seed step).
    await masterSkillsService.ensureSeeded();
    const skills = await masterSkillsService.listAll();
    return jsonResponse(200, { skills });
  } catch (err) {
    // Keep all failures in a consistent API error shape.
    return handleError(err);
  }
}

module.exports = { list };
