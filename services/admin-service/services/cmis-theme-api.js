import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayClient, FlushStageCacheCommand } from "@aws-sdk/client-api-gateway";


const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

// Initializing the API Gateway client to manage the cache
const apiG = new APIGatewayClient({});

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS"
};

export const handler = async (event) => {
    const method = event.httpMethod;
    const pk = "CONFIG#THEME";
    const sk = "METADATA";

    try {
        if (method === "GET") {
            const { Item } = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: pk, SK: sk }
            }));
            return { statusCode: 200, headers, body: JSON.stringify(Item || {}) };
        }

        if (method === "PUT") {
            const body = JSON.parse(event.body);
            const updatedItem = {
                PK: pk,
                SK: sk,
                ...body,
                updatedAt: new Date().toISOString()
            };

            // 1. Update the database record
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedItem }));

            // 2. The Production Solution: Programmatically flush the cache
            // We use the requestContext to dynamically get the API ID and Stage Name
            try {
                await apiG.send(new FlushStageCacheCommand({
                    restApiId: event.requestContext.apiId,
                    stageName: event.requestContext.stage
                }));
                console.log("Config cache invalidated successfully.");
            } catch (cacheError) {
                // If the cache flush fails (e.g., due to permissions),
                // we log it but still return a success code because the DB updated.
                console.error("Cache flush failed, but DB was updated:", cacheError);
            }

            return { statusCode: 200, headers, body: JSON.stringify(updatedItem) };
        }
    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};