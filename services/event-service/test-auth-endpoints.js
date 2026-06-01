
/*
 * Auth middleware smoke test — exercises the three auth layers on the event CRUD routes.
 *
 * Test matrix:
 *   GET  /api/events            (no auth header)        → 200/500   public route, no token required
 *   POST /api/events            (no auth header)        → 401       requireAuth rejects missing token
 *   POST /api/events            (non-admin token)       → 403       requireAdmin rejects non-admin users
 *   POST /api/events            (admin-token)           → 201/500   admin passes both gates; 500 is
 *                                                                   acceptable here because DynamoDB is
 *                                                                   not mocked in this script
 *
 * Logic checked:
 *   - Public routes (/api/events) are accessible without tokens.
 *   - Protected routes return 401 Unauthorized when no token is provided.
 *   - Admin routes return 403 Forbidden when a non-admin token is provided.
 *   - Admin routes return Success/Internal Error (depending on mock state) when admin-token is used.
 *
 * Relies on the local-mode mock in jwt.js: COGNITO_USER_POOL_ID must be unset (the default
 * when running locally) so that 'admin-token' is treated as an admin and any other token as
 * a plain authenticated user.
 *
 * Usage:
 *   node test-auth-endpoints.js
 */
const { handler } = require('./index.js');

async function runTests() {
    // Public read route — should succeed regardless of auth state.
    console.log('--- Testing GET /api/events (Public Route) ---');
    const getEvent = {
        version: '2.0',
        routeKey: 'GET /api/events/{proxy+}',
        rawPath: '/api/events',
        requestContext: { http: { method: 'GET', path: '/api/events' } }
    };
    const getRes = await handler(getEvent, {});
    console.log('Status:', getRes.statusCode);
    console.log('Body:', JSON.parse(getRes.body).message);

    // No Authorization header — requireAuth must reject with 401 before reaching the handler.
    console.log('\n--- Testing POST /api/events (No Auth) ---');
    const postNoAuthEvent = {
        version: '2.0',
        routeKey: 'POST /api/events/{proxy+}',
        rawPath: '/api/events',
        body: JSON.stringify({ name: 'Test Event' }),
        requestContext: { http: { method: 'POST', path: '/api/events' } }
    };
    const noAuthRes = await handler(postNoAuthEvent, {});
    console.log('Status:', noAuthRes.statusCode); // Should be 401
    console.log('Body:', noAuthRes.body);

    // Valid token but not in an admin group — requireAuth passes, requireAdmin rejects with 403.
    console.log('\n--- Testing POST /api/events (With Standard Auth Mock) ---');
    const postAuthEvent = {
        version: '2.0',
        routeKey: 'POST /api/events/{proxy+}',
        rawPath: '/api/events',
        headers: { authorization: 'Bearer dummy-token' },
        body: JSON.stringify({ title: 'Test Event', location: 'TAMU' }),
        requestContext: { http: { method: 'POST', path: '/api/events' } }
    };
    const authRes = await handler(postAuthEvent, {});
    console.log('Status:', authRes.statusCode); // Should be 403

    // 'admin-token' is mapped to the 'admins' group by the local mock in jwt.js.
    // Both middleware layers pass; outcome depends on whether DynamoDB is reachable (201 or 500).
    console.log('\n--- Testing POST /api/events (With Admin Auth Mock) ---');
    const postAdminEvent = {
        version: '2.0',
        routeKey: 'POST /api/events/{proxy+}',
        rawPath: '/api/events',
        headers: { authorization: 'Bearer admin-token' },
        body: JSON.stringify({ title: 'Admin Test Event', location: 'TAMU' }),
        requestContext: { http: { method: 'POST', path: '/api/events' } }
    };
    const adminRes = await handler(postAdminEvent, {});
    console.log('Status:', adminRes.statusCode); // Should be 201 or 500
}

runTests().catch(console.error);
