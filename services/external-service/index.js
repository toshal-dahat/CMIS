// Lambda handler wrapper for External Service
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
