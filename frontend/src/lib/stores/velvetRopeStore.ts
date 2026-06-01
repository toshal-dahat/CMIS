import { writable, get } from 'svelte/store';
import { fetchTiersConfig, fetchDomainTier, type TierConfig } from '../tiers-api';
import { getAuthUser, getCognitoGroups, getCognitoIdToken } from '../auth';

export interface VelvetRopeState {
  isLoaded: boolean;
  tiers: TierConfig[];
  userEarlyAccessHours: number;
  userTierId: string;
  isExempt: boolean;
}

export const velvetRopeStore = writable<VelvetRopeState>({
  isLoaded: false,
  tiers: [],
  userEarlyAccessHours: 0,
  userTierId: 'standard',
  isExempt: false
});

/**
 * Initializes the store by fetching the global configs and the current user's access level.
 */
export async function initializeVelvetRope() {
  const state = get(velvetRopeStore);
  if (state.isLoaded) return;

  const tiers = await fetchTiersConfig();
  
  // Sort tiers by rank descending implicitly (highest rank first)
  // or explicitly sort by rank ascending (1 = highest)
  tiers.sort((a, b) => a.rank - b.rank);

  let isExempt = false;
  let userEarlyAccessHours = 0;
  let userTierId = 'standard';

  const authUser = await getAuthUser();
  if (authUser) {
    const groups = await getCognitoGroups();
    
    // Check if exempt (students & admins)
    // Creators are also exempt, but that's checked per-event in the math engine
    const STUDENT_GROUPS = ['students', 'alumni'];
    const ADMIN_GROUPS = ['admins', 'admin', 'Admin', 'ADMIN', 'SuperAdmin', 'superadmin', 'SUPERADMIN'];
    if (groups.some(g => STUDENT_GROUPS.includes(g.toLowerCase()) || ADMIN_GROUPS.includes(g))) {
        isExempt = true;
    }

    if (!isExempt) {
        // Extract email to find domain
        const token = await getCognitoIdToken();
        let email = '';
        if (token) {
            try {
                const parts = token.split('.');
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                email = typeof payload.email === 'string' ? payload.email : '';
            } catch (e) {
                // ignore
            }
        }
        
        if (email.includes('@')) {
            const domain = email.split('@')[1].toLowerCase();
            const domainTier = await fetchDomainTier(domain);
            if (domainTier) {
                userTierId = domainTier.tierId;
                const activeTier = tiers.find(t => t.tierId.toLowerCase() === domainTier.tierId.toLowerCase());
                if (activeTier && !isNaN(Number(activeTier.earlyAccessHours))) {
                    userEarlyAccessHours = Number(activeTier.earlyAccessHours);
                }
            }
        }
    }
  }

  velvetRopeStore.set({
    isLoaded: true,
    tiers,
    userEarlyAccessHours,
    userTierId,
    isExempt
  });
}
