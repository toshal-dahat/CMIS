/**
 * Auth configuration for Cognito + Google SSO (TAMU students).
 * All values are read from environment variables (Vite: import.meta.env.VITE_*).
 *
 * Copy .env.example to .env and fill in the values after completing
 * the setup in CONFIG_TODO.md.
 */

type EnvKey =
  | 'VITE_COGNITO_USER_POOL_ID'
  | 'VITE_COGNITO_CLIENT_ID'
  | 'VITE_COGNITO_REGION'
  | 'VITE_COGNITO_OAUTH_DOMAIN'
  | 'VITE_COGNITO_REDIRECT_SIGN_IN'
  | 'VITE_COGNITO_REDIRECT_SIGN_OUT';

const getEnv = (key: EnvKey): string => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value : '';
};

/** Cognito User Pool ID (e.g. us-east-1_xxxxxxxxx) */
export const userPoolId = getEnv('VITE_COGNITO_USER_POOL_ID');

/** Cognito App Client ID (SPA client; no client secret) */
export const userPoolClientId = getEnv('VITE_COGNITO_CLIENT_ID');

/** AWS region where the User Pool is (e.g. us-east-1) */
export const region = getEnv('VITE_COGNITO_REGION');

/** Cognito Hosted UI domain (without https://). e.g. your-domain.auth.us-east-1.amazoncognito.com */
export const oauthDomain = getEnv('VITE_COGNITO_OAUTH_DOMAIN');

/** Comma-separated redirect URIs for sign-in (must match Cognito App Client settings) */
export const redirectSignIn = getEnv('VITE_COGNITO_REDIRECT_SIGN_IN');

/** Comma-separated redirect URIs for sign-out */
export const redirectSignOut = getEnv('VITE_COGNITO_REDIRECT_SIGN_OUT');

/**
 * Whether auth config is present enough to use Google SSO.
 * Used to avoid calling Amplify when not configured (e.g. first run).
 */
export function isAuthConfigured(): boolean {
  return !!(userPoolId && userPoolClientId && oauthDomain);
}

/**
 * Build the Amplify Auth Cognito config object (for Amplify.configure).
 */
export function getAmplifyAuthConfig() {
  return {
    userPoolId,
    userPoolClientId,
    loginWith: {
      oauth: {
        domain: oauthDomain,
        scopes: ['openid', 'email', 'profile'],
        redirectSignIn: redirectSignIn.split(',').map((s) => s.trim()).filter(Boolean),
        redirectSignOut: redirectSignOut.split(',').map((s) => s.trim()).filter(Boolean),
        responseType: 'code' as const,
      },
    },
  };
}
