/**
 * Partner domain check before non-TAMU email OTP sign-in.
 * Calls admin API GET /domain/{domain}. @tamu.edu skips (Google SSO path).
 */

function extractDomain(email: string): string {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0 || at === e.length - 1) return '';
  return e.slice(at + 1);
}

/** GET URL for admin partner lookup. */
export function resolvePartnerDomainLookupUrl(domain: string): string | null {
  const base = import.meta.env.VITE_ADMIN_API_BASE_URL;
  const companies = import.meta.env.VITE_COMPANIES_API_URL;
  if (typeof base === 'string' && base.trim()) {
    return `${base.trim().replace(/\/+$/, '')}/domain/${encodeURIComponent(domain)}`;
  }
  if (typeof companies === 'string' && companies.includes('/companies')) {
    const root = companies.replace(/\/companies\/?$/, '').replace(/\/+$/, '');
    return `${root}/domain/${encodeURIComponent(domain)}`;
  }
  return null;
}

export type PartnerVerifyResult = { ok: true } | { ok: false; error: string };

/**
 * Non-TAMU: verify domain via GET /domain/{domain}.
 * TAMU: no-op success (Google path does not use this).
 * If admin URL not configured: skip check (dev) with console warning.
 */
export async function verifyPartnerEmailForOtp(email: string): Promise<PartnerVerifyResult> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (normalized.endsWith('@tamu.edu')) {
    return { ok: true };
  }
  const domain = extractDomain(normalized);
  if (!domain) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const url = resolvePartnerDomainLookupUrl(domain);
  if (!url) {
    console.warn(
      '[partner] Set VITE_ADMIN_API_BASE_URL or VITE_COMPANIES_API_URL to enforce partner domain checks before OTP.'
    );
    return { ok: true };
  }
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.status === 404) {
      return {
        ok: false,
        error:
          'This email domain is not registered as a CMIS partner. Sign in with your company email on file with CMIS, or contact your administrator.',
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Partner verification failed (${res.status}). Try again later.` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error)?.message || 'Could not verify partner domain. Check your connection.',
    };
  }
}
