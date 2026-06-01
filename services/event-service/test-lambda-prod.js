
/**
 * Stage-prefix stripping smoke test (production API Gateway routing).
 *
 * Why this exists:
 *   When AWS API Gateway deploys a Lambda integration, it prepends the stage name
 *   (e.g. /dev/ or /prod/) to every incoming URL. Express doesn't know about the
 *   stage, so without stripping, requests like /dev/api/events/health would 404.
 *   index.js strips the prefix before handing the request to the router:
 *
 *     if (stage && request.url.startsWith(`/${stage}/`)) {
 *       request.url = request.url.replace(`/${stage}`, '');
 *     }
 *
 * What this test confirms:
 *   A request arriving with rawPath = '/dev/api/events/health' and
 *   requestContext.stage = 'dev' is correctly rewritten to '/api/events/health'
 *   and routed to the health-check handler (200).
 *
 * Usage:
 *   node test-lambda-prod.js
 */
const { handler } = require('./index.js');

async function testLambda() {
  console.log('--- Testing GET /dev/api/events/health (stage prefix present) ---');
  const healthEvent = {
    version: '2.0',
    routeKey: 'GET /api/events/{proxy+}',
    rawPath: '/dev/api/events/health',   // API Gateway prepends the stage name
    rawQueryString: '',
    headers: { host: 'api.example.com' },
    requestContext: {
      stage: 'dev',                       // used by index.js to strip the prefix
      http: {
        method: 'GET',
        path: '/dev/api/events/health',
      }
    }
  };

  const healthResult = await handler(healthEvent, {});
  console.log('Health Status Code:', healthResult.statusCode); // should be 200
  console.log('Health Body:', healthResult.body);
}

testLambda().catch(console.error);
