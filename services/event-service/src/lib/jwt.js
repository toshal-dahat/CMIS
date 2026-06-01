/**
 * JWT verification for Cognito tokens mapping to Express middleware.
 * Expects Authorization: Bearer <id_token>
 */

const { CognitoJwtVerifier } = require("aws-jwt-verify");

let verifier = null;

function getVerifier() {
    if (!verifier) {
        // If not locally mocked, expect the environment variables to be fed via Terraform
        const userPoolId = process.env.COGNITO_USER_POOL_ID || "mock-user-pool-id";
        const clientId = process.env.COGNITO_CLIENT_ID || "mock-client-id";

        // In local tests without actual Cognito config, we may bypass validation or fail gracefully
        if (userPoolId === "mock-user-pool-id") {
            console.warn("Using mock Cognito verifier - requests will be authorized blindly for local testing");
        }

        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "id",
            clientId,
        });
    }
    return verifier;
}

function extractToken(authHeader) {
    if (!authHeader || typeof authHeader !== "string") return null;
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
    return parts[1];
}

/**
 * Express Middleware: verifies JWT from request headers, binds { userId, claims } to req.user
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization header" });
    }

    // Local testing mock override if real credentials aren't provided
    if (!process.env.COGNITO_USER_POOL_ID) {
        req.user = { userId: 'local-test-user-id', claims: { email: 'test@example.com' } };
        return next();
    }

    try {
        const v = getVerifier();
        const payload = await v.verify(token);
        req.user = { userId: payload.sub, claims: payload };
        next();
    } catch (e) {
        console.error("Token verification failed", e);
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid or expired token" });
    }
}

module.exports = { extractToken, requireAuth };
