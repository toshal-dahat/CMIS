<script>
  import { handoverLookup, graduationHandover, me } from '../lib/api.js';

  export let accessToken;
  export let user = null; // if has linkedUin, show already-linked message
  export let onDone = () => {};
  export let onCancel = () => {};

  const STEPS = ['Enter UIN', 'Verify', 'Confirm'];
  let step = 1;
  let uin = '';
  let classYear = '';
  let personalEmail = '';
  let password = '';
  let studentProfile = null; // { uin, gradDate, accountStatus }
  let linkedUser = null; // after success, from me()
  let error = '';
  let success = '';
  let loading = false;

  /** UIN digits only, max 9. Valid when exactly 9 digits. */
  $: uinValid = /^\d{9}$/.test(String(uin || '').trim());

  function onUinInput(e) {
    const v = (e.target.value || '').replace(/\D/g, '').slice(0, 9);
    uin = v;
  }

  async function findRecord() {
    error = '';
    if (loading) return;
    if (!uinValid) {
      error = 'UIN must be exactly 9 digits';
      return;
    }
    if (!accessToken) {
      error = 'Please log in again to verify your UIN.';
      return;
    }
    loading = true;
    try {
      const data = await handoverLookup(accessToken, uin.trim());
      studentProfile = data.studentProfile || null;
      step = 2;
    } catch (e) {
      error = e.message || 'Lookup failed';
      if (error.includes('already been claimed')) error = 'This student account has already been linked to another user.';
      else if (error.includes('No student record')) error = 'No student record found. Please verify your UIN.';
      else if (error.includes('Failed to fetch') || error.includes('NetworkError')) error = 'Network error. Check your connection and try again.';
      else if (error.includes('Authorization') || error.includes('token')) error = 'Session expired or invalid. Please log out and log in again.';
    } finally {
      loading = false;
    }
  }

  function tryDifferentUin() {
    step = 1;
    studentProfile = null;
    uin = '';
    error = '';
  }

  async function confirmAndLink() {
    error = '';
    const pe = (personalEmail || '').trim().toLowerCase();
    if (!pe || !pe.includes('@')) {
      error = 'Personal email is required';
      return;
    }
    if (!password) {
      error = 'Enter your current password to verify your identity';
      return;
    }
    loading = true;
    try {
      await graduationHandover(accessToken, {
        uin: studentProfile.uin,
        classYear: classYear.trim() || undefined,
        personalEmail: pe,
        password,
      });
      linkedUser = await me(accessToken);
      success = 'Your account is now linked to your student history.';
      step = 3;
    } catch (e) {
      error = e.message || 'Handover failed';
    } finally {
      loading = false;
    }
  }

</script>

<div class="card">
  <h2>Graduation Handover</h2>
  <p class="intro">Link this account to your student record so your history is available here. You’ll verify with your <strong>UIN</strong> (9-digit student ID) and the personal email we have on file.</p>

  <details class="info-details">
    <summary>What is a UIN?</summary>
    <p>Your UIN (University Identification Number) is a 9-digit number assigned to you as a student. You can find it on your student ID, in Howdy, or in official university emails or letters.</p>
  </details>

  {#if user && user.linkedUin}
    <div class="alert alert-success">You have already linked your student account (UIN: {user.linkedUin}).</div>
    <button class="btn btn-secondary" on:click={onCancel}>Back to Profile</button>
  {:else}
  <!-- Progress stepper -->
  <div class="stepper" role="progressbar" aria-valuenow={step} aria-valuemin="1" aria-valuemax="3">
    {#each STEPS as s, i}
      <span class="step {i + 1 === step ? 'active' : ''} {i + 1 < step ? 'done' : ''}">{i + 1}. {s}</span>
      {#if i < STEPS.length - 1}<span class="step-sep">→</span>{/if}
    {/each}
  </div>

  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}
  {#if success}
    <div class="alert alert-success">{success}</div>
  {/if}

  {#if step === 1}
    <form on:submit|preventDefault={findRecord} class="uin-form">
      <div class="form-group">
        <label for="uin">Your UIN (9 digits)</label>
        <input
          id="uin"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="e.g. 123456789"
          maxlength="9"
          value={uin}
          on:input={onUinInput}
          disabled={loading}
        />
        <span class="hint">Enter your 9-digit UIN to verify your identity and find your student record.</span>
      </div>
      {#if loading}
        <p class="verifying-msg" role="status">Verifying UIN…</p>
      {/if}
      <button
        class="btn btn-primary"
        type="button"
        disabled={loading || !uinValid}
        on:click={findRecord}
      >
        {loading ? 'Verifying…' : 'Verify with UIN'}
      </button>
    </form>
  {:else if step === 2 && studentProfile}
    <div class="verify-box">
      <h3>UIN verified — Is this your record?</h3>
      <p class="hint">We found a student record for this UIN. Confirm it's yours before linking.</p>
      <dl class="profile-dl">
        <dt>UIN</dt>
        <dd>{studentProfile.uin}</dd>
        {#if studentProfile.gradDate}
          <dt>Graduation date</dt>
          <dd>{studentProfile.gradDate}</dd>
        {/if}
        {#if studentProfile.accountStatus}
          <dt>Status</dt>
          <dd>{studentProfile.accountStatus}</dd>
        {/if}
      </dl>
      <p class="security-notice">Ensure this is your correct student record before confirming. This action is permanent and cannot be undone.</p>
      <form on:submit|preventDefault={confirmAndLink} class="confirm-form">
        <div class="form-group">
          <label for="personal-email">Personal email</label>
          <input id="personal-email" type="email" bind:value={personalEmail} placeholder="e.g. you@gmail.com" />
          <span class="hint">Must match the personal email on file for this UIN.</span>
        </div>
        <div class="form-group">
          <label for="handover-password">Your password</label>
          <input id="handover-password" type="password" bind:value={password} placeholder="Your account password" />
          <span class="hint">Confirm your identity with your current sign-in password.</span>
        </div>
        <div class="form-group">
          <label for="handover-class-year">Class year (optional)</label>
          <input id="handover-class-year" type="text" bind:value={classYear} placeholder="e.g. 26" />
        </div>
        <div class="button-row">
          <button class="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Linking…' : 'Yes, Link This Account'}
          </button>
          <button type="button" class="btn btn-secondary" on:click={tryDifferentUin}>No, Try Different UIN</button>
        </div>
      </form>
    </div>
  {:else if step === 3}
    <div class="success-step">
      <p><strong>Your account is now linked.</strong> Your student record is connected to this profile. You can view your full profile and linked UIN on the Profile page.</p>
      <button class="btn btn-primary" on:click={() => onDone(linkedUser)}>Go to Profile</button>
    </div>
  {/if}

  <div class="security-notice bottom">
    <strong>Security notice:</strong> This action is permanent and cannot be undone. Ensure this is your correct student record before confirming.
  </div>

  <button class="btn btn-secondary" style="margin-top: 1rem;" on:click={onCancel}>Cancel</button>
  {/if}
</div>

<style>
  .stepper {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
  }
  .step {
    color: var(--text-muted);
    transition: color 0.25s ease, transform 0.2s ease;
  }
  .step.active {
    font-weight: 600;
    color: var(--primary-color);
  }
  .step.done {
    color: var(--success);
  }
  .step-sep {
    color: var(--text-muted);
    margin: 0 0.25rem;
  }
  .verify-box {
    margin: 1rem 0;
  }
  .verify-box h3 { margin-top: 0; }
  .profile-dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 1rem;
    margin: 1rem 0;
  }
  .profile-dl dt { font-weight: 600; color: var(--text-muted); }
  .security-notice {
    margin: 1rem 0;
    padding: 0.75rem;
    background: linear-gradient(90deg, rgba(184, 134, 11, 0.12), transparent);
    border-left: 4px solid var(--warning);
    font-size: 0.9rem;
    animation: fadeIn 0.35s ease-out backwards;
  }
  .security-notice.bottom { margin-top: 1.5rem; }
  .confirm-form { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  .button-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
  .intro {
    margin-bottom: 1rem;
    line-height: 1.5;
    color: var(--text-color, #333);
  }
  .info-details {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, rgba(80, 0, 0, 0.06), rgba(80, 0, 0, 0.03));
    border-radius: 8px;
    border: 1px solid rgba(80, 0, 0, 0.2);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .info-details[open] {
    box-shadow: 0 2px 8px rgba(80, 0, 0, 0.08);
  }
  .info-details summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--primary-color);
  }
  .info-details summary:hover {
    color: var(--primary-light);
  }
  .info-details p {
    margin: 0.5rem 0 0 0;
    font-size: 0.95rem;
    color: var(--text-muted, #555);
    line-height: 1.5;
  }
  .success-step {
    margin: 1rem 0;
  }
  .success-step p { margin-bottom: 1rem; }
  .verifying-msg {
    margin: 0.5rem 0;
    color: var(--primary-color);
    font-weight: 500;
    animation: verifyingPulse 1.2s ease-in-out infinite;
  }
  @keyframes verifyingPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
