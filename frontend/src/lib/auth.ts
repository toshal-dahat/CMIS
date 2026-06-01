/**
 * Auth service: Google SSO via Cognito (federated login for TAMU students).
 * No separate password creation — students sign in with TAMU Google only.
 */

import { Amplify } from 'aws-amplify';
import { signInWithRedirect, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
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
export async function getCognitoIdToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  try {
    const session = await fetchAuthSession();
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

export { isAuthConfigured };
