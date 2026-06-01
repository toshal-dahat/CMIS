/**
 * GET /api/skills — list canonical master skills (for profile form).
 */

const { requireAuthWithClaims } = require("../lib/auth");
const { ensureUserGrouped } = require("../services/userGroupService");
const masterSkillsService = require("../services/masterSkillsService");

function jsonResponse(statusCode, body) {
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
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { claims } = await requireAuthWithClaims(event, { requireTamuEmail: false });
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }

    await masterSkillsService.ensureSeeded();
    const skills = await masterSkillsService.listAll();
    return jsonResponse(200, { skills });
  } catch (err) {
    return handleError(err);
  }
}

module.exports = { list };
