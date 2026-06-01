/**
 * Production Stage Prefix Handling Test
 * 
 * Specifically tests the stage-prefix stripping logic in index.js.
 * In AWS API Gateway, requests often arrive with a /dev/ or /prod/ prefix
 * in the path. This test ensures that the service correctly strips these
 * prefixes before routing to Express, preventing 404 errors.
 * 
 * Usage:
 *   node test-lambda-prod.js
 */
const { handler } = require('./index.js');

async function testLambda() {
  console.log('--- Testing GET /dev/api/events/health ---');
  const healthEvent = {
    version: '2.0',
    routeKey: 'GET /api/events/{proxy+}',
    rawPath: '/dev/api/events/health',
    rawQueryString: '',
    headers: { host: 'api.example.com' },
    requestContext: {
      stage: 'dev',
      http: {
        method: 'GET',
        path: '/dev/api/events/health',
      }
    }
  };
  
  const healthResult = await handler(healthEvent, {});
  console.log('Health Status Code:', healthResult.statusCode);
  console.log('Health Body:', healthResult.body);
}

testLambda().catch(console.error);
