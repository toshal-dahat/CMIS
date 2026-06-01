const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const TEMPLATES_TABLE = process.env.SURVEY_TEMPLATES_TABLE || "SurveyTemplates-dev";
const RESPONSES_TABLE = process.env.SURVEY_RESPONSES_TABLE || "SurveyResponses-dev";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const DEFAULT_QUESTIONS = [
    { id: "overall", text: "Overall Event Rating", type: "rating", min: 1, max: 5 },
];

class SurveyService {
    async getTemplate(eventId) {
        const res = await docClient.send(
            new GetCommand({ TableName: TEMPLATES_TABLE, Key: { eventId } })
        );
        if (res.Item) return res.Item;
        return { eventId, questions: DEFAULT_QUESTIONS, isDefault: true };
    }

    async upsertTemplate(eventId, questions, createdBy) {
        const now = new Date().toISOString();
        const existing = await docClient.send(
            new GetCommand({ TableName: TEMPLATES_TABLE, Key: { eventId } })
        );
        const item = {
            eventId,
            questions,
            createdBy: createdBy || "",
            createdAt: existing.Item?.createdAt || now,
            updatedAt: now,
        };
        await docClient.send(new PutCommand({ TableName: TEMPLATES_TABLE, Item: item }));
        return item;
    }

    async submitResponse(eventId, userId, userEmail, responses) {
        const existing = await docClient.send(
            new GetCommand({ TableName: RESPONSES_TABLE, Key: { eventId, userId } })
        );
        if (existing.Item) {
            const e = new Error("You have already submitted a survey for this event.");
            e.statusCode = 409;
            throw e;
        }
        const item = {
            eventId,
            userId,
            userEmail: userEmail || "",
            responses,
            submittedAt: new Date().toISOString(),
        };
        await docClient.send(new PutCommand({ TableName: RESPONSES_TABLE, Item: item }));
        return item;
    }

    async getResponses(eventId) {
        const data = await docClient.send(
            new QueryCommand({
                TableName: RESPONSES_TABLE,
                KeyConditionExpression: "eventId = :eid",
                ExpressionAttributeValues: { ":eid": eventId },
            })
        );
        return data.Items || [];
    }
}

module.exports = new SurveyService();
