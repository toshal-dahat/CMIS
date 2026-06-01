import { writable } from 'svelte/store';
import type { NormalizedTheme } from '../../admin-api/theme';

/** Default theme (TAMU maroon and warm background) */
const defaultTheme: NormalizedTheme = {
  primaryColor: '#500000',
  secondaryColor: '#faf8f6',
  logoUrl: ''
};

/** Current theme store - holds primaryColor, secondaryColor, and logoUrl */
export const currentTheme = writable<NormalizedTheme>(defaultTheme);