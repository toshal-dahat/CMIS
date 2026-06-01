const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand, DeleteScheduleCommand } = require("@aws-sdk/client-scheduler");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { requireAuth } = require("../lib/jwt");

const EVENTS_API_BASE_URL = (process.env.EVENTS_API_BASE_URL || "").replace(/\/+$/, "");
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";
const STUDENT_PROFILES_TABLE = process.env.STUDENT_PROFILES_TABLE;
const SES_VERIFIED_SENDER = process.env.SES_VERIFIED_SENDER || "";
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const REMINDER_SCHEDULER_ROLE_ARN = process.env.REMINDER_SCHEDULER_ROLE_ARN || "";
const REMINDER_TARGET_LAMBDA_ARN = process.env.REMINDER_TARGET_LAMBDA_ARN || "";
const REMINDER_SCHEDULE_GROUP_NAME = process.env.REMINDER_SCHEDULE_GROUP_NAME || "default";

const schedulerClient = new SchedulerClient({});
const sesClient = new SESClient({});
const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

const ADMIN_GROUPS = ["admins", "admin", "Admin", "ADMIN", "SuperAdmin", "superadmin", "SUPERADMIN"];

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: "",
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}

function isAdmin(claims) {
  const groups = claims?.["cognito:groups"] || [];
  return groups.some((g) => ADMIN_GROUPS.includes(g));
}

function getAuthHeader(event) {
  return event.headers?.Authorization || event.headers?.authorization || "";
}

function scheduleNameForEvent(eventId) {
  const safe = String(eventId || "").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `student-event-reminder-${safe}`;
}

function toSchedulerAtExpression(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const isoNoMillis = d.toISOString().replace(/\.\d{3}Z$/, "");
  return `at(${isoNoMillis})`;
}

function computeReminderDate(eventDateIso) {
  const eventTs = new Date(eventDateIso).getTime();
  if (!Number.isFinite(eventTs)) return null;
  const reminderTs = eventTs - 60 * 60 * 1000;
  const nowTs = Date.now();
  // If event is too close (< 1h), schedule as near-immediate (1 minute from now).
  const effectiveTs = reminderTs <= nowTs + 30 * 1000 ? nowTs + 60 * 1000 : reminderTs;
  return new Date(effectiveTs);
}

async function callEventService(path, options = {}) {
  if (!EVENTS_API_BASE_URL) {
    throw new Error("EVENTS_API_BASE_URL is not configured");
  }
  const res = await fetch(`${EVENTS_API_BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    const e = new Error(message);
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

async function upsertEventReminderSchedule(eventId, eventDateIso) {
  if (!REMINDER_SCHEDULER_ROLE_ARN || !REMINDER_TARGET_LAMBDA_ARN) {
    throw new Error("Reminder scheduler target is not configured");
  }
  const reminderDate = computeReminderDate(eventDateIso);
  if (!reminderDate) {
    throw new Error("Invalid event date for reminder scheduling");
  }

  const name = scheduleNameForEvent(eventId);
  const scheduleExpression = toSchedulerAtExpression(reminderDate);
  if (!scheduleExpression) {
    throw new Error("Unable to build reminder schedule expression");
  }
  const payload = JSON.stringify({
    eventId,
    triggerType: "EVENT_ONE_HOUR_REMINDER",
    scheduledAt: reminderDate.toISOString(),
  });

  const baseInput = {
    Name: name,
    GroupName: REMINDER_SCHEDULE_GROUP_NAME,
    ScheduleExpression: scheduleExpression,
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: REMINDER_TARGET_LAMBDA_ARN,
      RoleArn: REMINDER_SCHEDULER_ROLE_ARN,
      Input: payload,
    },
    ActionAfterCompletion: "DELETE",
    State: "ENABLED",
  };

  try {
    await schedulerClient.send(new UpdateScheduleCommand(baseInput));
  } catch (err) {
    if (err?.name !== "ResourceNotFoundException") throw err;
    await schedulerClient.send(new CreateScheduleCommand(baseInput));
  }

  return {
    scheduleName: name,
    groupName: REMINDER_SCHEDULE_GROUP_NAME,
    scheduledAt: reminderDate.toISOString(),
  };
}

async function deleteEventReminderSchedule(eventId) {
  const name = scheduleNameForEvent(eventId);
  try {
    await schedulerClient.send(new DeleteScheduleCommand({
      Name: name,
      GroupName: REMINDER_SCHEDULE_GROUP_NAME,
    }));
  } catch (err) {
    if (err?.name !== "ResourceNotFoundException") throw err;
  }
  return { scheduleName: name, groupName: REMINDER_SCHEDULE_GROUP_NAME, deleted: true };
}

async function getConfirmedEventRsvps(eventId) {
  const data = await docClient.send(new QueryCommand({
    TableName: RSVP_TABLE,
    KeyConditionExpression: "eventId = :eid",
    ExpressionAttributeValues: { ":eid": eventId },
  }));
  return (data.Items || []).filter((r) => String(r.status || "").toUpperCase() === "CONFIRMED");
}

async function userReminderOptedIn(userId) {
  if (!STUDENT_PROFILES_TABLE) return true;
  const row = await docClient.send(new GetCommand({
    TableName: STUDENT_PROFILES_TABLE,
    Key: { userId },
    ProjectionExpression: "reminderOptIn",
  }));
  if (!row.Item) return true;
  return row.Item.reminderOptIn !== false;
}

function buildReminderEmailHtml(eventObj) {
  const title = eventObj?.title || "your event";
  const date = eventObj?.date ? new Date(eventObj.date).toLocaleString() : "soon";
  const location = eventObj?.location ? `<p><b>Location:</b> ${eventObj.location}</p>` : "";
  const eventUrl = FRONTEND_URL ? `${FRONTEND_URL}/?view=events` : "";
  const cta = eventUrl
    ? `<p><a href="${eventUrl}" style="background:#500000;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;display:inline-block;">View Event</a></p>`
    : "";
  return `<p>Hi,</p><p>This is your reminder that <b>${title}</b> starts in about 1 hour.</p><p><b>Time:</b> ${date}</p>${location}${cta}`;
}

async function sendReminderEmailsForEvent(eventId) {
  const eventObj = await callEventService(`/api/events/${encodeURIComponent(eventId)}`, { method: "GET" });
  if (!eventObj || String(eventObj.status || "").toUpperCase() === "CANCELED") {
    return { eventId, skipped: true, reason: "EVENT_CANCELED_OR_MISSING" };
  }

  const confirmed = await getConfirmedEventRsvps(eventId);
  let eligible = 0;
  let sent = 0;
  let skippedOptOut = 0;
  let skippedNoEmail = 0;

  for (const rsvp of confirmed) {
    const email = String(rsvp.userEmail || "").trim();
    if (!email || email === "NA" || email === "N/A") {
      skippedNoEmail++;
      continue;
    }
    const optedIn = await userReminderOptedIn(rsvp.userId);
    if (!optedIn) {
      skippedOptOut++;
      continue;
    }
    eligible++;

    if (!SES_VERIFIED_SENDER) {
      console.log(`[reminder] SES sender not configured; would email ${email} for event ${eventId}`);
      continue;
    }

    try {
      await sesClient.send(new SendEmailCommand({
        Source: SES_VERIFIED_SENDER,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: `Reminder: ${eventObj.title || "Event"} starts in 1 hour` },
          Body: {
            Html: { Data: buildReminderEmailHtml(eventObj) },
          },
        },
      }));
      sent++;
    } catch (err) {
      console.error(`[reminder] failed to send to ${email}:`, err?.message || err);
    }
  }

  return { eventId, eligible, sent, skippedOptOut, skippedNoEmail, totalConfirmed: confirmed.length };
}

async function eventCrudProxy(event) {
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const { claims } = await requireAuth(event);
    if (!isAdmin(claims)) {
      return jsonResponse(403, { error: "FORBIDDEN", message: "Admin access required." });
    }
    const authHeader = getAuthHeader(event);
    const method = event.httpMethod;
    const body = parseBody(event);
    if ((method === "POST" || method === "PUT") && body == null) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "Invalid JSON body." });
    }

    const path = event.path || "";
    const match = path.match(/\/student\/api\/events\/([^/]+)$/);
    const eventId = match ? decodeURIComponent(match[1]) : null;
    const triggerMatch = path.match(/\/student\/api\/events\/([^/]+)\/trigger-reminder$/);
    const triggerEventId = triggerMatch ? decodeURIComponent(triggerMatch[1]) : null;

    // Manual override endpoint for testing email delivery path only.
    // This does NOT change the EventBridge schedule flow.
    if (method === "POST" && triggerEventId) {
      const result = await sendReminderEmailsForEvent(triggerEventId);
      return jsonResponse(200, {
        ok: true,
        manual: true,
        message: "Reminder dispatch triggered manually.",
        ...result,
      });
    }

    if (method === "POST" && /\/student\/api\/events$/.test(path)) {
      const created = await callEventService("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(body || {}),
      });

      let reminder = null;
      if (String(created.status || "").toUpperCase() !== "CANCELED" && created.eventId && created.date) {
        reminder = await upsertEventReminderSchedule(created.eventId, created.date);
      }

      return jsonResponse(201, { ...created, reminderSchedule: reminder });
    }

    if (method === "PUT" && eventId) {
      const updated = await callEventService(`/api/events/${encodeURIComponent(eventId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(body || {}),
      });

      let reminder = null;
      if (String(updated.status || "").toUpperCase() === "CANCELED") {
        reminder = await deleteEventReminderSchedule(eventId);
      } else if (updated.date) {
        reminder = await upsertEventReminderSchedule(eventId, updated.date);
      }

      return jsonResponse(200, { ...updated, reminderSchedule: reminder });
    }

    if (method === "DELETE" && eventId) {
      await callEventService(`/api/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });
      const reminder = await deleteEventReminderSchedule(eventId);
      return jsonResponse(200, { eventId, deleted: true, reminderSchedule: reminder });
    }

    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED", message: "Method not allowed" });
  } catch (err) {
    return jsonResponse(err.statusCode || 500, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    });
  }
}

async function reminderPreference(event) {
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const { userId } = await requireAuth(event);
    const method = event.httpMethod;

    if (method === "GET") {
      const row = await docClient.send(new GetCommand({
        TableName: STUDENT_PROFILES_TABLE,
        Key: { userId },
        ProjectionExpression: "userId, reminderOptIn",
      }));
      return jsonResponse(200, { reminderOptIn: row.Item?.reminderOptIn !== false });
    }

    if (method === "PUT") {
      const body = parseBody(event);
      if (body == null || typeof body.reminderOptIn !== "boolean") {
        return jsonResponse(400, {
          error: "BAD_REQUEST",
          message: "Body must include boolean field reminderOptIn.",
        });
      }
      let updated;
      try {
        updated = await docClient.send(new UpdateCommand({
          TableName: STUDENT_PROFILES_TABLE,
          Key: { userId },
          UpdateExpression: "SET reminderOptIn = :v, updatedAt = :u",
          ConditionExpression: "attribute_exists(userId)",
          ExpressionAttributeValues: {
            ":v": body.reminderOptIn,
            ":u": new Date().toISOString(),
          },
          ReturnValues: "ALL_NEW",
        }));
      } catch (e) {
        if (e?.name === "ConditionalCheckFailedException") {
          return jsonResponse(404, { error: "NOT_FOUND", message: "Profile not found" });
        }
        throw e;
      }
      return jsonResponse(200, {
        userId,
        reminderOptIn: updated?.Attributes?.reminderOptIn === true,
      });
    }

    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED", message: "Method not allowed" });
  } catch (err) {
    return jsonResponse(err.statusCode || 500, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    });
  }
}

async function runScheduledReminder(event) {
  try {
    const eventId = event?.eventId || event?.detail?.eventId;
    if (!eventId) {
      return { statusCode: 400, body: JSON.stringify({ error: "BAD_REQUEST", message: "eventId is required" }) };
    }
    const result = await sendReminderEmailsForEvent(String(eventId));
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error("[reminder] scheduled dispatch failed:", err?.message || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "INTERNAL_ERROR", message: err?.message || "Dispatch failed" }),
    };
  }
}

module.exports = {
  eventCrudProxy,
  reminderPreference,
  runScheduledReminder,
};
