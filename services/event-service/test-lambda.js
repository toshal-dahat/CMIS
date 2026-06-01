
/**
 * Lambda routing smoke test — verifies that the serverless-http adapter correctly
 * translates API Gateway v2 (HTTP API) payload format into Express requests.
 *
 * Tests the core Lambda handler's ability to route requests to the Express app
 * and confirms the serverless-http wrapper is configured correctly.
 *
 * Tests:
 *   GET /api/events/health  → 200 with { status, service, timestamp }
 *   GET /api/events/        → 200 with event array (empty list when DynamoDB is unavailable)
 *
 * No auth is needed because both routes are public. DynamoDB is not mocked; the list
 * route may return an empty array or a 500 if the local environment has no AWS credentials.
 *
 * Usage:
 *   node test-lambda.js
 */
const { handler } = require('./index.js');

async function testLambda() {
  // Health check is always synchronous and requires no AWS calls.
  console.log('--- Testing GET /api/events/health ---');
  const healthEvent = {
    version: '2.0',
    routeKey: 'GET /api/events/{proxy+}',
    rawPath: '/api/events/health',
    rawQueryString: '',
    headers: { host: 'api.example.com' },
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/events/health',
      }
    }
  };

  const healthResult = await handler(healthEvent, {});
  console.log('Health Status Code:', healthResult.statusCode);
  console.log('Health Body:', healthResult.body);

  // List events — exercises DynamoDB Scan. Returns an empty array when no table exists locally.
  console.log('\n--- Testing GET /api/events/ ---');
  const rootEvent = {
    version: '2.0',
    routeKey: 'GET /api/events/{proxy+}',
    rawPath: '/api/events/',
    rawQueryString: '',
    headers: { host: 'api.example.com' },
    requestContext: {
      http: {
        method: 'GET',
        path: '/api/events/',
      }
    }
  };

  const rootResult = await handler(rootEvent, {});
  console.log('Root Status Code:', rootResult.statusCode);
  console.log('Root Body:', rootResult.body);
}

testLambda().catch(console.error);
