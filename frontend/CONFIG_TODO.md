# Config TODO: Google SSO via Cognito (TAMU Students)

This checklist covers everything you need to configure so students can sign in with their **TAMU Google account** (e.g. `aupragathii@tamu.edu`) via Cognito. **No separate password creation** — federated login only.

---

## 1. Google Cloud Console (Google OAuth Client)

- [ ] **1.1** Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project (e.g. "CMIS Team Reveille").
- [ ] **1.2** Enable the **Google+ API** (or **Google Identity**) if required for OAuth.
- [ ] **1.3** Open **APIs & Services → Credentials** and click **Create Credentials → OAuth client ID**.
- [ ] **1.4** If prompted, configure the **OAuth consent screen**:
  - User type: **Internal** (TAMU only) or **External** (if you need non-TAMU test users).
  - App name, support email, developer contact as needed.
- [ ] **1.5** Create an **OAuth 2.0 Client ID**:
  - Application type: **Web application**.
  - Name: e.g. `CMIS Cognito`.
  - **Authorized JavaScript origins**:
    - `http://localhost:5173` (Vite dev)
    - Your production origin (e.g. `https://cmis.example.com`) when you have it.
  - **Authorized redirect URIs** (must match Cognito Hosted UI callback URL):
    - `https://<YOUR_COGNITO_DOMAIN>/oauth2/idpresponse`
    - Example: `https://team-reveille.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
  - Save and note the **Client ID** and **Client secret** (you will add these in Cognito).
- [ ] **1.6** (Optional) To restrict to TAMU emails only, use an **Internal** consent screen with your TAMU Google Workspace org, or enforce `@tamu.edu` in a Cognito Pre sign-up Lambda (see 2.x).

---

## 2. Amazon Cognito (User Pool + Hosted UI)

- [ ] **2.1** In [AWS Console](https://console.aws.amazon.com/) go to **Cognito → User pools** and click **Create user pool**.
- [ ] **2.2** **Sign-in experience**:
  - Federated identity provider sign-in: **Federated** (or **Cognito user pool and Federated** if you want both; for students we use **Federated only** so no password sign-up).
  - Add **Google** as an identity provider (you will configure it in the next steps).
  - Do **not** enable "Allow users to sign up" if you want only Google (federated); or leave it off to avoid password-based sign-up.
- [ ] **2.3** **Configure security requirements**: set password policy and MFA as per your policy (e.g. optional MFA for students).
- [ ] **2.4** **Sign-up experience**: required attributes — at least **email** (and optionally **preferred_username**). Google will provide email.
- [ ] **2.5** **Integrate your app**:
  - Create an **App client**:
    - Type: **Public client** (no client secret; suitable for SPA).
    - Name: e.g. `cmis-spa`.
    - **Authentication flows**: Do **not** enable USER_PASSWORD_AUTH if you want Google-only; enable **ALLOW_USER_SRP_AUTH** only if you need it for other flows.
    - **OAuth 2.0 grant types**: **Authorization code grant**.
    - **OpenID Connect scopes**: `openid`, `email`, `profile`.
    - **Callback URL(s)** (where Cognito redirects after sign-in):
      - `http://localhost:5173/` (dev)
      - Your production URL when ready (e.g. `https://cmis.example.com/`).
    - **Sign-out URL(s)**:
      - `http://localhost:5173/`
      - Production URL when ready.
  - **Hosted UI**:
    - **Domain**: Create a Cognito domain (e.g. `team-reveille`) → full domain: `team-reveille.auth.<region>.amazoncognito.com`.
    - **Identity providers**: Select **Google**.
- [ ] **2.6** **Add Google as identity provider** (if not already):
  - In User pool → **Sign-in experience** → **Federated identity provider sign-in** → **Add identity provider** → **Google**.
  - Enter the **Google Client ID** and **Client secret** from step 1.5.
  - Save.
- [ ] **2.7** (Optional) **Restrict to @tamu.edu**: Create a **Pre sign-up** or **Pre authentication** Lambda trigger that checks `event.request.userAttributes.email` ends with `@tamu.edu` and throws (or does not confirm) for others. Attach the trigger in User pool → **User pool properties** → **Lambda triggers**.
- [ ] **2.8** Note the following values (you will put them in `.env`):
  - **User pool ID** (e.g. `us-east-1_xxxxxxxxx`).
  - **App client ID** (from the app client you created).
  - **Region** (e.g. `us-east-1`).
  - **Hosted UI domain** (without `https://`, e.g. `team-reveille.auth.us-east-1.amazoncognito.com`).

---

## 3. Environment variables (.env)

- [ ] **3.1** Copy the example file:
  ```bash
  cp .env.example .env
  ```
- [ ] **3.2** Edit `.env` and set (no quotes needed; no spaces around `=`):

  | Variable | Where to get it | Example |
  |----------|-----------------|---------|
  | `VITE_COGNITO_USER_POOL_ID` | Cognito → User pool → Pool ID | `us-east-1_xxxxxxxxx` |
  | `VITE_COGNITO_CLIENT_ID` | Cognito → App client → Client ID | `xxxxxxxxxxxxxxxxxx` |
  | `VITE_COGNITO_REGION` | User pool region | `us-east-1` |
  | `VITE_COGNITO_OAUTH_DOMAIN` | Cognito → Domain name (no `https://`) | `team-reveille.auth.us-east-1.amazoncognito.com` |
  | `VITE_COGNITO_REDIRECT_SIGN_IN` | Must match Cognito callback URL(s) | `http://localhost:5173/` |
  | `VITE_COGNITO_REDIRECT_SIGN_OUT` | Must match Cognito sign-out URL(s) | `http://localhost:5173/` |

- [ ] **3.3** For production, add production callback/sign-out URLs in Cognito and (if needed) add a second line or comma-separated list in the same vars; ensure the exact URLs match in both Cognito and Google.

---

## 4. Verify

- [ ] **4.1** Start the app: `npm run dev`.
- [ ] **4.2** Click **Sign In** on the landing page. You should be redirected to Cognito Hosted UI, then to Google. Sign in with a TAMU Google account (e.g. `aupragathii@tamu.edu`).
- [ ] **4.3** After consent, you should be redirected back to `http://localhost:5173/` and be signed in (the app will complete the OAuth code exchange automatically).
- [ ] **4.4** If you see "Auth not configured", double-check that `.env` exists, all `VITE_*` variables are set, and you restarted the dev server after changing `.env`.

---

## 5. Security / Production checklist

- [ ] **5.1** Do **not** commit `.env` (it is in `.gitignore`). Use CI/CD secrets or your host’s env config for production.
- [ ] **5.2** In production, use **HTTPS** and add your production URL to Cognito callback/sign-out URLs and to Google Authorized redirect URIs / origins.
- [ ] **5.3** (Optional) Restrict sign-in to `@tamu.edu` via Cognito Lambda trigger or Google Workspace (internal app).
- [ ] **5.4** Rotate Google OAuth client secret and Cognito app client settings if they are ever exposed.

---

## Quick reference: where each value comes from

| Purpose | Source |
|--------|--------|
| Google Client ID & Secret | Google Cloud Console → Credentials → OAuth 2.0 Client ID |
| Cognito User Pool ID, Client ID, Region, Domain | AWS Cognito → User pools → your pool → App integration / Domain |
| Callback / redirect URLs | Must match in: (1) Cognito App client, (2) Google OAuth client redirect URIs, (3) `.env` (VITE_COGNITO_REDIRECT_SIGN_IN / SIGN_OUT) |

Once these steps are done, the frontend’s **Sign In** button will perform Google SSO via Cognito with no password sign-up for students.
