import type { SelectOption } from './types';

/** Degree options for profile forms */
export const DEGREE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Select degree' },
  { value: 'BS', label: 'BS' },
  { value: 'MS', label: 'MS' },
  { value: 'PhD', label: 'PhD' },
];

/** Major options for profile forms */
export const MAJOR_OPTIONS: SelectOption[] = [
  { value: '', label: 'Select major' },
  { value: 'Management Information Systems', label: 'Management Information Systems' },
  { value: 'Supply Chain Management', label: 'Supply Chain Management' },
  { value: 'Business Analytics', label: 'Business Analytics' },
  { value: 'Accounting', label: 'Accounting' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Management', label: 'Management' },
  { value: 'Other', label: 'Other' },
];

/** UIN must be exactly 9 digits */
export function validateUin(uin: string): boolean {
  if (!uin || typeof uin !== 'string') return false;
  const trimmed = uin.trim();
  return /^\d{9}$/.test(trimmed);
}

const SINGLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One address (trimmed). */
export function validateSingleEmail(email: string): boolean {
  const e = (email ?? '').trim();
  return e.length > 0 && SINGLE_EMAIL_RE.test(e);
}

/**
 * StudentProfiles.email may be a comma-separated list (TAMU + personal after graduation handover).
 * HTML `type="email"` rejects commas, so forms use `type="text"` and validate here.
 */
export function validateEmailCsv(value: string): boolean {
  const raw = (value ?? '').trim();
  if (!raw) return false;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => SINGLE_EMAIL_RE.test(p));
}

/** Normalize CSV emails for API (lowercase, comma+space). */
export function normalizeEmailCsv(value: string): string {
  const parts = (value ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.join(', ');
}
