const EVENT_API_URL = import.meta.env.VITE_EVENT_API_URL;

export interface EventHealth {
    status: string;
    service: string;
    timestamp: string;
}

export interface EventRootInfo {
    message: string;
    service: string;
    version: string;
    endpoints: string[];
}

// Check the health of the live Event API Gateway
export async function getEventHealth(): Promise<EventHealth> {
    try {
        const response = await fetch(`${EVENT_API_URL}/health`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch event health endpoint:', error);
        throw error;
    }
}

// Get the root information from the Event API Gateway
export async function getEventRootInfo(): Promise<EventRootInfo> {
    try {
        const response = await fetch(`${EVENT_API_URL}/`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch event root status:', error);
        throw error;
    }
}
