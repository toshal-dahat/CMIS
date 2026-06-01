import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";


const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
    };

    try {
        // Fetch theme and all tiers in parallel
        const [themeResponse, tiersResponse] = await Promise.all([
            docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: "CONFIG#THEME", SK: "METADATA" }
            })),
            docClient.send(new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: "begins_with(PK, :prefix)",
                ExpressionAttributeValues: { ":prefix": "TIER#" }
            }))
        ]);

        const body = {
            theme: themeResponse.Item || {},
            tiers: tiersResponse.Items?.sort((a, b) => a.rank - b.rank) || [],
            timestamp: new Date().toISOString()
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(body)
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Failed to fetch configuration", details: error.message })
        };
    }
};
