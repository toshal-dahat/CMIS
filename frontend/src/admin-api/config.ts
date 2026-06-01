import type { Tier, Theme } from '../lib/types';
import type { NormalizedTheme } from './theme';
import { normalizeTheme } from './theme';

const API_URL = import.meta.env.VITE_CONFIG_API_URL;

// Raw shape as returned by the API before normalization
interface RawConfig {
  tiers: Tier[];
  theme: Theme;
  timestamp?: string;
}

// Normalized shape used across all frontend components
export interface Config {
  tiers: Tier[];
  theme: NormalizedTheme;
  timestamp?: string;
}

// GET aggregated config (companies + tiers + theme)
export async function getConfig(): Promise<Config> {
  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: RawConfig = await response.json();

    return {
      tiers: (data.tiers ?? []).sort((a, b) => (a.rank || 0) - (b.rank || 0)),
      theme: normalizeTheme(data.theme),
      timestamp: data.timestamp
    };
  } catch (error) {
    console.error('Failed to fetch config:', error);
    throw error;
  }
}

// GET only tiers from config
export async function getTiersFromConfig(): Promise<Tier[]> {
  const config = await getConfig();
  return config.tiers;
}

// GET only theme from config
export async function getThemeFromConfig(): Promise<NormalizedTheme> {
  const config = await getConfig();
  return config.theme;
}