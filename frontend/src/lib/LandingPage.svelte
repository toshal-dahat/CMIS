<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { startSignInByEmail, confirmEmailOtp } from './auth';
  import { authUser } from './stores/authStore';
  import { currentRole } from './stores/roleStore';
  import { currentView } from './stores/viewStore';
  import { profile } from './stores/profileStore';
  import { fetchGraduationStatus } from './api';
  import ProfilePanel from './ProfilePanel.svelte';

  let showProfilePanel = $state(false);
  let showAuthPanel = $state(false);
  let email = $state('');
  let otp = $state('');
  let authStatus = $state('');
  let authError = $state('');
  let otpStep = $state(false);
  let isAdmin = $state(false); // TODO: Set to true for local testing, false for production
  let isSuperAdmin = $state(false); // TODO: Set to true for local testing, false for production
  let showGraduationPrompt = $state(false);
  let graduationPromptMessage = $state('');
  let gradDateForPrompt = $state('');

  onMount(async () => {
    const { getAuthUser, getSession, getCognitoIdToken, getCognitoGroups } = await import('./auth');
    const { checkIsFirstTimeSignIn, fetchUserProfile } = await import('./api');
    const isOAuthCallback = typeof window !== 'undefined' && window.location.search.includes('code=');
    
    if (isOAuthCallback) {
      await new Promise((r) => setTimeout(r, 600));
    }
    
    try {
      const user = await getAuthUser();
      authUser.set(user ?? null);
      if (user) {
        const isFirstTime = await checkIsFirstTimeSignIn(user);
        if (isOAuthCallback) {
          if (isFirstTime) {
            currentView.set('profile-form');
          } else {
            currentView.set('landing');
            await fetchUserProfile(user);
            await maybeShowGraduationPrompt();
          }
        }
        let idToken = await getCognitoIdToken();
        if (!idToken && isOAuthCallback) {
          await new Promise((r) => setTimeout(r, 400));
          idToken = await getCognitoIdToken();
        }
        if (idToken) {
          console.log('[auth] ID token (for API e.g. Postman):', idToken);
          let groups = await getCognitoGroups(true);
          if (groups.length === 0) {
            await new Promise((r) => setTimeout(r, 400));
            groups = await getCognitoGroups(true);
          }
          console.log('[auth] Cognito groups:', groups);
          // Check if user has admin role (skipped in local dev override)
          if (!import.meta.env.DEV || !isAdmin) {
            isAdmin =
              groups.includes('admins') ||
              groups.includes('Admin') ||
              groups.includes('admin') ||
              groups.includes('ADMIN');
          }
          if (isAdmin) currentRole.set('admins');
          // Check if user has super admin role (skipped in local dev override)
          if (!import.meta.env.DEV || !isSuperAdmin) {
            isSuperAdmin = groups.includes('SuperAdmin') || groups.includes('superadmin') || groups.includes('SUPERADMIN');
          }
        } else {
          const session = await getSession();
          console.warn('[auth] Signed in but no id token in session:', session ? 'session exists, check tokens shape' : 'no session');
        }
      }
    } catch {
      authUser.set(null);
      currentView.set('landing');
    }
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
  }

  async function submitOtp() {
    authError = '';
    const result = await confirmEmailOtp(otp);
    if (!result.ok) {
      authError = result.error;
      return;
    }
    authStatus = 'Sign-in successful.';
    const { getAuthUser, getCognitoIdToken, getCognitoGroups } = await import('./auth');
    const { checkIsFirstTimeSignIn, fetchUserProfile } = await import('./api');
    const user = await getAuthUser();
    authUser.set(user ?? null);
    if (user) {
      const isFirstTime = await checkIsFirstTimeSignIn(user);
      if (isFirstTime) {
        currentView.set('profile-form');
      } else {
        currentView.set('landing');
        await fetchUserProfile(user);
        await maybeShowGraduationPrompt();
      }
      // Check admin group after OTP sign-in
      const idToken = await getCognitoIdToken();
      if (idToken) {
        const groups = await getCognitoGroups(true);
        isAdmin = groups.includes('admins');
        if (isAdmin) currentRole.set('admins');
      }
    }
    showAuthPanel = false;
    email = '';
    otp = '';
    otpStep = false;
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

    gradDateForPrompt = gradDate;
    graduationPromptMessage =
      status.reason === 'after_grad_month'
        ? `Our records show your graduation date is ${status.gradDate ?? gradDate}. Have you graduated and want to convert your account to Alumni?`
        : 'Have you graduated and want to convert your account to Alumni?';
    showGraduationPrompt = true;
  }

  function dismissGraduationPrompt() {
    const monthKey = (gradDateForPrompt ?? '').trim().slice(0, 7);
    if (typeof window !== 'undefined' && monthKey) {
      window.localStorage.setItem(`cmis:gradPromptDismissed:${monthKey}`, '1');
    }
    showGraduationPrompt = false;
  }

  function confirmGraduated() {
    showGraduationPrompt = false;
    currentView.set('graduation-handover');
  }

  function closeAuthPanel() {
    showAuthPanel = false;
    authStatus = '';
    authError = '';
    otpStep = false;
    otp = '';
  }

  function openProfile() {
    showProfilePanel = true;
  }
</script>

<header class="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <span class="logo-acronym">CMIS</span>
      <span class="logo-full">Council for the Management of Information Systems</span>
    </a>
    {#if $authUser}
      <button type="button" class="btn-profile-icon" onclick={openProfile} aria-label="View profile">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    {:else}
      <button type="button" class="btn-signin" onclick={handleSignIn}>
        Sign In
      </button>
    {/if}
  </div>
</header>

<ProfilePanel bind:open={showProfilePanel} />

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
      <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('mentorship')} onclick={() => currentView.set('mentorship')}>
        <div class="feature-icon" aria-hidden="true">🤝</div>
        <h3 class="feature-title">Mentorship</h3>
        <p class="feature-desc">Connect with industry mentors and peers for guidance, feedback, and career advice.</p>
      </article>
      <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('case-competitions')} onclick={() => currentView.set('case-competitions')}>
        <div class="feature-icon" aria-hidden="true">🏆</div>
        <h3 class="feature-title">Case Competitions</h3>
        <p class="feature-desc">Compete in case competitions, form teams, and track deadlines and results.</p>
      </article>
      <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('events')} onclick={() => currentView.set('events')}>
        <div class="feature-icon" aria-hidden="true">📅</div>
        <h3 class="feature-title">Events</h3>
        <p class="feature-desc">Discover and register for company info sessions, career fairs, and networking events.</p>
      </article>
      {#if $authUser}
        <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('students-connect')} onclick={() => currentView.set('students-connect')}>
          <div class="feature-icon" aria-hidden="true">👥</div>
          <h3 class="feature-title">Students Connect</h3>
          <p class="feature-desc">Browse other CMIS students, filter by major and degree, and connect via LinkedIn.</p>
        </article>
        {#if isAdmin}
          <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('manage-users')} onclick={() => currentView.set('manage-users')}>
            <div class="feature-icon" aria-hidden="true">👤</div>
            <h3 class="feature-title">Manage Users</h3>
            <p class="feature-desc">View all users and their roles in the system.</p>
          </article>
          <article class="feature-card" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('admins')} onclick={() => currentView.set('admins')}>
              <div class="feature-icon" aria-hidden="true">🔧</div>
              <h3 class="feature-title">Admin Dashboard</h3>
              <p class="feature-desc">Manage companies, tiers, and themes for the platform.</p>
            </article>
        {/if}
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
</style>