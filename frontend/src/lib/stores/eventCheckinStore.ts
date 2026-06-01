import { writable } from "svelte/store";

export interface EventCheckinContext {
  eventId: string;
  eventTitle?: string;
  prefilledScanText?: string;
}

export const eventCheckinContext = writable<EventCheckinContext | null>(null);
