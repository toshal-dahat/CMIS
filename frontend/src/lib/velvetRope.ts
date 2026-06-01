import type { VelvetRopeState } from './stores/velvetRopeStore';

export interface VelvetRopeStatus {
    canRsvpRightNow: boolean;
    hasStarted: boolean; // True if the event has already happened
    waitlistOnly: boolean; // True if the event has started or the user drops capacity limits
    countdownMessage: string;
    isExempt: boolean;
    isRsvpClosed: boolean;
}

/**
 * Transforms an ISO string to a relative English countdown.
 */
function getRelativeTimeStr(targetTs: number, now: number): string {
    const diff = targetTs - now;
    if (diff <= 0) return "Now";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / 1000 / 60) % 60);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

export function computeVelvetRopeStatus(
    eventDate: string,
    eventCreatedBy: string,
    currentUserId: string,
    state: VelvetRopeState,
    eventBypass: boolean = false,
    eventTierOverrides?: Record<string, number>,
    eventDeadline?: string
): VelvetRopeStatus {
    const defaultStatus: VelvetRopeStatus = {
        canRsvpRightNow: false,
        hasStarted: false,
        waitlistOnly: false,
        countdownMessage: '',
        isExempt: false,
        isRsvpClosed: false
    };

    if (!eventDate || !state.isLoaded) return defaultStatus;

    const eventTs = new Date(eventDate).getTime();
    const now = Date.now();

    if (eventDeadline && now >= new Date(eventDeadline).getTime()) {
        return { ...defaultStatus, canRsvpRightNow: false, isRsvpClosed: true };
    }

    if (now >= eventTs) {
        return { ...defaultStatus, canRsvpRightNow: false, hasStarted: true, waitlistOnly: true };
    }

    // Is the user the creator? They are globally exempt.
    const isCreator = Boolean(eventCreatedBy && currentUserId && eventCreatedBy === currentUserId);
    if (isCreator || state.isExempt || eventBypass) {
        return { ...defaultStatus, canRsvpRightNow: true, isExempt: true };
    }

    // Standard Math
    let myEarlyAccessHours = state.userEarlyAccessHours;
    if (state.userTierId && eventTierOverrides && eventTierOverrides[state.userTierId] !== undefined) {
        myEarlyAccessHours = Number(eventTierOverrides[state.userTierId]);
    }
    const myUnlockTs = eventTs - (myEarlyAccessHours * 60 * 60 * 1000);
    const canIRsvp = now >= myUnlockTs;

    if (canIRsvp) {
        return { ...defaultStatus, canRsvpRightNow: true };
    }

    // Since they cannot RSVP right now, strictly show when *they* individually unlock
    const rel = getRelativeTimeStr(myUnlockTs, now);
    let msg = `Opens in ${rel}`;
    
    if (state.userTierId && state.userTierId !== 'standard') {
        const matchingTier = state.tiers.find(t => t.tierId === state.userTierId);
        const name = matchingTier ? matchingTier.name : (state.userTierId.charAt(0).toUpperCase() + state.userTierId.slice(1));
        msg = `Opens for ${name} in ${rel}`;
    }

    return {
        ...defaultStatus,
        canRsvpRightNow: false,
        countdownMessage: `🔒 ${msg}`
    };
}
