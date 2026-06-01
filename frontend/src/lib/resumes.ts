/**
 * Resume upload/download API client (S3 presigned URL flow).
 * Uses same base URL as main API (VITE_API_BASE_URL). Auth: Bearer ID token for backend only.
 * Do NOT send Authorization to the presigned S3 PUT URL.
 */

import { getCognitoIdToken } from './auth';
import { getApiBase } from './api';

const API_BASE = getApiBase();

const PDF_MAX_BYTES = 5 * 1024 * 1024; // 5MB

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const idToken = await getCognitoIdToken();
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  return headers;
}

function userFacingError(res: Response, data: Record<string, unknown>): string {
  if (res.status === 401) return 'Session expired, please sign in again.';
  if (res.status === 403) return "You don't have permission to perform this action.";
  return (data?.message as string) || (data?.error as string) || res.statusText || 'Request failed.';
}

export type GetUploadUrlOk = {
  ok: true;
  uploadUrl: string;
  resumeId: string;
  s3Key: string;
  expiresInSeconds?: number;
};
export type GetUploadUrlErr = { ok: false; error: string; status?: number };
export type GetUploadUrlResult = GetUploadUrlOk | GetUploadUrlErr;

/**
 * Get presigned upload URL from backend.
 */
export async function getUploadUrl(
  fileName: string,
  contentType: string
): Promise<GetUploadUrlResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/resumes/upload-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName, contentType }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: userFacingError(res, data), status: res.status };
    }
    return {
      ok: true,
      uploadUrl: data.uploadUrl as string,
      resumeId: data.resumeId as string,
      s3Key: data.s3Key as string,
      expiresInSeconds: data.expiresInSeconds as number | undefined,
    };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error.' };
  }
}

export type UploadToPresignedResult = { ok: true } | { ok: false; error: string };

/**
 * Upload file to S3 presigned URL. No Authorization header. Content-Type: application/pdf.
 */
export function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadToPresignedResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);

    xhr.setRequestHeader('Content-Type', 'application/pdf');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: 'Upload failed, please retry.' });
      }
    });

    xhr.addEventListener('error', () => {
      resolve({ ok: false, error: 'Upload failed, please retry.' });
    });

    xhr.addEventListener('abort', () => {
      resolve({ ok: false, error: 'Upload cancelled.' });
    });

    xhr.send(file);
  });
}

export type CompleteUploadResult =
  | { ok: true; data?: object }
  | { ok: false; error: string; status?: number };

/**
 * Complete resume upload on backend after S3 PUT.
 */
export async function completeUpload(resumeId: string): Promise<CompleteUploadResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/resumes/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resumeId }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: userFacingError(res, data), status: res.status };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error.' };
  }
}

export type ListMyResumesResult =
  | { ok: true; resumes: unknown[] }
  | { ok: false; error: string; status?: number };

/**
 * List current user's resumes (metadata).
 */
export async function listMyResumes(): Promise<ListMyResumesResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/resumes/me`, {
      headers,
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as unknown[] | { resumes?: unknown[]; items?: unknown[] };
    if (!res.ok) {
      const obj = data as Record<string, unknown>;
      return {
        ok: false,
        error: userFacingError(res, obj),
        status: res.status,
      };
    }
    const list = Array.isArray(data)
      ? data
      : (data as { resumes?: unknown[] })?.resumes ?? (data as { items?: unknown[] })?.items ?? [];
    return { ok: true, resumes: list };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error.' };
  }
}

export type GetDownloadUrlResult =
  | { ok: true; downloadUrl: string }
  | { ok: false; error: string; status?: number };

/**
 * Get temporary download URL for a resume.
 */
export async function getDownloadUrl(resumeId: string): Promise<GetDownloadUrlResult> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${API_BASE}/api/resumes/${encodeURIComponent(resumeId)}/download-url`,
      { headers }
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: userFacingError(res, data), status: res.status };
    }
    const url = (data.downloadUrl ?? data.url) as string | undefined;
    if (!url) {
      return { ok: false, error: 'No download URL returned.' };
    }
    return { ok: true, downloadUrl: url };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Network error.' };
  }
}

export const PDF_MAX_BYTES_EXPORT = PDF_MAX_BYTES;
