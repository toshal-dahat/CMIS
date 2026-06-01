import type { VelvetRopeState } from './stores/velvetRopeStore';

export interface VelvetRopeStatus {
    canRsvpRightNow: boolean;
    hasStarted: boolean; // True if the event has already happened
    waitlistOnly: boolean; // True if the event has started or the user drops capacity limits
    countdownMessage: string;
    isExempt: boolean;
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
    state: VelvetRopeState
): VelvetRopeStatus {
    const defaultStatus: VelvetRopeStatus = {
        canRsvpRightNow: false,
        hasStarted: false,
        waitlistOnly: false,
        countdownMessage: '',
        isExempt: false
    };

    if (!eventDate || !state.isLoaded) return defaultStatus;

    const eventTs = new Date(eventDate).getTime();
    const now = Date.now();

    if (now >= eventTs) {
        return { ...defaultStatus, canRsvpRightNow: false, hasStarted: true, waitlistOnly: true };
    }

    // Is the user the creator? They are globally exempt.
    const isCreator = Boolean(eventCreatedBy && currentUserId && eventCreatedBy === currentUserId);
    if (isCreator || state.isExempt) {
        return { ...defaultStatus, canRsvpRightNow: true, isExempt: true };
    }

    // Standard Math
    const myUnlockTs = eventTs - (state.userEarlyAccessHours * 60 * 60 * 1000);
    const canIRsvp = now >= myUnlockTs;

    if (canIRsvp) {
        return { ...defaultStatus, canRsvpRightNow: true };
    }

    // Discover the next tier that unlocks
    // Tiers are sorted by rank ascending (1 = highest).
    // We want to find the tier with the earliest unlock time that is STILL IN THE FUTURE.
    const futureTiers = state.tiers
        .map(t => {
            const unlock = eventTs - (t.earlyAccessHours * 60 * 60 * 1000);
            return { name: t.tierId, unlockTs: unlock };
        })
        .filter(t => t.unlockTs > now)
        .sort((a, b) => a.unlockTs - b.unlockTs); // Earliest unlocking future tier first

    let msg = "";
    if (futureTiers.length > 0) {
        const next = futureTiers[0];
        // Capitalize Name if exists
        const rawName = next?.name || "Next Tier";
        const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        const rel = getRelativeTimeStr(next?.unlockTs || now, now);
        msg = `Opens for ${name} in ${rel}`;
    } else {
        // Fallback: Just print exactly when the user unlocking is natively.
        // E.g. Standard tier is mostly at exactly the event time.
        const rel = getRelativeTimeStr(myUnlockTs, now);
        msg = `Opens in ${rel}`;
    }

    return {
        ...defaultStatus,
        canRsvpRightNow: false,
        countdownMessage: `🔒 ${msg}`
    };
}
