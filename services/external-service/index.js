// Legacy Node wrapper for External Service (Serverless Framework / API Gateway HTTP integration).
// Production traffic for auth, graduation, and mentorship is handled by `handler.py` (Python).
// This Express app remains useful for smoke tests, legacy routes mounted at basePath `/external`, and local tooling.
const express = require('express');
const serverless = require('serverless-http');

const app = express();
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'External Service API',
    service: 'external-service',
    version: '1.0.0',
    endpoints: ['/health']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'external-service',
    timestamp: new Date().toISOString()
  });
});

// Export the handler with basePath configuration
exports.handler = serverless(app, {
  basePath: '/external'
});
