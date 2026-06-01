/**
 * Lambda handlers for StudentProfiles:
 * - checkProfileExists: GET /api/users/me/profile-exists
 * - crud: GET /api/profiles (list all except me), GET/POST/PUT/DELETE /api/profiles and /api/profiles/me
 */

const { requireAuth } = require("../lib/jwt");
const studentProfilesService = require("../services/studentProfilesService");
const resumesService = require("../services/resumesService");
const { ensureUserGrouped, deleteCognitoUserAndManagedGroups, syncGraduatedGroupsForProfile } = require("../services/userGroupService");

function parseGradYearMonth(gradDate) {
  const v = (gradDate ?? "").trim();
  if (!v) return null;
  const parts = v.split("-");
  if (parts.length < 2) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function graduatedByMonth(gradDate) {
  const ym = parseGradYearMonth(gradDate);
  if (!ym) return false;
  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  return [ty, tm] >= [ym.year, ym.month];
}

function emailCsvHasTamu(emailCsv) {
  const parts = (emailCsv ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.some((e) => e.endsWith("@tamu.edu"));
}

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
 * GET /api/users/me/profile-exists
 * Returns { exists: true | false }
 */
async function checkProfileExists(event) {
  try {
    const { userId, claims } = await requireAuth(event);
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }
    // Prefer matching by login email aliases (StudentProfiles.email is a CSV list).
    // This allows alumni users to reuse the same profile even if Cognito sub differs.
    const email = (claims?.email ?? "").toLowerCase();
    let exists = false;
    if (email) {
      const byEmail = await studentProfilesService.getByAnyEmail(email);
      exists = !!byEmail;
    }
    // Fall back to canonical Dynamo key: userId (Cognito sub).
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
    const method = event.httpMethod;
    if (method === "OPTIONS") {
      return preflightResponse();
    }

    const { userId, claims } = await requireAuth(event);
    try {
      await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }
    const path = event.path ?? event.rawPath ?? "";
    const pathIncludesMe = /\/me(\/|$)/.test(path) || path.endsWith("/me");

    // GET /api/profiles (no /me) – List all profiles except current user (Students Connect)
    if (method === "GET" && path.includes("/profiles") && !pathIncludesMe) {
      const profiles = await studentProfilesService.listAllExceptUserId(userId);
      return jsonResponse(200, { profiles });
    }

    if (method === "GET" && pathIncludesMe) {
      // First try to find by login email aliases.
      const email = (claims?.email ?? "").toLowerCase();
      let profile = null;
      if (email) {
        profile = await studentProfilesService.getByAnyEmail(email);
      }
      // Fall back to canonical Dynamo key: userId (Cognito sub).
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
      // If this is a first-time profile and gradDate is already in the past,
      // auto-set role and Cognito group membership:
      // - includes @tamu.edu => role FORMER_STUDENT (Alumni)
      // - otherwise => role FRIEND
      //
      // This prevents the graduation prompt from reappearing after saving a past gradDate.
      if (body.role === undefined && body.gradDate && graduatedByMonth(body.gradDate)) {
        if (emailCsvHasTamu(body.email)) body.role = "FORMER_STUDENT";
        else body.role = "FRIEND";
      }

      const profile = await studentProfilesService.create(userId, body);

      // Sync Cognito groups only when gradDate is in the past.
      // Best-effort: don't fail the profile create if group ops error.
      try {
        await syncGraduatedGroupsForProfile(claims, body.email, body.gradDate, body.role);
      } catch (e) {
        console.warn("[auth] syncGraduatedGroupsForProfile failed:", e?.message || e);
      }
      return jsonResponse(201, profile);
    }

    if (method === "PUT" && pathIncludesMe) {
      const body = JSON.parse(event.body ?? "{}");
      const existing = await studentProfilesService.getByUserId(userId);
      if (!existing) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
      }

      const effectiveGradDate = body.gradDate ?? existing.gradDate;
      if ((body.role === undefined || body.role === null) && effectiveGradDate && graduatedByMonth(effectiveGradDate)) {
        const emailValue = body.email ?? existing.email;
        if (!body.role) {
          if (emailCsvHasTamu(emailValue)) body.role = "FORMER_STUDENT";
          else body.role = "FRIEND";
        }
      }
      const profile = await studentProfilesService.update(userId, body);

      try {
        await syncGraduatedGroupsForProfile(
          claims,
          body.email ?? existing.email,
          effectiveGradDate,
          body.role ?? profile?.role ?? existing.role
        );
      } catch (e) {
        console.warn("[auth] syncGraduatedGroupsForProfile failed:", e?.message || e);
      }
      return jsonResponse(200, profile);
    }

    if (method === "DELETE" && pathIncludesMe) {
      // Resolve profile the same way as GET /profiles/me so alias logins (personal/TAMU CSV)
      // delete the same DynamoDB row GET returns.
      const email = (claims?.email ?? "").toLowerCase();
      let profile = null;
      if (email) {
        profile = await studentProfilesService.getByAnyEmail(email);
      }
      if (!profile) {
        profile = await studentProfilesService.getByUserId(userId);
      }
      if (!profile) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
      }

      await deleteCognitoUserAndManagedGroups(claims);

      // Remove every row whose email CSV contains this login (handles duplicate rows and
      // alias vs userId mismatches). Fall back to single-key delete if none matched.
      let removedRows = 0;
      if (email) {
        removedRows = await studentProfilesService.removeAllByEmailAlias(email);
      }
      if (removedRows === 0) {
        await studentProfilesService.remove(profile.userId || userId);
      }

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
