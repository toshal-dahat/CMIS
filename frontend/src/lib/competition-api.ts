/**
 * Competition Service API client
 * Follows the same pattern as events-api.ts
 */

const COMPETITION_API_URL = import.meta.env.VITE_COMPETITION_API_URL;

// ── Types ──────────────────────────────────────────────

export interface Criterion {
    key: string;
    label: string;
    min?: number;
    max?: number;
    weight?: number;
}

export interface Competition {
    competitionId: string;
    name: string;
    description: string;
    submissionDeadline: string | null;
    feedbackReleaseDate: string | null;
    status: string;
    rubric?: Criterion[];
    createdAt: string;
    updatedAt: string;
}

export interface Team {
    competitionId: string;
    teamId: string;
    teamName: string;
    members: string[];
    createdAt: string;
    /** Enriched by the judge teams endpoint */
    hasSubmission?: boolean;
    submittedAt?: string | null;
    gradingStatus?: 'GRADED' | 'PENDING';
    score?: Score | null;
}

export interface JudgeAssignment {
    competitionId: string;
    judgeUserId: string;
    judgeName: string;
    judgeEmail: string;
    teamIds: string[];
    assignedAt: string;
}

export interface Score {
    competitionId_teamId: string;
    competitionId: string;
    teamId: string;
    judgeUserId: string;
    ratings: Record<string, number>;
    feedback: string;
    status: string;
    gradedAt: string;
    updatedAt: string;
}

export interface SubmissionDownload {
    downloadUrl: string;
    expiresInSeconds: number;
    submission: {
        competitionId: string;
        teamId: string;
        s3Key: string;
        fileName: string;
        fileType: string;
        submittedAt: string;
    };
}

// ── Helpers ────────────────────────────────────────────

import { getCognitoIdToken } from './auth';

async function authHeaders(): Promise<HeadersInit> {
    const token = await getCognitoIdToken() || '';
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
    return res.json();
}

// ── Competition CRUD ──────────────────────────────────

export async function listCompetitions(): Promise<Competition[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions`, {
        headers: await authHeaders(),
    });
    return handleResponse<Competition[]>(res);
}

export async function getCompetition(competitionId: string): Promise<Competition> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}`, {
        headers: await authHeaders(),
    });
    return handleResponse<Competition>(res);
}

export async function createCompetition(payload: Partial<Competition>): Promise<Competition> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Competition>(res);
}

// ── Teams ─────────────────────────────────────────────

export async function listTeams(competitionId: string): Promise<Team[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams`, {
        headers: await authHeaders(),
    });
    return handleResponse<Team[]>(res);
}

export async function createTeam(competitionId: string, payload: { teamName: string; members?: string[] }): Promise<Team> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Team>(res);
}

// ── Judge Assignments ─────────────────────────────────

export async function getMyAssignments(): Promise<JudgeAssignment[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/judge/assignments`, {
        headers: await authHeaders(),
    });
    return handleResponse<JudgeAssignment[]>(res);
}

export async function getMyTeams(competitionId: string): Promise<Team[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/judge/competitions/${competitionId}/teams`, {
        headers: await authHeaders(),
    });
    return handleResponse<Team[]>(res);
}

export async function assignJudge(competitionId: string, payload: {
    judgeUserId: string;
    judgeName?: string;
    judgeEmail?: string;
    teamIds: string[];
}): Promise<JudgeAssignment> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/judges`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<JudgeAssignment>(res);
}

export async function listJudges(competitionId: string): Promise<JudgeAssignment[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/judges`, {
        headers: await authHeaders(),
    });
    return handleResponse<JudgeAssignment[]>(res);
}

// ── Submissions ───────────────────────────────────────

export async function getSubmissionDownloadUrl(competitionId: string, teamId: string): Promise<SubmissionDownload> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/submissions/${teamId}/download-url`, {
        headers: await authHeaders(),
    });
    return handleResponse<SubmissionDownload>(res);
}

// ── Scores ────────────────────────────────────────────

export async function getScore(competitionId: string, teamId: string): Promise<Score> {
    const res = await fetch(`${COMPETITION_API_URL}/api/judge/competitions/${competitionId}/teams/${teamId}/score`, {
        headers: await authHeaders(),
    });
    return handleResponse<Score>(res);
}

export async function submitScore(competitionId: string, teamId: string, payload: {
    ratings: Record<string, number>;
    feedback?: string;
}): Promise<Score> {
    const res = await fetch(`${COMPETITION_API_URL}/api/judge/competitions/${competitionId}/teams/${teamId}/score`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Score>(res);
}
