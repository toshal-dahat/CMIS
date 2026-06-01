/**
 * Lambda handlers for StudentProfiles:
 * - checkProfileExists: GET /api/users/me/profile-exists
 * - crud: GET /api/profiles (list all except me), GET/POST/PUT/DELETE /api/profiles and /api/profiles/me
 */

const { requireAuth } = require("../lib/jwt");
const studentProfilesService = require("../services/studentProfilesService");
const resumesService = require("../services/resumesService");
const { ensureUserGrouped, deleteCognitoUserAndManagedGroups, syncGraduatedGroupsForProfile, setUserRole, listGroupsForUser } = require("../services/userGroupService");
const { fireAndForgetMentorshipMatching } = require("../services/mentorshipLateRegistration");

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

/** Cognito `students` group => TAMU student sign-in; mentorship UI is hidden client-side — store as mentee by default. */
function isCognitoStudentGroup(managedGroup) {
  return /^students?$/i.test((managedGroup ?? "").trim());
}

function applyCognitoStudentMentorshipDefaults(target) {
  target.mentorshipInterested = true;
  target.mentorship = "mentee";
  target.mentorCapacity = null;
  target.mentorSkills = [];
  target.mentorIndustries = [];
  target.mentorCompany = null;
  target.mentorJobTitle = null;
  target.mentorYearsExperience = null;
  target.mentorBio = null;
}

const MENTORSHIP_PATCH_KEYS = [
  "mentorshipInterested",
  "mentorship",
  "mentorCapacity",
  "mentorSkills",
  "mentorIndustries",
  "mentorCompany",
  "mentorJobTitle",
  "mentorYearsExperience",
  "mentorshipGoals",
  "studentGoals",
  "mentorBio",
];

function isAdminManagedGroup(managedGroup) {
  return /^admins?$/i.test((managedGroup ?? "").trim());
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Normalize and validate mentorship fields. Mutates `target` in place.
 * @param {object} target - body or merged profile
 * @param {{ emailForMenteeCheck: string }} opts
 * @returns {{ ok: true } | { ok: false, statusCode: number, message: string }}
 */
function validateAndNormalizeMentorship(target, opts) {
  const { emailForMenteeCheck } = opts;

  if (typeof target.mentorshipInterested !== "boolean") {
    target.mentorshipInterested = false;
  }

  if (!target.mentorshipInterested) {
    target.mentorship = null;
    target.mentorCapacity = null;
    target.mentorSkills = [];
    target.mentorIndustries = [];
    target.mentorCompany = null;
    target.mentorJobTitle = null;
    target.mentorYearsExperience = null;
    target.mentorshipGoals = null;
    return { ok: true };
  }

  const role = (target.mentorship ?? "").trim().toLowerCase();
  if (role !== "mentee" && role !== "mentor") {
    return {
      ok: false,
      statusCode: 400,
      message: 'When interested in the mentorship program, mentorship must be "mentee" or "mentor".',
    };
  }
  target.mentorship = role;

  if (role === "mentor") {
    const c = Number(target.mentorCapacity);
    if (!Number.isInteger(c) || c < 1 || c > 10) {
      return {
        ok: false,
        statusCode: 400,
        message: "mentorCapacity must be an integer from 1 to 10 when mentorship is mentor.",
      };
    }
    target.mentorCapacity = c;

    target.mentorSkills = normalizeStringList(target.mentorSkills);
    target.mentorIndustries = normalizeStringList(target.mentorIndustries);
    target.mentorCompany = String(target.mentorCompany ?? "").trim() || null;
    target.mentorJobTitle = String(target.mentorJobTitle ?? "").trim() || null;
    if (target.mentorYearsExperience !== null && target.mentorYearsExperience !== undefined && target.mentorYearsExperience !== "") {
      const years = Number(target.mentorYearsExperience);
      if (!Number.isInteger(years) || years < 0 || years > 80) {
        return {
          ok: false,
          statusCode: 400,
          message: "mentorYearsExperience must be an integer between 0 and 80.",
        };
      }
      target.mentorYearsExperience = years;
    } else {
      target.mentorYearsExperience = null;
    }

    if (target.mentorSkills.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        message: "mentorSkills must contain at least one skill when mentorship is mentor.",
      };
    }
    if (target.mentorIndustries.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        message: "mentorIndustries must contain at least one industry when mentorship is mentor.",
      };
    }
    if (!target.mentorCompany) {
      return {
        ok: false,
        statusCode: 400,
        message: "mentorCompany is required when mentorship is mentor.",
      };
    }
    target.mentorshipGoals = null;
  } else {
    target.mentorCapacity = null;
    target.mentorSkills = [];
    target.mentorIndustries = [];
    target.mentorCompany = null;
    target.mentorJobTitle = null;
    target.mentorYearsExperience = null;
    const goals = String(target.mentorshipGoals ?? "").trim();
    target.mentorshipGoals = goals ? goals.slice(0, 2000) : null;
    if (!emailCsvHasTamu(emailForMenteeCheck)) {
      return {
        ok: false,
        statusCode: 400,
        message: "Mentee participation requires at least one @tamu.edu email on your profile.",
      };
    }
  }

  return { ok: true };
}

function roleFromManagedGroup(groupName) {
  const g = (groupName ?? "").trim().toLowerCase();
  if (g === "students" || g === "student") return "STUDENT";
  if (g === "admins" || g === "admin") return "ADMIN";
  if (g === "investors" || g === "investor") return "INVESTOR";
  if (g === "friends" || g === "friend") return "FRIEND";
  if (g === "faculties" || g === "faculty") return "FACULTY";
  if (g === "alumni") return "ALUMNI";
  return null;
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

async function resolveCurrentProfile(userId, claims) {
  const email = (claims?.email ?? "").toLowerCase();
  if (email) {
    const byEmail = await studentProfilesService.getByAnyEmail(email);
    if (byEmail) return byEmail;
  }
  return await studentProfilesService.getByUserId(userId);
}

/**
 * GET /api/users/me/profile-exists
 * Returns { exists: true | false }
 */
async function checkProfileExists(event) {
  try {
    const { userId, claims } = await requireAuth(event);
    let managedGroup = null;
    try {
      managedGroup = await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }
    // Prefer matching by login email aliases (StudentProfiles.email is a CSV list).
    // This allows alumni users to reuse the same profile even if Cognito sub differs.
    const email = (claims?.email ?? "").toLowerCase();
    const roleToPersist = roleFromManagedGroup(managedGroup);
    let exists = false;
    let matchedProfile = null;
    if (email) {
      matchedProfile = await studentProfilesService.getByAnyEmail(email);
      exists = !!matchedProfile;
    }
    // Fall back to canonical Dynamo key: userId (Cognito sub).
    if (!exists) {
      matchedProfile = await studentProfilesService.getByUserId(userId);
      exists = !!matchedProfile;
    }

    // Keep profile role in DynamoDB aligned with effective login group on each login.
    if (
      exists &&
      matchedProfile &&
      roleToPersist &&
      (matchedProfile.role ?? "").toUpperCase() !== roleToPersist
    ) {
      try {
        await studentProfilesService.update(matchedProfile.userId || userId, { role: roleToPersist });
      } catch (e) {
        console.warn("[profile] role sync failed during login:", e?.message || e);
      }
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
    let managedGroup = null;
    try {
      managedGroup = await ensureUserGrouped(claims);
    } catch (e) {
      console.warn("[auth] group bootstrap failed:", e?.message || e);
    }
    const path = event.path ?? event.rawPath ?? "";
    const pathIncludesMe = /\/me(\/|$)/.test(path) || path.endsWith("/me");

    // GET /api/profiles (no /me) – List profiles except current user.
    // Optional query: ?role=STUDENT to filter by role.
    if (method === "GET" && path.includes("/profiles") && !pathIncludesMe) {
      const role = (event.queryStringParameters?.role ?? "").trim();
      const profiles = role
        ? await studentProfilesService.listAllExceptUserIdByRole(userId, role)
        : await studentProfilesService.listAllExceptUserId(userId);
      return jsonResponse(200, { profiles });
    }

    if (method === "GET" && pathIncludesMe) {
      // Resolve via alias email first so personal/TAMU logins reuse same profile row.
      const profile = await resolveCurrentProfile(userId, claims);
      if (!profile) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
      }
      return jsonResponse(200, profile);
    }

    if (method === "POST" && path.includes("/profiles") && !pathIncludesMe) {
      const body = JSON.parse(event.body ?? "{}");
      // If resume reference fields are missing, attach user's latest uploaded resume
      // (e.g. uploaded before creating profile).
      if (!body.resumeS3Key || !body.resumeId) {
        const resumes = await resumesService.listByUser(userId);
        const uploaded = resumes
          .filter((r) => r.status === "UPLOADED")
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        if (uploaded.length > 0) {
          const latest = uploaded[0];
          if (!body.resumeS3Key) body.resumeS3Key = latest.s3Key;
          if (!body.resumeId) body.resumeId = latest.resumeId;
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
      // Default first-time student profiles to STUDENT when role is not provided.
      // This keeps DynamoDB role aligned with Cognito student grouping.
      if (body.role === undefined && /^students?$/i.test((managedGroup ?? "").trim())) {
        body.role = "STUDENT";
      }
      if (body.role === undefined && /^investors?$/i.test((managedGroup ?? "").trim())) {
        body.role = "INVESTOR";
      }

      if (isCognitoStudentGroup(managedGroup)) {
        applyCognitoStudentMentorshipDefaults(body);
      }

      if (!isAdminManagedGroup(managedGroup)) {
        if (typeof body.mentorshipInterested !== "boolean") {
          return jsonResponse(400, {
            error: "BAD_REQUEST",
            message: "Mentorship program preference (mentorshipInterested) is required.",
          });
        }
      } else if (body.mentorshipInterested === undefined) {
        body.mentorshipInterested = false;
      }
      const mentorshipPost = validateAndNormalizeMentorship(body, {
        emailForMenteeCheck: body.email,
      });
      if (!mentorshipPost.ok) {
        return jsonResponse(mentorshipPost.statusCode, {
          error: "BAD_REQUEST",
          message: mentorshipPost.message,
        });
      }

      const profile = await studentProfilesService.create(userId, body);

      if (
        profile?.mentorshipInterested === true &&
        String(profile.mentorship ?? "").toLowerCase() === "mentee"
      ) {
        void fireAndForgetMentorshipMatching(profile.userId || userId);
      }

      // Sync Cognito groups only when gradDate is in the past.
      // Best-effort: don't fail the profile create if group ops error.
      try {
        await syncGraduatedGroupsForProfile(claims, body.email, body.gradDate, body.role);
      } catch (e) {
        console.warn("[auth] syncGraduatedGroupsForProfile failed:", e?.message || e);
      }
      return jsonResponse(201, profile);
    }

    // PUT /profiles/{userId} (admin role update — path has userId, not /me)
    const VALID_ROLES = ["STUDENT", "FORMER_STUDENT", "FRIEND", "INVESTOR", "FACULTY", "ALUMNI", "ADMIN"];
    const pathUserIdMatch = !pathIncludesMe && method === "PUT" && path.match(/\/profiles\/([^/]+)$/);
    if (pathUserIdMatch) {
      const targetUserId = decodeURIComponent(pathUserIdMatch[1]);

      // Verify caller is admin
      const callerUsername = claims?.["cognito:username"] || claims?.sub;
      if (!callerUsername) {
        return jsonResponse(403, { error: "FORBIDDEN", message: "Unable to verify admin status" });
      }
      let callerGroups = [];
      try {
        callerGroups = await listGroupsForUser(callerUsername);
      } catch (_) {
        // best-effort
      }
      if (!callerGroups.includes("admins")) {
        return jsonResponse(403, { error: "FORBIDDEN", message: "Admin access required" });
      }

      const body = JSON.parse(event.body ?? "{}");
      const newRole = body.role;
      if (!newRole || !VALID_ROLES.includes(newRole)) {
        return jsonResponse(400, {
          error: "BAD_REQUEST",
          message: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
        });
      }

      const targetProfile = await studentProfilesService.getByUserId(targetUserId);
      if (!targetProfile) {
        return jsonResponse(404, { error: "NOT_FOUND", message: "Target user profile not found" });
      }

      const updatedProfile = await studentProfilesService.update(targetUserId, { role: newRole });

      // Sync Cognito groups for target user
      const targetEmail = targetProfile.email;
      if (targetEmail) {
        try {
          await setUserRole(targetEmail, newRole);
        } catch (e) {
          console.warn("[admin] setUserRole Cognito sync failed:", e?.message || e);
        }
      }

      return jsonResponse(200, updatedProfile);
    }

    if (method === "PUT" && pathIncludesMe) {
      const body = JSON.parse(event.body ?? "{}");
      // Resolve profile the same way as GET /profiles/me for alias logins.
      const existing = await resolveCurrentProfile(userId, claims);
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

      const merged = { ...existing, ...body };
      if (isCognitoStudentGroup(managedGroup)) {
        applyCognitoStudentMentorshipDefaults(merged);
      }
      const mentorshipPut = validateAndNormalizeMentorship(merged, {
        emailForMenteeCheck: merged.email,
      });
      if (!mentorshipPut.ok) {
        return jsonResponse(mentorshipPut.statusCode, {
          error: "BAD_REQUEST",
          message: mentorshipPut.message,
        });
      }
      const patch = { ...body };
      for (const key of MENTORSHIP_PATCH_KEYS) {
        patch[key] = merged[key];
      }

      const targetUserId = existing.userId || userId;
      const profile = await studentProfilesService.update(targetUserId, patch);

      const wasMentee =
        existing.mentorshipInterested === true &&
        String(existing.mentorship ?? "").toLowerCase() === "mentee";
      const nowMentee =
        profile?.mentorshipInterested === true &&
        String(profile.mentorship ?? "").toLowerCase() === "mentee";
      if (nowMentee && !wasMentee) {
        void fireAndForgetMentorshipMatching(profile.userId || userId);
      }

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
