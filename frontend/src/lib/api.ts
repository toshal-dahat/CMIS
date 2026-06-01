/**
 * Backend API client. See docs/API.md for full API documentation.
 */

import { getCognitoIdToken } from './auth';
import { profile } from './stores/profileStore';
import type { Profile, CreateProfileBody, UpdateProfileBody, ListProfilesResult, ApiResult } from './types';

/**
 * API base URL from env (no trailing slash). Throws if VITE_API_BASE_URL is missing.
 */
export function getApiBase(): string {
  const u = import.meta.env?.VITE_API_BASE_URL;
  if (typeof u !== 'string' || !u.trim()) {
    throw new Error('VITE_API_BASE_URL must be set in .env');
  }
  return u.trim().replace(/\/+$/, '');
}

const API_BASE = getApiBase();

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const idToken = await getCognitoIdToken();
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  return headers;
};

/** User with userId (e.g. from getAuthUser()) */
interface UserWithId {
  userId?: string;
}

/**
 * Check if the signed-in user has a profile (first-time vs returning).
 * Used after sign-in: first-time → profile form, else → landing with profile fetched.
 */
export async function checkIsFirstTimeSignIn(user: UserWithId): Promise<boolean> {
  if (!user?.userId) return true;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/users/me/profile-exists`, { headers });
    if (!res.ok) return true;
    const data = (await res.json()) as { exists?: boolean };
    return data.exists !== true;
  } catch {
    return true;
  }
}

/**
 * Fetch current user's profile from backend and populate profile store.
 * Called after sign-in when user is not first-time.
 */
export async function fetchUserProfile(_user?: UserWithId): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/profiles/me`, { headers });
    if (res.status === 404) return;
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, unknown>;
    profile.set({
      name: (data.name as string) ?? '',
      email: (data.email as string) ?? '',
      uin: (data.uin as string) ?? '',
      degree: (data.degree as string) ?? '',
      major: (data.major as string) ?? '',
      classYear: (data.classYear as string) ?? '',
      gradDate: (data.gradDate as string) ?? '',
      linkedinUrl: (data.linkedInUrl as string) ?? '',
      resumeFileName: data.resumeS3Key ? ((data.resumeS3Key as string).split('/').pop() ?? '') : '',
      resumeS3Key: (data.resumeS3Key as string) ?? '',
    });
  } catch {
    // ignore
  }
}

/** Derive classYear from gradDate (e.g. "2026-05" -> "26") for backend */
function classYearFromGradDate(gradDate: string): string {
  if (!gradDate || typeof gradDate !== 'string') return '';
  const y = gradDate.slice(0, 4);
  return y.length === 4 ? y.slice(2) : '';
}

function toProfileFromApi(data: Record<string, unknown>): Profile {
  return {
    name: (data.name as string) ?? '',
    email: (data.email as string) ?? '',
    uin: (data.uin as string) ?? '',
    degree: (data.degree as string) ?? '',
    major: (data.major as string) ?? '',
    classYear: (data.classYear as string) ?? '',
    gradDate: (data.gradDate as string) ?? '',
    linkedinUrl: (data.linkedInUrl as string) ?? '',
    resumeFileName: data.resumeS3Key ? ((data.resumeS3Key as string).split('/').pop() ?? '') : '',
    resumeS3Key: (data.resumeS3Key as string) ?? '',
  };
}

/**
 * Create a new student profile (first-time sign-in).
 */
export async function createProfile(body: CreateProfileBody): Promise<ApiResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: body.name,
        email: body.email || undefined,
        uin: body.uin,
        degree: body.degree || undefined,
        major: body.major,
        classYear: classYearFromGradDate(body.gradDate),
        gradDate: body.gradDate,
        linkedInUrl: body.linkedInUrl || undefined,
        resumeS3Key: body.resumeS3Key || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.message as string) || res.statusText || 'Failed to create profile',
      };
    }
    profile.set(toProfileFromApi(data));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

/**
 * Update current user's profile (partial update).
 */
export async function updateProfile(body: UpdateProfileBody): Promise<ApiResult> {
  try {
    const headers = await getAuthHeaders();
    const payload: Record<string, string> = {};
    if (body.name !== undefined) payload.name = body.name;
    if (body.email !== undefined) payload.email = body.email;
    if (body.uin !== undefined) payload.uin = body.uin;
    if (body.degree !== undefined) payload.degree = body.degree;
    if (body.major !== undefined) payload.major = body.major;
    if (body.gradDate !== undefined) {
      payload.gradDate = body.gradDate;
      payload.classYear = classYearFromGradDate(body.gradDate);
    }
    if (body.linkedInUrl !== undefined) payload.linkedInUrl = body.linkedInUrl;
    if (body.resumeS3Key !== undefined) payload.resumeS3Key = body.resumeS3Key;
    const res = await fetch(`${API_BASE}/api/profiles/me`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.message as string) || res.statusText || 'Failed to update profile',
      };
    }
    profile.set(toProfileFromApi(data));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

/**
 * List student profiles (excluding current user). Backend returns all profiles; filtering is done on the frontend.
 */
export async function listProfiles(): Promise<ListProfilesResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/profiles`, { headers });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: false,
        error: (data.message as string) || res.statusText || 'Failed to load students',
      };
    }
    const data = (await res.json()) as { profiles?: unknown[] } | unknown[];
    const profiles = Array.isArray(data)
      ? data
      : Array.isArray((data as { profiles?: unknown[] }).profiles)
        ? (data as { profiles: unknown[] }).profiles
        : [];
    return { ok: true, profiles: profiles as ListProfilesResult['profiles'] };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error', profiles: [] };
  }
}
