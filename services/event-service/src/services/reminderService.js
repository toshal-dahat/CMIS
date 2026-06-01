/**
 * Purpose: Manage event reminder scheduling and recipient preference lookup.
 * Logic: Create/delete per-event EventBridge rules and read StudentProfiles reminder fields in batches.
 * Edge cases: Missing env vars, invalid dates, or deleted rules are handled gracefully to keep reminders resilient.
 */
const { EventBridgeClient, PutRuleCommand, PutTargetsCommand, RemoveTargetsCommand, DeleteRuleCommand } = require("@aws-sdk/client-eventbridge");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchGetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const REMINDER_RULE_PREFIX = process.env.REMINDER_RULE_PREFIX || "events-core-reminder";
const STUDENT_PROFILES_TABLE = process.env.STUDENT_PROFILES_TABLE || "";

const eventBridgeClient = new EventBridgeClient({ region: REGION });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Purpose: Generate deterministic EventBridge rule names per event.
// Logic: Prefix with configured reminder namespace so rules are grouped and discoverable.
// Edge cases: Event IDs with unexpected characters still pass through unchanged.
function getReminderRuleName(eventId) {
  return `${REMINDER_RULE_PREFIX}-${eventId}`;
}

// Purpose: Convert event start time into reminder fire time.
// Logic: Subtract exactly one hour from the event ISO timestamp.
// Edge cases: Invalid timestamps return null so callers can skip scheduling safely.
function toReminderTimeIso(eventDateIso) {
  const eventTimeMs = new Date(eventDateIso).getTime();
  if (!Number.isFinite(eventTimeMs)) return null;
  const reminderTimeMs = eventTimeMs - (60 * 60 * 1000);
  return new Date(reminderTimeMs).toISOString();
}

// Purpose: Convert ISO reminder time into EventBridge cron expression.
// Logic: Use UTC fields because EventBridge cron is interpreted in UTC.
// Edge cases: Invalid date input returns null and prevents broken rule creation.
function formatEventBridgeCron(dateIso) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return null;
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return `cron(${minute} ${hour} ${day} ${month} ? ${year})`;
}

// Purpose: Create or update the reminder schedule for an event.
// Logic: Compute one-hour-prior fire time, ensure it's still in the future, then upsert rule + target.
// Edge cases: Missing identifiers or past reminder windows no-op or clean up stale schedules.
async function upsertReminderSchedule({ eventId, eventDateIso, lambdaArn }) {
  if (!eventId || !eventDateIso || !lambdaArn) return;

  const reminderTimeIso = toReminderTimeIso(eventDateIso);
  if (!reminderTimeIso) return;

  // Skip scheduling for events already inside the 1-hour window.
  if (new Date(reminderTimeIso).getTime() <= Date.now()) {
    await deleteReminderSchedule(eventId);
    return;
  }

  const ruleName = getReminderRuleName(eventId);
  const scheduleExpression = formatEventBridgeCron(reminderTimeIso);
  if (!scheduleExpression) return;

  await eventBridgeClient.send(new PutRuleCommand({
    Name: ruleName,
    ScheduleExpression: scheduleExpression,
    State: "ENABLED",
    Description: `Send reminder one hour before event ${eventId}`,
  }));

  await eventBridgeClient.send(new PutTargetsCommand({
    Rule: ruleName,
    Targets: [
      {
        Id: "event-reminder-target",
        Arn: lambdaArn,
        Input: JSON.stringify({
          action: "SEND_EVENT_REMINDER",
          eventId,
        }),
      },
    ],
  }));
}

// Purpose: Remove reminder schedule artifacts for an event.
// Logic: Delete target first, then delete rule, matching EventBridge dependency order.
// Edge cases: ResourceNotFound is ignored so repeated cleanup calls stay idempotent.
async function deleteReminderSchedule(eventId) {
  if (!eventId) return;
  const ruleName = getReminderRuleName(eventId);
  try {
    await eventBridgeClient.send(new RemoveTargetsCommand({
      Rule: ruleName,
      Ids: ["event-reminder-target"],
      Force: true,
    }));
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  try {
    await eventBridgeClient.send(new DeleteRuleCommand({
      Name: ruleName,
      Force: true,
    }));
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }
}

// Purpose: Fetch reminder preference/contact fields for users from StudentProfiles.
// Logic: Deduplicate user IDs and batch BatchGet requests in chunks of 100 keys.
// Edge cases: Empty input or missing table config returns an empty map without throwing.
async function getReminderRecipientProfiles(userIds = []) {
  if (!STUDENT_PROFILES_TABLE || userIds.length === 0) return new Map();

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const resultMap = new Map();

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const response = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [STUDENT_PROFILES_TABLE]: {
          Keys: chunk.map((userId) => ({ userId })),
          ProjectionExpression: "userId, reminderOptIn, phoneNumber",
        },
      },
    }));

    const rows = response.Responses?.[STUDENT_PROFILES_TABLE] || [];
    for (const row of rows) {
      resultMap.set(row.userId, {
        reminderOptIn: row.reminderOptIn === true,
        phoneNumber: typeof row.phoneNumber === "string" && row.phoneNumber.trim() ? row.phoneNumber.trim() : null,
      });
    }
  }

  return resultMap;
}

// Purpose: Provide lightweight opt-in eligibility view for reminder sending flows.
// Logic: Reuse profile lookup and project only boolean reminder eligibility by userId.
// Edge cases: Users missing profile rows are omitted from the eligibility map.
async function getReminderEligibleProfiles(userIds = []) {
  const profiles = await getReminderRecipientProfiles(userIds);
  const eligibility = new Map();
  for (const [userId, profile] of profiles.entries()) {
    eligibility.set(userId, profile.reminderOptIn === true);
  }
  return eligibility;
}

module.exports = {
  upsertReminderSchedule,
  deleteReminderSchedule,
  getReminderRecipientProfiles,
  getReminderEligibleProfiles,
};

