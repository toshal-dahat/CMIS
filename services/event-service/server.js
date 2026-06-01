/**
 * Local development server for the Event Service.
 * Uses in-memory storage to mock DynamoDB so you can test all
 * CRUD + RSVP endpoints locally with Postman — no AWS needed.
 *
 * Start:  node server.js
 * Base:   http://localhost:3005/api/events
 */

// ── In-memory DynamoDB mock ──────────────────────────────
const eventsStore = new Map();
const rsvpStore = new Map(); // key = "eventId#userId"

// Monkey-patch the DynamoDB Document Client BEFORE requiring our services
const mockDocClient = {
   send(command) {
      const name = command.constructor.name;

      // ── ScanCommand (listEvents) ──
      if (name === 'ScanCommand') {
         const items = [...eventsStore.values()];
         return Promise.resolve({ Items: items });
      }

      // ── GetCommand ──
      if (name === 'GetCommand') {
         const table = command.input.TableName;
         if (table.startsWith('EventRsvps')) {
            const k = `${command.input.Key.eventId}#${command.input.Key.userId}`;
            return Promise.resolve({ Item: rsvpStore.get(k) || null });
         }
         return Promise.resolve({ Item: eventsStore.get(command.input.Key.eventId) || null });
      }

      // ── PutCommand (createEvent) ──
      if (name === 'PutCommand') {
         const table = command.input.TableName;
         if (table.startsWith('EventRsvps')) {
            const item = command.input.Item;
            const k = `${item.eventId}#${item.userId}`;
            // Check condition: attribute_not_exists
            if (command.input.ConditionExpression && rsvpStore.has(k)) {
               const err = new Error('ConditionalCheckFailed');
               err.name = 'ConditionalCheckFailedException';
               return Promise.reject(err);
            }
            rsvpStore.set(k, item);
         } else {
            eventsStore.set(command.input.Item.eventId, command.input.Item);
         }
         return Promise.resolve({});
      }

      // ── UpdateCommand ──
      if (name === 'UpdateCommand') {
         const eventId = command.input.Key.eventId;
         const existing = eventsStore.get(eventId);
         if (!existing) return Promise.resolve({ Attributes: null });

         // Parse simple SET expressions for local mock
         const expr = command.input.UpdateExpression || '';
         const vals = command.input.ExpressionAttributeValues || {};
         const names = command.input.ExpressionAttributeNames || {};

         // Check conditions
         if (command.input.ConditionExpression) {
            const cond = command.input.ConditionExpression;
            // Optimistic locking: version check
            if (cond.includes('#version = :expectedVersion') && vals[':expectedVersion'] !== undefined) {
               if (existing.version !== vals[':expectedVersion']) {
                  const err = new Error('ConditionalCheckFailed');
                  err.name = 'ConditionalCheckFailedException';
                  return Promise.reject(err);
               }
            }
            // Capacity check for RSVP
            if (cond.includes('currentRsvps < capacity')) {
               if (existing.currentRsvps >= existing.capacity) {
                  const err = new Error('ConditionalCheckFailed');
                  err.name = 'ConditionalCheckFailedException';
                  return Promise.reject(err);
               }
            }
            // Decrement guard
            if (cond.includes('currentRsvps > :zero')) {
               if (existing.currentRsvps <= 0) {
                  const err = new Error('ConditionalCheckFailed');
                  err.name = 'ConditionalCheckFailedException';
                  return Promise.reject(err);
               }
            }
         }

         // Apply updates
         for (const [alias, realName] of Object.entries(names)) {
            if (vals[`:${realName.replace('#', '')}`] !== undefined) {
               existing[realName] = vals[`:${realName.replace('#', '')}`];
            }
         }
         // Handle increment/decrement for currentRsvps
         if (expr.includes('currentRsvps = currentRsvps + :one')) {
            existing.currentRsvps = (existing.currentRsvps || 0) + 1;
         }
         if (expr.includes('currentRsvps = currentRsvps - :one')) {
            existing.currentRsvps = Math.max(0, (existing.currentRsvps || 0) - 1);
         }
         // Handle version bump
         if (expr.includes('#version = #version + :versionInc') || expr.includes('#version = #version + :one')) {
            existing.version = (existing.version || 0) + 1;
         }
         if (vals[':updatedAt']) existing.updatedAt = vals[':updatedAt'];

         // Apply named attribute updates
         for (const key of Object.keys(vals)) {
            const cleanKey = key.replace(':', '');
            if (['updatedAt', 'versionInc', 'expectedVersion', 'one', 'zero'].includes(cleanKey)) continue;
            const realName = names[`#${cleanKey}`] || cleanKey;
            existing[realName] = vals[key];
         }

         eventsStore.set(eventId, existing);
         return Promise.resolve({ Attributes: existing });
      }

      // ── DeleteCommand ──
      if (name === 'DeleteCommand') {
         const table = command.input.TableName;
         if (table.startsWith('EventRsvps')) {
            const k = `${command.input.Key.eventId}#${command.input.Key.userId}`;
            rsvpStore.delete(k);
         } else {
            eventsStore.delete(command.input.Key.eventId);
         }
         return Promise.resolve({});
      }

      // ── QueryCommand ──
      if (name === 'QueryCommand') {
         const vals = command.input.ExpressionAttributeValues || {};
         const index = command.input.IndexName;
         let items = [];
         if (index === 'userId-index') {
            const uid = vals[':uid'];
            items = [...rsvpStore.values()].filter(r => r.userId === uid);
         } else {
            const eid = vals[':eid'];
            items = [...rsvpStore.values()].filter(r => r.eventId === eid);
         }
         return Promise.resolve({ Items: items });
      }

      // ── TransactWriteCommand (RSVP atomic) ──
      if (name === 'TransactWriteCommand') {
         const items = command.input.TransactItems;
         // Pre-check all conditions before applying
         for (const item of items) {
            if (item.Update) {
               const eventId = item.Update.Key.eventId;
               const existing = eventsStore.get(eventId);
               if (!existing) {
                  const err = new Error('TransactionCanceledException');
                  err.name = 'TransactionCanceledException';
                  err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
                  return Promise.reject(err);
               }
               const cond = item.Update.ConditionExpression || '';
               if (cond.includes('currentRsvps < capacity') && existing.currentRsvps >= existing.capacity) {
                  const err = new Error('TransactionCanceledException');
                  err.name = 'TransactionCanceledException';
                  err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
                  return Promise.reject(err);
               }
            }
            if (item.Put) {
               const rsvpItem = item.Put.Item;
               const k = `${rsvpItem.eventId}#${rsvpItem.userId}`;
               if (item.Put.ConditionExpression && rsvpStore.has(k)) {
                  const err = new Error('TransactionCanceledException');
                  err.name = 'TransactionCanceledException';
                  err.CancellationReasons = [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }];
                  return Promise.reject(err);
               }
            }
         }

         // Apply all changes
         for (const item of items) {
            if (item.Update) {
               const eventId = item.Update.Key.eventId;
               const existing = eventsStore.get(eventId);
               const expr = item.Update.UpdateExpression || '';
               if (expr.includes('currentRsvps + :one')) existing.currentRsvps += 1;
               if (expr.includes('currentRsvps - :one')) existing.currentRsvps = Math.max(0, existing.currentRsvps - 1);
               if (expr.includes('#version = #version + :one')) existing.version = (existing.version || 0) + 1;
               eventsStore.set(eventId, existing);
            }
            if (item.Put) {
               const rsvpItem = item.Put.Item;
               rsvpStore.set(`${rsvpItem.eventId}#${rsvpItem.userId}`, rsvpItem);
            }
            if (item.Delete) {
               const k = `${item.Delete.Key.eventId}#${item.Delete.Key.userId}`;
               rsvpStore.delete(k);
            }
         }
         return Promise.resolve({});
      }

      console.warn(`[mock] Unhandled DynamoDB command: ${name}`);
      return Promise.resolve({});
   }
};

// Patch the AWS SDK modules that our services import
const Module = require('module');
const originalResolve = Module._resolveFilename;
const dynamoMockExports = {
   DynamoDBClient: function () { return {}; },
   DynamoDBDocumentClient: { from: () => mockDocClient },
   ScanCommand: class ScanCommand { constructor(input) { this.input = input; } },
   GetCommand: class GetCommand { constructor(input) { this.input = input; } },
   PutCommand: class PutCommand { constructor(input) { this.input = input; } },
   UpdateCommand: class UpdateCommand { constructor(input) { this.input = input; } },
   DeleteCommand: class DeleteCommand { constructor(input) { this.input = input; } },
   QueryCommand: class QueryCommand { constructor(input) { this.input = input; } },
   TransactWriteCommand: class TransactWriteCommand { constructor(input) { this.input = input; } },
};

// Override require for AWS SDK modules
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
   if (id === '@aws-sdk/client-dynamodb') return { DynamoDBClient: dynamoMockExports.DynamoDBClient };
   if (id === '@aws-sdk/lib-dynamodb') return dynamoMockExports;
   return origRequire.apply(this, arguments);
};

// ── Environment ──────────────────────────────────────────
process.env.EVENTS_TABLE = 'Events-local';
process.env.RSVP_TABLE = 'EventRsvps-local';
process.env.COGNITO_USER_POOL_ID = ''; // empty = skip real JWT verification

// ── Start server ─────────────────────────────────────────
const { app } = require('./index');

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
   console.log(`\n🚀  Event Service running at http://localhost:${PORT}`);
   console.log(`\n📋  Test with Postman or curl:\n`);
   console.log(`  GET    http://localhost:${PORT}/api/events              List all events`);
   console.log(`  POST   http://localhost:${PORT}/api/events              Create event (needs Auth header)`);
   console.log(`  GET    http://localhost:${PORT}/api/events/:id          Get single event`);
   console.log(`  PUT    http://localhost:${PORT}/api/events/:id          Update event (needs Auth header)`);
   console.log(`  DELETE http://localhost:${PORT}/api/events/:id          Delete event (needs Auth header)`);
   console.log(`  POST   http://localhost:${PORT}/api/events/:id/rsvp    RSVP (needs Auth header)`);
   console.log(`  DELETE http://localhost:${PORT}/api/events/:id/rsvp    Cancel RSVP (needs Auth header)`);
   console.log(`  GET    http://localhost:${PORT}/api/events/:id/rsvp    List RSVPs for event`);
   console.log(`  GET    http://localhost:${PORT}/api/events/health       Health check`);
   console.log(`\n  💡 Auth header: Authorization: Bearer any-token-works-locally\n`);
});
