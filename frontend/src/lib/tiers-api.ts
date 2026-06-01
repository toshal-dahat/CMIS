

function getOptionalEnvUrl(key: string): string {
  const v = (import.meta.env as Record<string, unknown>)?.[key];
  if (typeof v !== 'string' || !v.trim()) return '';
  return v.trim().replace(/\/+$/, '');
}

const COMPANIES_API_URL = getOptionalEnvUrl('VITE_COMPANIES_API_URL');
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
  if (!COMPANIES_API_URL || !domain || domain.trim() === '') return null;
  try {
    const res = await fetch(COMPANIES_API_URL);
    if (!res.ok) return null;
    const companies = await res.json();
    if (Array.isArray(companies)) {
      const match = companies.find((c: any) => c.domain && c.domain.toLowerCase() === domain.toLowerCase());
      if (match) return { domain: match.domain, tierId: match.tierId };
    }
    return null;
  } catch (err) {
    console.warn(`Velvet Rope: failed to resolve domain ${domain}`, err);
    return null;
  }
}
