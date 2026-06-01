// Lambda handler wrapper for Student Service
const serverless = require('serverless-http');
const app = require('./src/app');

// Export the handler with basePath configuration
exports.handler = serverless(app, {
  basePath: '/student'
});
