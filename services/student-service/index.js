/**
 * Purpose: Lambda entrypoint for API Gateway -> Express execution.
 * Logic: Wrap Express app with serverless-http and apply the shared student base path.
 * Edge cases: Requests missing the /student prefix will not map to expected Express routes.
 */
const serverless = require('serverless-http');
const app = require('./src/app');

// Purpose: Export Lambda-compatible handler function consumed by Terraform-managed routes.
// Logic: basePath aligns route translation with API Gateway route keys under /student.
// Edge cases: If API Gateway route keys change, basePath must stay synchronized.
exports.handler = serverless(app, {
  basePath: '/student'
});
