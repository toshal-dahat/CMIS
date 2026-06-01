import type { ProfileEducationEntry } from './types';

export function emptyEducationEntry(): ProfileEducationEntry {
  return { institution: '', degree: '', field: '', dates: '', details: '', gpa: null };
}

export function cloneEducationEntries(
  raw: ProfileEducationEntry[] | undefined
): ProfileEducationEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((e) => ({
    institution: e?.institution ?? '',
    degree: e?.degree ?? '',
    field: e?.field ?? '',
    dates: e?.dates ?? '',
    details: e?.details ?? '',
    gpa: e?.gpa == null ? null : Number(e.gpa),
  }));
}

/** Strips empty rows (no field filled) before save. */
export function normalizeEducationForSubmit(entries: ProfileEducationEntry[]): ProfileEducationEntry[] {
  return entries
    .map((e) => ({
      institution: (e?.institution ?? '').trim(),
      degree: (e?.degree ?? '').trim(),
      field: (e?.field ?? '').trim(),
      dates: (e?.dates ?? '').trim(),
      details: (e?.details ?? '').trim(),
      gpa:
        e?.gpa == null || String(e.gpa).trim() === ''
          ? null
          : Number.isFinite(Number(e.gpa))
            ? Number(e.gpa)
            : null,
    }))
    .filter((e) => e.institution || e.degree || e.field || e.dates || e.details || e.gpa != null);
}
