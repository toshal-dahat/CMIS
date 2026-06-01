import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";


const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME;

const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

export const handler = async (event) => {
    const method = event.httpMethod;
    const path = event.resource;
    const pathParams = event.pathParameters;

    try {
        // 1. LOOKUP BY DOMAIN (For Team Gig 'Em)
        if (path.includes("domain")) {
            const domain = pathParams.domain;
            const result = await docClient.send(new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: "domain-index",
                KeyConditionExpression: "#d = :domain",
                ExpressionAttributeNames: { "#d": "domain" },
                ExpressionAttributeValues: { ":domain": domain }
            }));

            if (result.Items.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ message: "Not a partner" }) };
            return { statusCode: 200, headers, body: JSON.stringify(result.Items[0]) };
        }

        // 2. GET ALL COMPANIES (List view)
        if (method === "GET" && !pathParams) {
            const { Items } = await docClient.send(new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: "begins_with(PK, :prefix)",
                ExpressionAttributeValues: { ":prefix": "COMPANY#" }
            }));
            return { statusCode: 200, headers, body: JSON.stringify(Items) };
        }

        // 3. GET ONE COMPANY (Pre-filling the edit form)
        if (method === "GET" && pathParams?.companyId) {
            const { Item } = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `COMPANY#${pathParams.companyId}`, SK: "METADATA" }
            }));
            if (!Item) return { statusCode: 404, headers, body: JSON.stringify({ message: "Not found" }) };
            return { statusCode: 200, headers, body: JSON.stringify(Item) };
        }

        // 4. POST (Create Company)
        if (method === "POST") {
            const body = JSON.parse(event.body);
            const companyId = randomUUID();
            const newItem = {
                PK: `COMPANY#${companyId}`,
                SK: "METADATA",
                companyId,
                ...body,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: newItem }));
            return { statusCode: 201, headers, body: JSON.stringify(newItem) };
        }

        // 5. PUT (Update Company)
        if (method === "PUT" && pathParams?.companyId) {
            const id = pathParams.companyId;
            const body = JSON.parse(event.body);

            // Fetch the existing record first to preserve the 'createdAt' date
            const existing = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `COMPANY#${id}`, SK: "METADATA" }
            }));

            if (!existing.Item) {
                return { statusCode: 404, headers, body: JSON.stringify({ message: "Company not found" }) };
            }

            const updatedItem = {
                ...existing.Item, // Start with current data
                ...body,          // Overwrite with updates from the frontend
                PK: `COMPANY#${id}`,
                SK: "METADATA",
                updatedAt: new Date().toISOString() // Always set a fresh timestamp
            };

            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: updatedItem }));
            return { statusCode: 200, headers, body: JSON.stringify(updatedItem) };
        }

        // 6. DELETE
        if (method === "DELETE" && pathParams?.companyId) {
            const id = pathParams.companyId;
            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: `COMPANY#${id}`, SK: "METADATA" }
            }));
            return { statusCode: 200, headers, body: JSON.stringify({ message: "Deleted" }) };
        }

        return { statusCode: 400, headers, body: "Bad Request" };
    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};