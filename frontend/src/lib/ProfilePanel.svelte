<script lang="ts">
  import { getCognitoGroups, signOutUser } from './auth';
  import { profile } from './stores/profileStore';
  import { authUser } from './stores/authStore';
  import { currentView } from './stores/viewStore';
  import { createProfile, fetchMasterSkills, fetchUserProfile, updateProfile } from './api';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin, validateEmailCsv, normalizeEmailCsv } from './profileOptions';
  import type { MasterSkill, ProfileEducationEntry } from './types';
  import {
    cloneEducationEntries,
    emptyEducationEntry,
    normalizeEducationForSubmit,
  } from './profileEducation';

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

  let mentorshipRoleChoice = $state<'none' | 'mentor' | 'mentee'>('none');
  let mentorCapacityNum = $state(1);
  const MENTOR_INDUSTRY_OPTIONS = [
    'Technology',
    'Consulting',
    'Finance',
    'Healthcare',
    'Energy',
    'Retail',
    'Manufacturing',
    'Public Sector',
    'Startups',
    'Other',
  ];
  let mentorSkillsInput = $state('');
  let mentorIndustriesSelected = $state<string[]>([]);
  let mentorCompany = $state('');
  let mentorJobTitle = $state('');
  let mentorYearsExperienceInput = $state<string | number>('');
  let mentorBioText = $state('');

  let profileGpaStr = $state('');
  let educationEntries = $state<ProfileEducationEntry[]>([]);
  let selectedSkillKeys = $state<string[]>([]);
  let masterSkillsList = $state<MasterSkill[]>([]);
  let skillFilter = $state('');

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
    if (panelRole === 'friend' || panelRole === 'investor') {
      const role = String(p.mentorship || '').trim().toLowerCase();
      mentorshipRoleChoice =
        p.mentorshipInterested === true && (role === 'mentor' || role === 'mentee')
          ? (role as 'mentor' | 'mentee')
          : 'none';
      const isMentorProfile = mentorshipRoleChoice === 'mentor';
      mentorCapacityNum = typeof p.mentorCapacity === 'number' ? p.mentorCapacity : 1;
      mentorSkillsInput = Array.isArray(p.mentorSkills) ? p.mentorSkills.join(', ') : '';
      mentorIndustriesSelected = Array.isArray(p.mentorIndustries) ? [...p.mentorIndustries] : [];
      mentorCompany = p.mentorCompany ?? '';
      mentorJobTitle = p.mentorJobTitle ?? '';
      mentorYearsExperienceInput =
        typeof p.mentorYearsExperience === 'number' ? String(p.mentorYearsExperience) : '';
      mentorBioText = typeof p.mentorBio === 'string' ? p.mentorBio : '';
      if (!isMentorProfile) {
        mentorCapacityNum = 1;
        mentorSkillsInput = '';
        mentorIndustriesSelected = [];
        mentorCompany = '';
        mentorJobTitle = '';
        mentorYearsExperienceInput = '';
        mentorBioText = '';
      }
    }
    if (typeof p.profileGpa === 'number') profileGpaStr = String(p.profileGpa);
    else profileGpaStr = '';
    educationEntries = cloneEducationEntries(p.profileEducation);
    selectedSkillKeys = Array.isArray(p.profileSkillKeys) ? [...p.profileSkillKeys] : [];
  }

  function addEducationRow() {
    educationEntries = [...educationEntries, emptyEducationEntry()];
  }

  function removeEducationRow(index: number) {
    educationEntries = educationEntries.filter((_, i) => i !== index);
  }

  function toggleSkillKey(key: string) {
    if (selectedSkillKeys.includes(key)) {
      selectedSkillKeys = selectedSkillKeys.filter((k) => k !== key);
    } else {
      selectedSkillKeys = [...selectedSkillKeys, key];
    }
  }

  function filteredMasterSkills(): MasterSkill[] {
    const q = skillFilter.trim().toLowerCase();
    if (!q) return masterSkillsList;
    return masterSkillsList.filter(
      (s) =>
        s.canonicalName.toLowerCase().includes(q) || (s.normalizedKey && s.normalizedKey.includes(q))
    );
  }

  function parseCsvTags(value: string): string[] {
    return Array.from(
      new Set(
        (value ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  }

  function toggleMentorIndustry(industry: string): void {
    if (mentorIndustriesSelected.includes(industry)) {
      mentorIndustriesSelected = mentorIndustriesSelected.filter((v) => v !== industry);
    } else {
      mentorIndustriesSelected = [...mentorIndustriesSelected, industry];
    }
  }

  function mentorProfileReady(): boolean {
    const skills = parseCsvTags(mentorSkillsInput);
    const years = String(mentorYearsExperienceInput ?? '').trim();
    return (
      skills.length > 0 &&
      mentorIndustriesSelected.length > 0 &&
      !!mentorCompany.trim() &&
      (years === '' || (/^\d+$/.test(years) && Number(years) >= 0 && Number(years) <= 80))
    );
  }

  function mentorshipRoleLabel(): string {
    if (panelRole === 'student') return 'Mentee';
    if (panelRole === 'friend' || panelRole === 'investor') {
      if (mentorshipRoleChoice === 'mentor') return 'Mentor';
      if (mentorshipRoleChoice === 'mentee') return 'Mentee';
      return 'Not participating';
    }
    return 'Not participating';
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
      await resolvePanelRoleFromGroups();
      syncFormFromProfile();
      if (panelRole !== 'admin') {
        const sk = await fetchMasterSkills();
        if (sk.ok) masterSkillsList = sk.skills;
      }
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
    const isResumeRole = panelRole === 'student' || panelRole === 'friend' || panelRole === 'investor';
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

    let resumeProfileGpa: number | null | undefined;
    let resumeEducation: ProfileEducationEntry[] | undefined;
    if (isResumeRole) {
      if (profileGpaStr.trim()) {
        const g = parseFloat(profileGpaStr.trim());
        if (!Number.isFinite(g)) {
          saveError = 'GPA must be a valid number.';
          return;
        }
        resumeProfileGpa = g;
      } else {
        resumeProfileGpa = null;
      }
      resumeEducation = normalizeEducationForSubmit(educationEntries);
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

      const isFriendOrInvestor = panelRole === 'friend' || panelRole === 'investor';
      if (!isAdminRole && isFriendOrInvestor) {
        if (mentorshipRoleChoice === 'mentor') {
          const c = Number(mentorCapacityNum);
          if (!Number.isInteger(c) || c < 1 || c > 10) {
            saveError = 'Enter how many students you can mentor (1–10).';
            return;
          }
          if (!mentorProfileReady()) {
            saveError =
              'Please complete mentor details: at least one skill, one industry, company, and valid years of experience if provided.';
            return;
          }
        }
      }

      const selectedMentorshipRole = !isAdminRole && isFriendOrInvestor ? mentorshipRoleChoice : 'none';
      const interestedMentorship = selectedMentorshipRole === 'mentor' || selectedMentorshipRole === 'mentee';
      const interestedMentor = selectedMentorshipRole === 'mentor';
      const studentMentorshipDefaults = !isAdminRole && panelRole === 'student';

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
        mentorshipInterested:
          isAdminRole ? false : studentMentorshipDefaults ? true : interestedMentorship,
        mentorship: isAdminRole
          ? null
          : studentMentorshipDefaults
            ? 'mentee'
            : selectedMentorshipRole === 'mentor' || selectedMentorshipRole === 'mentee'
              ? selectedMentorshipRole
              : null,
        mentorCapacity: interestedMentor ? mentorCapacityNum : null,
        mentorSkills: interestedMentor ? parseCsvTags(mentorSkillsInput) : [],
        mentorIndustries: interestedMentor ? mentorIndustriesSelected : [],
        mentorCompany: interestedMentor ? mentorCompany.trim() || null : null,
        mentorJobTitle: interestedMentor ? mentorJobTitle.trim() || null : null,
        mentorYearsExperience:
          interestedMentor && String(mentorYearsExperienceInput ?? '').trim()
            ? Number(String(mentorYearsExperienceInput ?? '').trim())
            : null,
        mentorshipGoals: studentMentorshipDefaults ? undefined : null,
        studentGoals: studentMentorshipDefaults ? undefined : null,
        mentorBio: interestedMentor ? mentorBioText.trim() || null : null,
        ...(isResumeRole
          ? {
              profileGpa: resumeProfileGpa,
              profileEducation: resumeEducation,
              profileSkillKeys: [...selectedSkillKeys],
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
          {#if panelRole === 'friend' || panelRole === 'investor'}
            <fieldset class="mentorship-fieldset">
              <legend>Mentorship program</legend>
              <p class="field-hint">You can change this anytime from your profile.</p>
              <p class="field-hint"><strong>Current mentorship role:</strong> {mentorshipRoleLabel()}</p>
              <div class="field" style="margin-top: 0.5rem;">
                <label for="panel-mentorship-role-choice">Choose mentorship role</label>
                <select id="panel-mentorship-role-choice" bind:value={mentorshipRoleChoice}>
                  <option value="none">Not participating</option>
                  <option value="mentor">Mentor</option>
                  <option value="mentee">Mentee</option>
                </select>
              </div>
              {#if mentorshipRoleChoice === 'mentor'}
                <div class="mentorship-followup">
                  <div class="field" style="margin-top: 0.75rem;">
                    <label for="panel-mentor-capacity">How many students are you willing to mentor? (1–10)</label>
                    <input
                      id="panel-mentor-capacity"
                      type="number"
                      min="1"
                      max="10"
                      bind:value={mentorCapacityNum}
                    />
                  </div>
                  <div class="field" style="margin-top: 0.75rem;">
                    <label for="panel-mentor-bio"
                      >Mentor bio <span class="hint">(Your background and what you can help with)</span></label
                    >
                    <textarea
                      id="panel-mentor-bio"
                      rows="3"
                      bind:value={mentorBioText}
                      placeholder="e.g. I am a software engineer with 5 years of experience. I can help with architecture, system design, and coding interviews."
                      maxlength="2000"
                    ></textarea>
                  </div>
                  <div class="field">
                    <label for="panel-mentor-skills-input">Skills (comma separated) <span class="required-mark">*</span></label>
                    <input id="panel-mentor-skills-input" type="text" bind:value={mentorSkillsInput} placeholder="e.g. SQL, Python, Product Strategy" />
                  </div>
                  <div class="field">
                    <label>Industries <span class="required-mark">*</span></label>
                    <div class="mentorship-radios">
                      {#each MENTOR_INDUSTRY_OPTIONS as industry}
                        <label class="mentorship-radio-label">
                          <input
                            type="checkbox"
                            checked={mentorIndustriesSelected.includes(industry)}
                            onchange={() => toggleMentorIndustry(industry)}
                          />
                          {industry}
                        </label>
                      {/each}
                    </div>
                  </div>
                  <div class="field">
                    <label for="panel-mentor-company">Company <span class="required-mark">*</span></label>
                    <input id="panel-mentor-company" type="text" bind:value={mentorCompany} placeholder="Current company" />
                  </div>
                  <div class="field">
                    <label for="panel-mentor-job-title">Role / job title</label>
                    <input id="panel-mentor-job-title" type="text" bind:value={mentorJobTitle} placeholder="e.g. Senior Data Analyst" />
                  </div>
                  <div class="field">
                    <label for="panel-mentor-years">Years of experience</label>
                    <input id="panel-mentor-years" type="number" min="0" max="80" bind:value={mentorYearsExperienceInput} />
                  </div>
                </div>
              {/if}
            </fieldset>
          {/if}

            <div class="field">
              <label for="panel-profileGpa">GPA <span class="hint">(optional)</span></label>
              <input
                id="panel-profileGpa"
                type="text"
                inputmode="decimal"
                bind:value={profileGpaStr}
                placeholder="e.g. 3.75"
                autocomplete="off"
              />
              <p class="field-hint">Updated from your resume when extracted; editable anytime.</p>
            </div>
            <div class="field education-section">
              <span class="education-section-label">Education <span class="hint">(optional)</span></span>
              <p class="field-hint">One block per school or program. From your resume when extracted.</p>
              {#each educationEntries as entry, eduIndex}
                <div class="education-card">
                  <div class="education-card-header">
                    <span class="education-card-title">Education {eduIndex + 1}</span>
                    <button
                      type="button"
                      class="btn-remove-edu"
                      onclick={() => removeEducationRow(eduIndex)}
                      aria-label="Remove this education entry"
                    >
                      Remove
                    </button>
                  </div>
                  <div class="education-grid">
                    <div class="education-field">
                      <label for={`panel-edu-degree-${eduIndex}`}>Degree / Diploma</label>
                      <input
                        id={`panel-edu-degree-${eduIndex}`}
                        type="text"
                        bind:value={entry.degree}
                        placeholder="e.g. Master of Science"
                        autocomplete="off"
                      />
                    </div>
                    <div class="education-field">
                      <label for={`panel-edu-inst-${eduIndex}`}>Institute</label>
                      <input
                        id={`panel-edu-inst-${eduIndex}`}
                        type="text"
                        bind:value={entry.institution}
                        placeholder="e.g. Texas A&M University"
                        autocomplete="off"
                      />
                    </div>
                    <div class="education-field education-field-full">
                      <label for={`panel-edu-dates-${eduIndex}`}>Dates</label>
                      <input
                        id={`panel-edu-dates-${eduIndex}`}
                        type="text"
                        bind:value={entry.dates}
                        placeholder="e.g. Aug 2023 – May 2025"
                        autocomplete="off"
                      />
                    </div>
                    <div class="education-field education-field-full">
                      <label for={`panel-edu-details-${eduIndex}`}>Details</label>
                      <textarea
                        id={`panel-edu-details-${eduIndex}`}
                        class="education-details-input"
                        bind:value={entry.details}
                        rows="3"
                        spellcheck="true"
                        placeholder="Honors, coursework, GPA in major, etc."
                      ></textarea>
                    </div>
                    <div class="education-field education-field-full">
                      <label for={`panel-edu-field-${eduIndex}`}>Field</label>
                      <input
                        id={`panel-edu-field-${eduIndex}`}
                        type="text"
                        bind:value={entry.field}
                        placeholder="e.g. Management Information Systems"
                        autocomplete="off"
                      />
                    </div>
                    <div class="education-field">
                      <label for={`panel-edu-gpa-${eduIndex}`}>GPA</label>
                      <input
                        id={`panel-edu-gpa-${eduIndex}`}
                        type="text"
                        inputmode="decimal"
                        bind:value={entry.gpa}
                        placeholder="e.g. 3.85"
                        autocomplete="off"
                      />
                    </div>
                  </div>
                </div>
              {/each}
              <button type="button" class="btn-add-edu" onclick={addEducationRow}>+ Add education</button>
            </div>
            <div class="field">
              <label for="panel-skillFilter">Skills <span class="hint">(optional)</span></label>
              <input
                id="panel-skillFilter"
                type="search"
                bind:value={skillFilter}
                placeholder="Filter skills…"
                autocomplete="off"
              />
              <div class="skills-chips" role="group" aria-label="Selected skills">
                {#each selectedSkillKeys as k}
                  {@const label = masterSkillsList.find((s) => s.normalizedKey === k)?.canonicalName ?? k}
                  <button type="button" class="skill-chip selected" onclick={() => toggleSkillKey(k)}>
                    {label} ×
                  </button>
                {/each}
              </div>
              <div class="skills-picker" role="listbox" aria-label="Available skills">
                {#each filteredMasterSkills() as s}
                  <button
                    type="button"
                    class="skill-option"
                    class:selected={selectedSkillKeys.includes(s.normalizedKey)}
                    onclick={() => toggleSkillKey(s.normalizedKey)}
                  >
                    {s.canonicalName}
                  </button>
                {/each}
              </div>
            </div>
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

  .mentorship-fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    margin: 0;
  }

  .mentorship-fieldset legend {
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0 0.25rem;
  }

  .mentorship-radios {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .mentorship-radio-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    cursor: pointer;
  }

  .mentorship-radio-label input {
    width: auto;
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

  .education-section {
    gap: 0.75rem;
  }

  .education-section-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .education-card {
    padding: 0.85rem 0.85rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    margin-top: 0.45rem;
  }

  .education-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    margin-bottom: 0.55rem;
  }

  .education-card-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--maroon);
  }

  .btn-remove-edu {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .btn-remove-edu:hover {
    color: #721c24;
    border-color: #f5c6cb;
    background: #f8d7da;
  }

  .education-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem 0.85rem;
  }

  @media (max-width: 480px) {
    .education-grid {
      grid-template-columns: 1fr;
    }
  }

  .education-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .education-field-full {
    grid-column: 1 / -1;
  }

  .education-field label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .education-details-input {
    padding: 0.5rem 0.65rem;
    font-size: 0.85rem;
    font-family: inherit;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--text);
    resize: vertical;
    min-height: 3.5rem;
  }

  .education-details-input:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
  }

  .btn-add-edu {
    margin-top: 0.3rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--maroon);
    background: var(--maroon-muted);
    border: 1px dashed var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    width: fit-content;
    transition: background 0.15s, border-style 0.15s;
  }

  .btn-add-edu:hover {
    background: var(--border);
    border-style: solid;
  }

  .skills-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0.35rem 0;
  }

  .skill-chip {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--maroon);
    background: var(--maroon-muted);
    color: var(--text);
    cursor: pointer;
  }

  .skills-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-height: 9rem;
    overflow-y: auto;
    padding: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .skill-option {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--card-bg);
    cursor: pointer;
    color: var(--text);
  }

  .skill-option.selected {
    border-color: var(--maroon);
    background: var(--maroon-muted);
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

  .mentor-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2300;
    padding: 1rem;
  }

  .mentor-modal {
    width: min(640px, 95vw);
    max-height: 90vh;
    overflow-y: auto;
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    padding: 1rem;
    display: grid;
    gap: 0.8rem;
  }
</style>
