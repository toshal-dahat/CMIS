// Lambda handler wrapper for Event Service
const express = require('express');
const serverless = require('serverless-http');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const { requireAuth, requireAdmin } = require('./src/lib/jwt');
const eventService = require('./src/services/eventService');
const rsvpService = require('./src/services/rsvpService');
const reminderService = require('./src/services/reminderService');
const calendarService = require('./src/services/calendarService');
const surveyService = require('./src/services/surveyService');
const analyticsService = require('./src/services/analyticsService');

const app = express();
app.use(express.json());

function getReminderTargetLambdaArn(context) {
  if (process.env.REMINDER_TARGET_LAMBDA_ARN) return process.env.REMINDER_TARGET_LAMBDA_ARN;
  if (context?.invokedFunctionArn) return context.invokedFunctionArn;
  const region = process.env.AWS_REGION || 'us-east-1';
  const accountId = process.env.AWS_ACCOUNT_ID;
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!accountId || !functionName) return null;
  return `arn:aws:lambda:${region}:${accountId}:function:${functionName}`;
}

async function sendReminderEmails(eventId) {
  const event = await eventService.getEvent(eventId);
  if (!event) return { eventId, sent: 0, totalCandidates: 0, optedIn: 0 };

  const allRsvps = await rsvpService.getEventRsvps(eventId);
  const confirmedRsvps = allRsvps.filter((row) => row.status === 'CONFIRMED' && row.userEmail);
  if (confirmedRsvps.length === 0) return { eventId, sent: 0, totalCandidates: 0, optedIn: 0 };

  const userPreferenceMap = await reminderService.getReminderEligibleProfiles(
    confirmedRsvps.map((row) => row.userId)
  );

  const recipients = confirmedRsvps.filter((row) => userPreferenceMap.get(row.userId) === true);
  const sender = process.env.SES_VERIFIED_SENDER;
  let sent = 0;

  for (const recipient of recipients) {
    if (!sender) {
      console.log(`[event reminder] SES_VERIFIED_SENDER missing; would send to ${recipient.userEmail}`);
      sent++;
      continue;
    }

    const eventTime = new Date(event.date).toLocaleString('en-US', { timeZone: 'UTC', hour12: true });
    const htmlBody = `
      <p>Hi,</p>
      <p>This is a reminder that <strong>${event.title}</strong> starts in about 1 hour.</p>
      <p><strong>When:</strong> ${eventTime} UTC</p>
      <p><strong>Where:</strong> ${event.location || 'TBA'}</p>
      <p>We look forward to seeing you there.</p>
    `;

    try {
      await sesClient.send(new SendEmailCommand({
        Source: sender,
        Destination: { ToAddresses: [recipient.userEmail] },
        Message: {
          Subject: { Data: `Reminder: ${event.title} starts in 1 hour` },
          Body: { Html: { Data: htmlBody } },
        },
      }));
      sent++;
    } catch (err) {
      console.error(`[event reminder] Failed to send to ${recipient.userEmail}:`, err.message);
    }
  }

  return {
    eventId,
    sent,
    totalCandidates: confirmedRsvps.length,
    optedIn: recipients.length,
  };
}

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
    const lambdaArn = getReminderTargetLambdaArn();
    if (lambdaArn) {
      await reminderService.upsertReminderSchedule({
        eventId: newEvent.eventId,
        eventDateIso: newEvent.date,
        lambdaArn,
      });
    }
    res.status(201).json(newEvent);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Update event (admin required)
app.put('/api/events/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existingEvent = await eventService.getEvent(req.params.eventId);
    if (!existingEvent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    }
    const updated = await eventService.updateEvent(req.params.eventId, req.body);
    const lambdaArn = getReminderTargetLambdaArn();
    if (lambdaArn && updated.date) {
      await reminderService.upsertReminderSchedule({
        eventId: updated.eventId,
        eventDateIso: updated.date,
        lambdaArn,
      });
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
    await reminderService.deleteReminderSchedule(req.params.eventId);
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

// ── Surveys ────────────────────────────────────────────

// Get survey template for an event (admin)
app.get('/api/surveys/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const template = await surveyService.getTemplate(req.params.eventId);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Create/update survey template for an event (admin)
app.put('/api/surveys/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'questions must be a non-empty array' });
    }
    const template = await surveyService.upsertTemplate(req.params.eventId, questions, req.user.userId);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Get survey form data (public — accessed via emailed link)
app.get('/api/surveys/:eventId/respond', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'userId is required' });
    const [event, template] = await Promise.all([
      eventService.getEvent(req.params.eventId),
      surveyService.getTemplate(req.params.eventId),
    ]);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });
    res.json({ event: { eventId: event.eventId, title: event.title, date: event.date }, template });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Submit survey response (public — userId from request body)
app.post('/api/surveys/:eventId/respond', async (req, res) => {
  try {
    const { userId, userEmail, responses } = req.body;
    if (!userId) return res.status(400).json({ error: 'BAD_REQUEST', message: 'userId is required' });
    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'responses object is required' });
    }
    const result = await surveyService.submitResponse(req.params.eventId, userId, userEmail, responses);
    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 409 ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// ── Analytics ──────────────────────────────────────────

// Event success analytics — RSVP vs check-in vs survey rating by category (admin)
app.get('/api/analytics/event-success', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await analyticsService.getEventSuccessAnalytics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Send survey emails to all checked-in attendees for an event (admin)
app.post('/api/events/:eventId/send-survey', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await eventService.getEvent(eventId);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });

    const rsvps = await rsvpService.getEventRsvps(eventId);
    const attendees = rsvps.filter(r => r.checkedIn === true && r.userEmail);

    const sender = process.env.SES_VERIFIED_SENDER;
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    let sent = 0;

    for (const attendee of attendees) {
      const surveyLink = `${frontendUrl}/?surveyEventId=${encodeURIComponent(eventId)}&surveyUserId=${encodeURIComponent(attendee.userId)}&surveyUserEmail=${encodeURIComponent(attendee.userEmail)}`;
      if (!sender) {
        console.log(`[survey email] SES_VERIFIED_SENDER not set — would send to ${attendee.userEmail}: ${surveyLink}`);
        sent++;
        continue;
      }
      try {
        await sesClient.send(new SendEmailCommand({
          Source: sender,
          Destination: { ToAddresses: [attendee.userEmail] },
          Message: {
            Subject: { Data: `How was ${event.title}? Share your feedback` },
            Body: {
              Html: {
                Data: `<p>Hi,</p><p>Thanks for attending <strong>${event.title}</strong>! We'd love to hear your thoughts.</p><p><a href="${surveyLink}" style="background:#500000;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;display:inline-block;">Rate this event (30 seconds)</a></p><p style="color:#666;font-size:12px">Or paste this link: ${surveyLink}</p>`,
              },
            },
          },
        }));
        sent++;
      } catch (emailErr) {
        console.error(`Failed to send survey email to ${attendee.userEmail}:`, emailErr.message);
      }
    }

    res.json({ eventId, sent, total: attendees.length });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
  }
});

// Test-only override: trigger reminder email flow immediately (admin)
app.post('/api/events/:eventId/send-reminder-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await eventService.getEvent(eventId);
    if (!event) return res.status(404).json({ error: 'NOT_FOUND', message: 'Event not found' });

    const result = await sendReminderEmails(eventId);
    res.json({ ...result, triggeredBy: 'manual-test-endpoint' });
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
  if (event?.action === 'SEND_EVENT_REMINDER' && event?.eventId) {
    const result = await sendReminderEmails(event.eventId);
    return { statusCode: 200, body: JSON.stringify(result) };
  }

  // 1. Intercept DynamoDB Stream Events (Background execution)
  if (event.Records && event.Records[0].eventSource === 'aws:dynamodb') {
    for (const record of event.Records) {
      // We only want to send an email when an RSVP is INSERTED, not deleted
      if (record.eventName === 'INSERT') {
        const newImage = record.dynamodb.NewImage;
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
      }
    }
    return { statusCode: 200, body: 'Stream processed' };
  }

  // 2. Otherwise, route standard API requests to Express
  return expressHandler(event, context);
};

// Export Express app for local testing
exports.app = app;


