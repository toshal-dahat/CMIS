const crypto = require("crypto");
const { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } = require("@aws-sdk/client-scheduler");
const twilio = require("twilio");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const studentProfilesService = require("./studentProfilesService");

const scheduler = new SchedulerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";
const SMS_SCHEDULE_GROUP = process.env.SMS_SCHEDULE_GROUP || "default";
const SMS_SCHEDULER_TARGET_ARN = process.env.SMS_SCHEDULER_TARGET_ARN;
const SMS_SCHEDULER_ROLE_ARN = process.env.SMS_SCHEDULER_ROLE_ARN;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";
const EVENTS_API_BASE_URL = process.env.EVENTS_API_BASE_URL || "";
const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

function scheduleName(eventId) {
  const hash = crypto.createHash("sha1").update(String(eventId)).digest("hex").slice(0, 32);
  return `sms-reminder-${hash}`;
}

function reminderTimeIso(eventDate) {
  const eventMs = new Date(eventDate).getTime();
  if (!Number.isFinite(eventMs)) return null;
  return new Date(eventMs - 60 * 60 * 1000).toISOString();
}

async function getEvent(eventId) {
  if (EVENTS_API_BASE_URL) {
    try {
      const res = await fetch(`${EVENTS_API_BASE_URL.replace(/\/$/, "")}/api/events/${encodeURIComponent(eventId)}`);
      if (res.ok) return await res.json();
    } catch (_) {
      // Fallback to DynamoDB read below.
    }
  }
  const out = await ddb.send(
    new GetCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId },
    })
  );
  return out.Item || null;
}

async function listConfirmedRsvpUserIds(eventId) {
  const rows = await ddb.send(
    new QueryCommand({
      TableName: RSVP_TABLE,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: { ":eventId": eventId },
      ProjectionExpression: "userId, #status",
      ExpressionAttributeNames: { "#status": "status" },
    })
  );
  return (rows.Items || [])
    .filter((r) => String(r.status || "").toUpperCase() === "CONFIRMED")
    .map((r) => r.userId)
    .filter(Boolean);
}

async function createOrUpdateReminder({ eventId, eventDate }) {
  if (!SMS_SCHEDULER_TARGET_ARN || !SMS_SCHEDULER_ROLE_ARN) {
    console.warn("[sms] Missing scheduler env; skipping schedule create/update.");
    return;
  }
  const reminderIso = reminderTimeIso(eventDate);
  if (!reminderIso) return;
  if (new Date(reminderIso).getTime() <= Date.now()) {
    await deleteReminder(eventId);
    return;
  }

  const name = scheduleName(eventId);
  await deleteReminder(eventId);
  await scheduler.send(
    new CreateScheduleCommand({
      Name: name,
      GroupName: SMS_SCHEDULE_GROUP,
      ScheduleExpression: `at(${reminderIso.replace(".000Z", "Z")})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: SMS_SCHEDULER_TARGET_ARN,
        RoleArn: SMS_SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          action: "SEND_EVENT_SMS_REMINDER",
          eventId,
        }),
      },
      ActionAfterCompletion: "DELETE",
      Description: "Event SMS reminder 1 hour before event.",
    })
  );
}

async function deleteReminder(eventId) {
  const name = scheduleName(eventId);
  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: name,
        GroupName: SMS_SCHEDULE_GROUP,
      })
    );
  } catch (err) {
    if (err?.name !== "ResourceNotFoundException") throw err;
  }
}

async function rescheduleForEvent(eventId, eventDate) {
  const confirmedUserIds = await listConfirmedRsvpUserIds(eventId);
  if (confirmedUserIds.length === 0) {
    await deleteReminder(eventId);
    return;
  }
  let effectiveEventDate = eventDate;
  if (!effectiveEventDate) {
    const event = await getEvent(eventId);
    effectiveEventDate = event?.date;
  }
  if (!effectiveEventDate) {
    await deleteReminder(eventId);
    return;
  }
  await createOrUpdateReminder({ eventId, eventDate: effectiveEventDate });
}

async function sendReminderNow(eventId) {
  if (!twilioClient || !TWILIO_FROM_NUMBER) {
    throw new Error("Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.");
  }
  const event = await getEvent(eventId);
  if (!event) return { sent: 0, skipped: 0, reason: "EVENT_NOT_FOUND" };

  const confirmedUserIds = await listConfirmedRsvpUserIds(eventId);
  let sent = 0;
  let skipped = 0;
  const msg = `Reminder: ${event.title || "Your event"} starts in about 1 hour. See you there!`;
  for (const userId of confirmedUserIds) {
    const profile = await studentProfilesService.getByUserId(userId);
    if (!profile || profile.smsOptIn !== true || !profile.phoneNumber) {
      skipped++;
      continue;
    }
    await twilioClient.messages.create({
      body: msg,
      from: TWILIO_FROM_NUMBER,
      to: profile.phoneNumber,
    });
    sent++;
  }
  return { sent, skipped };
}

module.exports = {
  getEvent,
  createOrUpdateReminder,
  deleteReminder,
  rescheduleForEvent,
  sendReminderNow,
};
