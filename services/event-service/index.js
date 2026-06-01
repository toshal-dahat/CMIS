// Lambda handler wrapper for Event Service
const express = require('express');
const serverless = require('serverless-http');

const app = express();
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Event Service API (Integrated)',
    service: 'event-service',
    version: '1.0.0',
    endpoints: ['/health']
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'event-service',
    timestamp: new Date().toISOString()
  });
});

// Export the handler with basePath configuration
exports.handler = serverless(app, {
  basePath: '/event'
});
