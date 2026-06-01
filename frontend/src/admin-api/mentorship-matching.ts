import { getCognitoAccessToken } from '../lib/auth';

function getExternalBase(): string {
  const external = (import.meta.env?.VITE_EXTERNAL_API_BASE_URL as string | undefined)?.trim();
  if (external) return external.replace(/\/+$/, '');
  const apiBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();
  if (!apiBase) throw new Error('VITE_EXTERNAL_API_BASE_URL or VITE_API_BASE_URL must be set');
  return `${apiBase.replace(/\/+$/, '')}/external`;
}

const EXTERNAL_BASE = getExternalBase();

async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await getCognitoAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function buildError(data: Record<string, unknown>, fallback: string): Error {
  const msg = (data.error as string) || (data.message as string) || fallback;
  const detail = typeof data.detail === 'string' ? data.detail.trim() : '';
  return new Error(detail ? `${msg} — ${detail}` : msg);
}

export interface MentorshipMatchingRunSummary {
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  status?: string;
  triggerSource?: string;
  snapshotSummary?: { pairCount?: number; mentorCount?: number } | null;
}

export interface MentorshipMatchingRunDetail {
  accepted?: boolean;
  requestId?: string;
  queuedAt?: string;
  runId?: string;
  kind?: string;
  status?: string;
  triggerSource?: string;
  startedAt?: string;
  finishedAt?: string;
  reset?: { ok?: boolean; deletedMatchRows?: number };
  batch?: Record<string, unknown> | null;
  snapshotSummary?: { pairCount?: number; mentorCount?: number };
  snapshot?: {
    pairs?: Array<Record<string, unknown>>;
    mentors?: Array<Record<string, unknown>>;
    pairCount?: number;
  };
}

export interface MentorshipMatchingSchedule {
  enabled?: boolean;
  cronExpression?: string;
  timezone?: string;
  updatedAt?: string;
  updatedBy?: string;
  lastTriggeredAt?: string;
  lastTriggeredSlot?: string;
  persistenceEnabled?: boolean;
  source?: string;
}

export async function startMentorshipMatchingRun(body?: {
  resetMatches?: boolean;
  runBatchMatching?: boolean;
}): Promise<MentorshipMatchingRunDetail> {
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/matching-runs`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      resetMatches: !!body?.resetMatches,
      runBatchMatching: body?.runBatchMatching !== false,
    }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to run mentorship matching');
  return data as unknown as MentorshipMatchingRunDetail;
}

export async function listMentorshipMatchingRuns(limit = 25): Promise<{
  runs: MentorshipMatchingRunSummary[];
  persistenceEnabled?: boolean;
}> {
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/matching-runs?limit=${encodeURIComponent(String(limit))}`, {
    headers: await authHeaders(),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to load matching run history');
  return {
    runs: ((data.runs as MentorshipMatchingRunSummary[]) || []).slice(),
    persistenceEnabled: Boolean(data.persistenceEnabled),
  };
}

export async function getLatestMentorshipMatchingRun(): Promise<{
  run?: MentorshipMatchingRunDetail;
  persistenceEnabled?: boolean;
}> {
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/matching-runs/latest`, {
    headers: await authHeaders(),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to load latest matching run');
  return {
    run: data.run as MentorshipMatchingRunDetail,
    persistenceEnabled: Boolean(data.persistenceEnabled),
  };
}

export async function getMentorshipMatchingRunById(runId: string): Promise<{
  run?: MentorshipMatchingRunDetail;
  persistenceEnabled?: boolean;
}> {
  const rid = String(runId || '').trim();
  if (!rid) throw new Error('runId is required');
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/matching-runs/${encodeURIComponent(rid)}`, {
    headers: await authHeaders(),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to load matching run');
  return {
    run: data.run as MentorshipMatchingRunDetail,
    persistenceEnabled: Boolean(data.persistenceEnabled),
  };
}

export async function getMentorshipMatchingSchedule(): Promise<MentorshipMatchingSchedule> {
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/schedule`, {
    headers: await authHeaders(),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to load mentorship schedule');
  return data as MentorshipMatchingSchedule;
}

export async function putMentorshipMatchingSchedule(body: {
  enabled: boolean;
  cronExpression?: string;
  timezone?: string;
}): Promise<MentorshipMatchingSchedule> {
  const res = await fetch(`${EXTERNAL_BASE}/mentorship/admin/schedule`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({
      enabled: !!body.enabled,
      cronExpression: body.cronExpression,
      timezone: body.timezone,
    }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) throw buildError(data, 'Failed to update mentorship schedule');
  return data as MentorshipMatchingSchedule;
}
