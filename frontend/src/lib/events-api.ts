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
    rsvpAt: string;
    /** CONFIRMED, WAITLISTED, etc. — engagement analytics counts CONFIRMED only. */
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

export function getEventCalendarUrl(eventId: string): string {
    return `${EVENT_API_URL}/${eventId}/calendar`;
}

export function getUserCalendarUrl(userId: string): string {
    const base = EVENT_API_URL?.replace(/\/api\/events$/, '') ?? '';
    return `${base}/api/users/${encodeURIComponent(userId)}/calendar`;
}

// ── Health ─────────────────────────────────────────────

export async function getEventHealth(): Promise<EventHealth> {
    const res = await fetch(`${EVENT_API_URL}/health`);
    return handleResponse<EventHealth>(res);
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
