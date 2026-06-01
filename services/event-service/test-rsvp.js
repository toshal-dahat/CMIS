const rsvpService = require("./src/services/rsvpService");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

process.env.EVENTS_TABLE = "Events-local";
process.env.RSVP_TABLE = "EventRsvps-local";
process.env.DOMAIN_API_URL = "http://localhost:3005/mock/domain";
process.env.CONFIG_API_URL = "http://localhost:3005/mock/config";

const client = new DynamoDBClient({
  endpoint: "http://localhost:8000",
  region: "local",
  credentials: { accessKeyId: "mock", secretAccessKey: "mock" }
});
const docClient = DynamoDBDocumentClient.from(client);

async function run() {
    console.log("Mocking event...");
    const eventId = "test-event-555";
    await docClient.send(new PutCommand({
        TableName: "Events-local",
        Item: {
            eventId,
            title: "Test Event",
            date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
            capacity: 10,
            createdBy: "admin1",
            currentRsvps: 0,
            version: 1,
        }
    }));

    try {
        await rsvpService.rsvpToEvent(eventId, "fake-user", "test@yahoo.com", []);
        console.log("❌ BUG: RSVP SUCCEEDED");
    } catch (err) {
         console.log("✅ RESULT for test@yahoo.com: ", err.statusCode, err.message);
    }
}
run();
