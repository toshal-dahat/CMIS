import type { Tier } from '../lib/types';

const TIERS_API_URL = import.meta.env.VITE_TIERS_API_URL
const CONFIG_URL = import.meta.env.VITE_CONFIG_API_URL;

// GET all tiers from config API (aggregated endpoint, may be cached)
export async function getTiers(): Promise<Tier[]> {
  try {
    const response = await fetch(CONFIG_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.tiers ?? [];
  } catch (error) {
    console.error('Failed to fetch tiers from config:', error);
    throw error;
  }
}

// GET tiers directly from tiers API, bypassing config cache
export async function getTiersFresh(): Promise<Tier[]> {
  try {
    const response = await fetch(`${TIERS_API_URL}?cb=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const items: Tier[] = await response.json();
    return items.sort((a, b) => (a.rank || 0) - (b.rank || 0));
  } catch (error) {
    console.error('Failed to fetch fresh tiers:', error);
    throw error;
  }
}

// POST create new tier
export async function createTier(tierData: Omit<Tier, 'createdAt' | 'updatedAt'>): Promise<Tier> {
  try {
    const response = await fetch(TIERS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tierId: tierData.tierId || tierData.name.toLowerCase().replace(/\s+/g, '-'),
        name: tierData.name,
        rank: tierData.rank,
        earlyAccessHours: tierData.earlyAccessHours
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to create tier:', error);
    throw error;
  }
}

// PUT update existing tier
export async function updateTier(tierId: string, tierData: Partial<Tier>): Promise<Tier> {
  try {
    const response = await fetch(`${TIERS_API_URL}/${tierId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tierId: tierData.tierId || tierId,
        name: tierData.name,
        rank: tierData.rank,
        earlyAccessHours: tierData.earlyAccessHours
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to update tier:', error);
    throw error;
  }
}

// DELETE tier (returns 409 if companies are assigned to it)
export async function deleteTier(tierId: string): Promise<void> {
  try {
    const response = await fetch(`${TIERS_API_URL}/${tierId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json();
      if (response.status === 409) {
        throw new Error(error.message || 'Cannot delete: Tier is assigned to active companies.');
      }
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to delete tier:', error);
    throw error;
  }
}