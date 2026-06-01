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
