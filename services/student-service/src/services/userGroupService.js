const {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

/**
 * Cognito group orchestration service.
 *
 * Responsibilities:
 * - resolve Cognito usernames from auth claims when tokens vary by IdP flow
 * - map users into managed groups based on role/email-domain rules
 * - keep group membership consistent for login bootstrap, profile sync, and deletes
 */
const sts = new STSClient({});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COMPANIES_API_URL =
  process.env.COMPANIES_API_URL || "https://h54a90p4ca.execute-api.us-east-1.amazonaws.com/prod/companies";
const COGNITO_ADMIN_ROLE_ARN = process.env.COGNITO_ADMIN_ROLE_ARN || "";
const COGNITO_ADMIN_EXTERNAL_ID = process.env.COGNITO_ADMIN_EXTERNAL_ID || "";

const GROUP_STUDENTS = process.env.COGNITO_GROUP_STUDENTS || "students";
const GROUP_INVESTORS = process.env.COGNITO_GROUP_INVESTORS || "investors";
const GROUP_FRIENDS = process.env.COGNITO_GROUP_FRIENDS || "friends";
const GROUP_ADMINS = process.env.COGNITO_GROUP_ADMINS || "admins";
const GROUP_ALUMNI = process.env.COGNITO_GROUP_ALUMNI || "alumni";
const GROUP_FACULTIES = process.env.COGNITO_GROUP_FACULTIES || "faculties";
const ADMIN_OVERRIDE_EMAILS = new Set(
  (
  process.env.COGNITO_ADMIN_OVERRIDE_EMAIL ||
  process.env.VITE_ADMIN_OVERRIDE_EMAIL ||
  ""
)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
const MANAGED_GROUPS = [GROUP_STUDENTS, GROUP_INVESTORS, GROUP_FRIENDS, GROUP_ADMINS];
const ALL_MANAGED_GROUPS = [GROUP_STUDENTS, GROUP_INVESTORS, GROUP_FRIENDS, GROUP_ADMINS, GROUP_ALUMNI, GROUP_FACULTIES];

const ROLE_TO_GROUPS = {
  STUDENT: [GROUP_STUDENTS],
  FORMER_STUDENT: [GROUP_ALUMNI, GROUP_FRIENDS],
  FRIEND: [GROUP_FRIENDS],
  INVESTOR: [GROUP_INVESTORS],
  PARTNER: [GROUP_INVESTORS],
  ADMIN: [GROUP_ADMINS],
  FACULTY: [GROUP_FACULTIES],
  ALUMNI: [GROUP_ALUMNI],
};

const COMPANY_CACHE_TTL_MS = 5 * 60 * 1000;
let companiesCache = null;
let companiesCacheAt = 0;
let cognitoClient = null;
let assumedRoleExpiresAt = 0;

function ensureUserPoolId() {
  if (!USER_POOL_ID) {
    throw new Error("COGNITO_USER_POOL_ID environment variable is not set");
  }
}

function extractDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function isUsableUsername(value) {
  return typeof value === "string" && value.trim() !== "" && !/\s/.test(value);
}

async function listGroupsForUser(username) {
  ensureUserPoolId();
  const cognito = await getCognitoClient();
  const out = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );
  return (out.Groups || []).map((g) => g.GroupName).filter(Boolean);
}

async function addUserToGroup(username, groupName) {
  ensureUserPoolId();
  const cognito = await getCognitoClient();
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName,
    })
  );
}

async function removeUserFromGroup(username, groupName) {
  ensureUserPoolId();
  const cognito = await getCognitoClient();
  await cognito.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName,
    })
  );
}

async function listUsersByFilter(filter) {
  ensureUserPoolId();
  const cognito = await getCognitoClient();
  const out = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: filter,
      Limit: 2,
    })
  );
  return out?.Users || [];
}

async function resolveUsernameFromClaims(claims) {
  // Prefer the token claim when valid; fallback handles federated edge cases.
  const fromClaim = claims?.["cognito:username"];
  if (isUsableUsername(fromClaim)) return fromClaim;
  return await resolveUsernameFromDirectory(claims);
}

async function resolveUsernameFromDirectory(claims) {
  // Lookup priority: immutable sub, then email; final fallback is sub-as-username.
  const sub = claims?.sub;
  if (sub && typeof sub === "string") {
    const usersBySub = await listUsersByFilter(`sub = "${sub}"`);
    if (usersBySub.length > 0 && usersBySub[0]?.Username) {
      return usersBySub[0].Username;
    }
  }

  const email = claims?.email;
  if (email && typeof email === "string") {
    const usersByEmail = await listUsersByFilter(`email = "${email}"`);
    if (usersByEmail.length > 0 && usersByEmail[0]?.Username) {
      return usersByEmail[0].Username;
    }
  }

  if (sub && typeof sub === "string") return sub;
  return null;
}

async function getCognitoClient() {
  // Reuse a cached client; if assuming role, refresh shortly before expiry.
  if (!COGNITO_ADMIN_ROLE_ARN) {
    if (!cognitoClient) {
      cognitoClient = new CognitoIdentityProviderClient({});
    }
    return cognitoClient;
  }

  const now = Date.now();
  if (cognitoClient && now < assumedRoleExpiresAt - 60_000) {
    return cognitoClient;
  }

  const assumeParams = {
    RoleArn: COGNITO_ADMIN_ROLE_ARN,
    RoleSessionName: "cmis-student-core-cognito-admin",
  };
  if (COGNITO_ADMIN_EXTERNAL_ID) {
    assumeParams.ExternalId = COGNITO_ADMIN_EXTERNAL_ID;
  }

  const assumed = await sts.send(new AssumeRoleCommand(assumeParams));
  const creds = assumed?.Credentials;
  if (!creds?.AccessKeyId || !creds?.SecretAccessKey || !creds?.SessionToken) {
    throw new Error("Failed to assume Cognito admin role");
  }

  assumedRoleExpiresAt = creds.Expiration ? new Date(creds.Expiration).getTime() : now + 10 * 60 * 1000;
  cognitoClient = new CognitoIdentityProviderClient({
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    },
  });
  return cognitoClient;
}

async function getCompanyDomains() {
  // Short-lived cache reduces pressure on Companies API during auth spikes.
  const now = Date.now();
  if (companiesCache && now - companiesCacheAt < COMPANY_CACHE_TTL_MS) {
    console.log(
      `[auth] companies cache hit url=${COMPANIES_API_URL} domains=${JSON.stringify(Array.from(companiesCache))}`
    );
    return companiesCache;
  }

  const res = await fetch(COMPANIES_API_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  console.log(`[auth] companies fetch url=${COMPANIES_API_URL} status=${res.status}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch companies list: ${res.status}`);
  }

  const data = await res.json();
  console.log(`[auth] companies fetch raw response=${JSON.stringify(data)}`);
  const domains = new Set(
    (Array.isArray(data) ? data : [])
      .map((item) => (typeof item?.domain === "string" ? item.domain.trim().toLowerCase() : ""))
      .filter(Boolean)
  );
  console.log(`[auth] companies parsed domains=${JSON.stringify(Array.from(domains))}`);

  companiesCache = domains;
  companiesCacheAt = now;
  return domains;
}

async function resolveTargetGroup(email) {
  // Routing precedence: explicit admin override > tamu student > investor domain > friend.
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && ADMIN_OVERRIDE_EMAILS.has(normalizedEmail)) {
    return GROUP_ADMINS;
  }

  const domain = extractDomain(email);
  if (!domain) return GROUP_FRIENDS;
  if (domain === "tamu.edu") return GROUP_STUDENTS;

  try {
    const companyDomains = await getCompanyDomains();
    if (companyDomains.has(domain)) return GROUP_INVESTORS;
  } catch (err) {
    console.warn("[auth] companies API fetch failed; defaulting to friends", err?.message || err);
  }
  return GROUP_FRIENDS;
}

async function ensureUserGrouped(claims) {
  // Login-time bootstrap to ensure users belong to exactly one managed baseline group.
  let username = await resolveUsernameFromClaims(claims);
  if (!username) return null;

  const targetGroup = await resolveTargetGroup(claims?.email);
  let existingGroups = [];
  try {
    existingGroups = await listGroupsForUser(username);
  } catch (err) {
    // Federated tokens can sometimes carry a non-usable cognito:username value.
    // Retry once by resolving username through directory lookup (sub/email).
    if (err?.name === "UserNotFoundException" || err?.name === "ResourceNotFoundException") {
      const resolved = await resolveUsernameFromDirectory(claims);
      if (resolved && resolved !== username) {
        username = resolved;
        existingGroups = await listGroupsForUser(username);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  console.log(
    `[auth] ensureUserGrouped username=${username} email=${normalizeEmail(claims?.email)} target=${targetGroup} existing=${existingGroups.join(",")}`
  );
  if (existingGroups.includes(targetGroup)) {
    return targetGroup;
  }

  // For admin override emails, always ensure admins group is attached.
  // We do this before honoring existing managed groups to avoid sticking to students.
  if (targetGroup === GROUP_ADMINS) {
    for (const g of existingGroups) {
      if (MANAGED_GROUPS.includes(g) && g !== GROUP_ADMINS) {
        try {
          await removeUserFromGroup(username, g);
        } catch (err) {
          console.warn(`[auth] failed removing ${username} from ${g}:`, err?.message || err);
        }
      }
    }
    await addUserToGroup(username, GROUP_ADMINS);
    return GROUP_ADMINS;
  }

  const existingManagedGroup = existingGroups.find((g) => MANAGED_GROUPS.includes(g));
  if (existingManagedGroup) {
    // If a TAMU user was previously mis-grouped (e.g. friends), correct to students.
    if (targetGroup === GROUP_STUDENTS && existingManagedGroup !== GROUP_STUDENTS) {
      try {
        await removeUserFromGroup(username, existingManagedGroup);
      } catch (err) {
        console.warn(`[auth] failed removing ${username} from ${existingManagedGroup}:`, err?.message || err);
      }
      await addUserToGroup(username, GROUP_STUDENTS);
      console.log(
        `[auth] corrected managed group for ${username}: ${existingManagedGroup} -> ${GROUP_STUDENTS}`
      );
      return GROUP_STUDENTS;
    }
    return existingManagedGroup;
  }

  await addUserToGroup(username, targetGroup);
  console.log(`[auth] added user ${username} to group ${targetGroup}`);
  return targetGroup;
}

async function deleteCognitoUserAndManagedGroups(claims) {
  // Best-effort managed-group cleanup before deleting the Cognito user account.
  const username = await resolveUsernameFromClaims(claims);
  if (!username) return { deleted: false, reason: "USERNAME_NOT_FOUND" };

  const existingGroups = await listGroupsForUser(username);
  for (const groupName of existingGroups) {
    if (!MANAGED_GROUPS.includes(groupName)) continue;
    try {
      await removeUserFromGroup(username, groupName);
    } catch (err) {
      console.warn(
        `[auth] failed removing user ${username} from group ${groupName}:`,
        err?.message || err
      );
    }
  }

  // Also remove alumni group if present (not part of MANAGED_GROUPS).
  if (existingGroups.includes(GROUP_ALUMNI)) {
    try {
      await removeUserFromGroup(username, GROUP_ALUMNI);
    } catch (err) {
      console.warn(`[auth] failed removing user ${username} from group ${GROUP_ALUMNI}:`, err?.message || err);
    }
  }

  ensureUserPoolId();
  const cognito = await getCognitoClient();
  try {
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );
  } catch (err) {
    // Treat already-deleted users as success for idempotency.
    if (err?.name !== "UserNotFoundException") {
      throw err;
    }
  }
  return { deleted: true, username };
}

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
  // Compare [year, month] tuples.
  return [ty, tm] >= [ym.year, ym.month];
}

function emailCsvHasTamu(emailCsv) {
  const parts = (emailCsv ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.some((e) => e.endsWith("@tamu.edu"));
}

/**
 * Sync Cognito groups for users whose graduation date is already in the past.
 *
 * Behavior:
 * - if profile email contains @tamu.edu => add `alumni` group (and keep `friends`)
 * - else => ensure user is NOT in `alumni`
 *
 * Note: this is intentionally limited to "graduated_by_month" so it doesn't interfere
 * with users whose graduation month is in the future.
 */
async function syncGraduatedGroupsForProfile(claims, emailCsv, gradDate, profileRole) {
  // Explicit saved profile role wins; graduation heuristics are fallback behavior.
  const username = await resolveUsernameFromClaims(claims);
  if (!username) return;
  const existingGroups = await listGroupsForUser(username);

  if (profileRole === "STUDENT") {
    if (!existingGroups.includes(GROUP_STUDENTS)) {
      await addUserToGroup(username, GROUP_STUDENTS);
    }
    // Keep this path strictly "students only".
    if (existingGroups.includes(GROUP_ALUMNI)) {
      try {
        await removeUserFromGroup(username, GROUP_ALUMNI);
      } catch (_) {
        // best-effort
      }
    }
    if (existingGroups.includes(GROUP_FRIENDS)) {
      try {
        await removeUserFromGroup(username, GROUP_FRIENDS);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  // Explicit role from profile save always wins.
  if (profileRole === "FORMER_STUDENT") {
    // Add alumni. Also ensure friends group exists so the UI treats them like non-admin users.
    if (!existingGroups.includes(GROUP_ALUMNI)) {
      await addUserToGroup(username, GROUP_ALUMNI);
    }
    if (!existingGroups.includes(GROUP_FRIENDS)) {
      await addUserToGroup(username, GROUP_FRIENDS);
    }
    // Optional: remove students group so they don't behave like active students.
    if (existingGroups.includes(GROUP_STUDENTS)) {
      try {
        await removeUserFromGroup(username, GROUP_STUDENTS);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  if (profileRole === "FRIEND") {
    if (!existingGroups.includes(GROUP_FRIENDS)) {
      await addUserToGroup(username, GROUP_FRIENDS);
    }
    if (existingGroups.includes(GROUP_ALUMNI)) {
      try {
        await removeUserFromGroup(username, GROUP_ALUMNI);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  if (profileRole === "INVESTOR" || profileRole === "PARTNER") {
    if (!existingGroups.includes(GROUP_INVESTORS)) {
      await addUserToGroup(username, GROUP_INVESTORS);
    }
    if (existingGroups.includes(GROUP_STUDENTS)) {
      try {
        await removeUserFromGroup(username, GROUP_STUDENTS);
      } catch (_) {
        // best-effort
      }
    }
    if (existingGroups.includes(GROUP_ALUMNI)) {
      try {
        await removeUserFromGroup(username, GROUP_ALUMNI);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  if (profileRole === "FACULTY") {
    if (!existingGroups.includes(GROUP_FACULTIES)) {
      await addUserToGroup(username, GROUP_FACULTIES);
    }
    if (existingGroups.includes(GROUP_STUDENTS)) {
      try {
        await removeUserFromGroup(username, GROUP_STUDENTS);
      } catch (_) {
        // best-effort
      }
    }
    if (existingGroups.includes(GROUP_ALUMNI)) {
      try {
        await removeUserFromGroup(username, GROUP_ALUMNI);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  if (profileRole === "ALUMNI") {
    if (!existingGroups.includes(GROUP_ALUMNI)) {
      await addUserToGroup(username, GROUP_ALUMNI);
    }
    if (existingGroups.includes(GROUP_STUDENTS)) {
      try {
        await removeUserFromGroup(username, GROUP_STUDENTS);
      } catch (_) {
        // best-effort
      }
    }
    return;
  }

  // Fallback behavior: only auto-adjust when graduation month has passed.
  if (!graduatedByMonth(gradDate)) return;
  const hasTamu = emailCsvHasTamu(emailCsv);
  if (hasTamu) {
    if (!existingGroups.includes(GROUP_ALUMNI)) {
      await addUserToGroup(username, GROUP_ALUMNI);
    }
    if (!existingGroups.includes(GROUP_FRIENDS)) {
      await addUserToGroup(username, GROUP_FRIENDS);
    }
    if (existingGroups.includes(GROUP_STUDENTS)) {
      try {
        await removeUserFromGroup(username, GROUP_STUDENTS);
      } catch (_) {
        // best-effort
      }
    }
  } else {
    if (!existingGroups.includes(GROUP_FRIENDS)) {
      await addUserToGroup(username, GROUP_FRIENDS);
    }
    if (existingGroups.includes(GROUP_ALUMNI)) {
      try {
        await removeUserFromGroup(username, GROUP_ALUMNI);
      } catch (_) {
        // best-effort
      }
    }
  }
}

async function setUserRole(email, newRole) {
  // Authoritative role sync: remove other managed groups, then add target role groups.
  const targetGroups = ROLE_TO_GROUPS[newRole];
  if (!targetGroups) {
    throw new Error(`Invalid role: ${newRole}`);
  }

  const users = await listUsersByFilter(`email = "${normalizeEmail(email)}"`);
  if (!users.length || !users[0]?.Username) {
    throw new Error(`Cognito user not found for email: ${email}`);
  }
  const username = users[0].Username;

  const existingGroups = await listGroupsForUser(username);
  for (const g of existingGroups) {
    if (ALL_MANAGED_GROUPS.includes(g) && !targetGroups.includes(g)) {
      try {
        await removeUserFromGroup(username, g);
      } catch (err) {
        console.warn(`[auth] setUserRole: failed removing ${username} from ${g}:`, err?.message || err);
      }
    }
  }

  for (const g of targetGroups) {
    if (!existingGroups.includes(g)) {
      await addUserToGroup(username, g);
    }
  }
}

module.exports = {
  ensureUserGrouped,
  deleteCognitoUserAndManagedGroups,
  syncGraduatedGroupsForProfile,
  setUserRole,
  listGroupsForUser,
};
