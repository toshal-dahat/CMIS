const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

const TABLE_NAME = process.env.EVENTS_TABLE || "Events-dev";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const REQUIRED_FIELDS = ["title", "date", "category", "capacity"];

class EventService {
    /**
     * Validate that an event payload includes all required fields.
     */
    _validate(data) {
        const missing = REQUIRED_FIELDS.filter((f) => !data[f] && data[f] !== 0);
        if (missing.length > 0) {
            const err = new Error(`Missing required fields: ${missing.join(", ")}`);
            err.statusCode = 400;
            throw err;
        }
        if (typeof data.capacity !== "number" || data.capacity < 1) {
            const err = new Error("capacity must be a positive integer");
            err.statusCode = 400;
            throw err;
        }
    }

    /** List all events */
    async listEvents() {
        const data = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
        return data.Items || [];
    }

    /** Get a single event by eventId */
    async getEvent(eventId) {
        const data = await docClient.send(
            new GetCommand({ TableName: TABLE_NAME, Key: { eventId } })
        );
        return data.Item || null;
    }

    /** Create a new event */
    async createEvent(eventData) {
        this._validate(eventData);

        const eventId = uuidv4();
        const now = new Date().toISOString();

        const item = {
            eventId,
            title: eventData.title,
            date: eventData.date,
            category: eventData.category,
            capacity: Number(eventData.capacity),
            description: eventData.description || "",
            location: eventData.location || "",
            currentRsvps: 0,
            version: 1,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return item;
    }

    /** Update an existing event (with optimistic locking) */
    async updateEvent(eventId, updateData) {
        // Never allow overwriting these directly
        delete updateData.eventId;
        delete updateData.currentRsvps;
        delete updateData.createdAt;

        const now = new Date().toISOString();
        const keys = Object.keys(updateData).filter((k) => k !== "version");

        if (keys.length === 0) {
            return this.getEvent(eventId);
        }

        const updateExpressions = [];
        const exprNames = {};
        const exprValues = { ":updatedAt": now, ":versionInc": 1 };

        keys.forEach((key) => {
            updateExpressions.push(`#${key} = :${key}`);
            exprNames[`#${key}`] = key;
            exprValues[`:${key}`] = updateData[key];
        });

        updateExpressions.push("#updatedAt = :updatedAt");
        exprNames["#updatedAt"] = "updatedAt";

        // Optimistic locking: bump version
        updateExpressions.push("#version = #version + :versionInc");
        exprNames["#version"] = "version";

        const params = {
            TableName: TABLE_NAME,
            Key: { eventId },
            UpdateExpression: "SET " + updateExpressions.join(", "),
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
            ReturnValues: "ALL_NEW",
        };

        // If the caller provides a version, enforce it
        if (updateData.version !== undefined) {
            params.ConditionExpression = "#version = :expectedVersion";
            exprValues[":expectedVersion"] = updateData.version;
        }

        try {
            const data = await docClient.send(new UpdateCommand(params));
            return data.Attributes;
        } catch (error) {
            if (error.name === "ConditionalCheckFailedException") {
                const e = new Error("Event was modified by another user. Refresh and try again.");
                e.statusCode = 409;
                throw e;
            }
            throw error;
        }
    }

    /** Delete an event */
    async deleteEvent(eventId) {
        await docClient.send(
            new DeleteCommand({ TableName: TABLE_NAME, Key: { eventId } })
        );
        return { eventId, deleted: true };
    }
}

module.exports = new EventService();
