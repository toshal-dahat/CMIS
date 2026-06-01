/**
 * JWT verification for Cognito tokens — Express middleware.
 * Copied from event-service pattern, with an additional requireJudge middleware.
 *
 * Provides:
 *   requireAuth   — verifies JWT, binds req.user = { userId, claims }
 *   requireAdmin  — checks Cognito admins group
 *   requireJudge  — checks JudgeAssignments table for the authenticated user
 */

const { CognitoJwtVerifier } = require("aws-jwt-verify");

let verifier = null;

function getVerifier() {
    if (!verifier) {
        const userPoolId = process.env.COGNITO_USER_POOL_ID || "mock-user-pool-id";
        const clientId = process.env.COGNITO_CLIENT_ID || "mock-client-id";

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
 * Express Middleware: verifies JWT, binds { userId, claims } to req.user
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
        return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid Authorization header" });
    }

    // Local testing mock override
    if (!process.env.COGNITO_USER_POOL_ID) {
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
 * Express Middleware: ensures user is in the Cognito admins group.
 * Must be chained after requireAuth.
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

/**
 * Factory that returns an Express middleware verifying the authenticated user
 * is assigned as a judge for req.params.competitionId.
 *
 * On success, attaches req.judgeAssignment with a teamIds[] array DERIVED
 * from the union of teams across all rooms this judge belongs to in this
 * competition. Downstream route handlers continue reading
 * req.judgeAssignment.teamIds exactly as before.
 *
 * Must be chained after requireAuth.
 *
 * @param {Object} judgeAssignmentService — service with getAssignment()
 * @param {Object} roomService — service with getTeamIdsForJudge()
 */
function requireJudge(judgeAssignmentService, roomService) {
    return async (req, res, next) => {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ error: "UNAUTHORIZED", message: "User not authenticated" });
        }

        const competitionId = req.params.competitionId;
        if (!competitionId) {
            return res.status(400).json({ error: "BAD_REQUEST", message: "competitionId is required" });
        }

        try {
            const assignment = await judgeAssignmentService.getAssignment(competitionId, req.user.userId);
            if (!assignment) {
                return res.status(403).json({ error: "FORBIDDEN", message: "You are not assigned as a judge for this competition" });
            }
            const derivedTeamIds = roomService
                ? await roomService.getTeamIdsForJudge(competitionId, req.user.userId)
                : (assignment.teamIds || []);
            req.judgeAssignment = { ...assignment, teamIds: derivedTeamIds };
            next();
        } catch (err) {
            console.error("Judge assignment check failed", err);
            return res.status(500).json({ error: "INTERNAL_SERVER_ERROR", message: "Failed to verify judge assignment" });
        }
    };
}

module.exports = { extractToken, requireAuth, requireAdmin, requireJudge };
