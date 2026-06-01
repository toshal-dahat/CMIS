/**
 * Event Service API client
 */

const EVENT_API_URL = import.meta.env.VITE_EVENT_API_URL;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ── Types ──────────────────────────────────────────────

export interface EventItem {
    eventId: string;
    title: string;
    date: string;
    category: string;
    capacity: number;
    currentRsvps: number;
    description?: string;
    location?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    status?: string;
    createdBy?: string;
    velvetRopeBypass?: boolean;
    tierOverrides?: Record<string, number>;
    rsvpDeadline?: string;
}

export interface CreateEventPayload {
    title: string;
    date: string;
    category: string;
    capacity: number;
    description?: string;
    location?: string;
    status?: string;
    velvetRopeBypass?: boolean;
    tierOverrides?: Record<string, number>;
    rsvpDeadline?: string;
}

export interface RsvpRecord {
    eventId: string;
    userId: string;
    userEmail?: string;
    /** ISO timestamp from RSVP, or sentinel `NA` when the row is check-in only (no prior RSVP). */
    rsvpAt: string;
    status?: string;
    checkedIn?: boolean;
    checkedInAt?: string | null;
}

export interface EventHealth {
    status: string;
    service: string;
    timestamp: string;
}

export interface EventQrPayload {
    eventId: string;
    eventTitle?: string;
    signedEventCode: string;
    checkInUrl?: string | null;
    qrCodeDataUrl: string;
    stablePerEvent?: boolean;
    generatedAt?: string;
}

export interface EventSelfCheckinPayload {
    status?: string;
    eventId?: string;
    userId?: string;
    checkedInAt?: string | null;
    rsvpAt?: string;
    rsvpStatus?: string;
    message?: string;
}

// ── Helpers ────────────────────────────────────────────

import { getCognitoIdToken } from './auth';

async function authHeaders(): Promise<HeadersInit> {
    const token = await getCognitoIdToken() || '';
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
    return res.json();
}

// ── Event CRUD ─────────────────────────────────────────

export async function listEvents(): Promise<EventItem[]> {
    const res = await fetch(`${EVENT_API_URL}`);
    return handleResponse<EventItem[]>(res);
}

export async function getEvent(eventId: string): Promise<EventItem> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}`);
    return handleResponse<EventItem>(res);
}

export async function createEvent(payload: CreateEventPayload): Promise<EventItem> {
    const res = await fetch(`${EVENT_API_URL}`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<EventItem>(res);
}

export async function updateEvent(eventId: string, payload: Partial<CreateEventPayload>): Promise<EventItem> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<EventItem>(res);
}

export async function deleteEvent(eventId: string): Promise<void> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
}

// ── RSVP ───────────────────────────────────────────────

export async function rsvpToEvent(eventId: string): Promise<{ status: string; message?: string }> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`, {
        method: 'POST',
        headers: await authHeaders(),
    });
    return handleResponse(res);
}

export async function cancelRsvp(eventId: string): Promise<{ status: string }> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    return handleResponse(res);
}

export async function getEventRsvps(eventId: string): Promise<RsvpRecord[]> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`, {
        headers: await authHeaders(),
    });
    return handleResponse<RsvpRecord[]>(res);
}

export async function getUserRsvps(): Promise<RsvpRecord[]> {
    const res = await fetch(`${EVENT_API_URL}/user/rsvps`, {
        headers: await authHeaders(),
    });
    return handleResponse<RsvpRecord[]>(res);
}

// ── Calendar ───────────────────────────────────────────

/** Returns the direct URL for a single-event .ics download (no auth required). */
export function getEventCalendarUrl(eventId: string): string {
    return `${EVENT_API_URL}/${eventId}/calendar`;
}

/**
 * Fetches the authenticated user's full RSVP schedule as an .ics string.
 * Uses Bearer auth — must be called from JS, not used as a plain href.
 * Returns an empty-but-valid VCALENDAR string when the user has no confirmed RSVPs.
 */
export async function getUserScheduleIcs(): Promise<string> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/users/me/calendar`, {
        headers: await authHeaders(),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
    return res.text();
}

// ── Health ─────────────────────────────────────────────

export async function getEventHealth(): Promise<EventHealth> {
    const res = await fetch(`${EVENT_API_URL}/health`);
    return handleResponse<EventHealth>(res);
}

// ── Survey Types ───────────────────────────────────────

export interface SurveyQuestion {
    id: string;
    text: string;
    type: 'rating';
    min: number;
    max: number;
}

export interface SurveyTemplate {
    eventId: string;
    questions: SurveyQuestion[];
    isDefault?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface SurveyFormData {
    event: { eventId: string; title: string; date: string };
    template: SurveyTemplate;
}

export interface EventCategoryAnalytics {
    category: string;
    rsvpCount: number;
    checkinCount: number;
    checkinRate: number;
    avgSurveyRating: number | null;
    surveyResponseCount: number;
    eventCount: number;
}

export interface EventSuccessAnalytics {
    categories: EventCategoryAnalytics[];
    totals: {
        totalEvents: number;
        totalRsvps: number;
        totalCheckins: number;
        overallCheckinRate: number;
        overallAvgRating: number | null;
    };
}

// ── Survey API ─────────────────────────────────────────

export async function getSurveyTemplate(eventId: string): Promise<SurveyTemplate> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/surveys/${eventId}`, {
        headers: await authHeaders(),
    });
    return handleResponse<SurveyTemplate>(res);
}

export async function saveSurveyTemplate(eventId: string, questions: SurveyQuestion[]): Promise<SurveyTemplate> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/surveys/${eventId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({ questions }),
    });
    return handleResponse<SurveyTemplate>(res);
}

export async function getSurveyForm(eventId: string, userId: string): Promise<SurveyFormData> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/surveys/${eventId}/respond?userId=${encodeURIComponent(userId)}`);
    return handleResponse<SurveyFormData>(res);
}

export async function submitSurveyResponse(
    eventId: string,
    userId: string,
    userEmail: string,
    responses: Record<string, number>
): Promise<void> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/surveys/${eventId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, userEmail, responses }),
    });
    await handleResponse<unknown>(res);
}

// ── Analytics API ──────────────────────────────────────

export async function getEventSuccessAnalytics(): Promise<EventSuccessAnalytics> {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    const res = await fetch(`${base}/api/analytics/event-success`, {
        headers: await authHeaders(),
    });
    return handleResponse<EventSuccessAnalytics>(res);
}

export async function sendSurveyEmails(eventId: string): Promise<{ sent: number; total: number }> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/send-survey`, {
        method: 'POST',
        headers: await authHeaders(),
    });
    return handleResponse<{ sent: number; total: number }>(res);
}

// ── Event QR / Attendance ──────────────────────────────

export async function getEventQr(eventId: string): Promise<EventQrPayload> {
    const res = await fetch(`${API_BASE_URL}/student/api/events/${encodeURIComponent(eventId)}/qr`, {
        headers: await authHeaders(),
    });
    return handleResponse<EventQrPayload>(res);
}

export async function selfCheckIn(scannedText: string, expectedEventId: string): Promise<EventSelfCheckinPayload> {
    const res = await fetch(`${API_BASE_URL}/student/api/events/check-in/self`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
            scannedText,
            expectedEventId,
        }),
    });
    return handleResponse<EventSelfCheckinPayload>(res);
}
