// Lambda handler wrapper for Event Service
const express = require('express');
const serverless = require('serverless-http');

// AWS SDK v3 imports added from feature branch
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

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
