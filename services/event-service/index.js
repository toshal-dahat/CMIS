// Lambda handler wrapper for Event Service
const express = require('express');
const serverless = require('serverless-http');

const { requireAuth, requireAdmin } = require('./src/lib/jwt');
const eventService = require('./src/services/eventService');
const rsvpService = require('./src/services/rsvpService');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health ─────────────────────────────────────────────
app.get('/api/events/health', (req, res) => {
  res.json({ status: 'healthy', service: 'event-service', timestamp: new Date().toISOString() });
});

// ── Event CRUD ─────────────────────────────────────────

// List all events
app.get('/api/events', async (req, res) => {
  try {
    const events = await eventService.listEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get single event
app.get('/api/events/:eventId', async (req, res) => {
  try {
    const event = await eventService.getEvent(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Create event (admin required)
app.post('/api/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const newEvent = await eventService.createEvent(req.body);
    res.status(201).json(newEvent);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Update event (admin required)
app.put('/api/events/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await eventService.updateEvent(req.params.eventId, req.body);
    res.json(updated);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 409 ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Delete event (admin required)
app.delete('/api/events/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await eventService.deleteEvent(req.params.eventId);
    res.json({ eventId: req.params.eventId, deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ── RSVP ───────────────────────────────────────────────

// RSVP to an event
app.post('/api/events/:eventId/rsvp', requireAuth, async (req, res) => {
  try {
    const result = await rsvpService.rsvpToEvent(
      req.params.eventId,
      req.user.userId,
      req.user.claims?.email || ''
    );
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 409 ? 'CONFLICT' : 'BAD_REQUEST', message: err.message });
  }
});

// Cancel RSVP
app.delete('/api/events/:eventId/rsvp', requireAuth, async (req, res) => {
  try {
    const result = await rsvpService.cancelRsvp(req.params.eventId, req.user.userId);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: 'ERROR', message: err.message });
  }
});

// Get RSVPs for an event (admin required)
app.get('/api/events/:eventId/rsvp', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rsvps = await rsvpService.getEventRsvps(req.params.eventId);
    res.json(rsvps);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get current user's RSVPs
app.get('/api/events/user/rsvps', requireAuth, async (req, res) => {
  try {
    const rsvps = await rsvpService.getUserRsvps(req.user.userId);
    res.json(rsvps);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Export handler with stage prefix stripping
exports.handler = serverless(app, {
  request: (request, event, context) => {
    const stage = event.requestContext?.stage;
    if (stage && request.url.startsWith(`/${stage}/`)) {
      request.url = request.url.replace(`/${stage}`, '');
    }
  }
});

// Export Express app for local testing
exports.app = app;
