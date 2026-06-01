<script lang="ts">
  import { onMount } from 'svelte';
  import { profile } from './stores/profileStore';
  import { currentView } from './stores/viewStore';
  import { createProfile, fetchUserProfile } from './api';
  import { getCognitoGroups, getIdentityPrefill, waitForCognitoIdToken } from './auth';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin, validateEmailCsv, normalizeEmailCsv } from './profileOptions';

  let name = '';
  let email = '';
  let uin = '';
  let staffId = '';
  let university = '';
  let degree = '';
  let major = '';
  let gradDate = '';
  let personalEmailForAlumni = '';
  let isFormerStudentChecked = false;
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
    // Fallback for locale-typed values like MM/DD/YYYY.
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
    return undefined;
  }

  function emailPartsFromCsv(value: string): string[] {
    return (value ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
  }

  function csvHasTamu(value: string): boolean {
    return emailPartsFromCsv(value).some((e) => e.endsWith('@tamu.edu'));
  }

  function toYearMonth(value: string | undefined): { year: number; month: number } | null {
    const v = (value ?? '').trim();
    if (!v) return null;
    const parts = v.split('-');
    if (parts.length < 2) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month };
  }

  function isPastOrCurrentGradMonth(gradYm: string | undefined): boolean {
    const ym = toYearMonth(gradYm);
    if (!ym) return false;
    const d = new Date();
    const ty = d.getFullYear();
    const tm = d.getMonth() + 1;
    return ty > ym.year || (ty === ym.year && tm >= ym.month);
  }

  function hasExistingProfileData(): boolean {
    const p = $profile;
    return !!(
      p.name ||
      p.email ||
      p.uin ||
      p.staffId ||
      p.university ||
      p.degree ||
      p.major ||
      p.gradDate ||
      p.linkedinUrl ||
      p.resumeS3Key ||
      p.role
    );
  }

  onMount(() => {
    (async () => {
      // First-time signup can render before token claims are ready.
      // Wait briefly so name/email prefill from JWT is available.
      await waitForCognitoIdToken(2200);
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

      await fetchUserProfile();
      if (hasExistingProfileData()) {
        hydrateFromProfile();
      } else {
        const prefill = await getIdentityPrefill();
        if (prefill.name) name = prefill.name;
        if (prefill.email) email = prefill.email;
      }
    })();
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
    if (!validateEmailCsv(email)) {
      submitError =
        'Enter one or more valid emails separated by commas (e.g. your.name@tamu.edu, you@gmail.com).';
      return;
    }
    if (isStudentRole && !validateUin(uin)) {
      uinError = 'UIN must be exactly 9 digits.';
      return;
    }
    submitting = true;
    try {
      // Capture current resume key, but refresh after uploadSelectedFile() in case it was skipped.
      let resumeS3Key = $profile.resumeS3Key || '';
      if (resumeSectionRef) {
        const uploadResult = await resumeSectionRef.uploadSelectedFile();
        if (!uploadResult.ok) {
          submitError = uploadResult.error || 'Resume upload failed, please retry.';
          return;
        }
        // If the upload was skipped (resume already uploaded), uploadSelectedFile() may not return s3Key.
        // In that case, re-read from the profile store so we persist the correct value.
        if (uploadResult.s3Key) resumeS3Key = uploadResult.s3Key;
        resumeS3Key = $profile.resumeS3Key || resumeS3Key;
      }

      const apiGradDate = isAdminRole ? undefined : toApiGradDate(gradDate);
      const baseEmailCsv = normalizeEmailCsv(email);
      const hasTamuEmail = csvHasTamu(baseEmailCsv);
      const graduatedNowOrPast = isPastOrCurrentGradMonth(apiGradDate);

      let finalEmailCsv = baseEmailCsv;
      let explicitRole: string | undefined = isAdminRole ? (selectedProfileRole.trim() || undefined) : undefined;

      if (!isAdminRole) {
        // 1) TAMU + past grad date => require personal email and auto Alumni/Friend.
        if (hasTamuEmail && graduatedNowOrPast) {
          const pe = (personalEmailForAlumni ?? '').trim().toLowerCase();
          // Non-blocking: if personal email isn't provided (or field didn't render),
          // still save the profile as FORMER_STUDENT based on past graduation date.
          if (pe && validateEmailCsv(pe)) {
            const merged = Array.from(
              new Set([...emailPartsFromCsv(baseEmailCsv), ...emailPartsFromCsv(pe)])
            );
            finalEmailCsv = merged.join(', ');
          }
          explicitRole = 'FORMER_STUDENT';
        }

        // 1b) TAMU + future grad date => keep student role only.
        if (hasTamuEmail && !graduatedNowOrPast) {
          explicitRole = 'STUDENT';
        }

        // 2) Personal-email-first users can opt into former student.
        if (!hasTamuEmail) {
          explicitRole = isFormerStudentChecked ? 'FORMER_STUDENT' : 'FRIEND';
          if (isFormerStudentChecked && !apiGradDate) {
            submitError = 'Please provide graduation date for former student selection.';
            return;
          }
        }
      }

      const result = await createProfile({
        name: name.trim(),
        email: finalEmailCsv,
        uin: isStudentRole ? uin.trim() : undefined,
        staffId: isAdminRole ? (staffId.trim() || undefined) : undefined,
        university: !isStudentRole && !isAdminRole ? (university.trim() || undefined) : undefined,
        degree: isAdminRole ? undefined : degree || undefined,
        major: isAdminRole ? undefined : major || undefined,
        gradDate: apiGradDate,
        linkedInUrl: isAdminRole ? undefined : linkedinUrl.trim() || undefined,
        resumeS3Key: isAdminRole ? undefined : resumeS3Key || undefined,
        role: explicitRole,
      });

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
    } catch (err) {
      submitError = (err as Error)?.message || 'Failed to save profile.';
    } finally {
      submitting = false;
    }
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

  <form class="profile-form" novalidate onsubmit={handleSubmit}>
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
        type="text"
        inputmode="email"
        autocomplete="email"
        bind:value={email}
        required
        placeholder="your.name@tamu.edu, personal@gmail.com"
      />
      <p class="field-hint">Use commas to separate multiple addresses if needed.</p>
    </div>

    {#if signupRole !== 'admin' && normalizeEmailCsv(email).trim() && !csvHasTamu(normalizeEmailCsv(email))}
      <div class="field">
        <label for="formerStudentChecked">Former student?</label>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input
            id="formerStudentChecked"
            type="checkbox"
            bind:checked={isFormerStudentChecked}
            style="width:auto;"
          />
          <span class="field-hint" style="font-size:0.9rem;">Are you a former student?</span>
        </div>
      </div>
    {/if}

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

  .field-hint {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.35;
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
