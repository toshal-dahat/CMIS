<script>
  import { signin, requestMagicLink } from '../lib/api.js';

  export let onLogin = () => {};
  export let onGoToClaim = () => {};
  export let onGoToRegister = () => {};
  export let onGoToForgotPassword = () => {};

  let email = '';
  let password = '';
  let error = '';
  let loading = false;
  let rememberMe = true;

  // Graduate claim flow
  let showGraduateFlow = false;
  let graduateEmail = '';
  let requestLoading = false;
  let requestSuccess = null; // { message, magicLink? }
  let showPasteToken = false;
  let claimTokenInput = '';

  async function handleRequestLink() {
    error = '';
    requestSuccess = null;
    const em = graduateEmail.trim().toLowerCase();
    if (!em || !em.includes('@')) {
      error = 'Enter your personal email (the one on your graduation record)';
      return;
    }
    requestLoading = true;
    try {
      const result = await requestMagicLink(em);
      requestSuccess = result;
    } catch (e) {
      const msg = e.message || 'Request failed';
      error = msg;
      if (msg.includes('eligible') || msg.includes('not found') || msg.includes('404')) {
        error = msg + ' Check the spelling of your email (e.g. yashassuresh775@gmail.com).';
      }
    } finally {
      requestLoading = false;
    }
  }

  function openClaimFromLink() {
    if (requestSuccess?.magicLink) {
      const match = requestSuccess.magicLink.match(/token=([A-Za-z0-9_-]+)/);
      if (match) onGoToClaim(match[1]);
    }
  }

  function goToClaimFromPaste() {
    let token = claimTokenInput.trim();
    // Try to parse as URL (handles encoded links from email)
    try {
      const url = new URL(token);
      const fromHash = url.hash ? new URLSearchParams(url.hash.replace(/^#/, '').split('?')[1] || '') : null;
      const fromSearch = url.searchParams;
      const t = (fromHash && fromHash.get('token')) || fromSearch.get('token');
      if (t) token = t;
    } catch (_) {}
    // Fallback: extract token=... from string (base64url: A-Za-z0-9_-)
    if (!token || token.includes('=') || token.includes('/') || token.includes('#')) {
      const match = claimTokenInput.trim().match(/token=([A-Za-z0-9_-]+)/);
      if (match) token = match[1];
    }
    token = token.trim();
    if (token && /^[A-Za-z0-9_-]+$/.test(token)) {
      onGoToClaim(token);
    } else {
      error = 'Please paste your claim token or the full magic link URL';
    }
  }

  function resetGraduateFlow() {
    showGraduateFlow = false;
    graduateEmail = '';
    requestSuccess = null;
    error = '';
  }

  async function handleSubmit() {
    error = '';
    if (!email.trim() || !password) {
      error = 'Email and password are required';
      return;
    }
    loading = true;
    try {
      const data = await signin({
        email: email.trim().toLowerCase(),
        password,
      });
      onLogin({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
    } catch (e) {
      error = e.message || 'Sign in failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Log in</h2>
  <div class="info-box">
    <p><strong>Who can sign in?</strong> Partners, former students, and community members who have created an account. Use the email and password you registered with.</p>
    <p class="sso-note">Current students: use your institution’s Google SSO (Team Reveille).</p>
  </div>
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}
  <form class="form-block" on:submit|preventDefault={handleSubmit}>
    <div class="form-group">
      <label for="login-email">Email</label>
      <input id="login-email" type="email" bind:value={email} required placeholder="you@example.com" />
    </div>
    <div class="form-group">
      <label for="login-password">Password</label>
      <input id="login-password" type="password" bind:value={password} required placeholder="Your password" />
    </div>
    <div class="form-group remember-row">
      <input id="remember" type="checkbox" bind:checked={rememberMe} />
      <label for="remember">Remember me</label>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Log in'}
      </button>
      {#if onGoToForgotPassword}
        <button type="button" class="btn btn-link" on:click={onGoToForgotPassword}>Forgot password?</button>
      {/if}
    </div>
  </form>
  {#if onGoToRegister}
    <p class="register-link">Don't have an account? <button type="button" class="btn btn-link" on:click={onGoToRegister}>Register</button></p>
  {/if}

  <div class="claim-section">
    <h3 class="claim-heading">Recent graduate?</h3>
    <p class="hint">Claim your CMIS account using the personal email on your student record.</p>

    {#if showGraduateFlow}
      {#if requestSuccess}
        <div class="alert alert-success">
          {#if requestSuccess.magicLink}
            {requestSuccess.message}
          {:else}
            We sent the claim link to <strong>{graduateEmail.trim().toLowerCase()}</strong>. Check your inbox and spam (or promotions) folder. The link expires in 7 days.
          {/if}
        </div>
        {#if requestSuccess.magicLink}
          <button type="button" class="btn btn-primary claim-cta" on:click={openClaimFromLink}>
            Open claim page →
          </button>
        {/if}
        <button type="button" class="btn btn-link" on:click={resetGraduateFlow}>Start over</button>
      {:else}
        <div class="claim-input-row">
          <input
            type="email"
            bind:value={graduateEmail}
            placeholder="Your personal email (e.g. you@gmail.com)"
            class="claim-token-input"
            disabled={requestLoading}
          />
          <button type="button" class="btn btn-primary" on:click={handleRequestLink} disabled={requestLoading}>
            {requestLoading ? 'Sending…' : 'Get my claim link'}
          </button>
        </div>
        <button type="button" class="btn btn-link" on:click={resetGraduateFlow}>Cancel</button>
      {/if}
    {:else}
      <button type="button" class="btn btn-secondary" on:click={() => { showGraduateFlow = true; error = ''; requestSuccess = null; }}>
        I'm a graduate — get my claim link
      </button>
    {/if}

    <div class="claim-paste">
      <button type="button" class="btn btn-link" on:click={() => { showPasteToken = !showPasteToken; error = ''; }}>
        {showPasteToken ? '▼' : '▶'} Already have a magic link? Paste it here
      </button>
      {#if showPasteToken}
        <div class="claim-input-row">
          <input
            type="text"
            bind:value={claimTokenInput}
            placeholder="Paste token or full URL"
            class="claim-token-input"
          />
          <button type="button" class="btn btn-primary" on:click={goToClaimFromPaste}>
            Go to claim
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .form-block {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    margin-top: 0.25rem;
  }
  .claim-section {
    margin-top: 1.5rem;
    padding: 1.25rem 0 0;
    border-top: 1px solid var(--border);
  }
  .claim-heading {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.35rem 0;
    color: var(--text);
  }
  .claim-section .hint {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
  }
  .claim-input-row {
    display: flex;
    gap: 0.5rem;
    margin: 0.5rem 0;
    flex-wrap: wrap;
  }
  .claim-token-input {
    flex: 1;
    min-width: 200px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 1rem;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .claim-token-input:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(80, 0, 0, 0.15);
  }
  .claim-cta {
    margin: 0.5rem 0;
  }
  .claim-paste {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border);
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--primary-color);
    cursor: pointer;
    padding: 0.25rem 0;
    font-size: 0.95rem;
  }
  .btn-link:hover {
    text-decoration: underline;
  }
  .info-box {
    padding: 1rem;
    background: linear-gradient(135deg, rgba(80, 0, 0, 0.06), rgba(122, 0, 0, 0.04));
    border-radius: var(--radius);
    border-left: 4px solid var(--primary-color);
    margin-bottom: 1.25rem;
    font-size: 0.95rem;
    animation: fadeIn 0.4s ease-out 0.15s backwards;
  }
  .info-box p { margin: 0 0 0.5rem 0; }
  .info-box p:last-child { margin-bottom: 0; }
  .sso-note {
    margin-top: 0.5rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .remember-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .remember-row label { margin: 0; }
  .register-link { margin-top: 1rem; font-size: 0.95rem; }
</style>
