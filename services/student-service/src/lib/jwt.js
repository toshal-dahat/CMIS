/**
 * JWT verification for Cognito tokens.
 * Expects Authorization: Bearer <id_token> from Cognito Google SSO.
 */

const { CognitoJwtVerifier } = require("aws-jwt-verify");

let verifier = null;

function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID must be set");
    }
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    });
  }
  return verifier;
}

/**
 * Extracts Bearer token from Authorization header.
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} - Token or null
 */
function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

/**
 * Verifies Cognito JWT and returns payload (includes sub as userId).
 * @param {string} token - JWT string
 * @returns {Promise<{ sub: string, email?: string, ... }>}
 * @throws {Error} if token is invalid
 */
async function verifyToken(token) {
  const v = getVerifier();
  return await v.verify(token);
}

/**
 * Middleware helper: verifies JWT from event, returns { userId, claims } or throws.
 * @param {Object} event - API Gateway event
 * @returns {Promise<{ userId: string, claims: Object }>}
 */
async function requireAuth(event) {
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;
  const token = extractToken(authHeader);
  if (!token) {
    const err = new Error("Missing or invalid Authorization header");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  try {
    const payload = await verifyToken(token);
    return { userId: payload.sub, claims: payload };
  } catch (e) {
    const err = new Error("Invalid or expired token");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
}

module.exports = { extractToken, verifyToken, requireAuth };
