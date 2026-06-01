/// <reference types="vite/client" />
/// <reference types="svelte" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_CONFIG_API_URL: string;
  readonly VITE_THEME_API_URL: string;
  readonly VITE_TIERS_API_URL: string;
  readonly VITE_COMPANIES_API_URL: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_REGION: string;
  readonly VITE_COGNITO_OAUTH_DOMAIN: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_IN: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_OUT: string;
  readonly VITE_EVENT_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
