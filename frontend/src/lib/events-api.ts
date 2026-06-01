/**
 * Event Service API client
 */

const EVENT_API_URL = import.meta.env.VITE_EVENT_API_URL;

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
}

export interface CreateEventPayload {
    title: string;
    date: string;
    category: string;
    capacity: number;
    description?: string;
    location?: string;
}

export interface RsvpRecord {
    eventId: string;
    userId: string;
    userEmail?: string;
    rsvpAt: string;
}

export interface EventHealth {
    status: string;
    service: string;
    timestamp: string;
}

// ── Helpers ────────────────────────────────────────────

function authHeaders(): HeadersInit {
    const token = localStorage.getItem('cognitoIdToken') || '';
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
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<EventItem>(res);
}

export async function updateEvent(eventId: string, payload: Partial<CreateEventPayload>): Promise<EventItem> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<EventItem>(res);
}

export async function deleteEvent(eventId: string): Promise<void> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
}

// ── RSVP ───────────────────────────────────────────────

export async function rsvpToEvent(eventId: string): Promise<{ status: string }> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`, {
        method: 'POST',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function cancelRsvp(eventId: string): Promise<{ status: string }> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function getEventRsvps(eventId: string): Promise<RsvpRecord[]> {
    const res = await fetch(`${EVENT_API_URL}/${eventId}/rsvp`);
    return handleResponse<RsvpRecord[]>(res);
}

export async function getUserRsvps(): Promise<RsvpRecord[]> {
    const res = await fetch(`${EVENT_API_URL}/user/rsvps`, {
        headers: authHeaders(),
    });
    return handleResponse<RsvpRecord[]>(res);
}

// ── Health ─────────────────────────────────────────────

export async function getEventHealth(): Promise<EventHealth> {
    const res = await fetch(`${EVENT_API_URL}/health`);
    return handleResponse<EventHealth>(res);
}
