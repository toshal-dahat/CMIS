<script lang="ts">
  import { getCognitoGroups, signOutUser } from './auth';
  import { profile } from './stores/profileStore';
  import { authUser } from './stores/authStore';
  import { currentView } from './stores/viewStore';
  import { createProfile, fetchUserProfile, updateProfile, fetchMasterSkills } from './api';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin, validateEmailCsv, normalizeEmailCsv } from './profileOptions';
  import type { EducationRow, ExperienceRow, Profile } from './types';

  let { open = $bindable(false) } = $props();
  let name = $state('');
  let email = $state('');
  let uin = $state('');
  let staffId = $state('');
  let university = $state('');
  let degree = $state('');
  let major = $state('');
  let gradDate = $state('');
  let personalEmailForAlumni = $state('');
  let isFormerStudentChecked = $state(false);
  let linkedinUrl = $state('');
  let selectedProfileRole = $state('');
  let panelRole = $state<'student' | 'friend' | 'investor' | 'admin'>('student');
  let resumeS3Key = $state('');
  let saved = $state(false);
  let saveError = $state('');
  let uinError = $state('');
  let saving = $state(false);
  let showSavedBanner = $state(false);
  let savedBannerTimeout: ReturnType<typeof setTimeout> | null = null;
  let resumeSectionRef = $state<{ uploadSelectedFile: () => Promise<{ ok: boolean; s3Key?: string; error?: string }> } | null>(null);

  let profileGpa = $state('');
  let educationRows = $state<EducationRow[]>([]);
  let experienceRows = $state<ExperienceRow[]>([]);
  let selectedSkillIds = $state<string[]>([]);
  let masterSkills = $state<{ skillId: string; canonicalName: string }[]>([]);
  let skillFilter = $state('');
  let extraProjectsJson = $state('');
  let extraExtracurricular = $state('');
  let extraAchievements = $state('');
  let extraOther = $state('');

  function emptyEducationRow(): EducationRow {
    return {
      institution: '',
      degreeDiploma: '',
      specialization: '',
      gpa: '',
      dates: '',
      details: '',
    };
  }

  function emptyExperienceRow(): ExperienceRow {
    return { company: '', title: '', dates: '', highlights: '' };
  }

  function buildResumeExtraFromForm(): Profile['resumeExtra'] {
    let projects: unknown[] = [];
    try {
      if (extraProjectsJson.trim()) projects = JSON.parse(extraProjectsJson) as unknown[];
      if (!Array.isArray(projects)) projects = [];
    } catch {
      projects = [];
    }
    return {
      projects,
      extracurricular: extraExtracurricular
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      achievements: extraAchievements
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      other: extraOther
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    };
  }

  function hasManagedGroup(groups: string[]): boolean {
    return groups.some((g) => /^(students?|friends?|investors?|admins?)$/i.test((g ?? '').trim()));
  }

  function syncFormFromProfile() {
    const p = $profile;
    name = p.name ?? '';
    email = p.email ?? '';
    uin = p.uin ?? '';
    staffId = p.staffId ?? '';
    university = p.university ?? '';
    degree = p.degree ?? '';
    major = p.major ?? '';
    gradDate = toDateInputValue(p.gradDate ?? '');
    linkedinUrl = p.linkedinUrl ?? '';
    selectedProfileRole = p.role ?? '';
    resumeS3Key = p.resumeS3Key ?? '';
    profileGpa = p.gpa ?? '';
    educationRows =
      p.education && p.education.length > 0 ? p.education.map((r) => ({ ...r })) : [emptyEducationRow()];
    experienceRows =
      p.experience && p.experience.length > 0
        ? p.experience.map((r) => ({ ...r }))
        : [emptyExperienceRow()];
    selectedSkillIds = [...(p.skillIds ?? [])];
    const rx = p.resumeExtra;
    try {
      extraProjectsJson = rx?.projects?.length
        ? JSON.stringify(rx.projects, null, 2)
        : '';
    } catch {
      extraProjectsJson = '';
    }
    extraExtracurricular = (rx?.extracurricular ?? []).join('\n');
    extraAchievements = (rx?.achievements ?? []).join('\n');
    extraOther = (rx?.other ?? []).join('\n');
  }

  async function resolvePanelRoleFromGroups() {
    let groups = await getCognitoGroups();
    if (!hasManagedGroup(groups)) groups = await getCognitoGroups(true);
    if (groups.some((g) => /^admins?$/i.test(g))) {
      panelRole = 'admin';
    } else if (groups.some((g) => /^investors?$/i.test(g))) {
      panelRole = 'investor';
    } else if (groups.some((g) => /^friends?$/i.test(g))) {
      panelRole = 'friend';
    } else if (groups.some((g) => /^students?$/i.test(g))) {
      panelRole = 'student';
    } else {
      panelRole = 'friend';
    }
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
      await resolvePanelRoleFromGroups();
      masterSkills = await fetchMasterSkills();
    })();
  });

  function closePanel() {
    open = false;
  }

  function showProfileSavedBanner() {
    showSavedBanner = true;
    if (savedBannerTimeout) clearTimeout(savedBannerTimeout);
    savedBannerTimeout = setTimeout(() => {
      showSavedBanner = false;
    }, 3000);
  }

  function handleBackdropClick(event: MouseEvent & { currentTarget: EventTarget & HTMLDivElement }) {
    if (event.target === event.currentTarget) closePanel();
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    saveError = '';
    uinError = '';
    const isStudentRole = panelRole === 'student';
    const isAdminRole = panelRole === 'admin';
    if (!name?.trim()) {
      saveError = 'Please enter your name.';
      return;
    }
    if (!email?.trim()) {
      saveError = 'Please enter your email.';
      return;
    }
    if (!validateEmailCsv(email)) {
      saveError =
        'Enter one or more valid emails separated by commas (e.g. your.name@tamu.edu, you@gmail.com).';
      return;
    }
    if (isStudentRole && !validateUin(uin)) {
      uinError = 'UIN must be exactly 9 digits.';
      return;
    }
    saving = true;
    try {
      if (!isAdminRole && resumeSectionRef) {
        const uploadResult = await resumeSectionRef.uploadSelectedFile();
        if (!uploadResult.ok) {
          saveError = uploadResult.error || 'Resume upload failed, please retry.';
          return;
        }
          if (uploadResult.s3Key) resumeS3Key = uploadResult.s3Key;
          // uploadSelectedFile may return `skipped` and not provide s3Key.
          // Re-read from the shared profile store to persist the uploaded resume.
          resumeS3Key = $profile.resumeS3Key || resumeS3Key;
      }
      const apiGradDate = isAdminRole ? undefined : toApiGradDate(gradDate);
      const baseEmailCsv = normalizeEmailCsv(email);
      const hasTamuEmail = csvHasTamu(baseEmailCsv);
      const graduatedNowOrPast = isPastOrCurrentGradMonth(apiGradDate);

      let finalEmailCsv = baseEmailCsv;
      let explicitRole: string | undefined = isAdminRole ? (selectedProfileRole.trim() || undefined) : undefined;

      if (!isAdminRole) {
        if (hasTamuEmail && graduatedNowOrPast) {
          const pe = (personalEmailForAlumni ?? '').trim().toLowerCase();
          // Non-blocking: if field didn't render or user didn't provide it,
          // still save the profile as FORMER_STUDENT based on past graduation date.
          if (pe && validateEmailCsv(pe)) {
            const merged = Array.from(
              new Set([...emailPartsFromCsv(baseEmailCsv), ...emailPartsFromCsv(pe)])
            );
            finalEmailCsv = merged.join(', ');
          }
          explicitRole = 'FORMER_STUDENT';
        }

        // TAMU + future grad date => keep student role only.
        if (hasTamuEmail && !graduatedNowOrPast) {
          explicitRole = 'STUDENT';
        }

        if (!hasTamuEmail) {
          explicitRole = isFormerStudentChecked ? 'FORMER_STUDENT' : 'FRIEND';
          if (isFormerStudentChecked && !apiGradDate) {
            saveError = 'Please provide graduation date for former student selection.';
            return;
          }
        }
      }

      const payload = {
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
        ...(panelRole === 'student'
          ? {
              gpa: profileGpa.trim() || null,
              education: educationRows,
              skillIds: selectedSkillIds,
              experience: experienceRows.filter(
                (x) =>
                  x.company.trim() ||
                  x.title.trim() ||
                  x.dates.trim() ||
                  x.highlights.trim()
              ),
              resumeExtra: buildResumeExtraFromForm(),
            }
          : {}),
      };

      let result = await updateProfile(payload);
      const errStr = (result.error ?? '').toLowerCase();
      if (!result.ok && (result.status === 404 || errStr.includes('profile not found') || errStr.includes('not_found'))) {
        result = await createProfile(payload);
      }
      if (!result.ok) {
        saveError = result.error || 'Failed to update profile.';
        return;
      }
      saved = true;
      showProfileSavedBanner();
      closePanel();
    } catch (err) {
      saveError = (err as Error)?.message || 'Failed to save profile.';
    } finally {
      saving = false;
    }
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
      <p class="panel-subtitle">
        {panelRole === 'admin'
          ? 'View and edit your admin profile.'
          : panelRole === 'student'
            ? 'View and edit your student profile. Recruiters use this to discover you.'
            : 'View and edit your profile.'}
      </p>

      <form class="profile-form" onsubmit={handleSubmit}>
        <div class="field">
          <label for="profile-name">Name <span class="required-mark">*</span></label>
          <input id="profile-name" type="text" bind:value={name} required placeholder="Your full name" />
        </div>
        <div class="field">
          <label for="profile-email">Email <span class="required-mark">*</span></label>
          <input
            id="profile-email"
            type="text"
            inputmode="email"
            autocomplete="email"
            bind:value={email}
            required
            placeholder="your.name@tamu.edu, personal@gmail.com"
          />
          <p class="field-hint">Use commas to separate multiple addresses (e.g. TAMU and personal).</p>
        </div>

        {#if panelRole !== 'admin' && normalizeEmailCsv(email).trim()}
          <div class="field">
            <label for="profile-formerStudentChecked">Former student?</label>
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <input
                id="profile-formerStudentChecked"
                type="checkbox"
                bind:checked={isFormerStudentChecked}
                style="width:auto;"
              />
              <span class="field-hint" style="font-size:0.9rem;">Are you a former student?</span>
            </div>
          </div>
        {/if}
        {#if panelRole === 'student'}
          <div class="field">
            <label for="profile-uin">UIN <span class="required-mark">*</span></label>
            <input id="profile-uin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="9" value={uin} oninput={handleUinInput} required placeholder="9 digits, e.g. 123456789" />
            {#if uinError}
              <p class="error-message">{uinError}</p>
            {/if}
          </div>
        {:else if panelRole === 'friend' || panelRole === 'investor'}
          <div class="field">
            <label for="profile-university">University</label>
            <input id="profile-university" type="text" bind:value={university} placeholder="Your university" />
          </div>
        {:else if panelRole === 'admin'}
          <div class="field">
            <label for="profile-staffId">Staff ID</label>
            <input id="profile-staffId" type="text" bind:value={staffId} placeholder="Staff ID" />
          </div>
          <div class="field">
            <label for="profile-role">Role</label>
            <input id="profile-role" type="text" bind:value={selectedProfileRole} placeholder="Role" />
          </div>
        {/if}

        {#if panelRole !== 'admin'}
          <div class="field">
            <label for="profile-degree">
              Degree
            </label>
            <select id="profile-degree" bind:value={degree}>
              {#each DEGREE_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="profile-major">
              Major
            </label>
            <select id="profile-major" bind:value={major}>
              {#each MAJOR_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="profile-gradDate">
              Graduation Year
            </label>
            <input id="profile-gradDate" type="date" bind:value={gradDate} />
          </div>
          <div class="field">
            <label for="profile-linkedinUrl">
              LinkedIn URL
            </label>
            <input id="profile-linkedinUrl" type="url" bind:value={linkedinUrl} placeholder="https://www.linkedin.com/in/your-handle" />
          </div>
        {/if}

        {#if panelRole === 'student'}
          <div class="field">
            <label for="profile-gpa">GPA <span class="hint">(optional, most recent)</span></label>
            <input id="profile-gpa" type="text" bind:value={profileGpa} placeholder="e.g. 3.75" />
          </div>

          <div class="field">
            <span class="label-like">Education <span class="hint">(optional)</span></span>
            {#each educationRows as row, i (row)}
              <div class="repeat-block">
                <input placeholder="Institution" bind:value={row.institution} />
                <input placeholder="Degree / diploma" bind:value={row.degreeDiploma} />
                <input placeholder="Specialization" bind:value={row.specialization} />
                <input placeholder="GPA (this school)" bind:value={row.gpa} />
                <input placeholder="Dates" bind:value={row.dates} />
                <textarea placeholder="Details" rows="2" bind:value={row.details}></textarea>
                <button
                  type="button"
                  class="btn-tiny"
                  onclick={() => {
                    educationRows = educationRows.filter((_, j) => j !== i);
                    if (educationRows.length === 0) educationRows = [emptyEducationRow()];
                  }}>Remove</button
                >
              </div>
            {/each}
            <button
              type="button"
              class="btn-secondary"
              onclick={() => {
                educationRows = [...educationRows, emptyEducationRow()];
              }}>Add education</button
            >
          </div>

          <div class="field">
            <label for="skill-filter">Skills <span class="hint">(optional, from master list)</span></label>
            <input
              id="skill-filter"
              type="search"
              bind:value={skillFilter}
              placeholder="Filter skills…"
              autocomplete="off"
            />
            <div class="skills-box" role="group" aria-label="Skills">
              {#each masterSkills.filter((s) => {
                const q = skillFilter.trim().toLowerCase();
                return !q || s.canonicalName.toLowerCase().includes(q);
              }) as s (s.skillId)}
                <label class="skill-cb">
                  <input type="checkbox" value={s.skillId} bind:group={selectedSkillIds} />
                  {s.canonicalName}
                </label>
              {/each}
            </div>
          </div>

          <div class="field">
            <span class="label-like">Experience <span class="hint">(optional)</span></span>
            {#each experienceRows as row, i (row)}
              <div class="repeat-block">
                <input placeholder="Company" bind:value={row.company} />
                <input placeholder="Title" bind:value={row.title} />
                <input placeholder="Dates" bind:value={row.dates} />
                <textarea placeholder="Highlights (one per line)" rows="3" bind:value={row.highlights}></textarea>
                <button
                  type="button"
                  class="btn-tiny"
                  onclick={() => {
                    experienceRows = experienceRows.filter((_, j) => j !== i);
                    if (experienceRows.length === 0) experienceRows = [emptyExperienceRow()];
                  }}>Remove</button
                >
              </div>
            {/each}
            <button
              type="button"
              class="btn-secondary"
              onclick={() => {
                experienceRows = [...experienceRows, emptyExperienceRow()];
              }}>Add experience</button
            >
          </div>

          <div class="field">
            <span class="label-like">Projects &amp; extras <span class="hint">(optional)</span></span>
            <label for="extra-proj" class="sub-label">Projects (JSON array)</label>
            <textarea
              id="extra-proj"
              rows="4"
              bind:value={extraProjectsJson}
              placeholder="JSON array of projects: name, description, dates, technologies"
            ></textarea>
            <label for="extra-extra" class="sub-label">Extracurricular (one per line)</label>
            <textarea id="extra-extra" rows="3" bind:value={extraExtracurricular}></textarea>
            <label for="extra-ach" class="sub-label">Achievements (one per line)</label>
            <textarea id="extra-ach" rows="2" bind:value={extraAchievements}></textarea>
            <label for="extra-other" class="sub-label">Other (one per line)</label>
            <textarea id="extra-other" rows="2" bind:value={extraOther}></textarea>
          </div>
        {/if}

        {#if panelRole !== 'admin'}
          <ResumeSection open={open} bind:this={resumeSectionRef} />
        {/if}
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

{#if showSavedBanner}
  <div class="profile-saved-banner" role="status" aria-live="polite">
    Profile changes saved!
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
    padding: 0.55rem 0.75rem;
    font-size: 0.95rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
  }

  textarea {
    padding: 0.55rem 0.75rem;
    font-size: 0.9rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    font-family: inherit;
    resize: vertical;
    min-height: 2.5rem;
  }

  .label-like {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .sub-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 0.5rem;
    display: block;
  }

  .skills-box {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .skill-cb {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  .skill-cb input {
    width: auto;
    margin: 0;
  }

  .repeat-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.65rem;
    margin-bottom: 0.5rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--maroon-muted);
  }

  .btn-tiny {
    align-self: flex-start;
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    cursor: pointer;
  }

  .btn-tiny:hover {
    border-color: var(--maroon);
    color: var(--maroon);
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

  .profile-saved-banner {
    position: fixed;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    z-index: 2200;
    background: #1b7f3a;
    color: #fff;
    border-radius: var(--radius);
    padding: 0.65rem 1rem;
    box-shadow: var(--shadow);
    font-weight: 600;
    font-size: 0.92rem;
  }
</style>
