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

export interface TeamMember {
    name?: string;
    email: string;
}

export interface Team {
    competitionId: string;
    teamId: string;
    teamName: string;
    members: string[];
    memberDetails?: TeamMember[];
    createdAt: string;
    /** Enriched by the judge teams endpoint */
    hasSubmission?: boolean;
    submittedAt?: string | null;
    gradingStatus?: 'GRADED' | 'PENDING';
    score?: Score | null;
    /** B3: total score across all rubric criteria */
    scoreTotal?: number | null;
    /** B2: whether an AI summary has been cached for this team */
    hasSummary?: boolean;
}

export interface JudgeAssignment {
    competitionId: string;
    judgeUserId: string;
    judgeName: string;
    judgeEmail: string;
    /**
     * Legacy field. Source of truth for judge↔team binding now lives in
     * Room records — see Room.judgeIds / Room.teamIds. Kept optional here
     * so older list payloads still typecheck.
     */
    teamIds?: string[];
    assignedAt: string;
}

export interface Room {
    competitionId: string;
    roomId: string;
    roomName: string;
    judgeIds: string[];
    teamIds: string[];
    createdAt: string;
    updatedAt: string;
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

export interface UploadUrlResponse {
    uploadUrl: string;
    s3Key: string;
    submissionId: string;
    expiresInSeconds: number;
}

export interface SubmissionRecord {
    competitionId: string;
    teamId: string;
    s3Key: string;
    fileName: string;
    fileType: string;
    submittedAt: string;
    updatedAt: string;
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

export async function updateCompetition(competitionId: string, payload: Partial<Competition>): Promise<Competition> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Competition>(res);
}

export async function deleteCompetition(competitionId: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    return handleResponse<{ deleted: boolean }>(res);
}

// ── Teams ─────────────────────────────────────────────

export async function listTeams(competitionId: string): Promise<Team[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams`, {
        headers: await authHeaders(),
    });
    return handleResponse<Team[]>(res);
}

export async function createTeam(competitionId: string, payload: { teamName: string; members?: Array<string | TeamMember>; memberDetails?: TeamMember[] }): Promise<Team> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Team>(res);
}

export async function getTeam(competitionId: string, teamId: string): Promise<Team> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}`, {
        headers: await authHeaders(),
    });
    return handleResponse<Team>(res);
}

export async function updateTeam(
    competitionId: string,
    teamId: string,
    payload: { teamName?: string; members?: Array<string | TeamMember>; memberDetails?: TeamMember[] }
): Promise<Team> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Team>(res);
}

export async function deleteTeam(competitionId: string, teamId: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    return handleResponse<{ deleted: boolean }>(res);
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

/**
 * Register a judge as a member of a competition.
 *
 * teamIds is optional and ignored by the backend now — rooms own the
 * judge↔team binding. It remains in the type for compatibility with any
 * older caller still passing it.
 */
export async function assignJudge(competitionId: string, payload: {
    judgeUserId: string;
    judgeName?: string;
    judgeEmail?: string;
    teamIds?: string[];
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

export async function getJudge(competitionId: string, judgeUserId: string): Promise<JudgeAssignment> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/judges/${judgeUserId}`, {
        headers: await authHeaders(),
    });
    return handleResponse<JudgeAssignment>(res);
}

export async function updateJudge(
    competitionId: string,
    judgeUserId: string,
    payload: { judgeName?: string; judgeEmail?: string }
): Promise<JudgeAssignment> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/judges/${judgeUserId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<JudgeAssignment>(res);
}

export async function deleteJudge(competitionId: string, judgeUserId: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/judges/${judgeUserId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    return handleResponse<{ deleted: boolean }>(res);
}

// ── Rooms (Admin) ─────────────────────────────────────
// Rooms are the source of truth for which judges grade which teams.
// A team belongs to AT MOST ONE room within a competition; judges may
// belong to multiple rooms.

export async function listRooms(competitionId: string): Promise<Room[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/rooms`, {
        headers: await authHeaders(),
    });
    return handleResponse<Room[]>(res);
}

export async function getRoom(competitionId: string, roomId: string): Promise<Room> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/rooms/${roomId}`, {
        headers: await authHeaders(),
    });
    return handleResponse<Room>(res);
}

export async function createRoom(
    competitionId: string,
    payload: { roomName: string; judgeIds?: string[]; teamIds?: string[] }
): Promise<Room> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/rooms`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Room>(res);
}

export async function updateRoom(
    competitionId: string,
    roomId: string,
    payload: { roomName?: string; judgeIds?: string[]; teamIds?: string[] }
): Promise<Room> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/rooms/${roomId}`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<Room>(res);
}

export async function deleteRoom(competitionId: string, roomId: string): Promise<{ deleted: boolean }> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/rooms/${roomId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    return handleResponse<{ deleted: boolean }>(res);
}

// ── Submissions ───────────────────────────────────────

/**
 * Step 1 of upload: request a presigned S3 PUT URL.
 * fileType should be 'application/pdf', 'application/vnd.ms-powerpoint', or
 * 'application/vnd.openxmlformats-officedocument.presentationml.presentation'.
 */
export async function requestUploadUrl(
    competitionId: string,
    payload: { teamId: string; fileName: string; fileType: string }
): Promise<UploadUrlResponse> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/submissions/upload-url`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<UploadUrlResponse>(res);
}

/**
 * Step 2 of upload: confirm the file was successfully placed in S3.
 */
export async function confirmSubmission(
    competitionId: string,
    payload: { teamId: string; s3Key: string; fileName: string }
): Promise<SubmissionRecord> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/submissions/complete`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    return handleResponse<SubmissionRecord>(res);
}

/**
 * Get a team's existing submission (returns null if none found yet).
 */
export async function getTeamSubmission(competitionId: string, teamId: string): Promise<SubmissionDownload | null> {
    const res = await fetch(
        `${COMPETITION_API_URL}/api/competitions/${competitionId}/submissions/${teamId}/download-url`,
        { headers: await authHeaders() }
    );
    if (res.status === 404) return null;
    return handleResponse<SubmissionDownload>(res);
}

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

export async function getCompetitionScores(competitionId: string): Promise<Score[]> {
    const res = await fetch(`${COMPETITION_API_URL}/api/competitions/${competitionId}/scores`, {
        headers: await authHeaders(),
    });
    return handleResponse<Score[]>(res);
}

// ── AI Summary ────────────────────────────────────────

export interface SummaryResult {
    summary: string;
    cached: boolean;
    generatedAt: string;
}

export async function generateSummary(competitionId: string, teamId: string): Promise<SummaryResult> {
    const res = await fetch(
        `${COMPETITION_API_URL}/api/judge/competitions/${competitionId}/teams/${teamId}/summary`,
        {
            method: 'POST',
            headers: await authHeaders(),
        }
    );
    return handleResponse<SummaryResult>(res);
}

// ── Feedback Retrieval (Bounty 19-B) ──────────────────

export interface JudgeFeedback {
    judgeUserId?: string; // only present for admins
    feedback: string;
    ratings: Record<string, number>;
    gradedAt: string;
}

export interface FeedbackResponse {
    released: boolean;
    releasedAt: string | null;
    feedbackCount?: number;
    /** B19: Total number of judges assigned to this team */
    totalJudges?: number;
    feedback?: JudgeFeedback[];
    /** B19: The AI-synthesized single narrative */
    narrative?: string;
    // present when released: false
    error?: string;
    message?: string;
}

export async function getTeamFeedback(competitionId: string, teamId: string): Promise<FeedbackResponse> {
    const res = await fetch(
        `${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}/feedback`,
        { headers: await authHeaders() }
    );
    // 423 Locked is a valid non-error response — parse it as JSON
    if (res.status === 423) {
        return res.json();
    }
    return handleResponse<FeedbackResponse>(res);
}

export async function getSynthesizedFeedback(competitionId: string, teamId: string, refresh = false): Promise<{ narrative: string; averageScores?: Record<string, number>; cached?: boolean }> {
    const url = new URL(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}/synthesized-feedback`);
    if (refresh) url.searchParams.set('refresh', 'true');
    
    const res = await fetch(url.toString(), { headers: await authHeaders() });
    return handleResponse<{ narrative: string; averageScores?: Record<string, number>; cached?: boolean }>(res);
}

export interface SynthesisResult {
    narrative: string;
    synthesizedAt: string;
    judgeCount?: number;
    averageScores?: Record<string, number>;
    cached?: boolean;
}

/**
 * Admin: trigger Bedrock synthesis for a single team's judge feedback.
 * If `refresh` is true, regenerates even if a cached narrative exists.
 */
export async function triggerSynthesis(
    competitionId: string,
    teamId: string,
    refresh = false
): Promise<SynthesisResult> {
    const url = new URL(`${COMPETITION_API_URL}/api/competitions/${competitionId}/teams/${teamId}/synthesize`);
    if (refresh) url.searchParams.set('refresh', 'true');

    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: await authHeaders(),
    });
    return handleResponse<SynthesisResult>(res);
}
