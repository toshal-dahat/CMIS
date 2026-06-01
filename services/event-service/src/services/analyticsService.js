const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    ScanCommand,
    QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";
const RESPONSES_TABLE = process.env.SURVEY_RESPONSES_TABLE || "SurveyResponses-dev";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

class AnalyticsService {
    async getEventSuccessAnalytics() {
        // 1. Get all events
        const eventsData = await docClient.send(new ScanCommand({ TableName: EVENTS_TABLE }));
        const events = eventsData.Items || [];

        if (events.length === 0) {
            return { categories: [], totals: { totalEvents: 0, totalRsvps: 0, totalCheckins: 0, overallCheckinRate: 0, overallAvgRating: null } };
        }

        // 2. Fan out queries for RSVPs and survey responses per event
        const [rsvpResults, surveyResults] = await Promise.all([
            Promise.all(events.map(e => this._getRsvpStats(e.eventId))),
            Promise.all(events.map(e => this._getSurveyStats(e.eventId))),
        ]);

        // 3. Build per-category aggregates
        const categoryMap = new Map();

        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const category = (event.category || "UNCATEGORIZED").toUpperCase();
            const { rsvpCount, checkinCount } = rsvpResults[i];
            const { avgRating, responseCount } = surveyResults[i];

            if (!categoryMap.has(category)) {
                categoryMap.set(category, {
                    category,
                    rsvpCount: 0,
                    checkinCount: 0,
                    ratingSum: 0,
                    ratingCount: 0,
                    surveyResponseCount: 0,
                    eventCount: 0,
                });
            }

            const cat = categoryMap.get(category);
            cat.rsvpCount += rsvpCount;
            cat.checkinCount += checkinCount;
            cat.eventCount += 1;
            cat.surveyResponseCount += responseCount;
            if (avgRating !== null) {
                cat.ratingSum += avgRating * responseCount;
                cat.ratingCount += responseCount;
            }
        }

        // 4. Shape the output
        const categories = Array.from(categoryMap.values())
            .map(cat => ({
                category: cat.category,
                rsvpCount: cat.rsvpCount,
                checkinCount: cat.checkinCount,
                checkinRate: cat.rsvpCount > 0
                    ? Math.round((cat.checkinCount / cat.rsvpCount) * 1000) / 10
                    : 0,
                avgSurveyRating: cat.ratingCount > 0
                    ? Math.round((cat.ratingSum / cat.ratingCount) * 10) / 10
                    : null,
                surveyResponseCount: cat.surveyResponseCount,
                eventCount: cat.eventCount,
            }))
            .sort((a, b) => a.category.localeCompare(b.category));

        const totalRsvps = categories.reduce((s, c) => s + c.rsvpCount, 0);
        const totalCheckins = categories.reduce((s, c) => s + c.checkinCount, 0);
        const allRatings = categories.filter(c => c.avgSurveyRating !== null);
        const totalResponses = allRatings.reduce((s, c) => s + c.surveyResponseCount, 0);
        const weightedRating = allRatings.reduce((s, c) => s + (c.avgSurveyRating * c.surveyResponseCount), 0);

        return {
            categories,
            totals: {
                totalEvents: events.length,
                totalRsvps,
                totalCheckins,
                overallCheckinRate: totalRsvps > 0
                    ? Math.round((totalCheckins / totalRsvps) * 1000) / 10
                    : 0,
                overallAvgRating: totalResponses > 0
                    ? Math.round((weightedRating / totalResponses) * 10) / 10
                    : null,
            },
        };
    }

    async _getRsvpStats(eventId) {
        const data = await docClient.send(
            new QueryCommand({
                TableName: RSVP_TABLE,
                KeyConditionExpression: "eventId = :eid",
                ExpressionAttributeValues: { ":eid": eventId },
            })
        );
        const items = data.Items || [];
        const rsvpCount = items.filter(r => r.status === "CONFIRMED").length;
        const checkinCount = items.filter(r => r.checkedIn === true).length;
        return { rsvpCount, checkinCount };
    }

    async _getSurveyStats(eventId) {
        const data = await docClient.send(
            new QueryCommand({
                TableName: RESPONSES_TABLE,
                KeyConditionExpression: "eventId = :eid",
                ExpressionAttributeValues: { ":eid": eventId },
            })
        );
        const items = data.Items || [];
        if (items.length === 0) return { avgRating: null, responseCount: 0 };

        const ratings = items
            .map(r => Number(r.responses?.overall))
            .filter(n => !isNaN(n) && n >= 1 && n <= 5);

        if (ratings.length === 0) return { avgRating: null, responseCount: items.length };

        const avg = ratings.reduce((s, n) => s + n, 0) / ratings.length;
        return { avgRating: Math.round(avg * 10) / 10, responseCount: items.length };
    }
}

module.exports = new AnalyticsService();
