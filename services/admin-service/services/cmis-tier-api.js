import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayClient, FlushStageCacheCommand } from "@aws-sdk/client-api-gateway";


const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

// Initializing the API Gateway client for cache invalidation
const apiG = new APIGatewayClient({});

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

// Helper function to flush the API Gateway cache
const flushConfigCache = async (event) => {
    try {
        await apiG.send(new FlushStageCacheCommand({
            restApiId: event.requestContext.apiId,
            stageName: event.requestContext.stage
        }));
        console.log("Config cache invalidated successfully.");
    } catch (cacheError) {
        console.error("Cache flush failed:", cacheError);
    }
};

export const handler = async (event) => {
    const method = event.httpMethod;
    const pathParams = event.pathParameters;

    try {
        // 1. GET ALL TIERS (Sorted by Rank)
        if (method === "GET" && !pathParams) {
            const { Items } = await docClient.send(new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: "begins_with(PK, :prefix)",
                ExpressionAttributeValues: { ":prefix": "TIER#" }
            }));

            const sortedTiers = Items.sort((a, b) => (a.rank || 0) - (b.rank || 0));
            return { statusCode: 200, headers, body: JSON.stringify(sortedTiers) };
        }

        // 2. POST (Create New Tier)
        if (method === "POST") {
            const body = JSON.parse(event.body);
            const newItem = {
                PK: `TIER#${body.tierId.toLowerCase()}`,
                SK: "METADATA",
                ...body,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: newItem }));

            // Invalidate cache after creation
            await flushConfigCache(event);

            return { statusCode: 201, headers, body: JSON.stringify(newItem) };
        }

        // 3. PUT (Update Existing Tier)
        if (method === "PUT" && pathParams?.tierId) {
            const tierId = pathParams.tierId.toLowerCase();
            const body = JSON.parse(event.body);

            const existing = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TIER#${tierId}`, SK: "METADATA" }
            }));

            if (!existing.Item) {
                return { statusCode: 404, headers, body: JSON.stringify({ message: "Tier not found" }) };
            }

            const updatedItem = {
                ...existing.Item,
                ...body,
                PK: `TIER#${tierId}`,
                SK: "METADATA",
                updatedAt: new Date().toISOString()
            };

            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedItem }));

            // Invalidate cache after update
            await flushConfigCache(event);

            return { statusCode: 200, headers, body: JSON.stringify(updatedItem) };
        }

        // 4. DELETE (With Safety Check)
        if (method === "DELETE" && pathParams?.tierId) {
            const tierId = pathParams.tierId;

            const companies = await docClient.send(new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: "tierId = :tid",
                ExpressionAttributeValues: { ":tid": tierId }
            }));

            if (companies.Items && companies.Items.length > 0) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({ message: "Cannot delete: Tier is assigned to active companies." })
                };
            }

            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TIER#${tierId}`, SK: "METADATA" }
            }));

            // Invalidate cache after deletion
            await flushConfigCache(event);

            return { statusCode: 200, headers, body: JSON.stringify({ message: "Tier deleted" }) };
        }

        return { statusCode: 400, headers, body: "Unsupported method or missing parameters" };
    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};