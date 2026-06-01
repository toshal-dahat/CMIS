<script>
  import { signup } from '../lib/api.js';

  export let onDone = () => {};

  const CLASS_YEARS = ['2020', '2021', '2022', '2023', '2024', '2025'];
  let email = '';
  let password = '';
  let confirmPassword = '';
  let formerStudent = false;
  let classYear = '';
  let error = '';
  let loading = false;

  $: pwLen = password.length >= 10;
  $: pwUpper = /[A-Z]/.test(password);
  $: pwLower = /[a-z]/.test(password);
  $: pwNum = /[0-9]/.test(password);
  $: pwSpecial = /[^A-Za-z0-9]/.test(password);
  $: pwValid = pwLen && pwUpper && pwLower && pwNum && pwSpecial;
  $: passwordsMatch = password && confirmPassword && password === confirmPassword;

  async function handleSubmit() {
    error = '';
    const em = email.trim().toLowerCase();
    if (!em) {
      error = 'Email is required';
      return;
    }
    if (!pwValid) {
      error = 'Password must meet all requirements below';
      return;
    }
    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    if (formerStudent && !classYear.trim()) {
      error = 'Class Year is required when claiming Former Student';
      return;
    }
    loading = true;
    try {
      await signup({
        email: em,
        password,
        formerStudent,
        classYear: classYear.trim() || undefined,
      });
      onDone();
    } catch (e) {
      error = e.message || 'Registration failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <h2>Create account</h2>
  <p class="intro">Create an account to access the platform. You can link your student record later using your UIN (Graduation Handover).</p>
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}
  <form class="form-block" on:submit|preventDefault={handleSubmit}>
    <h3 class="form-section-title">Account details</h3>
    <div class="form-group">
      <label for="reg-email">Email</label>
      <input id="reg-email" type="email" bind:value={email} required placeholder="you@example.com" />
      <span class="hint">Use any valid email address. You’ll sign in with this.</span>
    </div>
    <div class="form-group">
      <label for="reg-password">Password</label>
      <input id="reg-password" type="password" bind:value={password} required minlength="10" />
      <ul class="password-requirements" aria-label="Password requirements">
        <li class={pwLen ? 'valid' : ''}>At least 10 characters</li>
        <li class={pwUpper ? 'valid' : ''}>Contains uppercase letter</li>
        <li class={pwLower ? 'valid' : ''}>Contains lowercase letter</li>
        <li class={pwNum ? 'valid' : ''}>Contains number</li>
        <li class={pwSpecial ? 'valid' : ''}>Contains special character</li>
      </ul>
    </div>
    <div class="form-group">
      <label for="reg-confirm">Confirm password</label>
      <input id="reg-confirm" type="password" bind:value={confirmPassword} required />
      {#if confirmPassword}
        <span class="hint {passwordsMatch ? 'valid' : 'invalid'}">{passwordsMatch ? '✓ Passwords match' : 'Passwords do not match'}</span>
      {/if}
    </div>
    <div class="section-divider" aria-hidden="true"></div>
    <h3 class="form-section-title">Role (optional)</h3>
    <div class="checkbox-group">
      <input id="former" type="checkbox" bind:checked={formerStudent} />
      <label for="former">I am a Former Student</label>
    </div>
    <p class="hint role-hint">Check this if you’ve graduated and want to link your student record later via Graduation Handover.</p>
    {#if formerStudent}
      <div class="form-group">
        <label for="class-year">Class year</label>
        <select id="class-year" bind:value={classYear} required>
          <option value="">Select year</option>
          {#each CLASS_YEARS as y}
            <option value={y}>{y}</option>
          {/each}
        </select>
        <div class="hint">Required when claiming Former Student</div>
      </div>
    {/if}
    <button class="btn btn-primary" type="submit" disabled={loading || !pwValid || !passwordsMatch}>
      {loading ? 'Creating…' : 'Register'}
    </button>
  </form>
  <p class="login-link">
    Already have an account? <button type="button" class="btn btn-link" on:click={onDone}>Log in</button>
  </p>
  <p class="hint" style="margin-top: 0.5rem;">
    Partner role is assigned if your email domain is on the company list; otherwise you are a Friend, or Former Student if you check the box.
  </p>
</div>

<style>
  .password-requirements {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    font-size: 0.9rem;
    color: var(--text-muted, #666);
  }
  .password-requirements li.valid {
    color: var(--success);
  }
  .hint.valid { color: var(--success); }
  .hint.invalid { color: var(--error); }
  .login-link { margin-top: 1rem; }
  .btn-link {
    background: none;
    border: none;
    color: var(--primary-color);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
    text-decoration: underline;
  }
  .btn-link:hover { opacity: 0.9; color: var(--primary-light); }
  .intro {
    color: var(--text-muted, #555);
    margin-bottom: 1.25rem;
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .form-section-title {
    font-size: 1rem;
    font-weight: 600;
    margin: 1.25rem 0 0.5rem 0;
    color: var(--text);
  }
  .form-section-title:first-of-type { margin-top: 0; }
  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 1.5rem 0 0;
  }
  .role-hint { margin-top: 0.25rem; margin-bottom: 0; }
  .form-block {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
</style>
