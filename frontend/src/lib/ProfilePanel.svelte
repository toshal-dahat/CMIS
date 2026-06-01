<script lang="ts">
  import { signOutUser } from './auth';
  import { profile } from './stores/profileStore';
  import { authUser } from './stores/authStore';
  import { currentView } from './stores/viewStore';
  import { fetchUserProfile, updateProfile } from './api';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin } from './profileOptions';

  let { open = $bindable(false) } = $props();
  let name = $state('');
  let email = $state('');
  let uin = $state('');
  let degree = $state('');
  let major = $state('');
  let gradDate = $state('');
  let linkedinUrl = $state('');
  let resumeS3Key = $state('');
  let saved = $state(false);
  let saveError = $state('');
  let uinError = $state('');
  let saving = $state(false);

  function syncFormFromProfile() {
    const p = $profile;
    name = p.name ?? '';
    email = p.email ?? '';
    uin = p.uin ?? '';
    degree = p.degree ?? '';
    major = p.major ?? '';
    gradDate = p.gradDate ?? '';
    linkedinUrl = p.linkedinUrl ?? '';
    resumeS3Key = p.resumeS3Key ?? '';
  }

  function handleUinInput(e: Event) {
    const v = (e.target as HTMLInputElement | null)?.value ?? '';
    if (v === '' || /^\d*$/.test(v)) uin = v.slice(0, 9);
    uinError = '';
  }

  // When panel opens: fetch profile then sync form so data shows on first open.
  // Using async so sync runs after fetch; $state() ensures assignments trigger re-render.
  $effect(() => {
    if (!open) return;
    saveError = '';
    saved = false;
    (async () => {
      await fetchUserProfile();
      syncFormFromProfile();
    })();
  });

  // Sync form when profile store changes (e.g. after save).
  $effect(() => {
    if (open) {
      const p = $profile;
      name = p.name ?? '';
      email = p.email ?? '';
      uin = p.uin ?? '';
      degree = p.degree ?? '';
      major = p.major ?? '';
      gradDate = p.gradDate ?? '';
      linkedinUrl = p.linkedinUrl ?? '';
      resumeS3Key = p.resumeS3Key ?? '';
    }
  });

  function closePanel() {
    open = false;
  }

  function handleBackdropClick(event: MouseEvent & { currentTarget: EventTarget & HTMLDivElement }) {
    if (event.target === event.currentTarget) closePanel();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    saveError = '';
    uinError = '';
    if (!validateUin(uin)) {
      uinError = 'UIN must be exactly 9 digits.';
      return;
    }
    if (!degree) {
      saveError = 'Please select a degree.';
      return;
    }
    if (!major) {
      saveError = 'Please select a major.';
      return;
    }
    if (!email?.trim()) {
      saveError = 'Please enter your email.';
      return;
    }
    saving = true;
    const result = await updateProfile({
      name,
      email: email.trim(),
      uin: uin.trim(),
      degree,
      major,
      gradDate,
      linkedInUrl: linkedinUrl || undefined,
      resumeS3Key: resumeS3Key || undefined,
    });
    saving = false;
    if (!result.ok) {
      saveError = result.error || 'Failed to update profile.';
      return;
    }
    saved = true;
    closePanel();
  }

  async function handleSignOut() {
    await signOutUser();
    authUser.set(null);
    currentView.set('landing');
    open = false;
  }
</script>

{#if open}
  <div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-panel-title" onclick={handleBackdropClick}>
    <div class="panel" onclick={(e) => e.stopPropagation()}>
      <div class="panel-header">
        <h2 id="profile-panel-title">My Profile</h2>
        <button type="button" class="btn-close" onclick={closePanel} aria-label="Close">×</button>
      </div>
      <p class="panel-subtitle">View and edit your student profile. Recruiters use this to discover you.</p>

      <form class="profile-form" onsubmit={handleSubmit}>
        <div class="field">
          <label for="profile-name">Name</label>
          <input id="profile-name" type="text" bind:value={name} required placeholder="Your full name" />
        </div>
        <div class="field">
          <label for="profile-email">Email</label>
          <input id="profile-email" type="email" bind:value={email} required placeholder="your.email@tamu.edu" />
        </div>
        <div class="field">
          <label for="profile-uin">UIN</label>
          <input id="profile-uin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="9" value={uin} oninput={handleUinInput} required placeholder="9 digits, e.g. 123456789" />
          {#if uinError}
            <p class="error-message">{uinError}</p>
          {/if}
        </div>
        <div class="field">
          <label for="profile-degree">Degree</label>
          <select id="profile-degree" bind:value={degree} required>
            {#each DEGREE_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="profile-major">Major</label>
          <select id="profile-major" bind:value={major} required>
            {#each MAJOR_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="profile-gradDate">Graduation Year</label>
          <input id="profile-gradDate" type="month" bind:value={gradDate} required />
        </div>
        <div class="field">
          <label for="profile-linkedinUrl">LinkedIn URL</label>
          <input id="profile-linkedinUrl" type="url" bind:value={linkedinUrl} required placeholder="https://www.linkedin.com/in/your-handle" />
        </div>
        <ResumeSection open={open} />
        {#if saveError}
          <p class="error-message">{saveError}</p>
        {/if}
        <div class="actions">
          <button type="button" class="btn-secondary" onclick={closePanel}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
        {#if saved}
          <p class="success-message">Profile updated.</p>
        {/if}
      </form>
      <div class="panel-footer">
        <button type="button" class="btn-signout" onclick={handleSignOut}>Sign Out</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .panel {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg), 0 0 0 1px var(--border);
    border-top: 4px solid var(--maroon);
    max-width: 520px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1.75rem 2rem;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.25rem;
  }

  .panel-header h2 {
    font-family: var(--font-heading);
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--maroon);
  }

  .btn-close {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: var(--radius);
    transition: background 0.15s, color 0.15s;
  }

  .btn-close:hover {
    background: var(--maroon-muted);
    color: var(--maroon);
  }

  .panel-subtitle {
    margin: 0 0 1.25rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .profile-form {
    display: grid;
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .hint {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-left: 0.25rem;
  }

  input {
    padding: 0.55rem 0.75rem;
    font-size: 0.95rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
  }

  select {
    padding: 0.55rem 0.75rem;
    font-size: 0.95rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .btn-primary {
    padding: 0.55rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
    box-shadow: var(--shadow);
  }

  .btn-secondary {
    padding: 0.55rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-secondary:hover {
    background: var(--border);
  }

  .success-message {
    margin-top: 0.5rem;
    font-size: 0.9rem;
    color: #155724;
    background: #d4edda;
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
  }

  .error-message {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: #721c24;
    background: #f8d7da;
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
  }

  .file-info {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: var(--text);
  }

  .panel-footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .btn-signout {
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: color 0.15s, background 0.15s, border-color 0.15s;
  }

  .btn-signout:hover {
    color: var(--maroon);
    background: var(--maroon-muted);
    border-color: var(--maroon-light);
  }
</style>
