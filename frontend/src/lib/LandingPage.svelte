<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser } from 'aws-amplify/auth';
  import { get } from 'svelte/store';
  import { startSignInByEmail, confirmEmailOtp } from './auth';
  import { authUser } from './stores/authStore';
  import { currentRole } from './stores/roleStore';
  import { currentView } from './stores/viewStore';
  import { eventCheckinResult } from './stores/eventCheckinResultStore';
  import { profile } from './stores/profileStore';
  import { fetchGraduationStatus } from './api';
  import { signOutUser } from './auth';
  import { selfCheckIn } from './events-api';
  import ProfilePanel from './ProfilePanel.svelte';

  let showProfilePanel = $state(false);
  let showProfileMenu = $state(false);
  let showAuthPanel = $state(false);
  let email = $state('');
  let otp = $state('');
  let authStatus = $state('');
  let authError = $state('');
  let otpStep = $state(false);
  let isAdmin = $state(false); // TODO: Set to true for local testing, false for production
  let isSuperAdmin = $state(false); // TODO: Set to true for local testing, false for production
  let signedInProfileRole = $state<'student' | 'friend' | 'investor' | 'admin' | 'unknown'>('unknown');
  let showGraduationPrompt = $state(false);
  let graduationPromptMessage = $state('');
  let gradDateForPrompt = $state('');
  let showGradDateModal = $state(false);
  let gradDateForEdit = $state('');
  let gradDateSaveError = $state('');
  let authLoading = $state(false);
  let authLoadingMessage = $state('');
  let isActive = $state(false);
  const PROFILE_FORM_DISMISSED_KEY = 'cmis:profileFormDismissed';
  const OTP_VALIDITY_SECONDS = 300;
  let otpExpiresAtMs = $state(0);
  let otpNowMs = $state(Date.now());

  function setViewIfActive(view: import('./types').ViewName) {
    if (isActive) currentView.set(view);
  }

  function startOtpTimer() {
    otpExpiresAtMs = Date.now() + OTP_VALIDITY_SECONDS * 1000;
    otpNowMs = Date.now();
  }

  function formatOtpCountdown(seconds: number): string {
    const clamped = Math.max(0, seconds);
    const m = Math.floor(clamped / 60)
      .toString()
      .padStart(2, '0');
    const s = Math.floor(clamped % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  }

  $effect(() => {
    if (!otpStep) return;
    const id = setInterval(() => {
      otpNowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  function hasManagedGroup(groups: string[]): boolean {
    return groups.some((g) =>
      /^(students?|friends?|investors?|admins?)$/i.test((g ?? '').trim())
    );
  }

  function resolveManagedRole(groups: string[]): 'student' | 'friend' | 'investor' | 'admin' | 'unknown' {
    if (groups.some((g) => /^admins?$/i.test((g ?? '').trim()))) return 'admin';
    if (groups.some((g) => /^students?$/i.test((g ?? '').trim()))) return 'student';
    if (groups.some((g) => /^investors?$/i.test((g ?? '').trim()))) return 'investor';
    if (groups.some((g) => /^friends?$/i.test((g ?? '').trim()))) return 'friend';
    return 'unknown';
  }

  async function completePostSignIn(user: AuthUser) {
    const { checkIsFirstTimeSignIn, fetchUserProfile } = await import('./api');
    const { getCognitoGroups, getCognitoIdToken, getIdentityPrefill, waitForCognitoIdToken } = await import('./auth');

    const idToken = await getCognitoIdToken();
    if (idToken) {
      console.log('[auth] ID token (JWT):', idToken);
    } else {
      console.warn('[auth] ID token (JWT) unavailable');
    }

    const [isFirstTime, groupsInitial] = await Promise.all([
      checkIsFirstTimeSignIn(user),
      getCognitoGroups(),
    ]);

    let groups = groupsInitial;
    if (!hasManagedGroup(groups)) {
      groups = await getCognitoGroups(true);
    }
    console.log('[auth] Cognito groups:', groups);
    signedInProfileRole = resolveManagedRole(groups);

    // Check if user has admin role (skipped in local dev override)
    if (!import.meta.env.DEV || !isAdmin) {
      isAdmin =
        groups.includes('admins') ||
        groups.includes('Admin') ||
        groups.includes('admin') ||
        groups.includes('ADMIN');
    }
    currentRole.set(isAdmin ? 'admins' : 'students');

    // Check if user has super admin role (skipped in local dev override)
    if (!import.meta.env.DEV || !isSuperAdmin) {
      isSuperAdmin =
        groups.includes('SuperAdmin') ||
        groups.includes('superadmin') ||
        groups.includes('SUPERADMIN');
    }

    if (isFirstTime) {
      const dismissed = typeof window !== 'undefined'
        ? window.sessionStorage.getItem(PROFILE_FORM_DISMISSED_KEY) === '1'
        : false;
      if (dismissed) {
        setViewIfActive('landing');
        return;
      }
      // First-time users can reach here before JWT claims are fully hydrated.
      // Wait briefly so identity prefill (name/email) is reliably available.
      await waitForCognitoIdToken(3200);
      const prefill = await getIdentityPrefill();
      profile.update((p) => ({
        ...p,
        name: p.name || prefill.name || '',
        email: p.email || prefill.email || '',
      }));
      setViewIfActive('profile-form');
      return;
    }

    // Preload profile before routing to avoid blank fields.
    await fetchUserProfile(user);
    if (await processPendingSelfCheckin()) return;
    setViewIfActive('landing');
    await maybeShowGraduationPrompt();
  }

  function consumePendingCheckin(): { token: string; eventId: string } | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem('cmis:pendingCheckin');
      if (!raw) return null;
      const pending = JSON.parse(raw) as { token?: string; eventId?: string };
      if (!pending?.token || !pending?.eventId) return null;
      window.sessionStorage.removeItem('cmis:pendingCheckin');
      return { token: pending.token, eventId: pending.eventId };
    } catch {
      return null;
    }
  }

  async function processPendingSelfCheckin(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const pending = consumePendingCheckin();
    if (!pending) return false;
    try {
      const result = await selfCheckIn(pending.token, pending.eventId);
      const status = (result?.status || '').toUpperCase();
      const ok = status === 'CHECKED_IN' || status === 'ALREADY_CHECKED_IN';
      const message = result?.message || (ok ? 'Check-in completed.' : 'Check-in could not be completed.');
      eventCheckinResult.set({
        status: ok ? 'success' : 'failed',
        title: ok ? 'Check-in successful' : 'Check-in failed',
        message,
        eventId: pending.eventId,
      });
    } catch (err) {
      const message = (err as Error)?.message || 'Unable to complete check-in from QR link.';
      eventCheckinResult.set({
        status: 'failed',
        title: 'Check-in failed',
        message,
        eventId: pending.eventId,
      });
    }
    setViewIfActive('event-checkin-result');
    return true;
  }

  onMount(() => {
    isActive = true;
    void (async () => {
      const { getAuthUser, getSession, waitForCognitoIdToken } = await import('./auth');
      const isOAuthCallback = typeof window !== 'undefined' && window.location.search.includes('code=');

      if (isOAuthCallback) {
        authLoading = true;
        authLoadingMessage = 'Completing sign-in...';
        await waitForCognitoIdToken(3200);
      }

      try {
        const user = await getAuthUser();
        authUser.set(user ?? null);
        if (user) {
          await completePostSignIn(user);
        } else if (isOAuthCallback) {
          const session = await getSession();
          if (!session) {
            console.warn('[auth] Signed in but no id token in session:', session ? 'session exists, check tokens shape' : 'no session');
          }
        }
      } catch {
        authUser.set(null);
        signedInProfileRole = 'unknown';
        setViewIfActive('landing');
      } finally {
        authLoading = false;
        authLoadingMessage = '';
      }
    })();

    return () => {
      isActive = false;
    };
  });

  async function handleSignIn() {
    showAuthPanel = true;
    authStatus = '';
    authError = '';
    otpStep = false;
  }

  async function submitEmail() {
    authError = '';
    authStatus = '';
    const result = await startSignInByEmail(email);
    if (!result.ok) {
      authError = result.error;
      return;
    }
    if (result.mode === 'google_redirect') {
      authStatus = 'Redirecting to Google sign-in...';
      return;
    }
    otpStep = true;
    authStatus = `OTP sent to ${email.trim()}. Enter it below.`;
    startOtpTimer();
  }

  async function submitOtp() {
    try {
      authError = '';
      authLoading = true;
      authLoadingMessage = 'Signing you in...';
      const result = await confirmEmailOtp(otp);
      if (!result.ok) {
        if (result.nextStep === 'enter_login_otp') {
          otp = '';
          authError = '';
          authStatus = result.error;
          authLoadingMessage = 'Waiting for login OTP...';
          startOtpTimer();
          return;
        }
        authError = result.error;
        return;
      }
      authStatus = 'Sign-in successful.';
      const { getAuthUser, waitForCognitoIdToken } = await import('./auth');
      await waitForCognitoIdToken(2200);
      const user = await getAuthUser();
      authUser.set(user ?? null);
      if (user) {
        await completePostSignIn(user);
      }
      showAuthPanel = false;
      email = '';
      otp = '';
      otpStep = false;
    } catch (err) {
      authError = (err as Error)?.message || 'Sign-in failed. Please try again.';
    } finally {
      authLoading = false;
      authLoadingMessage = '';
    }
  }

  async function maybeShowGraduationPrompt() {
    const p = get(profile);
    const gradDate = (p?.gradDate ?? '').trim();
    if (!gradDate) return;
    if ((p?.role ?? '').toUpperCase() === 'FORMER_STUDENT') return;

    // Avoid re-prompting constantly: remember dismissals per gradDate month.
    const monthKey = gradDate.slice(0, 7); // YYYY-MM
    const dismissedKey = `cmis:gradPromptDismissed:${monthKey}`;
    if (typeof window !== 'undefined' && window.localStorage.getItem(dismissedKey) === '1') return;

    const status = await fetchGraduationStatus(gradDate);
    if (!status || !status.showPrompt) return;

    // Show it only once per gradDate month, even if the user doesn't explicitly dismiss.
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(dismissedKey, '1');
    }

    gradDateForPrompt = gradDate;
    graduationPromptMessage =
      status.reason === 'after_grad_month'
        ? `Our records show your graduation date is ${status.gradDate ?? gradDate}. Have you graduated and want to convert your account to Alumni?`
        : 'Have you graduated and want to convert your account to Alumni?';
    showGraduationPrompt = true;
  }

  function dismissGraduationPrompt() {
    showGraduationPrompt = false;
    // Let users update only the gradDate (minimal friction).
    gradDateForEdit = gradDateForPrompt ?? '';
    gradDateSaveError = '';
    showGradDateModal = true;
  }

  function confirmGraduated() {
    showGraduationPrompt = false;
    currentView.set('graduation-handover');
  }

  function toApiGradDate(value: string): string | undefined {
    const v = (value ?? '').trim();
    if (!v) return undefined;
    // HTML date input: YYYY-MM-DD, backend expects YYYY-MM
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(v)) return v;
    return undefined;
  }

  function parseGradYearMonth(gradDate: string) {
    const parts = gradDate.split("-");
    if (parts.length < 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
    return { year, month };
  }

  function isFutureGradMonth(gradDate: string): boolean {
    const ym = parseGradYearMonth(gradDate);
    if (!ym) return false;
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    // Strictly greater than current (same month still triggers prompt).
    return ty < ym.year || (ty === ym.year && tm < ym.month);
  }

  async function saveUpdatedGradDate() {
    gradDateSaveError = '';
    const apiGradDate = toApiGradDate(gradDateForEdit);
    if (!apiGradDate) {
      gradDateSaveError = 'Please select a valid future graduation month.';
      return;
    }
    if (!isFutureGradMonth(apiGradDate)) {
      gradDateSaveError = 'Graduation date must be in a future month.';
      return;
    }
    try {
      const { updateProfile, fetchUserProfile } = await import('./api');
      const res = await updateProfile({ gradDate: apiGradDate });
      if (!res.ok) {
        gradDateSaveError = res.error || 'Failed to save graduation date.';
        return;
      }
      showGradDateModal = false;
      // Refresh profile store; then re-check whether prompt should be shown.
      await fetchUserProfile();
      // maybeShowGraduationPrompt is in scope as a function below; call it directly.
      await maybeShowGraduationPrompt();
    } catch (e) {
      gradDateSaveError = (e as Error)?.message || 'Failed to save graduation date.';
    }
  }

  function closeAuthPanel() {
    showAuthPanel = false;
    authStatus = '';
    authError = '';
    otpStep = false;
    otp = '';
  }

  function openProfile() {
    showProfileMenu = false;
    showProfilePanel = true;
  }

  function toggleProfileMenu() {
    showProfileMenu = !showProfileMenu;
  }

  async function handleHeaderSignOut() {
    showProfileMenu = false;
    await signOutUser();
    authUser.set(null);
    signedInProfileRole = 'unknown';
    currentRole.set('students');
    currentView.set('landing');
  }
</script>

<header class="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <span class="logo-acronym">CMIS</span>
      <span class="logo-full">Council for the Management of Information Systems</span>
    </a>
    {#if $authUser}
      <div class="profile-menu-wrap">
        <button type="button" class="btn-profile-icon" onclick={toggleProfileMenu} aria-label="Open profile menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {#if showProfileMenu}
          <div class="profile-menu-backdrop" onclick={() => (showProfileMenu = false)}></div>
          <div class="profile-menu" role="menu" aria-label="Profile menu">
            <button type="button" role="menuitem" class="profile-menu-item" onclick={openProfile}>
              Edit/View Profile
            </button>
            <button type="button" role="menuitem" class="profile-menu-item danger" onclick={handleHeaderSignOut}>
              Sign Out
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <button type="button" class="btn-signin" onclick={handleSignIn}>
        Sign In
      </button>
    {/if}
  </div>
</header>

<ProfilePanel bind:open={showProfilePanel} />
{#if authLoading}
  <div class="auth-loading-banner" role="status" aria-live="polite">
    {authLoadingMessage || 'Loading...'}
  </div>
{/if}

{#if showGraduationPrompt}
  <div class="auth-overlay" role="dialog" aria-modal="true" aria-label="Graduation status">
    <div class="auth-card">
      <h3>Have you graduated?</h3>
      <p class="auth-hint">
        {graduationPromptMessage}
      </p>
      {#if gradDateForPrompt}
        <p class="auth-hint">Graduation date on file: {gradDateForPrompt}</p>
      {/if}
      <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap;">
        <button type="button" class="btn-signin" onclick={confirmGraduated}>
          Yes, I&apos;ve graduated
        </button>
        <button type="button" class="btn-close" onclick={dismissGraduationPrompt}>
          Not yet / Remind me later
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showGradDateModal}
  <div class="auth-overlay" role="dialog" aria-modal="true" aria-label="Update graduation date">
    <div class="auth-card">
      <h3>Update graduation date</h3>
      <p class="auth-hint">Set a new graduation month so we only prompt you again when it passes.</p>
      <div class="field">
        <label for="gradDateForEdit">Graduation date</label>
        <input
          id="gradDateForEdit"
          type="date"
          bind:value={gradDateForEdit}
        />
      </div>
      {#if gradDateSaveError}
        <p class="auth-error">{gradDateSaveError}</p>
      {/if}
      <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap;">
        <button type="button" class="btn-signin" onclick={saveUpdatedGradDate}>
          Save date
        </button>
        <button
          type="button"
          class="btn-close"
          onclick={() => {
            showGradDateModal = false;
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showAuthPanel}
  <div class="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign in">
    <div class="auth-card">
      <h3>Sign In</h3>
      {#if !otpStep}
        <p class="auth-hint">Enter your email. TAMU users are redirected to Google. Others receive an email OTP.</p>
        <input type="email" bind:value={email} placeholder="you@example.com" />
        <button type="button" class="btn-signin" onclick={submitEmail}>Continue</button>
      {:else}
        <p class="auth-hint">Enter the OTP sent to your email (sign-up or sign-in).</p>
        <input type="text" bind:value={otp} placeholder="Enter OTP" />
        {#if otpExpiresAtMs > 0}
          <p class="auth-hint">OTP valid for: {formatOtpCountdown(Math.floor((otpExpiresAtMs - otpNowMs) / 1000))}</p>
        {/if}
        <button type="button" class="btn-signin" onclick={submitOtp}>Verify OTP</button>
      {/if}
      {#if authStatus}<p class="auth-ok">{authStatus}</p>{/if}
      {#if authError}<p class="auth-error">{authError}</p>{/if}
      <button type="button" class="btn-close" onclick={closeAuthPanel}>Cancel</button>
    </div>
  </div>
{/if}

<main class="main">
  <section class="hero">
    <h1 class="hero-title">Engagement Platform</h1>
    <p class="hero-subtitle">
      One place for events, mentorship, and case competitions.
    </p>
    <p class="hero-byline">Powered by the Council for the Management of Information Systems</p>
  </section>
  <section class="features">
    <h2 class="features-heading">What we offer</h2>
    <div class="features-grid">
      {#if $authUser && ($profile.mentorshipInterested === true || signedInProfileRole === 'admin')}
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('mentorship')} onclick={() => currentView.set('mentorship')}>
          <div class="feature-icon" aria-hidden="true">🤝</div>
          <h3 class="feature-title">Mentorship</h3>
          <p class="feature-desc">Connect with industry mentors and peers for guidance, feedback, and career advice.</p>
        </article>
      {/if}
      <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('case-competitions')} onclick={() => currentView.set('case-competitions')}>
          <div class="feature-icon" aria-hidden="true">🏆</div>
          <h3 class="feature-title">Case Competitions</h3>
          <p class="feature-desc">
            {signedInProfileRole === 'admin'
              ? 'Manage competitions, team feedback readiness, and release dates.'
              : 'Compete in case competitions, form teams, and track deadlines and results.'}
          </p>
      </article>
      {#if $authUser}
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('judge-dashboard')} onclick={() => currentView.set('judge-dashboard')}>
          <div class="feature-icon" aria-hidden="true">&#9878;</div>
          <h3 class="feature-title">Judge Dashboard</h3>
          <p class="feature-desc">Review team submissions, grade case competition entries, and provide feedback.</p>
        </article>
      {/if}
      <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('events')} onclick={() => currentView.set('events')}>
        <div class="feature-icon" aria-hidden="true">📅</div>
        <h3 class="feature-title">Events</h3>
        <p class="feature-desc">Discover and register for company info sessions, career fairs, and networking events.</p>
      </article>
      {#if $authUser && signedInProfileRole !== 'friend' && signedInProfileRole !== 'admin'}
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('students-connect')} onclick={() => currentView.set('students-connect')}>
          <div class="feature-icon" aria-hidden="true">👥</div>
          <h3 class="feature-title">Students Connect</h3>
          <p class="feature-desc">Browse other CMIS students, filter by major and degree, and connect via LinkedIn.</p>
        </article>
      {/if}
      {#if signedInProfileRole === 'admin'}
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('manage-users')} onclick={() => currentView.set('manage-users')}>
          <div class="feature-icon" aria-hidden="true">👤</div>
          <h3 class="feature-title">Manage Users</h3>
          <p class="feature-desc">View all users and their roles in the system.</p>
        </article>
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('student-engagement-analytics')} onclick={() => currentView.set('student-engagement-analytics')}>
          <div class="feature-icon" aria-hidden="true">📊</div>
          <h3 class="feature-title">Student Engagement Analytics</h3>
          <p class="feature-desc">Track check-in attendance trends, top attendees, and major/year heatmap insights.</p>
        </article>
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('event-success-analytics')} onclick={() => currentView.set('event-success-analytics')}>
          <div class="feature-icon" aria-hidden="true">📈</div>
          <h3 class="feature-title">Event Success Analytics</h3>
          <p class="feature-desc">Compare RSVP counts, check-in rates, and survey ratings by event category.</p>
        </article>
        <article
          class="feature-card"
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && currentView.set('admins')}
          onclick={() => currentView.set('admins')}>
            <div class="feature-icon" aria-hidden="true">🔧</div>
            <h3 class="feature-title">Admin Dashboard</h3>
            <p class="feature-desc">Manage companies, tiers, and themes for the platform.</p>
          </article>
        <article
          class="feature-card"
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && currentView.set('mentorship-operator')}
          onclick={() => currentView.set('mentorship-operator')}>
          <div class="feature-icon" aria-hidden="true">🎛️</div>
          <h3 class="feature-title">Mentorship Operator</h3>
          <p class="feature-desc">Run mentorship matching, manage schedule settings, and review run history.</p>
        </article>
      {/if}
    </div>
  </section>
  <section class="cta">
    <p class="cta-text">Ready to get started?</p>
    {#if $authUser}
      <button type="button" class="btn-cta" onclick={openProfile}>
        View Profile
      </button>
    {:else}
      <button type="button" class="btn-cta" onclick={handleSignIn}>
        Sign In
      </button>
    {/if}
  </section>
</main>

<footer class="footer">
  <p>© Council for the Management of Information Systems (CMIS). All rights reserved.</p>
</footer>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: 100;
    height: var(--header-height);
    background: var(--maroon);
    border-bottom: 3px solid var(--maroon-dark);
    box-shadow: var(--shadow-sm);
  }
  .header-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-decoration: none;
    color: var(--card-bg);
  }
  .logo:hover {
    text-decoration: none;
  }
  .logo-acronym {
    font-family: var(--font-heading);
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--card-bg);
  }
  .logo-full {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .btn-signin {
    padding: 0.5rem 1.35rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--maroon);
    background: var(--card-bg);
    border: 2px solid var(--card-bg);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s;
  }
  .btn-signin:hover {
    background: var(--maroon-dark);
    border-color: var(--card-bg);
    color: var(--card-bg);
    box-shadow: var(--shadow);
  }
  .btn-signin:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .btn-profile-icon {
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--card-bg);
    border: 2px solid var(--card-bg);
    border-radius: 50%;
    cursor: pointer;
    color: var(--maroon);
    transition: background 0.2s, border-color 0.2s, transform 0.15s, color 0.2s;
  }
  .btn-profile-icon:hover {
    background: var(--maroon-dark);
    border-color: var(--card-bg);
    color: var(--card-bg);
    transform: scale(1.05);
  }
  .btn-profile-icon:active {
    transform: scale(0.98);
  }
  .btn-profile-icon:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .btn-profile-icon svg {
    width: 1.25rem;
    height: 1.25rem;
  }
  .profile-menu-wrap {
    position: relative;
    z-index: 120;
  }
  .profile-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 115;
  }
  .profile-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.5rem);
    z-index: 120;
    min-width: 190px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 0.35rem;
    display: grid;
    gap: 0.2rem;
  }
  .profile-menu-item {
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .profile-menu-item:hover {
    background: var(--maroon-muted);
  }
  .profile-menu-item.danger {
    color: #b3261e;
  }
  .profile-menu-item.danger:hover {
    background: #fde8e8;
  }
  .main {
    min-height: calc(100vh - var(--header-height) - 140px);
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    position: relative;
  }
  .main::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, var(--maroon-muted) 0%, transparent 70%);
    pointer-events: none;
  }
  .hero {
    position: relative;
    max-width: 720px;
    margin: 0 auto;
    padding: 4.5rem 1.5rem 3.5rem;
    text-align: center;
  }
  .hero-title {
    font-family: var(--font-heading);
    font-size: clamp(2.25rem, 5vw, 3.25rem);
    font-weight: 700;
    color: var(--maroon);
    margin: 0 0 0.85rem;
    letter-spacing: -0.02em;
    line-height: 1.12;
  }
  .hero-subtitle {
    font-size: 1.2rem;
    line-height: 1.6;
    color: var(--text);
    margin: 0 0 0.5rem;
    font-weight: 500;
  }
  .hero-byline {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0;
    letter-spacing: 0.01em;
  }
  .features {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }
  .features-heading {
    font-family: var(--font-heading);
    font-size: 1.65rem;
    font-weight: 600;
    color: var(--text);
    text-align: center;
    margin: 0 0 2.25rem;
    letter-spacing: -0.01em;
  }
  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.75rem;
  }
  .feature-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem 1.75rem;
    text-align: center;
    transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s ease;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .feature-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--maroon), var(--gold));
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .feature-card:hover {
    box-shadow: var(--shadow-lg);
    border-color: var(--maroon-light);
    transform: translateY(-2px);
  }
  .feature-card:hover::before {
    opacity: 1;
  }
  .feature-card:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .feature-icon {
    font-size: 2.5rem;
    margin-bottom: 0.85rem;
    line-height: 1;
  }
  .feature-title {
    font-family: var(--font-heading);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 0.5rem;
  }
  .feature-desc {
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-muted);
    margin: 0;
  }
  .cta {
    position: relative;
    text-align: center;
    padding: 2.5rem 1.5rem 3.5rem;
  }
  .cta-text {
    font-size: 1.1rem;
    color: var(--text-muted);
    margin: 0 0 1.25rem;
    font-weight: 500;
  }
  .btn-cta {
    padding: 0.65rem 1.75rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.15s;
  }
  .btn-cta:hover {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
    box-shadow: var(--shadow);
    transform: translateY(-1px);
  }
  .btn-cta:active {
    transform: translateY(0);
  }
  .btn-cta:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .footer {
    padding: 1.5rem 1.5rem 1.75rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted);
    background: var(--card-bg);
    border-top: 1px solid var(--border);
  }
  .footer p {
    margin: 0;
  }
  .auth-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .auth-card {
    width: min(460px, 100%);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    box-shadow: var(--shadow-lg);
    display: grid;
    gap: 0.8rem;
  }
  .auth-card h3 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .auth-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .auth-card input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.7rem;
    font-size: 0.95rem;
  }
  .auth-ok {
    margin: 0;
    color: #1b7f3a;
    font-size: 0.9rem;
  }
  .auth-error {
    margin: 0;
    color: #b3261e;
    font-size: 0.9rem;
  }
  .btn-close {
    padding: 0.45rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 600;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .auth-loading-banner {
    position: fixed;
    top: calc(var(--header-height) + 0.75rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 2100;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-left: 4px solid var(--maroon);
    border-radius: var(--radius);
    padding: 0.55rem 0.9rem;
    box-shadow: var(--shadow);
    font-size: 0.9rem;
    color: var(--text);
  }
</style>
