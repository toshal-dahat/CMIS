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
