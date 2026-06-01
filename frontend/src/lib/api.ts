/**
 * Backend API client. See docs/API.md for full API documentation.
 */

import { getCognitoAccessToken, getCognitoIdToken, waitForCognitoIdToken } from './auth';
import { profile } from './stores/profileStore';
import type {
  Profile,
  CreateProfileBody,
  UpdateProfileBody,
  ListProfilesResult,
  ApiResult,
  MasterSkill,
} from './types';

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

function getOptionalEnvUrl(key: string): string | null {
  const v = (import.meta.env as Record<string, unknown>)?.[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

const API_BASE = getApiBase();
const EXTERNAL_API_BASE = getOptionalEnvUrl('VITE_EXTERNAL_API_BASE_URL') ?? `${API_BASE}/external`;
const STUDENT_API_PREFIX = '/student/api';

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // On initial login, the token may not be immediately available. If we send requests
  // without Authorization, the backend returns UNAUTHORIZED and the UI can appear stuck.
  let idToken = await getCognitoIdToken();
  if (!idToken) {
    idToken = await getCognitoIdToken(true);
  }
  if (!idToken) {
    // Last attempt: poll briefly.
    idToken = await waitForCognitoIdToken(2500, 120);
  }
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  return headers;
};

const getExternalAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let accessToken = await getCognitoAccessToken();
  if (!accessToken) {
    accessToken = await getCognitoAccessToken(true);
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
};

export interface GraduationStatus {
  showPrompt: boolean;
  reason?: string;
  role?: string;
  linkedUin?: string | null;
  gradDate?: string;
}

export async function fetchGraduationStatus(gradDate: string): Promise<GraduationStatus | null> {
  try {
    const headers = await getExternalAuthHeaders();
    const params = new URLSearchParams();
    if (gradDate && gradDate.trim()) params.set('gradDate', gradDate.trim());
    const res = await fetch(`${EXTERNAL_API_BASE}/graduation-status?${params.toString()}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as GraduationStatus;
  } catch {
    return null;
  }
}

export async function externalHandoverLookup(uin: string): Promise<ApiResult<{ studentProfile?: unknown }>> {
  try {
    const headers = await getExternalAuthHeaders();
    const qs = new URLSearchParams({ uin: (uin ?? '').trim() }).toString();
    const res = await fetch(`${EXTERNAL_API_BASE}/graduation-handover/lookup?${qs}`, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) || res.statusText, status: res.status, data };
    return { ok: true, data: data as { studentProfile?: unknown } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function externalHandoverLink(body: {
  uin: string;
  personalEmail: string;
  classYear?: string;
}): Promise<ApiResult> {
  try {
    const headers = await getExternalAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/graduation-handover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uin: body.uin,
        personalEmail: body.personalEmail,
        classYear: body.classYear,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) || (data.message as string) || res.statusText, status: res.status, data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

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
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/users/me/profile-exists`, { headers });
    if (res.ok) {
      const data = (await res.json()) as { exists?: boolean };
      return data.exists !== true;
    }

    // Fallback: some transient auth/API errors can make profile-exists return non-2xx.
    // Probe /profiles/me directly to avoid misrouting existing users to blank create form.
    const profileRes = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles/me`, { headers });
    if (profileRes.status === 404) return true;
    if (profileRes.ok) return false;
    return true;
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
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles/me`, { headers });
    if (res.status === 404) return;
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, unknown>;
    profile.set({
      name: (data.name as string) ?? '',
      email: (data.email as string) ?? '',
      uin: (data.uin as string) ?? '',
      staffId: (data.staffId as string) ?? '',
      university: (data.university as string) ?? '',
      degree: (data.degree as string) ?? '',
      major: (data.major as string) ?? '',
      classYear: (data.classYear as string) ?? '',
      gradDate: (data.gradDate as string) ?? '',
      linkedinUrl: (data.linkedInUrl as string) ?? '',
      resumeFileName: data.resumeS3Key ? ((data.resumeS3Key as string).split('/').pop() ?? '') : '',
      resumeS3Key: (data.resumeS3Key as string) ?? '',
      role: (data.role as string) ?? '',
      profileGpa: (data.profileGpa as number | null | undefined) ?? undefined,
      profileEducation: Array.isArray(data.profileEducation)
        ? (data.profileEducation as Profile['profileEducation'])
        : undefined,
      profileSkillKeys: Array.isArray(data.profileSkillKeys)
        ? (data.profileSkillKeys as string[])
        : undefined,
    });
  } catch {
    // ignore
  }
}

/** Derive classYear from gradDate (e.g. "2026-05" -> "26") for backend */
function classYearFromGradDate(gradDate?: string): string {
  if (!gradDate || typeof gradDate !== 'string') return '';
  const y = gradDate.slice(0, 4);
  return y.length === 4 ? y.slice(2) : '';
}

function toProfileFromApi(data: Record<string, unknown>): Profile {
  return {
    name: (data.name as string) ?? '',
    email: (data.email as string) ?? '',
    uin: (data.uin as string) ?? '',
    staffId: (data.staffId as string) ?? '',
    university: (data.university as string) ?? '',
    degree: (data.degree as string) ?? '',
    major: (data.major as string) ?? '',
    classYear: (data.classYear as string) ?? '',
    gradDate: (data.gradDate as string) ?? '',
    linkedinUrl: (data.linkedInUrl as string) ?? '',
    resumeFileName: data.resumeS3Key ? ((data.resumeS3Key as string).split('/').pop() ?? '') : '',
    resumeS3Key: (data.resumeS3Key as string) ?? '',
    role: (data.role as string) ?? '',
    profileGpa: (data.profileGpa as number | null | undefined) ?? undefined,
    profileEducation: Array.isArray(data.profileEducation)
      ? (data.profileEducation as Profile['profileEducation'])
      : undefined,
    profileSkillKeys: Array.isArray(data.profileSkillKeys)
      ? (data.profileSkillKeys as string[])
      : undefined,
  };
}

/**
 * Create a new student profile (first-time sign-in).
 */
export async function createProfile(body: CreateProfileBody): Promise<ApiResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: body.name,
        email: body.email || undefined,
        uin: body.uin || undefined,
        staffId: body.staffId || undefined,
        university: body.university || undefined,
        degree: body.degree || undefined,
        major: body.major || undefined,
        classYear: body.gradDate ? classYearFromGradDate(body.gradDate) : undefined,
        gradDate: body.gradDate || undefined,
        linkedInUrl: body.linkedInUrl || undefined,
        resumeS3Key: body.resumeS3Key || undefined,
        role: body.role || undefined,
        // Include null so clearing GPA persists (do not use ?? which drops null)
        ...(body.profileGpa !== undefined ? { profileGpa: body.profileGpa } : {}),
        ...(body.profileEducation !== undefined ? { profileEducation: body.profileEducation } : {}),
        ...(body.profileSkillKeys !== undefined ? { profileSkillKeys: body.profileSkillKeys } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          `${(data.message as string) || (data.error as string) || res.statusText || 'Failed to create profile'}` +
          ` (status ${res.status})`,
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
    const payload: Record<string, unknown> = {};
    if (body.name !== undefined) payload.name = body.name;
    if (body.email !== undefined) payload.email = body.email;
    if (body.uin !== undefined) payload.uin = body.uin;
    if (body.staffId !== undefined) payload.staffId = body.staffId;
    if (body.university !== undefined) payload.university = body.university;
    if (body.degree !== undefined) payload.degree = body.degree;
    if (body.major !== undefined) payload.major = body.major;
    if (body.gradDate !== undefined) {
      payload.gradDate = body.gradDate;
      payload.classYear = classYearFromGradDate(body.gradDate);
    }
    if (body.linkedInUrl !== undefined) payload.linkedInUrl = body.linkedInUrl;
    if (body.resumeS3Key !== undefined) payload.resumeS3Key = body.resumeS3Key;
    if (body.role !== undefined) payload.role = body.role;
    if (body.profileGpa !== undefined) payload.profileGpa = body.profileGpa;
    if (body.profileEducation !== undefined) payload.profileEducation = body.profileEducation;
    if (body.profileSkillKeys !== undefined) payload.profileSkillKeys = body.profileSkillKeys;
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles/me`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error:
          `${(data.message as string) || (data.error as string) || res.statusText || 'Failed to update profile'}` +
          ` (status ${res.status})`,
      };
    }
    profile.set(toProfileFromApi(data));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

/**
 * Master skills catalog (canonical names) for profile skill multi-select.
 */
export async function fetchMasterSkills(): Promise<
  { ok: true; skills: MasterSkill[] } | { ok: false; error: string }
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/skills`, { headers });
    const data = (await res.json().catch(() => ({}))) as { skills?: MasterSkill[]; message?: string };
    if (!res.ok) {
      return { ok: false, error: data.message || res.statusText || 'Failed to load skills' };
    }
    const skills = Array.isArray(data.skills) ? data.skills : [];
    return { ok: true, skills };
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
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles`, { headers });
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

/**
 * List profiles by role (excluding current user), e.g. role=STUDENT.
 */
export async function listProfilesByRole(role: string): Promise<ListProfilesResult> {
  try {
    const headers = await getAuthHeaders();
    const qs = new URLSearchParams({ role: (role ?? '').trim() }).toString();
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles?${qs}`, { headers });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: false,
        error: (data.message as string) || res.statusText || 'Failed to load profiles by role',
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

/**
 * Update a user's role (admin function).
 */
export async function updateUserRole(userId: string, role: string): Promise<ApiResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}${STUDENT_API_PREFIX}/profiles/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.message as string) || res.statusText || 'Failed to update role',
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}
