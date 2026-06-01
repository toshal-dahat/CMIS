import { writable } from "svelte/store";

export type EventCheckinResultStatus = "success" | "failed";

export interface EventCheckinResultState {
  status: EventCheckinResultStatus;
  title: string;
  message: string;
  eventId?: string;
}

export const eventCheckinResult = writable<EventCheckinResultState | null>(null);
