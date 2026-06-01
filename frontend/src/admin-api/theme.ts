import type { Theme } from '../lib/types';

const CONFIG_URL = import.meta.env.VITE_CONFIG_API_URL;
const THEME_API_URL = import.meta.env.VITE_THEME_API_URL;

// Normalized theme shape used across all frontend components
export interface NormalizedTheme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;   // normalized from API's logoURL
}

export function normalizeTheme(raw: Theme): NormalizedTheme {
  return {
    primaryColor: raw.primaryColor,
    secondaryColor: raw.secondaryColor,
    logoUrl: raw.logoURL || ''   // API → frontend field name normalization
  };
}

// GET theme from config API (aggregated endpoint, may be cached)
export async function getTheme(): Promise<NormalizedTheme> {
  try {
    const response = await fetch(CONFIG_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return normalizeTheme(data.theme);
  } catch (error) {
    console.error('Failed to fetch theme from config:', error);
    throw error;
  }
}

// GET theme directly from theme API, bypassing config cache
export async function getThemeFresh(): Promise<NormalizedTheme> {
  try {
    const response = await fetch(`${THEME_API_URL}?cb=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const raw: Theme = await response.json();
    return normalizeTheme(raw);
  } catch (error) {
    console.error('Failed to fetch fresh theme:', error);
    throw error;
  }
}

// PUT update theme — accepts normalized frontend shape, maps logoUrl → logoURL for API
export async function updateTheme(themeData: NormalizedTheme): Promise<NormalizedTheme> {
  try {
    const response = await fetch(THEME_API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryColor: themeData.primaryColor,
        secondaryColor: themeData.secondaryColor,
        logoURL: themeData.logoUrl   // frontend logoUrl → API logoURL
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    const raw: Theme = await response.json();
    return normalizeTheme(raw);
  } catch (error) {
    console.error('Failed to update theme:', error);
    throw error;
  }
}