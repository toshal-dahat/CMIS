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
        try {
            // Try to parse the token if the user generates a fake one (like in our demo script)
            const parts = token.split('.');
            if (parts.length >= 2) {
                const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
                const claims = JSON.parse(payloadStr);
                req.user = { 
                    userId: claims.sub || claims.email || claims.username || 'mock-jwt-user', 
                    claims: claims 
                };
                return next();
            }
        } catch (err) {
            // Ignore parsing errors and fallback to default mock
        }
        
        // Fallback for simple tokens like 'admin-token' or 'any-token-works-locally'
        const groups = token === 'admin-token' ? ['admins'] : [];
        req.user = { userId: 'local-test-user-id', claims: { email: 'test@example.com', 'cognito:groups': groups } };
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

/**
 * Express Middleware: ensures user is an Admin
 * Must be used after requireAuth
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.claims) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "User not authenticated" });
    }

    const groups = req.user.claims['cognito:groups'] || [];
    const isAdmin = groups.some(g => ['admins', 'Admin', 'admin', 'ADMIN', 'SuperAdmin', 'superadmin', 'SUPERADMIN'].includes(g));

    if (!isAdmin) {
        return res.status(403).json({ error: "FORBIDDEN", message: "Requires administrator privileges" });
    }

    next();
}

module.exports = { extractToken, requireAuth, requireAdmin };
