/**
 * Pick GPA for the education row with the latest inferred end date (for profile-level "most recent" GPA).
 */

function parseGpaValue(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Infer a sortable end timestamp from a free-text education date range.
 * Returns milliseconds since epoch, or 0 if unknown (sorted first when ascending — we pick max).
 */
function endMsFromDatesString(datesStr) {
  const s = String(datesStr ?? "").trim();
  if (!s) return 0;

  const years = [];
  const reYear = /\b(19|20)\d{2}\b/g;
  let m;
  while ((m = reYear.exec(s)) !== null) {
    years.push(Number(m[0]));
  }
  if (years.length > 0) {
    const endYear = Math.max(...years);
    let month = 11;
    const monthMatch = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(19|20)\d{2}\b/i);
    if (monthMatch) {
      const monStr = monthMatch[1].toLowerCase();
      const monMap = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      month = monMap[monStr.slice(0, 3)] ?? 11;
    }
    return Date.UTC(endYear, month, 15);
  }

  const slash = s.match(/\b(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const year = Number(slash[2]);
    const month = Math.max(0, Number(slash[1]) - 1);
    return Date.UTC(year, month, 15);
  }

  return 0;
}

/**
 * @param {Array<{ dates?: string, gpa?: unknown }>} education
 * @returns {number|null}
 */
function pickMostRecentGpa(education) {
  if (!Array.isArray(education) || education.length === 0) return null;

  const scored = education.map((e) => ({
    endMs: endMsFromDatesString(e?.dates),
    gpa: parseGpaValue(e?.gpa),
  }));

  let best = null;
  let bestMs = -Infinity;
  for (const row of scored) {
    if (row.gpa == null) continue;
    const ms = row.endMs || 0;
    if (ms >= bestMs) {
      bestMs = ms;
      best = row.gpa;
    }
  }
  return best;
}

module.exports = {
  parseGpaValue,
  endMsFromDatesString,
  pickMostRecentGpa,
};
