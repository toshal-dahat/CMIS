/**
 * Lambda handlers for StudentProfiles:
 * - checkProfileExists: GET /api/users/me/profile-exists
 * - crud: GET /api/profiles (list all except me), GET/POST/PUT/DELETE /api/profiles and /api/profiles/me
 */

const { requireAuth } = require("../lib/jwt");
const studentProfilesService = require("../services/studentProfilesService");
const resumesService = require("../services/resumesService");
const { ensureUserGrouped, shouldBeAlumni } = require("../services/userGroupService");

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

function handleError(err) {
  const code = err.code ?? "INTERNAL_ERROR";
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? "Internal server error";
  return jsonResponse(statusCode, { error: code, message });
}

/**
 * GET /api/users/me/profile-exists
 * Returns { exists: true | false }
 */
async function checkProfileExists(event) {
  try {
    if (event?.httpMethod === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    const { userId, claims } = await requireAuth(event);
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }
    // Prefer matching by login email against the comma-separated email field,
    // so any known email (TAMU or personal) reuses the same profile.
    const email = (claims?.email ?? "").toLowerCase();
    let exists = false;
    if (email) {
      const byEmail = await studentProfilesService.getByAnyEmail(email);
      exists = !!byEmail;
    }
    // If no profile matched by email, fall back to the canonical key: userId (Cognito sub)
    if (!exists) {
      exists = await studentProfilesService.exists(userId);
    }
    return jsonResponse(200, { exists });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * CRUD router based on HTTP method and path
 */
async function crud(event) {
  try {
    if (event?.httpMethod === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    const { userId, claims } = await requireAuth(event);
    const method = event.httpMethod;
    const path = event.path ?? event.rawPath ?? "";
    const pathIncludesMe = /\/me(\/|$)/.test(path) || path.endsWith("/me");

    // GET /api/profiles (no /me) – List all profiles except current user (Students Connect)
    if (method === "GET" && path.includes("/profiles") && !pathIncludesMe) {
      const profiles = await studentProfilesService.listAllExceptUserId(userId);
      return jsonResponse(200, { profiles });
    }

    if (method === "GET" && pathIncludesMe) {
      // First try to find a profile whose comma-separated "email" contains the current login email
      // (TAMU or personal). This ensures any linked email reuses the same profile.
      const email = (claims?.email ?? "").toLowerCase();
      let profile = null;
      if (email) {
        profile = await studentProfilesService.getByAnyEmail(email);
      }
      // If no match by email, fall back to the canonical key: userId (original student account)
      if (!profile) {
        profile = await studentProfilesService.getByUserId(userId);
      }
      if (!profile) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
      }
      return jsonResponse(200, profile);
    }

    if (method === "POST" && path.includes("/profiles") && !pathIncludesMe) {
      const body = JSON.parse(event.body ?? "{}");
      const alumniSignup = shouldBeAlumni(claims?.email, body?.gradDate);
      // If no resumeS3Key provided, attach the user's uploaded resume if they have one (e.g. uploaded before creating profile)
      if (!body.resumeS3Key) {
        const resumes = await resumesService.listByUser(userId);
        const uploaded = resumes
          .filter((r) => r.status === "UPLOADED")
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        if (uploaded.length > 0) {
          body.resumeS3Key = uploaded[0].s3Key;
        }
      }
      if (alumniSignup) {
        body.role = "alumni";
      }
      await ensureUserGrouped(claims, { graduationDate: body?.gradDate });
      const profile = await studentProfilesService.create(userId, body);
      return jsonResponse(201, profile);
    }

    if (method === "PUT" && pathIncludesMe) {
      const body = JSON.parse(event.body ?? "{}");
      const existing = await studentProfilesService.getByUserId(userId);
      if (!existing) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
      }
      const effectiveGradDate = body?.gradDate ?? existing?.gradDate;
      if (shouldBeAlumni(claims?.email, effectiveGradDate)) {
        body.role = "alumni";
      }
      await ensureUserGrouped(claims, { graduationDate: effectiveGradDate });
      const profile = await studentProfilesService.update(userId, body);
      return jsonResponse(200, profile);
    }

    if (method === "DELETE" && pathIncludesMe) {
      await studentProfilesService.remove(userId);
      return jsonResponse(200, { deleted: true });
    }

    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED", message: "Method not allowed" });
  } catch (err) {
    if (err instanceof SyntaxError && err.message.includes("JSON")) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "Invalid JSON body" });
    }
    return handleError(err);
  }
}

module.exports = {
  checkProfileExists,
  crud,
};
