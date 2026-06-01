<script lang="ts">
  import { get } from 'svelte/store';
  import { profile } from './stores/profileStore';
  import { currentView } from './stores/viewStore';
  import { externalHandoverLink } from './api';
  import { authUser } from './stores/authStore';

  const p = get(profile);
  let uin = $state((p?.uin ?? '').trim());
  let personalEmail = $state('');
  let status = $state('');
  let error = $state('');
  let linking = $state(false);

  function classYearFromGradDate(gradDate: string): string {
    const d = (gradDate ?? '').trim();
    if (d.length < 4) return '';
    return d.slice(2, 4);
  }

  async function linkAccount() {
    error = '';
    status = '';
    const cleaned = (uin ?? '').trim();
    const email = (personalEmail ?? '').trim().toLowerCase();
    if (!/^\d{9}$/.test(cleaned)) {
      error = 'UIN must be exactly 9 digits.';
      return;
    }
    if (!isValidEmail(email)) {
      error = 'Personal email is required.';
      return;
    }

    linking = true;
    try {
      const cy = classYearFromGradDate(get(profile)?.gradDate ?? '');
      const res = await externalHandoverLink({
        uin: cleaned,
        personalEmail: email,
        classYear: cy || undefined,
      });
      if (!res.ok) {
        error = res.error || 'Link failed.';
        return;
      }
      status = 'Success! Your account has been converted to Alumni.';
      // Return to landing/profile; caller can refresh role via /me if needed.
      currentView.set('landing');
    } finally {
      linking = false;
    }
  }

  function cancel() {
    currentView.set('landing');
  }

  function isValidEmail(email: string): boolean {
    const e = (email ?? '').trim();
    if (!e) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  const canFinish = $derived(/^\d{9}$/.test((uin ?? '').trim()) && isValidEmail((personalEmail ?? '').trim()));
</script>

<div class="wrap">
  <div class="card">
    <h2>Graduation handover</h2>
    <p class="hint">
      Convert your account to Alumni by linking your student UIN and confirming your personal email.
    </p>

    {#if !$authUser}
      <p class="error">You must be signed in to continue.</p>
    {/if}

    <label class="label">
      UIN
      <input class="input" inputmode="numeric" bind:value={uin} placeholder="9 digits (e.g. 123456789)" />
    </label>

    <label class="label">
      Personal email
      <input
        class="input"
        type="email"
        bind:value={personalEmail}
        placeholder="you@gmail.com"
        required
      />
    </label>

    <div class="actions">
      <button class="btn primary" type="button" disabled={linking || !canFinish} onclick={linkAccount}>
        {linking ? 'Linking…' : 'Finish handover'}
      </button>
      <button class="btn ghost" type="button" onclick={cancel}>Cancel</button>
    </div>

    {#if status}
      <p class="ok">{status}</p>
    {/if}
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>
</div>

<style>
  .wrap {
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
  }
  .card {
    width: min(520px, 100%);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 1.25rem;
    display: grid;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .label {
    display: grid;
    gap: 0.35rem;
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
  }
  .input {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.65rem 0.75rem;
    font-size: 0.95rem;
  }
  .btn {
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary {
    border-color: var(--maroon);
    background: var(--maroon);
    color: var(--card-bg);
  }
  .btn.ghost {
    background: transparent;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.5rem 0;
  }
  .ok {
    margin: 0.25rem 0 0;
    color: #1b7f3a;
    font-size: 0.95rem;
  }
  .error {
    margin: 0.25rem 0 0;
    color: #b3261e;
    font-size: 0.95rem;
  }
</style>

