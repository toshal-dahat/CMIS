<script lang="ts">
  import { onMount } from 'svelte';
  import { profile } from './stores/profileStore';
  import { currentView } from './stores/viewStore';
  import { createProfile, fetchUserProfile } from './api';
  import { getCognitoGroups, getIdentityPrefill, waitForCognitoIdToken } from './auth';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin } from './profileOptions';

  let name = '';
  let email = '';
  let uin = '';
  let staffId = '';
  let university = '';
  let degree = '';
  let major = '';
  let gradDate = '';
  let linkedinUrl = '';
  let selectedProfileRole = '';
  let signupRole = $state<'student' | 'friend' | 'investor' | 'admin'>('student');
  let submitError = '';
  let uinError = '';
  let submitting = false;
  let submitted = false;
  let resumeSectionRef: { uploadSelectedFile: () => Promise<{ ok: boolean; s3Key?: string; error?: string }> } | null = null;
  const PROFILE_FORM_DISMISSED_KEY = 'cmis:profileFormDismissed';

  function hasManagedGroup(groups: string[]): boolean {
    return groups.some((g) => /^(students?|friends?|investors?|admins?)$/i.test((g ?? '').trim()));
  }

  function hydrateFromProfile() {
    const p = $profile;
    if (p.name) name = p.name;
    if (p.email) email = p.email;
    if (p.uin) uin = p.uin;
    if (p.staffId) staffId = p.staffId;
    if (p.university) university = p.university;
    if (p.degree) degree = p.degree;
    if (p.major) major = p.major;
    if (p.gradDate) gradDate = toDateInputValue(p.gradDate);
    if (p.linkedinUrl) linkedinUrl = p.linkedinUrl;
  }

  function toDateInputValue(value: string): string {
    const v = (value ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
    return '';
  }

  function toApiGradDate(value: string): string | undefined {
    const v = (value ?? '').trim();
    if (!v) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(v)) return v;
    return undefined;
  }

  onMount(() => {
    hydrateFromProfile();
    (async () => {
      // First-time signup can render before token claims are ready.
      // Wait briefly so name/email prefill from JWT is available.
      await waitForCognitoIdToken(2200);
      const prefill = await getIdentityPrefill();
      let groups = await getCognitoGroups();
      if (!hasManagedGroup(groups)) groups = await getCognitoGroups(true);

      if (groups.some((g) => /^admins?$/i.test(g))) {
        signupRole = 'admin';
      } else if (groups.some((g) => /^investors?$/i.test(g))) {
        signupRole = 'investor';
      } else if (groups.some((g) => /^friends?$/i.test(g))) {
        signupRole = 'friend';
      } else if (groups.some((g) => /^students?$/i.test(g))) {
        signupRole = 'student';
      } else {
        // Fallback when groups are missing/unexpected: render generic friend profile.
        signupRole = 'friend';
      }

      console.log('[auth] Cognito groups:', groups);
      console.log('[profile-form] resolved role from groups:', signupRole);

      if (!name && prefill.name) name = prefill.name;
      if (!email && prefill.email) email = prefill.email;
      await fetchUserProfile();
      hydrateFromProfile();
      // Keep identity-prefilled values for first-time users when profile doesn't exist yet.
      if (!name && prefill.name) name = prefill.name;
      if (!email && prefill.email) email = prefill.email;
    })();
  });

  // If profile store updates after mount (e.g. late fetch), hydrate empty fields.
  $effect(() => {
    const p = $profile;
    if (!name && p.name) name = p.name;
    if (!email && p.email) email = p.email;
    if (!uin && p.uin) uin = p.uin;
    if (!staffId && p.staffId) staffId = p.staffId;
    if (!university && p.university) university = p.university;
    if (!degree && p.degree) degree = p.degree;
    if (!major && p.major) major = p.major;
    if (!gradDate && p.gradDate) gradDate = p.gradDate;
    if (!linkedinUrl && p.linkedinUrl) linkedinUrl = p.linkedinUrl;
  });

  function handleUinInput(e: Event) {
    const v = (e.target as HTMLInputElement | null)?.value ?? '';
    if (v === '' || /^\d*$/.test(v)) uin = v.slice(0, 9);
    uinError = '';
  }

  function closeForm() {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(PROFILE_FORM_DISMISSED_KEY, '1');
      }
    } catch {
      // ignore
    }
    currentView.set('landing');
  }

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    submitError = '';
    uinError = '';
    const isStudentRole = signupRole === 'student';
    const isAdminRole = signupRole === 'admin';

    if (!name?.trim()) {
      submitError = 'Please enter your name.';
      return;
    }
    if (!email?.trim()) {
      submitError = 'Please enter your email.';
      return;
    }
    if (isStudentRole && !validateUin(uin)) {
      uinError = 'UIN must be exactly 9 digits.';
      return;
    }
    submitting = true;
    let resumeS3Key = $profile.resumeS3Key || '';
    if (resumeSectionRef) {
      const uploadResult = await resumeSectionRef.uploadSelectedFile();
      if (!uploadResult.ok) {
        submitting = false;
        submitError = uploadResult.error || 'Resume upload failed, please retry.';
        return;
      }
      if (uploadResult.s3Key) resumeS3Key = uploadResult.s3Key;
    }

    const result = await createProfile({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      uin: isStudentRole ? uin.trim() : undefined,
      staffId: isAdminRole ? (staffId.trim() || undefined) : undefined,
      university: !isStudentRole && !isAdminRole ? (university.trim() || undefined) : undefined,
      degree: isAdminRole ? undefined : degree || undefined,
      major: isAdminRole ? undefined : major || undefined,
      gradDate: isAdminRole ? undefined : toApiGradDate(gradDate),
      linkedInUrl: isAdminRole ? undefined : linkedinUrl.trim() || undefined,
      resumeS3Key: isAdminRole ? undefined : resumeS3Key || undefined,
      role: isAdminRole ? (selectedProfileRole.trim() || undefined) : undefined,
    });
    submitting = false;

    if (!result.ok) {
      submitError = result.error || 'Failed to create profile.';
      return;
    }

    submitted = true;
    setTimeout(() => {
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(PROFILE_FORM_DISMISSED_KEY);
        }
      } catch {
        // ignore
      }
      currentView.set('landing');
    }, 1500);
  };
</script>

<section class="profile-form-container">
  <div class="form-header">
    <h1 class="heading">
      {signupRole === 'admin'
        ? 'Admin Profile'
        : signupRole === 'investor'
          ? 'Investor Profile'
          : signupRole === 'friend'
            ? 'Profile'
            : 'Student Profile'}
    </h1>
    <button type="button" class="btn-close" onclick={closeForm} aria-label="Close profile form">×</button>
  </div>
  <p class="subheading">
    {signupRole === 'admin'
      ? 'Fill out your admin profile details.'
      : signupRole === 'student'
      ? 'Fill out your details so TAMU CMIS recruiters can discover you.'
      : 'Fill out your profile details.'}
  </p>

  <form class="profile-form" onsubmit={handleSubmit}>
    <div class="field">
      <label for="name">Name <span class="required-mark">*</span></label>
      <input
        id="name"
        type="text"
        bind:value={name}
        required
        placeholder="Your full name"
      />
    </div>

    <div class="field">
      <label for="email">Email <span class="required-mark">*</span></label>
      <input
        id="email"
        type="email"
        bind:value={email}
        required
        placeholder="your.email@tamu.edu"
      />
    </div>

    {#if signupRole === 'student'}
      <div class="field">
        <label for="uin">UIN (University Identification Number) <span class="required-mark">*</span></label>
        <input
          id="uin"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="9"
          value={uin}
          oninput={handleUinInput}
          required
          placeholder="9 digits, e.g. 123456789"
        />
        {#if uinError}
          <p class="error-message">{uinError}</p>
        {/if}
      </div>
    {:else if signupRole === 'friend' || signupRole === 'investor'}
      <div class="field">
        <label for="university">University</label>
        <input
          id="university"
          type="text"
          bind:value={university}
          placeholder="Your university"
        />
      </div>
    {:else if signupRole === 'admin'}
      <div class="field">
        <label for="staffId">Staff ID</label>
        <input
          id="staffId"
          type="text"
          bind:value={staffId}
          placeholder="Staff ID"
        />
      </div>

      <div class="field">
        <label for="profileRole">Role</label>
        <input
          id="profileRole"
          type="text"
          bind:value={selectedProfileRole}
          placeholder="Role"
        />
      </div>
    {/if}

    {#if signupRole !== 'admin'}
      <div class="field">
        <label for="degree">
          Degree
        </label>
        <select id="degree" bind:value={degree}>
          {#each DEGREE_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="major">
          Major
        </label>
        <select id="major" bind:value={major}>
          {#each MAJOR_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="gradDate">
          Graduation Year
        </label>
        <input
          id="gradDate"
          type="date"
          bind:value={gradDate}
        />
      </div>

      <div class="field">
        <label for="linkedinUrl">
          LinkedIn URL
        </label>
        <input
          id="linkedinUrl"
          type="url"
          bind:value={linkedinUrl}
          placeholder="https://www.linkedin.com/in/your-handle"
        />
      </div>

      <ResumeSection open={true} bind:this={resumeSectionRef} />
    {/if}

    {#if submitError}
      <p class="error-message">{submitError}</p>
    {/if}

    <button type="submit" class="submit-button" disabled={submitting}>
      {submitting ? 'Saving…' : 'Save Profile'}
    </button>

    {#if submitted}
      <p class="success-message">Profile saved successfully.</p>
    {/if}
  </form>
</section>

<style>
  :global(body) {
    margin: 0;
    font-family: var(--font-body);
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    color: var(--text);
    min-height: 100vh;
  }

  .profile-form-container {
    max-width: 640px;
    margin: 3rem auto;
    padding: 2.5rem 2rem;
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg), 0 0 0 1px var(--border);
    border-top: 4px solid var(--maroon);
  }

  .heading {
    font-family: var(--font-heading);
    margin: 0 0 0.5rem;
    font-size: 1.9rem;
    font-weight: 700;
    color: var(--maroon);
  }

  .form-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
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

  .subheading {
    margin: 0 0 1.5rem;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  .profile-form {
    display: grid;
    gap: 1.1rem;
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

  .required-mark {
    color: #b3261e;
    margin-left: 0.15rem;
  }

  .hint {
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-left: 0.25rem;
  }

  input {
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  }

  input::placeholder {
    color: var(--text-muted);
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
    background: var(--card-bg);
  }

  select {
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }

  .submit-button {
    margin-top: 0.5rem;
    padding: 0.7rem 1.5rem;
    border-radius: var(--radius);
    border: 2px solid var(--maroon);
    background: var(--maroon);
    color: var(--card-bg);
    font-size: 0.98rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    box-shadow: var(--shadow);
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.15s;
  }

  .submit-button:hover:not(:disabled) {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }

  .submit-button:active {
    transform: translateY(0);
  }

  .submit-button:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .success-message {
    margin-top: 0.75rem;
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

  @media (max-width: 600px) {
    .profile-form-container {
      margin: 1.5rem 1rem;
      padding: 2rem 1.5rem;
    }

    .heading {
      font-size: 1.6rem;
    }
  }
</style>
