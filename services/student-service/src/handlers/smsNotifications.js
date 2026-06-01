const smsService = require("../services/smsNotificationService");
const { requireAuth } = require("../lib/jwt");

function readAttr(attr) {
  if (!attr || typeof attr !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(attr, "S")) return attr.S;
  if (Object.prototype.hasOwnProperty.call(attr, "N")) return Number(attr.N);
  if (Object.prototype.hasOwnProperty.call(attr, "BOOL")) return attr.BOOL;
  return undefined;
}

function safeRow(image) {
  if (!image || typeof image !== "object") return null;
  return {
    eventId: readAttr(image.eventId),
    userId: readAttr(image.userId),
    status: readAttr(image.status),
    date: readAttr(image.date),
  }
}

async function onRsvpStream(event) {
  for (const record of event.Records || []) {
    const newRow = safeRow(record.dynamodb?.NewImage);
    const oldRow = safeRow(record.dynamodb?.OldImage);
    const eventId = newRow?.eventId || oldRow?.eventId;
    if (!eventId) continue;
    const eventItem = await smsService.getEvent(eventId);
    if (!eventItem?.date) {
      await smsService.deleteReminder(eventId);
      continue;
    }
    await smsService.rescheduleForEvent(eventId, eventItem.date);
  }
  return { statusCode: 200, body: "ok" };
}

async function onEventsStream(event) {
  for (const record of event.Records || []) {
    if (record.eventName !== "MODIFY") continue;
    const newRow = safeRow(record.dynamodb?.NewImage);
    const oldRow = safeRow(record.dynamodb?.OldImage);
    if (!newRow?.eventId || !newRow?.date) continue;
    if (String(newRow.date) === String(oldRow?.date || "")) continue;
    await smsService.rescheduleForEvent(newRow.eventId, newRow.date);
  }
  return { statusCode: 200, body: "ok" };
}

async function sendScheduledReminder(event) {
  if (event?.action !== "SEND_EVENT_SMS_REMINDER") {
    return { statusCode: 400, body: "unsupported action" };
  }
  await smsService.sendReminderNow(event.eventId);
  return { statusCode: 200, body: "sent" };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
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
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: "",
  };
}

function isAdmin(claims) {
  const groups = claims?.["cognito:groups"] || [];
  return Array.isArray(groups) && groups.some((g) => /^admins?$/i.test(String(g || "")));
}

function parseEventIdFromPath(path = "") {
  const m = path.match(/\/student\/api\/events\/([^/]+)\/sms-reminder\/trigger$/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function triggerReminderApi(event) {
  try {
    if (event?.httpMethod === "OPTIONS") return preflightResponse();
    const { claims } = await requireAuth(event);
    if (!isAdmin(claims)) {
      return jsonResponse(403, { error: "FORBIDDEN", message: "Admin access required." });
    }
    let body = {};
    try {
      body = JSON.parse(event?.body || "{}");
    } catch (_) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "Invalid JSON body." });
    }
    const eventIdFromPath = event?.pathParameters?.eventId || parseEventIdFromPath(event?.path || event?.rawPath || "");
    const eventId = String(eventIdFromPath || body.eventId || "").trim();
    if (!eventId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "eventId is required." });
    }
    const result = await smsService.sendReminderNow(eventId);
    return jsonResponse(200, {
      status: "TRIGGERED",
      eventId,
      result,
    });
  } catch (err) {
    return jsonResponse(err?.statusCode || 500, {
      error: err?.code || "INTERNAL_ERROR",
      message: err?.message || "Internal server error",
    });
  }
}

module.exports = {
  onRsvpStream,
  onEventsStream,
  sendScheduledReminder,
  triggerReminderApi,
};
