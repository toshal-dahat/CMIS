import type { ProfileEducationEntry } from './types';

function parseEducationGpa(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

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
    gpa: parseEducationGpa((e as { gpa?: unknown })?.gpa),
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
      gpa: parseEducationGpa((e as { gpa?: unknown })?.gpa),
    }))
    .filter((e) => e.institution || e.degree || e.field || e.dates || e.details || e.gpa != null);
}

/** English month prefix → 0–11 (for parsing "May 2025" style dates). */
const MONTH_PREFIX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Higher = more recent end of program. Used to pick which education row is "most recent".
 * Parses common resume strings: "Aug 2023 – May 2025", "2018-2022", ISO fragments, "Present".
 */
export function parseEducationDatesEndMs(dates: string): number {
  const s = (dates ?? '').trim();
  if (!s) return 0;
  const lower = s.toLowerCase();
  if (/\b(present|current|now)\b/.test(lower)) {
    return Date.now();
  }

  const isoRe = /\b(20\d{2}|19\d{2})-(\d{2})(?:-(\d{2}))?\b/g;
  let isoLastMs = 0;
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(s)) !== null) {
    const y = Number.parseInt(m[1] ?? '', 10);
    const mo = Number.parseInt(m[2] ?? '1', 10) - 1;
    const d = m[3] ? Number.parseInt(m[3], 10) : new Date(y, mo + 1, 0).getDate();
    const t = new Date(y, mo, Math.min(d || 1, 31)).getTime();
    if (Number.isFinite(t) && t > isoLastMs) isoLastMs = t;
  }
  if (isoLastMs > 0) return isoLastMs;

  const yearRe = /\b(?:19|20)\d{2}\b/g;
  const years: number[] = [];
  while ((m = yearRe.exec(s)) !== null) {
    years.push(Number.parseInt(m[0], 10));
  }
  if (years.length > 0) {
    const maxY = Math.max(...years);
    return Date.UTC(maxY, 11, 31);
  }

  const monYearRe = /\b([A-Za-z]{3,9})\s+((?:19|20)\d{2})\b/g;
  let myLastMs = 0;
  while ((m = monYearRe.exec(s)) !== null) {
    const monKey = m[1].toLowerCase().slice(0, 3);
    const mon = MONTH_PREFIX[monKey];
    if (mon == null) continue;
    const y = Number.parseInt(m[2], 10);
    const t = Date.UTC(y, mon, 28);
    if (Number.isFinite(t) && t > myLastMs) myLastMs = t;
  }
  if (myLastMs > 0) return myLastMs;

  return 0;
}

/**
 * GPA from the education row with the latest end date (from `dates`).
 * If dates cannot be compared, falls back to the last entry in the list.
 */
export function gpaFromMostRecentEducation(entries: ProfileEducationEntry[]): number | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let bestIdx = 0;
  let bestMs = parseEducationDatesEndMs(entries[0]?.dates ?? '');
  for (let i = 1; i < entries.length; i++) {
    const ms = parseEducationDatesEndMs(entries[i]?.dates ?? '');
    if (ms > bestMs) {
      bestMs = ms;
      bestIdx = i;
    } else if (ms === bestMs && ms > 0) {
      bestIdx = i;
    }
  }

  if (bestMs <= 0) {
    const last = entries[entries.length - 1];
    return parseEducationGpa((last as { gpa?: unknown })?.gpa);
  }

  return parseEducationGpa((entries[bestIdx] as { gpa?: unknown })?.gpa);
}

/** Backward compatibility: move legacy top-level profile GPA to first education row when needed. */
export function mergeLegacyProfileGpaIntoEducation(
  entries: ProfileEducationEntry[],
  legacyProfileGpa: unknown
): ProfileEducationEntry[] {
  const legacyGpa = parseEducationGpa(legacyProfileGpa);
  if (legacyGpa == null) return entries;
  if (entries.some((e) => parseEducationGpa((e as { gpa?: unknown })?.gpa) != null)) return entries;
  if (entries.length === 0) return [{ ...emptyEducationEntry(), gpa: legacyGpa }];
  return entries.map((e, idx) => (idx === 0 ? { ...e, gpa: legacyGpa } : e));
}
