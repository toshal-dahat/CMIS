/**
 * Lambda Routing & Basic API Tests
 * 
 * Tests the core Lambda handler's ability to route requests to the Express app.
 * Primarily checks the health endpoint and root event list to ensure the
 * serverless-http wrapper is configured correctly.
 * 
 * Usage:
 *   node test-lambda.js
 */
const { handler } = require('./index.js');

async function testLambda() {
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
