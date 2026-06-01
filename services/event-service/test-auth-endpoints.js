/**
 * Auth Middleware Smoke Tests
 * 
 * Verifies that the Express application correctly protects routes using the
 * requireAuth and requireAdmin middlewares.
 * 
 * Logic Checked:
 * - Public routes (/api/events) are accessible without tokens.
 * - Protected routes return 401 Unauthorized when no token is provided.
 * - Admin routes return 403 Forbidden when a non-admin token is provided.
 * - Admin routes return Success/Internal Error (depending on mock state) when admin-token is used.
 * 
 * Usage:
 *   node test-auth-endpoints.js
 */
const { handler } = require('./index.js');

async function runTests() {
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
