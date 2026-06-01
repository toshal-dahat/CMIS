<script>
  import { forgotPassword } from '../lib/api.js';

  export let onBackToLogin = () => {};
  /** Called after code was sent; pass email so user can go to reset-password page */
  export let onSentResetCode = (email) => {};

  let email = '';
  let loading = false;
  let error = '';
  let sent = false;

  async function sendResetCode() {
    error = '';
    const em = email.trim().toLowerCase();
    if (!em || !em.includes('@')) {
      error = 'Enter your email address';
      return;
    }
    loading = true;
    try {
      await forgotPassword(em);
      sent = true;
      onSentResetCode(em);
    } catch (e) {
      error = e.message || 'Could not send reset code';
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Forgot password?</h2>
  <p class="intro">Enter your email and we’ll send you a code to set a new password. Check your inbox (and spam folder).</p>

  {#if sent}
    <div class="alert alert-success">
      <strong>Check your email.</strong> We sent a reset code to <strong>{email.trim().toLowerCase()}</strong>. Use the code on the next screen to set your new password.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" on:click={() => onSentResetCode(email.trim().toLowerCase())}>
        Set new password
      </button>
    </div>
  {:else}
    <form class="form-block" on:submit|preventDefault={sendResetCode}>
      {#if error}
        <div class="alert alert-error">{error}</div>
      {/if}
      <div class="form-group">
        <label for="fp-email">Email</label>
        <input
          id="fp-email"
          type="email"
          bind:value={email}
          placeholder="you@example.com"
          disabled={loading}
          autocomplete="email"
        />
      </div>
      <button type="submit" class="btn btn-primary" disabled={loading}>
        {loading ? 'Sending…' : 'Send reset code to my email'}
      </button>
    </form>
  {/if}

  <p class="back-row">
    <button type="button" class="btn btn-link" on:click={onBackToLogin}>
      ← Back to Log in
    </button>
  </p>
</div>

<style>
  .intro {
    margin-bottom: 1.25rem;
    line-height: 1.5;
    color: var(--text-muted);
    font-size: 0.95rem;
  }
  .form-block {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .form-actions {
    margin-top: 0.25rem;
  }
  .back-row {
    margin: 1.25rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--primary-color);
    cursor: pointer;
    padding: 0.25rem 0;
    font-size: 0.95rem;
  }
  .btn-link:hover { text-decoration: underline; }
</style>
