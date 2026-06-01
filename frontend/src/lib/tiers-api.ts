

function getOptionalEnvUrl(key: string): string {
  const v = (import.meta.env as Record<string, unknown>)?.[key];
  if (typeof v !== 'string' || !v.trim()) return '';
  return v.trim().replace(/\/+$/, '');
}

const EXTERNAL_API_BASE = getOptionalEnvUrl('VITE_EXTERNAL_API_BASE_URL') || `${getOptionalEnvUrl('VITE_API_BASE_URL')}/external`;
const CONFIG_API_URL = getOptionalEnvUrl('VITE_CONFIG_API_URL');

export interface TierConfig {
  tierId: string;
  rank: number;
  earlyAccessHours: number;
}

export interface DomainConfig {
  domain: string;
  tierId: string;
}

/**
 * Fetch the global tiers configuration (ranks and access hours)
 */
export async function fetchTiersConfig(): Promise<TierConfig[]> {
  if (!CONFIG_API_URL) return [];
  try {
    const res = await fetch(CONFIG_API_URL);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.tiers || []);
  } catch (err) {
    console.error("Failed to fetch Velvet Rope config", err);
    return [];
  }
}

/**
 * Fetch the tier definition for a specific external domain
 */
export async function fetchDomainTier(domain: string): Promise<DomainConfig | null> {
  if (!EXTERNAL_API_BASE || !domain || domain.trim() === '') return null;
  try {
    const res = await fetch(`${EXTERNAL_API_BASE}/domain/${encodeURIComponent(domain.trim())}`);
    if (res.status === 404) return null; // Not a partner domain
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`Velvet Rope: failed to resolve domain ${domain}`, err);
    return null;
  }
}
