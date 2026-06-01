<script>
  import { resetPassword } from '../lib/api.js';
  import { onMount } from 'svelte';

  export let onDone = () => {};
  export let onBack = () => {};
  /** Pre-filled when coming from Forgot Password flow */
  export let emailPreFill = '';

  let email = '';
  let code = '';
  let newPassword = '';
  let confirmPassword = '';
  let loading = false;
  let error = '';
  let success = '';

  onMount(() => {
    if (emailPreFill) email = emailPreFill;
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const q = hash.indexOf('?');
      const params = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : (window.location.search || '').slice(1));
      if (!email) email = params.get('email') || '';
      if (!code) code = params.get('code') || '';
    }
  });

  async function submitReset() {
    error = '';
    const em = email.trim().toLowerCase();
    if (!em || !em.includes('@')) {
      error = 'Enter your email address';
      return;
    }
    if (!code.trim()) {
      error = 'Enter the code from your email';
      return;
    }
    if (!newPassword || newPassword.length < 10) {
      error = 'New password must be at least 10 characters';
      return;
    }
    if (newPassword !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    loading = true;
    try {
      await resetPassword({
        email: em,
        code: code.trim(),
        newPassword,
      });
      success = 'Password has been reset. You can sign in with your new password.';
      setTimeout(() => onDone(), 2000);
    } catch (e) {
      error = e.message || 'Reset failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Reset password</h2>
  <p class="intro">Set a new password using the code we sent to your email.</p>
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}
  {#if success}
    <div class="alert alert-success">{success}</div>
  {:else}
    <form class="form-block" on:submit|preventDefault={submitReset}>
      <div class="field-group">
        <span class="field-group-label">Your email & code</span>
        <div class="form-group">
          <label for="rp-email">Email</label>
          <input id="rp-email" type="email" bind:value={email} placeholder="you@tamu.edu" disabled={loading} />
        </div>
        <div class="form-group">
          <label for="rp-code">Reset code</label>
          <input id="rp-code" type="text" bind:value={code} placeholder="123456" disabled={loading} />
        </div>
      </div>
      <div class="field-group">
        <span class="field-group-label">New password</span>
        <div class="form-group">
          <label for="rp-new">New password</label>
          <input id="rp-new" type="password" bind:value={newPassword} placeholder="At least 10 characters" disabled={loading} />
        </div>
        <div class="form-group">
          <label for="rp-confirm">Confirm new password</label>
          <input id="rp-confirm" type="password" bind:value={confirmPassword} placeholder="Repeat password" disabled={loading} />
        </div>
      </div>
      <button class="btn btn-primary" type="submit" disabled={loading}>
        {loading ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  {/if}

  <p class="back-row">
    <button type="button" class="btn btn-link" on:click={onBack}>← Back to log in</button>
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
  .field-group {
    margin-bottom: 1.25rem;
  }
  .field-group:last-of-type {
    margin-bottom: 1rem;
  }
  .field-group-label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
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
