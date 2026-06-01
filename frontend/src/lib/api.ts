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

/** External-service errors often include a `detail` field — show both in the UI. */
function externalApiError(data: Record<string, unknown>, fallback: string, res: Response): string {
  const msg = (data.error as string) || (data.message as string) || res.statusText || fallback;
  const detail = typeof data.detail === 'string' ? data.detail.trim() : '';
  return detail ? `${msg} — ${detail}` : msg;
}

export interface GraduationStatus {
  showPrompt: boolean;
  reason?: string;
  role?: string;
  linkedUin?: string | null;
  gradDate?: string;
}

export interface MentorshipMatchRow {
  mentorUserId?: string;
  menteeUserId?: string;
  mentorName?: string;
  menteeName?: string;
  menteeEmail?: string;
  menteeMajor?: string;
  menteeGradDate?: string;
  menteeSkills?: string[];
  menteeLinkedInUrl?: string | null;
  menteeDegree?: string | null;
  menteeUniversity?: string | null;
  menteeStudentGoals?: string | null;
  menteeMentorshipGoals?: string | null;
  menteeProfileGpa?: number | string | null;
  /** @deprecated Prefer menteeResumeDownloadUrl */
  menteeResumePreview?: string | null;
  menteeResumeDownloadUrl?: string | null;
  menteeResumeFileName?: string | null;
  menteeEducationSummary?: string | null;
  /** Gold/Silver/none for this mentor on mentee match cards (from GET /mentorship/mentee/matches). */
  mentorBoard?: MentorshipMentorBoardInfo;
  /** Populated for mentee view after mentor confirms a match (CHANNEL_OPENED). */
  mentorEmail?: string;
  mentorCompany?: string | null;
  mentorJobTitle?: string | null;
  mentorIndustries?: string[];
  mentorMajor?: string | null;
  mentorDegree?: string | null;
  mentorLinkedInUrl?: string | null;
  similarityScore?: number;
  semanticScore?: number;
  ruleScore?: number;
  finalScore?: number;
  baseFinalScore?: number;
  boostedScore?: number;
  mentorBoardTier?: string;
  mentorBoardMultiplier?: number;
  mentorBoardReason?: string;
  matchedSignals?: string[];
  reasonSummary?: string;
  skillGapOpportunities?: { skill?: string; rationale?: string }[];
  suggestedIcebreaker?: string;
  status?: string;
  channelId?: string;
  requestedBy?: string;
  declineReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MentorshipEmbeddingConfigPayload {
  status?: string;
  meta?: Record<string, unknown>;
  probe_dimensions?: number;
  error?: string;
}

export interface MentorshipMentorBoardInfo {
  tier?: string;
  multiplier?: number;
  reason?: string;
}

/** Shown to mentees so they know program caps (e.g. concurrent active mentors). */
export interface MentorshipMenteeProgramLimits {
  maxActiveMentorMatches?: number;
  activeOpenedCount?: number;
}

export interface MentorshipMenteeStatusPayload {
  state?: 'MATCHING_IN_PROGRESS' | 'MATCHED';
  isMatching?: boolean;
  matchedMentor?: MentorshipMatchRow | null;
  updatedAt?: string;
  matches?: MentorshipMatchRow[];
  count?: number;
  menteeProgramLimits?: MentorshipMenteeProgramLimits;
}

/** Normalize mentorBoard from external-service JSON (handles string decimals). */
function parseMentorBoardPayload(mb: unknown): MentorshipMentorBoardInfo | undefined {
  if (!mb || typeof mb !== 'object') return undefined;
  const o = mb as Record<string, unknown>;
  const tier = typeof o.tier === 'string' ? o.tier : undefined;
  let multiplier: number | undefined;
  if (typeof o.multiplier === 'number' && Number.isFinite(o.multiplier)) multiplier = o.multiplier;
  else if (typeof o.multiplier === 'string') {
    const n = parseFloat(o.multiplier);
    if (Number.isFinite(n)) multiplier = n;
  }
  const reason = typeof o.reason === 'string' ? o.reason : undefined;
  if (tier === undefined && multiplier === undefined && !(reason && reason.trim())) return undefined;
  return { tier, multiplier, reason };
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

export interface MentorshipAllocatorMeta {
  exclusiveLocks?: number;
  note?: string;
}

export interface MentorshipRankedPreviewRow {
  menteeUserId?: string;
  menteeName?: string;
  matchPercent?: number;
  isAvailableToMatch?: boolean;
  availabilityReason?: string;
  reasonSummary?: string;
}

export async function fetchMentorshipCandidates(): Promise<
  ApiResult<{
    candidates: MentorshipMatchRow[];
    totalCandidates: number;
    rankedPreview?: MentorshipRankedPreviewRow[];
    mentorBoard?: MentorshipMentorBoardInfo;
    mentorPauseUntil?: string | null;
    mentorPaused?: boolean;
    allocator?: MentorshipAllocatorMeta;
  }>
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/candidates`, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: externalApiError(data, 'Failed to load mentee suggestions', res),
        status: res.status,
        data: data as {
          candidates: MentorshipMatchRow[];
          totalCandidates: number;
          rankedPreview?: MentorshipRankedPreviewRow[];
          mentorBoard?: MentorshipMentorBoardInfo;
          mentorPauseUntil?: string | null;
          mentorPaused?: boolean;
          allocator?: MentorshipAllocatorMeta;
        },
      };
    }
    const candidates = (data.candidates as MentorshipMatchRow[]) || [];
    const totalCandidates = typeof data.totalCandidates === 'number' ? data.totalCandidates : candidates.length;
    const rankedPreview = (data.rankedPreview as MentorshipRankedPreviewRow[]) || [];
    const mentorBoard = parseMentorBoardPayload(data.mentorBoard);
    const mentorPauseUntil =
      data.mentorPauseUntil == null || data.mentorPauseUntil === '' ? null : String(data.mentorPauseUntil);
    const mentorPaused = typeof data.mentorPaused === 'boolean' ? data.mentorPaused : undefined;
    const allocator = data.allocator as MentorshipAllocatorMeta | undefined;

    return {
      ok: true,
      data: {
        candidates,
        totalCandidates,
        rankedPreview,
        mentorBoard,
        mentorPauseUntil,
        mentorPaused,
        allocator,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function putMentorshipMentorPause(body: {
  until?: string;
  clear?: boolean;
  /** When setting `until`, skip all SUGGESTED/PENDING rows so mentees return to the admin pool. */
  clearActiveSuggestions?: boolean;
}): Promise<
  ApiResult<{
    mentorPauseUntil?: string | null;
    mentorPaused?: boolean;
    cleared?: boolean;
    clearedSuggestions?: { skippedRows?: number };
  }>
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/mentor/pause`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || (data.message as string) || res.statusText || 'Failed to update mentor pause',
        status: res.status,
        data: data as { mentorPauseUntil?: string | null; mentorPaused?: boolean },
      };
    }
    return {
      ok: true,
      data: data as { mentorPauseUntil?: string | null; mentorPaused?: boolean; cleared?: boolean },
    };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function fetchMentorshipEmbeddingConfig(): Promise<
  ApiResult<MentorshipEmbeddingConfigPayload>
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/embedding-config`, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || (data.message as string) || res.statusText || 'Failed to load embedding config',
        status: res.status,
        data: data as MentorshipEmbeddingConfigPayload,
      };
    }
    return { ok: true, data: data as MentorshipEmbeddingConfigPayload };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function fetchMentorshipMenteeMatches(): Promise<ApiResult<MentorshipMenteeStatusPayload>> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/mentee/matches`, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: externalApiError(data, 'Failed to load your mentorship status', res),
        status: res.status,
        data: data as MentorshipMenteeStatusPayload,
      };
    }
    const stateRaw = typeof data.state === 'string' ? data.state : '';
    const state: 'MATCHING_IN_PROGRESS' | 'MATCHED' =
      stateRaw === 'MATCHED' ? 'MATCHED' : 'MATCHING_IN_PROGRESS';

    const matchedMentorRaw =
      data.matchedMentor && typeof data.matchedMentor === 'object'
        ? (data.matchedMentor as MentorshipMatchRow)
        : null;
    const matchedMentor = matchedMentorRaw
      ? (() => {
          const parsed = parseMentorBoardPayload((matchedMentorRaw as unknown as Record<string, unknown>).mentorBoard);
          return parsed ? { ...matchedMentorRaw, mentorBoard: parsed } : matchedMentorRaw;
        })()
      : null;

    const limRaw = data.menteeProgramLimits;
    let menteeProgramLimits: MentorshipMenteeProgramLimits | undefined;
    if (limRaw && typeof limRaw === 'object') {
      const lo = limRaw as Record<string, unknown>;
      const maxActiveMentorMatches =
        typeof lo.maxActiveMentorMatches === 'number' && Number.isFinite(lo.maxActiveMentorMatches)
          ? lo.maxActiveMentorMatches
          : undefined;
      const activeOpenedCount =
        typeof lo.activeOpenedCount === 'number' && Number.isFinite(lo.activeOpenedCount)
          ? lo.activeOpenedCount
          : undefined;
      if (maxActiveMentorMatches != null || activeOpenedCount != null) {
        menteeProgramLimits = { maxActiveMentorMatches, activeOpenedCount };
      }
    }

    const payload: MentorshipMenteeStatusPayload = {
      state,
      isMatching: typeof data.isMatching === 'boolean' ? data.isMatching : state !== 'MATCHED',
      matchedMentor,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      matches: matchedMentor ? [matchedMentor] : [],
      count: matchedMentor ? 1 : 0,
      menteeProgramLimits,
    };
    return { ok: true, data: payload };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function reviveMentorshipMatch(menteeUserId: string): Promise<ApiResult<{ revived?: MentorshipMatchRow }>> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/matches/${encodeURIComponent(menteeUserId)}/revive`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data.error as string) || (data.message as string) || res.statusText || 'Failed to revive match';
      const detail = typeof data.detail === 'string' ? data.detail : '';
      return {
        ok: false,
        error: detail ? `${msg} — ${detail}` : msg,
        status: res.status,
        data: data as { revived?: MentorshipMatchRow },
      };
    }
    return { ok: true, data: data as { revived?: MentorshipMatchRow } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function declineMentorshipMatch(
  menteeUserId: string,
  reason?: string,
): Promise<ApiResult<{ declined?: MentorshipMatchRow }>> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/matches/${encodeURIComponent(menteeUserId)}/decline`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || (data.message as string) || res.statusText || 'Failed to decline',
        status: res.status,
        data: data as { declined?: MentorshipMatchRow },
      };
    }
    return { ok: true, data: data as { declined?: MentorshipMatchRow } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function fetchMentorshipMatches(): Promise<
  ApiResult<{
    matches: MentorshipMatchRow[];
    count: number;
    mentorBoard?: MentorshipMentorBoardInfo;
    mentorPauseUntil?: string | null;
    mentorPaused?: boolean;
  }>
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/matches`, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: externalApiError(data, 'Failed to load matches', res),
        status: res.status,
        data: data as {
          matches: MentorshipMatchRow[];
          count: number;
          mentorBoard?: MentorshipMentorBoardInfo;
          mentorPauseUntil?: string | null;
          mentorPaused?: boolean;
        },
      };
    }
    const matches = (data.matches as MentorshipMatchRow[]) || [];
    const count = typeof data.count === 'number' ? data.count : matches.length;
    const mentorBoard = parseMentorBoardPayload(data.mentorBoard);
    const mentorPauseUntil =
      data.mentorPauseUntil == null || data.mentorPauseUntil === '' ? null : String(data.mentorPauseUntil);
    const mentorPaused = typeof data.mentorPaused === 'boolean' ? data.mentorPaused : undefined;
    return { ok: true, data: { matches, count, mentorBoard, mentorPauseUntil, mentorPaused } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

/** Mentor + mentee canonical profile embeddings (persisted in DynamoDB by external-service). */
export interface MentorshipProfileEmbeddingBlock {
  profileKind?: string;
  dimensions?: number;
  vector?: number[];
  canonicalTextPreview?: string;
  embeddingMeta?: Record<string, unknown>;
  updatedAt?: string;
}

export async function fetchMentorshipProfileEmbeddings(options?: {
  refresh?: boolean;
  includeVector?: boolean;
}): Promise<
  ApiResult<{
    ok?: boolean;
    userId?: string;
    source?: string;
    mentor?: MentorshipProfileEmbeddingBlock;
    mentee?: MentorshipProfileEmbeddingBlock;
    embeddingMeta?: Record<string, unknown>;
    error?: string;
    detail?: string;
  }>
> {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (options?.refresh) params.set('refresh', 'true');
    if (options?.includeVector === false) params.set('includeVector', 'false');
    const qs = params.toString();
    const url = `${EXTERNAL_API_BASE}/mentorship/embeddings/me${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || (data.message as string) || res.statusText || 'Failed to load profile embeddings',
        status: res.status,
        data: data as { ok?: boolean; detail?: string },
      };
    }
    return { ok: true, data: data as { ok?: boolean; userId?: string; source?: string; mentor?: MentorshipProfileEmbeddingBlock; mentee?: MentorshipProfileEmbeddingBlock } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function acceptMentorshipMatch(menteeUserId: string): Promise<
  ApiResult<{
    accepted?: MentorshipMatchRow;
    email?: { sent?: boolean; mode?: string; detail?: string };
  }>
> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/matches/${encodeURIComponent(menteeUserId)}/accept`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data.error as string) || (data.message as string) || res.statusText || 'Failed to accept match';
      const detail = typeof data.detail === 'string' ? data.detail : '';
      return {
        ok: false,
        error: detail ? `${msg} — ${detail}` : msg,
        status: res.status,
        data: data as {
          accepted?: MentorshipMatchRow;
          email?: { sent?: boolean; mode?: string; detail?: string };
          detail?: string;
          code?: string;
        },
      };
    }
    return {
      ok: true,
      data: data as {
        accepted?: MentorshipMatchRow;
        email?: { sent?: boolean; mode?: string; detail?: string };
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
  }
}

export async function skipMentorshipMatch(menteeUserId: string): Promise<ApiResult<{ skipped?: MentorshipMatchRow }>> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${EXTERNAL_API_BASE}/mentorship/matches/${encodeURIComponent(menteeUserId)}/skip`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: (data.error as string) || (data.message as string) || res.statusText || 'Failed to skip candidate',
        status: res.status,
      };
    }
    return { ok: true, data: data as { skipped?: MentorshipMatchRow } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error' };
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
    profile.set(toProfileFromApi(data));
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
  const mi = data.mentorshipInterested;
  const cap = data.mentorCapacity;
  const mship = data.mentorship;
  const mentorYears = data.mentorYearsExperience;
  const reminderOptIn = data.reminderOptIn;
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
    mentorshipInterested: typeof mi === 'boolean' ? mi : undefined,
    mentorship: mship === 'mentee' || mship === 'mentor' ? mship : mship === null ? null : undefined,
    mentorCapacity: typeof cap === 'number' && Number.isInteger(cap) ? cap : cap === null ? null : undefined,
    mentorSkills: Array.isArray(data.mentorSkills) ? (data.mentorSkills as string[]) : undefined,
    mentorIndustries: Array.isArray(data.mentorIndustries) ? (data.mentorIndustries as string[]) : undefined,
    mentorCompany: typeof data.mentorCompany === 'string' ? data.mentorCompany : data.mentorCompany === null ? null : undefined,
    mentorJobTitle: typeof data.mentorJobTitle === 'string' ? data.mentorJobTitle : data.mentorJobTitle === null ? null : undefined,
    mentorYearsExperience:
      typeof mentorYears === 'number' && Number.isInteger(mentorYears)
        ? mentorYears
        : mentorYears === null
          ? null
          : undefined,
    mentorshipGoals:
      typeof data.mentorshipGoals === 'string'
        ? data.mentorshipGoals
        : data.mentorshipGoals === null
          ? null
          : undefined,
    studentGoals:
      typeof data.studentGoals === 'string'
        ? data.studentGoals
        : data.studentGoals === null
          ? null
          : undefined,
    mentorBio:
      typeof data.mentorBio === 'string'
        ? data.mentorBio
        : data.mentorBio === null
          ? null
          : undefined,
    mentorshipMentorPauseUntil:
      typeof data.mentorshipMentorPauseUntil === 'string'
        ? data.mentorshipMentorPauseUntil
        : data.mentorshipMentorPauseUntil === null
          ? null
          : undefined,
    reminderOptIn:
      typeof reminderOptIn === 'boolean'
        ? reminderOptIn
        : reminderOptIn == null
          ? true
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
        mentorshipInterested: body.mentorshipInterested,
        mentorship: body.mentorship ?? undefined,
        mentorCapacity: body.mentorCapacity ?? undefined,
        ...(body.mentorSkills !== undefined ? { mentorSkills: body.mentorSkills } : {}),
        ...(body.mentorIndustries !== undefined ? { mentorIndustries: body.mentorIndustries } : {}),
        ...(body.mentorCompany !== undefined ? { mentorCompany: body.mentorCompany } : {}),
        ...(body.mentorJobTitle !== undefined ? { mentorJobTitle: body.mentorJobTitle } : {}),
        ...(body.mentorYearsExperience !== undefined ? { mentorYearsExperience: body.mentorYearsExperience } : {}),
        ...(body.mentorshipGoals !== undefined ? { mentorshipGoals: body.mentorshipGoals } : {}),
        ...(body.studentGoals !== undefined ? { studentGoals: body.studentGoals } : {}),
        ...(body.mentorBio !== undefined ? { mentorBio: body.mentorBio } : {}),
        ...(body.reminderOptIn !== undefined ? { reminderOptIn: body.reminderOptIn } : {}),
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
    if (body.mentorshipInterested !== undefined) payload.mentorshipInterested = body.mentorshipInterested;
    if (body.mentorship !== undefined) payload.mentorship = body.mentorship;
    if (body.mentorCapacity !== undefined) payload.mentorCapacity = body.mentorCapacity;
    if (body.mentorSkills !== undefined) payload.mentorSkills = body.mentorSkills;
    if (body.mentorIndustries !== undefined) payload.mentorIndustries = body.mentorIndustries;
    if (body.mentorCompany !== undefined) payload.mentorCompany = body.mentorCompany;
    if (body.mentorJobTitle !== undefined) payload.mentorJobTitle = body.mentorJobTitle;
    if (body.mentorYearsExperience !== undefined) payload.mentorYearsExperience = body.mentorYearsExperience;
    if (body.mentorshipGoals !== undefined) payload.mentorshipGoals = body.mentorshipGoals;
    if (body.studentGoals !== undefined) payload.studentGoals = body.studentGoals;
    if (body.mentorBio !== undefined) payload.mentorBio = body.mentorBio;
    if (body.reminderOptIn !== undefined) payload.reminderOptIn = body.reminderOptIn;
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
