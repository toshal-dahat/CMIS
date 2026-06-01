/**
 * Centralized auth helper for API handlers.
 * Extracts and validates claims from Cognito JWT.
 * Supports TAMU domain enforcement.
 */

const { requireAuth } = require("./jwt");

/** TAMU email domain; set to null to skip domain check */
const TAMU_DOMAIN = "@tamu.edu";

/**
 * Validates JWT and optionally enforces TAMU domain.
 * @param {Object} event - API Gateway event
 * @param {Object} options - { requireTamuEmail: boolean }
 * @returns {Promise<{ userId: string, email?: string, emailVerified?: boolean, claims: Object }>}
 * @throws Error with statusCode 401 (auth) or 403 (forbidden domain)
 */
async function requireAuthWithClaims(event, options = {}) {
  const { requireTamuEmail = true } = options;
  const { userId, claims } = await requireAuth(event);

  const email = claims.email;
  const emailVerified = claims.email_verified === true;

  if (requireTamuEmail && TAMU_DOMAIN) {
    if (!email || typeof email !== "string") {
      const err = new Error("Email claim not found");
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
    if (!emailVerified) {
      const err = new Error("Email not verified");
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
    if (!email.toLowerCase().endsWith(TAMU_DOMAIN.toLowerCase())) {
      const err = new Error("Only TAMU (@tamu.edu) email addresses are allowed");
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
  }

  return { userId, email, emailVerified, claims };
}

module.exports = { requireAuthWithClaims, requireAuth };
