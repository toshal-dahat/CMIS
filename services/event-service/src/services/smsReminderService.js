const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
} = require("@aws-sdk/client-scheduler");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";
const STUDENT_PROFILES_TABLE = process.env.STUDENT_PROFILES_TABLE || "";
const SMS_SCHEDULER_ROLE_ARN = process.env.SMS_SCHEDULER_ROLE_ARN || "";
const SMS_SCHEDULE_GROUP = process.env.SMS_SCHEDULE_GROUP || "default";
const SMS_TARGET_LAMBDA_ARN = process.env.SMS_TARGET_LAMBDA_ARN || "";
const SMS_ENABLED = String(process.env.SMS_ENABLED || "true").toLowerCase() === "true";

const oneHourMs = 60 * 60 * 1000;
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const schedulerClient = new SchedulerClient({});
const snsClient = new SNSClient({});

function parseBooleanLike(value) {
  // Accepts both real booleans and stringified flags from legacy data.
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function normalizePhoneE164(rawPhone) {
  // Normalize and validate as E.164 before scheduling/sending.
  const trimmed = String(rawPhone || "").trim();
  if (!trimmed) return null;
  return /^\+[1-9]\d{6,14}$/.test(trimmed) ? trimmed : null;
}

function toScheduleName(eventId, userId, eventDateIso) {
  // Keep schedule names deterministic so updates are idempotent.
  const safeEvent = String(eventId || "").replace(/[^A-Za-z0-9_-]/g, "_");
  const safeUser = String(userId || "").replace(/[^A-Za-z0-9_-]/g, "_");
  const safeDate = String(eventDateIso || "").replace(/[^A-Za-z0-9]/g, "");
  return `cmis-sms-${safeEvent}-${safeUser}-${safeDate}`;
}

async function getEvent(eventId) {
  const result = await dynamo.send(
    new GetCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId },
    })
  );
  return result.Item || null;
}

async function getRsvp(eventId, userId) {
  const result = await dynamo.send(
    new GetCommand({
      TableName: RSVP_TABLE,
      Key: { eventId, userId },
    })
  );
  return result.Item || null;
}

async function listConfirmedRsvps(eventId) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: RSVP_TABLE,
      KeyConditionExpression: "eventId = :eventId",
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":eventId": eventId,
        ":status": "CONFIRMED",
      },
    })
  );
  return result.Items || [];
}

async function getProfileByUserId(userId) {
  if (!STUDENT_PROFILES_TABLE) return null;
  const result = await dynamo.send(
    new GetCommand({
      TableName: STUDENT_PROFILES_TABLE,
      Key: { userId },
    })
  );
  return result.Item || null;
}

async function deleteScheduleIfExists(scheduleName) {
  try {
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
        GroupName: SMS_SCHEDULE_GROUP,
      })
    );
  } catch (error) {
    // ResourceNotFound means there is nothing to clean up.
    if (error?.name !== "ResourceNotFoundException") throw error;
  }
}

async function createOneTimeSchedule({ scheduleName, sendAtIso, payload }) {
  if (!SMS_SCHEDULER_ROLE_ARN) {
    throw new Error("SMS_SCHEDULER_ROLE_ARN is not configured");
  }
  if (!SMS_TARGET_LAMBDA_ARN) {
    throw new Error("SMS_TARGET_LAMBDA_ARN is not configured");
  }

  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: scheduleName,
      GroupName: SMS_SCHEDULE_GROUP,
      ScheduleExpression: `at(${sendAtIso})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        // Invoke this same Lambda with a distinct payload type.
        Arn: SMS_TARGET_LAMBDA_ARN,
        RoleArn: SMS_SCHEDULER_ROLE_ARN,
        Input: JSON.stringify(payload),
      },
      ActionAfterCompletion: "DELETE",
    })
  );
}

async function scheduleOneHourReminder({ eventId, userId }) {
  if (!SMS_ENABLED) return;
  const event = await getEvent(eventId);
  if (!event?.date) return;

  const profile = await getProfileByUserId(userId);
  const smsOptIn = parseBooleanLike(profile?.smsOptIn);
  const phoneE164 = normalizePhoneE164(profile?.phoneE164);
  if (!smsOptIn || !phoneE164) return;

  const sendAtMs = new Date(event.date).getTime() - oneHourMs;
  if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) return;
  const sendAtIso = new Date(sendAtMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  const scheduleName = toScheduleName(eventId, userId, event.date);

  // Delete first so reschedule/update stays deterministic.
  await deleteScheduleIfExists(scheduleName);

  await createOneTimeSchedule({
    scheduleName,
    sendAtIso,
    payload: {
      source: "cmis.sms.reminder",
      eventId,
      userId,
      expectedEventDate: event.date,
    },
  });
}

async function cancelOneHourReminder({ eventId, userId, eventDate }) {
  if (!eventDate) return;
  const scheduleName = toScheduleName(eventId, userId, eventDate);
  await deleteScheduleIfExists(scheduleName);
}

async function handleRsvpInsert(newImage) {
  const eventId = newImage?.eventId?.S;
  const userId = newImage?.userId?.S;
  const status = newImage?.status?.S;
  if (!eventId || !userId) return;
  if (status !== "CONFIRMED") return;
  await scheduleOneHourReminder({ eventId, userId });
}

async function handleRsvpDelete(oldImage) {
  const eventId = oldImage?.eventId?.S;
  const userId = oldImage?.userId?.S;
  if (!eventId || !userId) return;
  const eventDate = (await getEvent(eventId))?.date || null;
  await cancelOneHourReminder({ eventId, userId, eventDate });
}

async function handleRsvpModify(oldImage, newImage) {
  const eventId = newImage?.eventId?.S || oldImage?.eventId?.S;
  const userId = newImage?.userId?.S || oldImage?.userId?.S;
  if (!eventId || !userId) return;

  const oldStatus = oldImage?.status?.S;
  const newStatus = newImage?.status?.S;
  if (oldStatus === "WAITLISTED" && newStatus === "CONFIRMED") {
    await scheduleOneHourReminder({ eventId, userId });
    return;
  }
  if (oldStatus === "CONFIRMED" && newStatus !== "CONFIRMED") {
    const eventDate = (await getEvent(eventId))?.date || null;
    await cancelOneHourReminder({ eventId, userId, eventDate });
  }
}

async function handleEventDateUpdated(eventId, previousDate, nextDate) {
  // Only confirmed RSVPs are eligible for one-hour reminders.
  const confirmed = await listConfirmedRsvps(eventId);
  for (const row of confirmed) {
    const userId = row.userId;
    if (!userId) continue;
    // Remove old schedule keyed by previous date, then create new one.
    await cancelOneHourReminder({ eventId, userId, eventDate: previousDate });
    await scheduleOneHourReminder({ eventId, userId });
  }
}

async function processScheduledReminder(payload) {
  if (!SMS_ENABLED) return { sent: false, reason: "sms_disabled" };
  const { eventId, userId, expectedEventDate } = payload || {};
  if (!eventId || !userId) return { sent: false, reason: "invalid_payload" };

  // Re-check RSVP at send time to enforce "only if RSVP'd".
  const rsvp = await getRsvp(eventId, userId);
  if (!rsvp || rsvp.status !== "CONFIRMED") {
    return { sent: false, reason: "not_confirmed" };
  }

  const event = await getEvent(eventId);
  if (!event?.date) return { sent: false, reason: "event_missing" };

  // Guard against stale schedule payloads after event-date edits.
  if (expectedEventDate && event.date !== expectedEventDate) {
    return { sent: false, reason: "stale_schedule" };
  }

  const profile = await getProfileByUserId(userId);
  const smsOptIn = parseBooleanLike(profile?.smsOptIn);
  const phoneE164 = normalizePhoneE164(profile?.phoneE164);
  if (!smsOptIn || !phoneE164) return { sent: false, reason: "opt_out_or_phone_missing" };

  const eventStart = new Date(event.date).toLocaleString("en-US", { timeZone: "UTC", hour12: true });
  const message = `Reminder: "${event.title || "Your event"}" starts in 1 hour (${eventStart} UTC).`;
  await snsClient.send(
    new PublishCommand({
      PhoneNumber: phoneE164,
      Message: message,
    })
  );
  return { sent: true };
}

async function cleanupUserSchedulesForEvent({ eventId, userId }) {
  // Best-effort fallback when the old event date isn't known by caller.
  if (!eventId || !userId) return;
  const prefix = `cmis-sms-${String(eventId).replace(/[^A-Za-z0-9_-]/g, "_")}-${String(userId).replace(/[^A-Za-z0-9_-]/g, "_")}-`;
  let nextToken;
  do {
    const page = await schedulerClient.send(
      new ListSchedulesCommand({
        GroupName: SMS_SCHEDULE_GROUP,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    for (const schedule of page.Schedules || []) {
      if (String(schedule.Name || "").startsWith(prefix)) {
        await deleteScheduleIfExists(schedule.Name);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);
}

module.exports = {
  handleRsvpInsert,
  handleRsvpModify,
  handleRsvpDelete,
  handleEventDateUpdated,
  processScheduledReminder,
  cleanupUserSchedulesForEvent,
};
