/**
 * External Service API client.
 * Set VITE_API_BASE in .env (e.g. https://xxx.execute-api.region.amazonaws.com)
 * or use /api when proxying in dev.
 */
const BASE = import.meta.env.VITE_API_BASE || '/api';

export async function signup({ email, password, formerStudent, classYear }) {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      formerStudent: !!formerStudent,
      classYear: classYear || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ? `${data.error || 'Registration failed'}: ${data.detail}` : (data.error || 'Registration failed'));
  return data;
}

export async function signin({ email, password }) {
  const res = await fetch(`${BASE}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Sign in failed');
  return data;
}

/** Request password reset code (sent to email) */
export async function forgotPassword(email) {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: (email || '').trim().toLowerCase() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/** Reset password with code from email */
export async function resetPassword({ email, code, newPassword }) {
  const res = await fetch(`${BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: (email || '').trim().toLowerCase(),
      code: (code || '').trim(),
      newPassword: newPassword || '',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Reset failed');
  return data;
}

export async function me(accessToken) {
  const res = await fetch(`${BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load profile');
  return data;
}

/** Step 1: Look up student by UIN for verification (returns studentProfile, no link). */
export async function handoverLookup(accessToken, uin) {
  const res = await fetch(`${BASE}/graduation-handover/lookup?uin=${encodeURIComponent(String(uin).trim())}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lookup failed');
  return data;
}

export async function graduationHandover(accessToken, { uin, classYear, personalEmail, password }) {
  const res = await fetch(`${BASE}/graduation-handover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      uin: String(uin).trim(),
      classYear: classYear || undefined,
      personalEmail: (personalEmail || '').trim().toLowerCase() || undefined,
      password: password || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ? `${data.error || 'Handover failed'}: ${data.detail}` : (data.error || 'Handover failed'));
  return data;
}

/** Request magic link for graduate account (self-service). Returns { success, message, magicLink? } */
export async function requestMagicLink(email) {
  const res = await fetch(`${BASE}/graduation-handover/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: (email || '').trim().toLowerCase() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/** Validate magic-link token; returns { email, uin, classYear } if valid */
export async function claimTokenInfo(token) {
  const url = `${BASE}/graduation-handover/claim?token=${encodeURIComponent(token)}`;
  const res = await fetch(url).catch((err) => {
    throw new Error(err?.message === 'Failed to fetch' ? 'Failed to fetch' : (err?.message || 'Network error'));
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Invalid or expired link');
  return data;
}

/** Complete graduation claim with password */
export async function claimWithPassword(token, password) {
  const res = await fetch(`${BASE}/graduation-handover/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Claim failed');
  return data;
}

/** Update profile (classYear, linkedInUrl). PUT /me */
export async function updateMe(accessToken, { classYear, linkedInUrl }) {
  const res = await fetch(`${BASE}/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      classYear: classYear || undefined,
      linkedInUrl: linkedInUrl || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data;
}

/** Admin: GET handover history. Returns { entries } */
export async function handoverHistory(accessToken) {
  const res = await fetch(`${BASE}/graduation-handover/history`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load history');
  return data;
}
