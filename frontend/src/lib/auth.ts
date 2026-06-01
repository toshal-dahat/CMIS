/**
 * Auth service: Google SSO via Cognito (federated login for TAMU students).
 * No separate password creation — students sign in with TAMU Google only.
 */

import { Amplify } from 'aws-amplify';
import {
  signInWithRedirect,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  signIn,
  confirmSignIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  autoSignIn,
} from 'aws-amplify/auth';
import type { AuthUser } from 'aws-amplify/auth';
import { isAuthConfigured, getAmplifyAuthConfig } from '../config/auth.config';

// Configure Amplify as soon as this module loads (so OAuth callback can complete).
if (isAuthConfigured()) {
  try {
    Amplify.configure({
      Auth: {
        Cognito: getAmplifyAuthConfig(),
      },
    });
  } catch (err) {
    console.error('[auth] Amplify configure failed:', err);
  }
}

/**
 * Start Google SSO (redirects to Cognito Hosted UI → Google).
 * Students use TAMU Google (e.g. aupragathii@tamu.edu); no password sign-up.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!isAuthConfigured()) {
    console.warn('[auth] Auth not configured. Add .env from .env.example and complete CONFIG_TODO.md.');
    return;
  }
  await signInWithRedirect({ provider: 'Google' });
}

type EmailSignInStartResult =
  | { ok: true; mode: 'google_redirect' }
  | { ok: true; mode: 'otp_sent' }
  | { ok: false; error: string };

type NonTamuFlowMode = 'none' | 'signup_confirm' | 'signin_otp';

let nonTamuFlowMode: NonTamuFlowMode = 'none';
let pendingNonTamuEmail = '';

async function startEmailOtpSignIn(normalizedEmail: string): Promise<EmailSignInStartResult> {
  const initial = await signIn({
    username: normalizedEmail,
    options: {
      authFlowType: 'USER_AUTH',
      preferredChallenge: 'EMAIL_OTP',
    } as unknown as Parameters<typeof signIn>[0]['options'],
  });

  let step = initial?.nextStep?.signInStep;
  if (step === 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION') {
    const selected = await confirmSignIn({ challengeResponse: 'EMAIL_OTP' });
    step = selected?.nextStep?.signInStep;
  }

  if (
    step === 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE' ||
    step === 'CONFIRM_SIGN_IN_WITH_OTP' ||
    step === 'CONFIRM_SIGN_IN'
  ) {
    nonTamuFlowMode = 'signin_otp';
    pendingNonTamuEmail = normalizedEmail;
    return { ok: true, mode: 'otp_sent' };
  }

  if (step === 'DONE' || step == null) {
    nonTamuFlowMode = 'none';
    return { ok: true, mode: 'otp_sent' };
  }

  return { ok: false, error: `Unexpected sign-in step: ${String(step)}` };
}

/**
 * Starts sign-in based on email domain:
 * - @tamu.edu -> Google redirect
 * - otherwise -> Cognito Email OTP challenge
 */
export async function startSignInByEmail(email: string): Promise<EmailSignInStartResult> {
  if (!isAuthConfigured()) {
    return { ok: false, error: 'Auth is not configured.' };
  }
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('cmis:lastLoginEmail', normalized);
      window.localStorage.setItem('cmis:lastLoginEmail', normalized);
    }
  } catch {
    // ignore storage failures
  }

  if (normalized.endsWith('@tamu.edu')) {
    await signInWithGoogle();
    return { ok: true, mode: 'google_redirect' };
  }

  try {
    await signUp({
      username: normalized,
      options: {
        userAttributes: {
          email: normalized,
        },
        autoSignIn: true,
      },
    });
    nonTamuFlowMode = 'signup_confirm';
    pendingNonTamuEmail = normalized;
    return { ok: true, mode: 'otp_sent' };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    // Existing non-TAMU user: start OTP sign-in flow.
    if (name === 'UsernameExistsException') {
      try {
        return await startEmailOtpSignIn(normalized);
      } catch (signInErr) {
        return { ok: false, error: (signInErr as Error)?.message || 'Failed to start email OTP sign-in.' };
      }
    }
    return { ok: false, error: (err as Error)?.message || 'Failed to start email sign-up/sign-in.' };
  }
}

/**
 * Completes non-TAMU sign-in using the received email OTP code.
 */
export async function confirmEmailOtp(code: string): Promise<
  { ok: true } | { ok: false; error: string; nextStep?: 'enter_login_otp' }
> {
  const challengeResponse = (code ?? '').trim();
  if (!challengeResponse) return { ok: false, error: 'Enter the OTP code from your email.' };
  try {
    if (nonTamuFlowMode === 'signup_confirm') {
      await confirmSignUp({
        username: pendingNonTamuEmail,
        confirmationCode: challengeResponse,
      });
      try {
        await autoSignIn();
        nonTamuFlowMode = 'none';
        pendingNonTamuEmail = '';
        return { ok: true };
      } catch {
        // Some pool/client combinations may require a normal OTP sign-in even after confirm.
        const signInStart = await startEmailOtpSignIn(pendingNonTamuEmail);
        if (!signInStart.ok) return { ok: false, error: signInStart.error };
        return {
          ok: false,
          error: 'Account confirmed. Please enter the new OTP sent to your email to complete login.',
          nextStep: 'enter_login_otp',
        };
      }
    }

    const res = await confirmSignIn({ challengeResponse });
    const step = res?.nextStep?.signInStep;
    if (step === 'DONE' || step == null) {
      nonTamuFlowMode = 'none';
      pendingNonTamuEmail = '';
      return { ok: true };
    }
    return { ok: false, error: `OTP not completed. Current step: ${String(step)}` };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Failed to verify OTP.' };
  }
}

export async function resendEmailOtp(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  try {
    if (nonTamuFlowMode === 'signup_confirm') {
      await resendSignUpCode({ username: pendingNonTamuEmail || normalized });
      return { ok: true };
    }
    if (nonTamuFlowMode === 'signin_otp') {
      const res = await startEmailOtpSignIn(pendingNonTamuEmail || normalized);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true };
    }
    const res = await startSignInByEmail(normalized);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Failed to resend OTP.' };
  }
}

/**
 * Sign out (redirects to Cognito sign-out then back to redirectSignOut).
 */
export async function signOutUser(): Promise<void> {
  if (!isAuthConfigured()) return;
  await signOut();
}

/**
 * Get current authenticated user, if any.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

/**
 * Get the current session (tokens). Useful for API calls.
 */
export async function getSession(): Promise<Awaited<ReturnType<typeof fetchAuthSession>> | null> {
  if (!isAuthConfigured()) return null;
  try {
    return await fetchAuthSession();
  } catch {
    return null;
  }
}

/**
 * Get the Cognito ID token as a raw JWT string for the Authorization header.
 * Returns the full token so the client can send exactly: Authorization: Bearer <token>
 */
export async function getCognitoIdToken(forceRefresh = false): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  try {
    const session = await fetchAuthSession({ forceRefresh });
    const idToken = session?.tokens?.idToken;
    if (idToken == null) return null;
    const raw =
      typeof idToken === 'string'
        ? idToken
        : typeof (idToken as { toString?: () => string })?.toString === 'function'
          ? (idToken as { toString: () => string }).toString()
          : null;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return null;
    const trimmed = raw.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Get the Cognito Access token as a raw JWT string (for APIs that call Cognito GetUser).
 */
export async function getCognitoAccessToken(forceRefresh = false): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  try {
    const session = await fetchAuthSession({ forceRefresh });
    const accessToken = session?.tokens?.accessToken;
    if (accessToken == null) return null;
    const raw =
      typeof accessToken === 'string'
        ? accessToken
        : typeof (accessToken as { toString?: () => string })?.toString === 'function'
          ? (accessToken as { toString: () => string }).toString()
          : null;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') return null;
    const trimmed = raw.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Extract Cognito groups from current ID token (`cognito:groups` claim).
 */
export async function getCognitoGroups(forceRefresh = false): Promise<string[]> {
  const token = await getCognitoIdToken(forceRefresh);
  if (!token) return [];

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return [];
    const payloadBase64Url = parts[1];
    const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadBase64 + '='.repeat((4 - (payloadBase64.length % 4)) % 4);
    const payloadJson = atob(padded);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Wait until Cognito ID token becomes available (useful right after OAuth redirect).
 * Returns null when timeout is reached.
 */
export async function waitForCognitoIdToken(
  timeoutMs = 3000,
  pollMs = 120
): Promise<string | null> {
  const start = Date.now();
  let usedForceRefresh = false;
  while (Date.now() - start < timeoutMs) {
    const token = await getCognitoIdToken(usedForceRefresh);
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    // Try force refresh after first polling round.
    usedForceRefresh = true;
  }
  return null;
}

function parseJwtClaims(token: string | null): Record<string, unknown> {
  if (!token) return {};
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payloadBase64Url = parts[1];
    const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadBase64 + '='.repeat((4 - (payloadBase64.length % 4)) % 4);
    const payloadJson = atob(padded);
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Get first-time profile prefill values from authenticated identity.
 * Prefers JWT claims, then Cognito user details, then last entered login email.
 */
export async function getIdentityPrefill(): Promise<{ name?: string; email?: string }> {
  const token = await getCognitoIdToken();
  const claims = parseJwtClaims(token);

  let email = (claims.email as string | undefined)?.trim().toLowerCase();
  let name = (claims.name as string | undefined)?.trim();
  const cognitoUsername = (claims['cognito:username'] as string | undefined)?.trim();

  if (!email && cognitoUsername && cognitoUsername.includes('@')) {
    email = cognitoUsername.toLowerCase();
  }

  if (!name) {
    const given = (claims.given_name as string | undefined)?.trim() ?? '';
    const family = (claims.family_name as string | undefined)?.trim() ?? '';
    const full = `${given} ${family}`.trim();
    if (full) name = full;
  }

  try {
    const user = await getCurrentUser();
    const loginId = (user as { signInDetails?: { loginId?: string } })?.signInDetails?.loginId;
    if (!email && typeof loginId === 'string' && loginId.includes('@')) {
      email = loginId.trim().toLowerCase();
    }
  } catch {
    // ignore
  }

  if (!email) {
    try {
      if (typeof window !== 'undefined') {
        const stored = window.sessionStorage.getItem('cmis:lastLoginEmail');
        if (stored && stored.includes('@')) email = stored.trim().toLowerCase();
        if (!email) {
          const storedPersistent = window.localStorage.getItem('cmis:lastLoginEmail');
          if (storedPersistent && storedPersistent.includes('@')) {
            email = storedPersistent.trim().toLowerCase();
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (!name && email) {
    // Last-resort UX fallback for first-time forms.
    name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  }

  return {
    name: name || undefined,
    email: email || undefined,
  };
}

export { isAuthConfigured };
