const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    TransactWriteCommand,
    QueryCommand,
    GetCommand,
    PutCommand,
    DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";

// Team Howdy's Admin API endpoints (set via Terraform env vars)
const DOMAIN_API_URL = process.env.DOMAIN_API_URL; // e.g. https://<admin-api>/domain
const CONFIG_API_URL = process.env.CONFIG_API_URL; // e.g. https://<admin-api>/config

// Groups that bypass the Velvet Rope time gate entirely.
// FORMER_STUDENT role maps to 'alumni' + 'friends'; FRIEND role maps to 'friends'.
// 'friends' (standard users) MUST be subject to the lock, so we only exempt students and alumni.
const STUDENT_GROUPS = ['students', 'alumni'];
const ADMIN_GROUPS = ['admins', 'admin', 'Admin', 'ADMIN', 'SuperAdmin', 'superadmin', 'SUPERADMIN'];

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

class RsvpService {
    /**
     * RSVP a user to an event.
     * 
     * Handles:
     * 1. Deadline verification.
     * 2. 'Velvet Rope' gating (Partner early access vs Student immediate access).
     * 3. Atomic capacity management (fails and triggers waitlist if full).
     * 4. Duplicate RSVP prevention.
     * 
     * @param {string} eventId - The event ID.
     * @param {string} userId - The user ID.
     * @param {string} userEmail - The user's email (for domain gating).
     * @param {Array<string>} userGroups - Cognito groups for the user.
     * @returns {Promise<object>} The RSVP result (CONFIRMED or WAITLISTED).
     */
    async rsvpToEvent(eventId, userId, userEmail, userGroups) {
        const now = new Date().toISOString();
        const groups = userGroups || [];

        // Fetch the target event
        const eventRes = await docClient.send(
            new GetCommand({ TableName: EVENTS_TABLE, Key: { eventId } })
        );

        if (!eventRes.Item) {
            const e = new Error("Event not found.");
            e.statusCode = 404;
            throw e;
        }

        const event = eventRes.Item;

        // --- RSVP DEADLINE CHECK ---
        if (event.rsvpDeadline && Date.now() > new Date(event.rsvpDeadline).getTime()) {
            const e = new Error("RSVP is officially closed for this event.");
            e.statusCode = 403;
            throw e;
        }

        // --- VELVET ROPE ---
        const isStudent  = groups.some(g => STUDENT_GROUPS.includes(g.toLowerCase()));
        const isAdmin    = groups.some(g => ADMIN_GROUPS.includes(g));
        const isCreator  = !!event.createdBy && event.createdBy === userId;
        const isCapacityExempt = isAdmin || isCreator;
        const isBypassed = !!event.velvetRopeBypass;

        // AC: Backend rejects RSVP requests if Now < (EventTime - TierEarlyAccessHours)
        // Students, Admins, and Creators are exempt from gating. Everyone else is subject to it.
        if (!isBypassed && !isStudent && !isAdmin && !isCreator) {
            const earlyAccessHours = await this._fetchPartnerEarlyAccessHours(userEmail, event.tierOverrides);

            if (earlyAccessHours === null) {
                const e = new Error("Unable to verify access eligibility, please try again later.");
                e.statusCode = 503;
                throw e;
            }

            // Everyone receives the math lock: (0 hours for standard users)
            const unlockTime = new Date(event.date).getTime() - (earlyAccessHours * 60 * 60 * 1000);
            if (Date.now() < unlockTime) {
                const e = new Error(`You cannot RSVP for this event until ${new Date(unlockTime).toUTCString()}.`);
                e.statusCode = 403;
                throw e;
            }
        }
        // -------------------------

        // Build the event Update item — admins and the event creator skip the capacity check
        const eventUpdate = isCapacityExempt
            ? {
                TableName: EVENTS_TABLE,
                Key: { eventId },
                UpdateExpression: "SET currentRsvps = currentRsvps + :one, #version = #version + :one",
                ConditionExpression: "attribute_exists(eventId)",
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: { ":one": 1 },
            }
            : {
                TableName: EVENTS_TABLE,
                Key: { eventId },
                UpdateExpression: "SET currentRsvps = currentRsvps + :one, #version = #version + :one",
                ConditionExpression: "attribute_exists(eventId) AND currentRsvps < #cap",
                ExpressionAttributeNames: { "#version": "version", "#cap": "capacity" },
                ExpressionAttributeValues: { ":one": 1 },
            };

        try {
            await docClient.send(
                new TransactWriteCommand({
                    TransactItems: [
                        { Update: eventUpdate },
                        {
                            // Insert RSVP record (fails if user already RSVP'd = duplicate prevention)
                            Put: {
                                TableName: RSVP_TABLE,
                                Item: {
                                    eventId,
                                    userId,
                                    userEmail: userEmail || "",
                                    status: "CONFIRMED",
                                    rsvpAt: now,
                                },
                                ConditionExpression: "attribute_not_exists(eventId)",
                            },
                        },
                    ],
                })
            );

            return { eventId, userId, rsvpAt: now, status: "CONFIRMED" };
        } catch (error) {
            if (error.name === "TransactionCanceledException") {
                const reasons = error.CancellationReasons || [];
                // reasons[0] = Events table condition, reasons[1] = RSVP table condition
                if (reasons[1] && reasons[1].Code === "ConditionalCheckFailed") {
                    // User already has an RSVP or waitlist entry — check both conditions
                    // (reasons[0] may also have failed, but the dupe check takes priority)
                    const e = new Error("You have already RSVP'd to this event.");
                    e.statusCode = 409;
                    throw e;
                }
                if (reasons[0] && reasons[0].Code === "ConditionalCheckFailed") {
                    // Event is full and user has no existing RSVP — add them to the waitlist
                    return await this._addToWaitlist(eventId, userId, userEmail, now);
                }
            }
            throw error;
        }
    }

    /**
     * Look up a partner's earlyAccessHours from Team Howdy's Admin API.
     *
     * Flow:
     *   1. GET /domain/{domain}  → company record (tierId)
     *   2. GET /config           → tiers array → find tier by tierId → earlyAccessHours
     *
     * @param {string} userEmail - The user's email.
     * @param {object} eventTierOverrides - Event-specific overrides for tiers.
     * @returns {Promise<number|null>} earlyAccessHours (0 if standard, null if error).
     */
    async _fetchPartnerEarlyAccessHours(userEmail, eventTierOverrides = {}) {
        try {
            const domain = userEmail?.split('@')[1]?.toLowerCase();
            if (!domain) return 0;

            if (!DOMAIN_API_URL || !CONFIG_API_URL) {
                console.error("Velvet Rope: DOMAIN_API_URL or CONFIG_API_URL is not configured.");
                return null;
            }

            // Step 1: resolve domain → company → tierId
            console.log(`\n[Velvet Rope] 🕵️  Querying Team Howdy API for domain: @${domain}`);
            const domainRes = await fetch(`${DOMAIN_API_URL}/${encodeURIComponent(domain)}`);
            if (domainRes.status === 404) {
                console.log(`[Velvet Rope] ❌ Domain @${domain} not found in partner registry. Assumed standard access (0 hours).`);
                return 0; // Not a partner domain — no gate
            }
            if (!domainRes.ok) {
                console.error(`[Velvet Rope] domain lookup returned ${domainRes.status}`);
                return null;
            }

            const company = await domainRes.json();
            const tierId = company?.tierId;
            if (!tierId) return 0;

            console.log(`[Velvet Rope] ✅ Found partner! Tier is: '${tierId.toUpperCase()}'`);

            if (eventTierOverrides && eventTierOverrides[tierId] !== undefined) {
                console.log(`[Velvet Rope] 🎛️  Using event-level override for tier ${tierId}: ${eventTierOverrides[tierId]} hours.`);
                return Number(eventTierOverrides[tierId]);
            }

            // Step 2: resolve tierId → earlyAccessHours via /config
            console.log(`[Velvet Rope] ⚙️  Fetching full Velvet Rope Config to check early access hours...`);
            const configRes = await fetch(CONFIG_API_URL);
            if (!configRes.ok) {
                console.error(`[Velvet Rope] config fetch returned ${configRes.status}`);
                return null;
            }

            const config = await configRes.json();
            const configArray = Array.isArray(config) ? config : (config?.tiers || []);
            const tier = configArray.find(
                t => t.tierId?.toLowerCase() === tierId.toLowerCase()
            );

            return (tier && !isNaN(Number(tier.earlyAccessHours))) ? Number(tier.earlyAccessHours) : 0;
        } catch (err) {
            console.error("Velvet Rope: failed to fetch partner config:", err);
            return null; // Network / parse error → fail closed
        }
    }

    /**
     * Resolve user domain to a mathematical tierRank (1=Gold, 99=Student).
     * Used for sorting the waitlist.
     * 
     * @param {string} userEmail - The user's email.
     * @returns {Promise<number>} The priority rank.
     */
    async _fetchPartnerTierRank(userEmail) {
        try {
            const domain = userEmail?.split('@')[1]?.toLowerCase();
            if (!domain) return 99; // Standard student or unknown

            if (!DOMAIN_API_URL || !CONFIG_API_URL) return 99;

            const domainRes = await fetch(`${DOMAIN_API_URL}/${encodeURIComponent(domain)}`);
            if (!domainRes.ok) return 99;

            const company = await domainRes.json();
            const tierId = company?.tierId;
            if (!tierId) return 99;

            const configRes = await fetch(CONFIG_API_URL);
            if (!configRes.ok) return 99;

            const config = await configRes.json();
            const tier = (config?.tiers || []).find(
                t => t.tierId?.toLowerCase() === tierId.toLowerCase()
            );

            if (tier && !isNaN(Number(tier.rank))) {
                return Number(tier.rank);
            }
            
            // Hardcoded fallback ranks if remote API does not specify explicit numeric rank
            if (tierId.toLowerCase() === 'gold') return 1;
            if (tierId.toLowerCase() === 'silver') return 2;
            if (tierId.toLowerCase() === 'bronze') return 3;
            
            return 99;
        } catch (err) {
            console.error("Velvet Rope: failed to fetch partner rank:", err);
            return 99; 
        }
    }

    /**
     * Write a WAITLISTED entry for a user whose RSVP arrived when the event was full.
     * Uses attribute_not_exists to prevent double-waitlisting in concurrent requests.
     * 
     * @param {string} eventId - The event ID.
     * @param {string} userId - The user ID.
     * @param {string} userEmail - The user email.
     * @param {string} waitlistedAt - ISO timestamp of waitlisting.
     * @returns {Promise<object>} Waitlist status and position.
     */
    async _addToWaitlist(eventId, userId, userEmail, waitlistedAt) {
        const tierRank = await this._fetchPartnerTierRank(userEmail);
        try {
            await docClient.send(new PutCommand({
                TableName: RSVP_TABLE,
                Item: {
                    eventId,
                    userId,
                    userEmail: userEmail || "",
                    status: "WAITLISTED",
                    waitlistedAt,
                    tierRank,
                },
                ConditionExpression: "attribute_not_exists(eventId)",
            }));
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                const e = new Error("You have already RSVP'd or are already on the waitlist for this event.");
                e.statusCode = 409;
                throw e;
            }
            throw err;
        }

        const { position, queueSize } = await this.getWaitlistPosition(eventId, userId);
        return {
            eventId,
            userId,
            status: "WAITLISTED",
            waitlistedAt,
            position,
            queueSize,
            message: `Event is full. You've been added to the waitlist at position ${position}.`,
        };
    }

    /**
     * Return a user's 1-based position in the waitlist for an event.
     * Sorts by Tier Rank first, then FIFO by timestamp.
     * 
     * @param {string} eventId - The event ID.
     * @param {string} userId - The user ID.
     * @returns {Promise<object>} position and queueSize.
     */
    async getWaitlistPosition(eventId, userId) {
        const data = await docClient.send(new QueryCommand({
            TableName: RSVP_TABLE,
            KeyConditionExpression: "eventId = :eid",
            FilterExpression: "#s = :waitlisted",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":eid": eventId, ":waitlisted": "WAITLISTED" },
        }));

        const sorted = (data.Items || []).sort((a, b) => {
            const rankA = a.tierRank || 99;
            const rankB = b.tierRank || 99;
            // Option B: First priority is VIP Tier Rank (Lower wins)
            if (rankA !== rankB) return rankA - rankB;
            // Secondary priority is timestamp (FIFO)
            return a.waitlistedAt.localeCompare(b.waitlistedAt);
        });

        const idx = sorted.findIndex(item => item.userId === userId);
        if (idx === -1) {
            const e = new Error("You are not on the waitlist for this event.");
            e.statusCode = 404;
            throw e;
        }

        return { eventId, userId, position: idx + 1, queueSize: sorted.length };
    }

    /**
     * Cancel a confirmed RSVP or a waitlist entry.
     * 
     * Atomic Actions:
     * - If confirmed: Frees seat and promotes next waitlisted user OR decrements capacity.
     * - If waitlisted: Simple removal.
     * 
     * @param {string} eventId - The event ID.
     * @param {string} userId - The user ID.
     * @returns {Promise<object>} Cancellation status and promotion info.
     */
    async cancelRsvp(eventId, userId) {
        const existing = await docClient.send(
            new GetCommand({ TableName: RSVP_TABLE, Key: { eventId, userId } })
        );
        if (!existing.Item) {
            const e = new Error("No RSVP found for this event.");
            e.statusCode = 404;
            throw e;
        }

        const wasConfirmed = existing.Item.status !== "WAITLISTED";

        if (!wasConfirmed) {
            // Removing a waitlist entry — no seat was held, no promotion needed
            await docClient.send(new DeleteCommand({
                TableName: RSVP_TABLE,
                Key: { eventId, userId },
            }));
            return { eventId, userId, status: "cancelled" };
        }

        // Confirmed cancellation — look for the next person in the waitlist
        const waitlistRes = await docClient.send(new QueryCommand({
            TableName: RSVP_TABLE,
            KeyConditionExpression: "eventId = :eid",
            FilterExpression: "#s = :waitlisted",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":eid": eventId, ":waitlisted": "WAITLISTED" },
        }));

        const nextInLine = (waitlistRes.Items || []).sort((a, b) => {
            const rankA = a.tierRank || 99;
            const rankB = b.tierRank || 99;
            // Option B: First priority is VIP Tier Rank (Lower wins)
            if (rankA !== rankB) return rankA - rankB;
            // Secondary priority is timestamp (FIFO)
            return a.waitlistedAt.localeCompare(b.waitlistedAt);
        })[0];

        if (nextInLine) {
            const now = new Date().toISOString();
            // Atomic cancel + promote — net zero change to currentRsvps
            await docClient.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Delete: {
                            TableName: RSVP_TABLE,
                            Key: { eventId, userId },
                            ConditionExpression: "attribute_exists(eventId)",
                        },
                    },
                    {
                        // condition prevents double-promotion if two cancels race
                        Update: {
                            TableName: RSVP_TABLE,
                            Key: { eventId, userId: nextInLine.userId },
                            UpdateExpression: "SET #s = :confirmed, confirmedAt = :now REMOVE waitlistedAt",
                            ConditionExpression: "#s = :waitlisted",
                            ExpressionAttributeNames: { "#s": "status" },
                            ExpressionAttributeValues: {
                                ":confirmed": "CONFIRMED",
                                ":waitlisted": "WAITLISTED",
                                ":now": now,
                            },
                        },
                    },
                ],
            }));
            return { eventId, userId, status: "cancelled", promoted: nextInLine.userId };
        }

        // No one waiting — simple cancel + decrement
        await docClient.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Delete: {
                        TableName: RSVP_TABLE,
                        Key: { eventId, userId },
                    },
                },
                {
                    Update: {
                        TableName: EVENTS_TABLE,
                        Key: { eventId },
                        UpdateExpression: "SET currentRsvps = currentRsvps - :one",
                        ConditionExpression: "currentRsvps > :zero",
                        ExpressionAttributeValues: { ":one": 1, ":zero": 0 },
                    },
                },
            ],
        }));

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
