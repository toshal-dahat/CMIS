// Lambda handler wrapper for Event Service
const express = require('express');
const serverless = require('serverless-http');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const { requireAuth, requireAdmin } = require('./src/lib/jwt');
const eventService = require('./src/services/eventService');
const rsvpService = require('./src/services/rsvpService');
const calendarService = require('./src/services/calendarService');
const smsReminderService = require('./src/services/smsReminderService');

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
    const newEvent = await eventService.createEvent(req.body, req.user.userId);
    res.status(201).json(newEvent);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Update event (admin required)
app.put('/api/events/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Read existing event first so we can detect date changes and reschedule reminders.
    const existing = await eventService.getEvent(req.params.eventId);
    const updated = await eventService.updateEvent(req.params.eventId, req.body);
    // Only reschedule when event date actually changes.
    if (existing?.date && updated?.date && existing.date !== updated.date) {
      await smsReminderService.handleEventDateUpdated(req.params.eventId, existing.date, updated.date);
    }
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
    const emailToSave = req.user.claims?.email || req.user.claims?.username || req.user.claims?.['cognito:username'] || '';
    if (!emailToSave) console.warn("WARNING: Cognito did not provide an email in the JWT claims payload!");

    const userGroups = req.user.claims?.['cognito:groups'] || [];

    const result = await rsvpService.rsvpToEvent(
      req.params.eventId,
      req.user.userId,
      emailToSave,
      userGroups
    );
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    const errorCode = status === 409 ? 'CONFLICT'
      : status === 403 ? 'FORBIDDEN'
      : status === 503 ? 'SERVICE_UNAVAILABLE'
      : 'BAD_REQUEST';
    res.status(status).json({ error: errorCode, message: err.message });
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

// Get waitlist position for the current user
app.get('/api/events/:eventId/waitlist/position', requireAuth, async (req, res) => {
  try {
    const result = await rsvpService.getWaitlistPosition(req.params.eventId, req.user.userId);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR', message: err.message });
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

// ── Calendar ───────────────────────────────────────────

// Single event .ics download (no auth — events are public)
app.get('/api/events/:eventId/ical', async (req, res) => {
  try {
    const ics = await calendarService.getEventCalendar(req.params.eventId);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="event-${req.params.eventId}.ics"`);
    res.send(ics);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Full user schedule .ics download (userId in path — no token required)
app.get('/api/users/:userId/ical', async (req, res) => {
  try {
    const ics = await calendarService.getUserSchedule(req.params.userId);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="my-schedule.ics"');
    res.send(ics);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Wrap the Express app
const expressHandler = serverless(app, {
  request: (request, event, context) => {
    const stage = event.requestContext?.stage;
    if (stage && request.url.startsWith(`/${stage}/`)) {
      request.url = request.url.replace(`/${stage}`, '');
    }
  }
});

// Main Lambda Entrypoint
exports.handler = async (event, context) => {
  // 0. Scheduled SMS reminders from EventBridge Scheduler.
  if (event?.source === 'cmis.sms.reminder') {
    try {
      const outcome = await smsReminderService.processScheduledReminder(event);
      return { statusCode: 200, body: JSON.stringify(outcome) };
    } catch (err) {
      console.error("SMS reminder execution failed:", err);
      return { statusCode: 500, body: JSON.stringify({ error: 'SMS_SEND_FAILED' }) };
    }
  }

  // 1. Intercept DynamoDB Stream Events (Background execution)
  if (event.Records && event.Records[0].eventSource === 'aws:dynamodb') {
    for (const record of event.Records) {
      // We only want to send an email when an RSVP is INSERTED, not deleted
      if (record.eventName === 'INSERT') {
        const newImage = record.dynamodb.NewImage;
        // Schedule SMS reminder for confirmed RSVP if user is opted in.
        await smsReminderService.handleRsvpInsert(newImage);
        // Only send confirmation emails for confirmed RSVPs, not waitlist entries
        if (newImage.status?.S === 'WAITLISTED') continue;

        const userEmail = newImage.userEmail?.S;
        const eventId = newImage.eventId?.S;

        if (userEmail) {
          console.log(`Sending RSVP confirmation to ${userEmail} for event ${eventId}`);
          try {
            await sesClient.send(new SendEmailCommand({
              Source: "abhishekp1703@gmail.com", // ⚠️ MUST CHANGE THIS (See note below!)
              Destination: { ToAddresses: [userEmail] },
              Message: {
                Subject: { Data: `RSVP Confirmed: Event ${eventId}` },
                Body: { Html: { Data: `<h1>You're in!</h1><p>Your RSVP for Event <b>${eventId}</b> is confirmed.</p>` } }
              }
            }));
          } catch (err) {
            console.error("SES Email Failed:", err);
          }
        }
      } else if (record.eventName === 'MODIFY') {
        const oldImage = record.dynamodb.OldImage;
        const newImage = record.dynamodb.NewImage;
        // Keep SMS schedules in sync with status changes (waitlist promotion, etc).
        await smsReminderService.handleRsvpModify(oldImage, newImage);

        // Waitlist Promotion Email Trigger
        if (oldImage && oldImage.status?.S === 'WAITLISTED' && newImage.status?.S === 'CONFIRMED') {
          const userEmail = newImage.userEmail?.S;
          const eventId = newImage.eventId?.S;

          if (userEmail) {
            console.log(`Sending Waitlist Promotion email to ${userEmail} for event ${eventId}`);
            try {
              await sesClient.send(new SendEmailCommand({
                Source: "abhishekp1703@gmail.com",
                Destination: { ToAddresses: [userEmail] },
                Message: {
                  Subject: { Data: `You're off the waitlist! Event ${eventId}` },
                  Body: { Html: { Data: `<h1>Good news!</h1><p>A spot opened up and your RSVP for Event <b>${eventId}</b> has been upgraded from Waitlisted to Confirmed!</p>` } }
                }
              }));
            } catch (err) {
              console.error("SES Waitlist Promotion Email Failed:", err);
            }
          }
        }
      } else if (record.eventName === 'REMOVE') {
        const oldImage = record.dynamodb.OldImage;
        // RSVP deletion should cancel any pending SMS reminder.
        await smsReminderService.handleRsvpDelete(oldImage);
      }
    }
    return { statusCode: 200, body: 'Stream processed' };
  }

  // 2. Otherwise, route standard API requests to Express
  return expressHandler(event, context);
};

// Export Express app for local testing
exports.app = app;


