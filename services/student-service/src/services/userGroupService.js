const {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

const sts = new STSClient({});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COMPANIES_API_URL =
  process.env.COMPANIES_API_URL || "https://h54a90p4ca.execute-api.us-east-1.amazonaws.com/prod/companies";
const COGNITO_ADMIN_ROLE_ARN = process.env.COGNITO_ADMIN_ROLE_ARN || "";
const COGNITO_ADMIN_EXTERNAL_ID = process.env.COGNITO_ADMIN_EXTERNAL_ID || "";

const GROUP_STUDENTS = process.env.COGNITO_GROUP_STUDENTS || "students";
const GROUP_ALUMNI = process.env.COGNITO_GROUP_ALUMNI || "alumni";
const GROUP_INVESTORS = process.env.COGNITO_GROUP_INVESTORS || "investors";
const GROUP_FRIENDS = process.env.COGNITO_GROUP_FRIENDS || "friends";
const GROUP_ADMINS = process.env.COGNITO_GROUP_ADMINS || "admins";
const ADMIN_OVERRIDE_EMAIL = (
  process.env.COGNITO_ADMIN_OVERRIDE_EMAIL ||
  process.env.VITE_ADMIN_OVERRIDE_EMAIL ||
  ""
)
  .trim()
  .toLowerCase();
const MANAGED_GROUPS = [GROUP_STUDENTS, GROUP_ALUMNI, GROUP_INVESTORS, GROUP_FRIENDS, GROUP_ADMINS];

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
  const fromClaim = claims?.["cognito:username"];
  if (fromClaim && typeof fromClaim === "string") return fromClaim;

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
  const now = Date.now();
  if (companiesCache && now - companiesCacheAt < COMPANY_CACHE_TTL_MS) {
    return companiesCache;
  }

  const res = await fetch(COMPANIES_API_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch companies list: ${res.status}`);
  }

  const data = await res.json();
  const domains = new Set(
    (Array.isArray(data) ? data : [])
      .map((item) => (typeof item?.domain === "string" ? item.domain.trim().toLowerCase() : ""))
      .filter(Boolean)
  );

  companiesCache = domains;
  companiesCacheAt = now;
  return domains;
}

function isPastGraduationDate(graduationDate) {
  if (!graduationDate || typeof graduationDate !== "string") return false;
  const trimmed = graduationDate.trim();
  if (!trimmed) return false;

  // Supports "YYYY-MM" (profile form) and any valid Date.parse-compatible value.
  const monthOnlyMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthOnlyMatch) {
    const year = Number(monthOnlyMatch[1]);
    const month = Number(monthOnlyMatch[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return false;
    }
    // Consider graduation month complete at the end of that month.
    const graduationMonthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return Date.now() > graduationMonthEnd.getTime();
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return false;
  return Date.now() > parsed;
}

function isTamuEmail(email) {
  return extractDomain(email) === "tamu.edu";
}

function shouldBeAlumni(email, graduationDate) {
  return isTamuEmail(email) && isPastGraduationDate(graduationDate);
}

async function resolveTargetGroup(email, graduationDate) {
  const normalizedEmail = normalizeEmail(email);
  if (ADMIN_OVERRIDE_EMAIL && normalizedEmail === ADMIN_OVERRIDE_EMAIL) {
    return GROUP_ADMINS;
  }

  if (shouldBeAlumni(email, graduationDate)) return GROUP_ALUMNI;

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

async function ensureUserGrouped(claims, options = {}) {
  const { graduationDate } = options;
  const username = await resolveUsernameFromClaims(claims);
  if (!username) return null;

  const targetGroup = await resolveTargetGroup(claims?.email, graduationDate);
  const existingGroups = await listGroupsForUser(username);
  const currentGroups = new Set(existingGroups);

  // Enforce exactly one managed group: remove old managed groups, then add target.
  const groupsToRemove = [...currentGroups].filter(
    (groupName) => MANAGED_GROUPS.includes(groupName) && groupName !== targetGroup
  );

  for (const groupName of groupsToRemove) {
    await removeUserFromGroup(username, groupName);
    currentGroups.delete(groupName);
  }

  if (!currentGroups.has(targetGroup)) {
    await addUserToGroup(username, targetGroup);
  }

  return targetGroup;
}

module.exports = {
  ensureUserGrouped,
  shouldBeAlumni,
};
