const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { buildICS } = require("../lib/icsBuilder");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

class CalendarService {
    async getEventCalendar(eventId) {
        const res = await docClient.send(
            new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
        );
        if (!res.Item) {
            const e = new Error("Event not found.");
            e.statusCode = 404;
            throw e;
        }
        return buildICS([res.Item]);
    }

    async getUserSchedule(userId) {
        const rsvpRes = await docClient.send(
            new QueryCommand({
                TableName: RSVP_TABLE,
                IndexName: "userId-index",
                KeyConditionExpression: "userId = :uid",
                ExpressionAttributeValues: { ":uid": userId },
            })
        );
        const rsvps = rsvpRes.Items || [];
        if (rsvps.length === 0) {
            return buildICS([]);
        }

        const eventResults = await Promise.all(
            rsvps.map((rsvp) =>
                docClient.send(
                    new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId: rsvp.eventId } })
                )
            )
        );

        const events = eventResults.map((r) => r.Item).filter(Boolean);
        return buildICS(events);
    }
}

module.exports = new CalendarService();
