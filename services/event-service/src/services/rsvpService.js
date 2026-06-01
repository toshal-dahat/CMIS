const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    TransactWriteCommand,
    QueryCommand,
    GetCommand,
    DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

class RsvpService {
    /**
     * RSVP a user to an event.
     * Uses DynamoDB TransactWriteItems for atomicity:
     *   1. Conditionally increment currentRsvps on the Events table (only if < capacity)
     *   2. Insert into RSVP table (only if user hasn't already RSVP'd)
     */
    async rsvpToEvent(eventId, userId, userEmail) {
        const now = new Date().toISOString();

        try {
            await docClient.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            // Atomically increment currentRsvps only if < capacity
                            Update: {
                                TableName: EVENTS_TABLE,
                                Key: { eventId },
                                UpdateExpression: "SET currentRsvps = currentRsvps + :one, #version = #version + :one",
                                ConditionExpression: "attribute_exists(eventId) AND currentRsvps < #cap",
                                ExpressionAttributeNames: { "#version": "version", "#cap": "capacity" },
                                ExpressionAttributeValues: { ":one": 1 },
                            },
                        },
                        {
                            // Insert RSVP record (fails if user already RSVP'd = duplicate prevention)
                            Put: {
                                TableName: RSVP_TABLE,
                                Item: {
                                    eventId,
                                    userId,
                                    userEmail: userEmail || "",
                                    rsvpAt: now,
                                },
                                ConditionExpression: "attribute_not_exists(eventId)",
                            },
                        },
                    ],
                })
            );

            return { eventId, userId, rsvpAt: now, status: "confirmed" };
        } catch (error) {
            if (error.name === "TransactionCanceledException") {
                const reasons = error.CancellationReasons || [];
                // reasons[0] = Events table condition, reasons[1] = RSVP table condition
                if (reasons[0] && reasons[0].Code === "ConditionalCheckFailed") {
                    const e = new Error("Event is full — no more spots available.");
                    e.statusCode = 400;
                    throw e;
                }
                if (reasons[1] && reasons[1].Code === "ConditionalCheckFailed") {
                    const e = new Error("You have already RSVP'd to this event.");
                    e.statusCode = 409;
                    throw e;
                }
            }
            throw error;
        }
    }

    /**
     * Cancel an RSVP. Decrements currentRsvps and removes RSVP record.
     */
    async cancelRsvp(eventId, userId) {
        // First check RSVP exists
        const existing = await docClient.send(
            new GetCommand({ TableName: RSVP_TABLE, Key: { eventId, userId } })
        );
        if (!existing.Item) {
            const e = new Error("No RSVP found for this event.");
            e.statusCode = 404;
            throw e;
        }

        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: EVENTS_TABLE,
                            Key: { eventId },
                            UpdateExpression: "SET currentRsvps = currentRsvps - :one",
                            ConditionExpression: "currentRsvps > :zero",
                            ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
                        },
                    },
                    {
                        Delete: {
                            TableName: RSVP_TABLE,
                            Key: { eventId, userId },
                        },
                    },
                ],
            })
        );

        return { eventId, userId, status: "cancelled" };
    }

    /** List all RSVPs for a given event */
    async getEventRsvps(eventId) {
        const data = await docClient.send(
            new QueryCommand({
                TableName: RSVP_TABLE,
                KeyConditionExpression: "eventId = :eid",
                ExpressionAttributeValues: { ":eid": eventId },
            })
        );
        return data.Items || [];
    }

    /** Get all RSVPs for a specific user (via GSI) */
    async getUserRsvps(userId) {
        const data = await docClient.send(
            new QueryCommand({
                TableName: RSVP_TABLE,
                IndexName: "userId-index",
                KeyConditionExpression: "userId = :uid",
                ExpressionAttributeValues: { ":uid": userId },
            })
        );
        return data.Items || [];
    }

    /** Check if a specific user has RSVP'd to a specific event */
    async hasUserRsvpd(eventId, userId) {
        const data = await docClient.send(
            new GetCommand({ TableName: RSVP_TABLE, Key: { eventId, userId } })
        );
        return !!data.Item;
    }
}

module.exports = new RsvpService();
