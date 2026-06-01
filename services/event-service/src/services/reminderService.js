const { EventBridgeClient, PutRuleCommand, PutTargetsCommand, RemoveTargetsCommand, DeleteRuleCommand } = require("@aws-sdk/client-eventbridge");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchGetCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const REMINDER_RULE_PREFIX = process.env.REMINDER_RULE_PREFIX || "events-core-reminder";
const STUDENT_PROFILES_TABLE = process.env.STUDENT_PROFILES_TABLE || "";

const eventBridgeClient = new EventBridgeClient({ region: REGION });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

function getReminderRuleName(eventId) {
  return `${REMINDER_RULE_PREFIX}-${eventId}`;
}

function toReminderTimeIso(eventDateIso) {
  const eventTimeMs = new Date(eventDateIso).getTime();
  if (!Number.isFinite(eventTimeMs)) return null;
  const reminderTimeMs = eventTimeMs - (60 * 60 * 1000);
  return new Date(reminderTimeMs).toISOString();
}

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

async function getReminderEligibleProfiles(userIds = []) {
  if (!STUDENT_PROFILES_TABLE || userIds.length === 0) return new Map();

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const resultMap = new Map();

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const response = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [STUDENT_PROFILES_TABLE]: {
          Keys: chunk.map((userId) => ({ userId })),
          ProjectionExpression: "userId, reminderOptIn",
        },
      },
    }));

    const rows = response.Responses?.[STUDENT_PROFILES_TABLE] || [];
    for (const row of rows) {
      resultMap.set(row.userId, row.reminderOptIn === true);
    }
  }

  return resultMap;
}

module.exports = {
  upsertReminderSchedule,
  deleteReminderSchedule,
  getReminderEligibleProfiles,
};

