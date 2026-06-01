// Lambda handler wrapper for Admin Service
const express = require('express');
const serverless = require('serverless-http');

const app = express();

app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Hello',
    service: 'admin-service',
    version: '1.0.0',
    endpoints: ['/health', '/api/message']
  });
});

// API endpoint that returns Hello
app.get('/api/message', (req, res) => {
  res.json({ 
    message: 'Hello',
    service: 'admin-service',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'admin-service',
    timestamp: new Date().toISOString()
  });
});

// Export the handler with basePath configuration
exports.handler = serverless(app, {
  basePath: '/admin'
});
