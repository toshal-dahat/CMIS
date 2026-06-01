<script lang="ts">
  import { onMount } from 'svelte';
  import { profile } from './stores/profileStore';
  import { currentView } from './stores/viewStore';
  import { createProfile, fetchMasterSkills, fetchUserProfile } from './api';
  import { getCognitoGroups, getIdentityPrefill, waitForCognitoIdToken } from './auth';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin, validateEmailCsv, normalizeEmailCsv } from './profileOptions';
  import type { MasterSkill, ProfileEducationEntry } from './types';
  import {
    cloneEducationEntries,
    emptyEducationEntry,
    normalizeEducationForSubmit,
  } from './profileEducation';

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
  let signupRole = $state<'student' | 'friend' | 'investor' | 'admin'>('student');
  let submitError = $state('');
  let uinError = $state('');
  let submitting = $state(false);
  let submitted = $state(false);
  let resumeSectionRef = $state<{ uploadSelectedFile: () => Promise<{ ok: boolean; s3Key?: string; error?: string }> } | null>(null);
  const PROFILE_FORM_DISMISSED_KEY = 'cmis:profileFormDismissed';

  /** Friend/investor mentorship role selection shown in profile form. */
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
  let reminderOptIn = $state(false);
  let phoneNumber = $state('');

  let profileGpaStr = $state('');
  let educationEntries = $state<ProfileEducationEntry[]>([]);
  let selectedSkillKeys = $state<string[]>([]);
  let masterSkillsList = $state<MasterSkill[]>([]);
  let skillFilter = $state('');

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
    if (signupRole === 'friend' || signupRole === 'investor') {
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
    reminderOptIn = p.reminderOptIn === true;
    phoneNumber = p.phoneNumber ?? '';
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
    if (signupRole === 'student') return 'Mentee';
    if (signupRole === 'friend' || signupRole === 'investor') {
      if (mentorshipRoleChoice === 'mentor') return 'Mentor';
      if (mentorshipRoleChoice === 'mentee') return 'Mentee';
      return 'Not participating';
    }
    return 'Not participating';
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
      p.role ||
      p.mentorshipInterested !== undefined ||
      typeof p.profileGpa === 'number' ||
      (Array.isArray(p.profileEducation) && p.profileEducation.length > 0) ||
      (Array.isArray(p.profileSkillKeys) && p.profileSkillKeys.length > 0)
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
      if (signupRole !== 'admin') {
        const sk = await fetchMasterSkills();
        if (sk.ok) masterSkillsList = sk.skills;
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
    const isResumeRole = signupRole === 'student' || signupRole === 'friend' || signupRole === 'investor';
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

    let resumeProfileGpa: number | null | undefined;
    let resumeEducation: ProfileEducationEntry[] | undefined;
    if (isResumeRole) {
      if (profileGpaStr.trim()) {
        const g = parseFloat(profileGpaStr.trim());
        if (!Number.isFinite(g)) {
          submitError = 'GPA must be a valid number.';
          return;
        }
        resumeProfileGpa = g;
      } else {
        resumeProfileGpa = null;
      }
      resumeEducation = normalizeEducationForSubmit(educationEntries);
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

      const isFriendOrInvestor = signupRole === 'friend' || signupRole === 'investor';
      if (!isAdminRole && isFriendOrInvestor) {
        if (mentorshipRoleChoice === 'mentor') {
          const c = Number(mentorCapacityNum);
          if (!Number.isInteger(c) || c < 1 || c > 10) {
            submitError = 'Enter how many students you can mentor (1–10).';
            return;
          }
          if (!mentorProfileReady()) {
            submitError =
              'Please complete mentor details: at least one skill, one industry, company, and valid years of experience if provided.';
            return;
          }
        }
      }

      const selectedMentorshipRole = !isAdminRole && isFriendOrInvestor ? mentorshipRoleChoice : 'none';
      const interestedMentorship = selectedMentorshipRole === 'mentor' || selectedMentorshipRole === 'mentee';
      const interestedMentor = selectedMentorshipRole === 'mentor';
      const studentMentorshipDefaults =
        !isAdminRole && signupRole === 'student';

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
        mentorshipInterested:
          isAdminRole ? false : studentMentorshipDefaults ? true : interestedMentorship,
        reminderOptIn: isAdminRole ? false : reminderOptIn,
        phoneNumber: isAdminRole ? undefined : phoneNumber.trim() || undefined,
        mentorship: isAdminRole
          ? null
          : studentMentorshipDefaults
            ? 'mentee'
            : selectedMentorshipRole === 'mentor' || selectedMentorshipRole === 'mentee'
              ? selectedMentorshipRole
              : null,
        mentorCapacity:
          interestedMentor ? mentorCapacityNum : null,
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

    {#if signupRole !== 'admin' && normalizeEmailCsv(email).trim()}
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
        <label for="reminderOptIn">Email reminders</label>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input id="reminderOptIn" type="checkbox" bind:checked={reminderOptIn} style="width:auto;" />
          <span class="field-hint" style="font-size:0.9rem;">Opt-in to reminders (1 hour before events)</span>
        </div>
      </div>

      <div class="field">
        <label for="phoneNumber">Phone number <span class="hint">(optional, for SMS reminders)</span></label>
        <input
          id="phoneNumber"
          type="tel"
          bind:value={phoneNumber}
          placeholder="+1 555 123 4567"
          autocomplete="tel"
        />
      </div>

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

      {#if signupRole === 'friend' || signupRole === 'investor'}
        <fieldset class="mentorship-fieldset">
          <legend>Mentorship program</legend>
          <p class="field-hint">You can change this anytime from your profile.</p>
          <p class="field-hint"><strong>Current mentorship role:</strong> {mentorshipRoleLabel()}</p>
          <div class="field" style="margin-top: 0.5rem;">
            <label for="mentorship-role-choice">Choose mentorship role</label>
            <select id="mentorship-role-choice" bind:value={mentorshipRoleChoice}>
              <option value="none">Not participating</option>
              <option value="mentor">Mentor</option>
              <option value="mentee">Mentee</option>
            </select>
          </div>
          {#if mentorshipRoleChoice === 'mentor'}
            <div class="mentorship-followup">
              <div class="field" style="margin-top: 0.75rem;">
                <label for="mentor-capacity">How many students are you willing to mentor? (1–10)</label>
                <input
                  id="mentor-capacity"
                  type="number"
                  min="1"
                  max="10"
                  bind:value={mentorCapacityNum}
                />
              </div>
              <div class="field" style="margin-top: 0.75rem;">
                <label for="mentor-bio"
                  >Mentor bio <span class="hint">(Your background and what you can help with)</span></label
                >
                <textarea
                  id="mentor-bio"
                  rows="3"
                  bind:value={mentorBioText}
                  placeholder="e.g. I am a software engineer with 5 years of experience. I can help with architecture, system design, and coding interviews."
                  maxlength="2000"
                ></textarea>
              </div>
              <div class="field">
                <label for="mentor-skills-input">Skills (comma separated) <span class="required-mark">*</span></label>
                <input id="mentor-skills-input" type="text" bind:value={mentorSkillsInput} placeholder="e.g. SQL, Python, Product Strategy" />
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
                <label for="mentor-company">Company <span class="required-mark">*</span></label>
                <input id="mentor-company" type="text" bind:value={mentorCompany} placeholder="Current company" />
              </div>
              <div class="field">
                <label for="mentor-title">Role / job title</label>
                <input id="mentor-title" type="text" bind:value={mentorJobTitle} placeholder="e.g. Senior Data Analyst" />
              </div>
              <div class="field">
                <label for="mentor-years">Years of experience</label>
                <input id="mentor-years" type="number" min="0" max="80" bind:value={mentorYearsExperienceInput} />
              </div>
            </div>
          {/if}
        </fieldset>
      {/if}

        <div class="field">
          <label for="profileGpa">GPA <span class="hint">(optional)</span></label>
          <input
            id="profileGpa"
            type="text"
            inputmode="decimal"
            bind:value={profileGpaStr}
            placeholder="e.g. 3.75"
            autocomplete="off"
          />
          <p class="field-hint">Filled automatically from your resume when available; you can edit anytime.</p>
        </div>

        <div class="field education-section">
          <span class="education-section-label">Education <span class="hint">(optional)</span></span>
          <p class="field-hint">Add one block per school or program. Filled from your resume when available.</p>
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
                  <label for={`edu-degree-${eduIndex}`}>Degree / Diploma</label>
                  <input
                    id={`edu-degree-${eduIndex}`}
                    type="text"
                    bind:value={entry.degree}
                    placeholder="e.g. Master of Science"
                    autocomplete="off"
                  />
                </div>
                <div class="education-field">
                  <label for={`edu-inst-${eduIndex}`}>Institute</label>
                  <input
                    id={`edu-inst-${eduIndex}`}
                    type="text"
                    bind:value={entry.institution}
                    placeholder="e.g. Texas A&M University"
                    autocomplete="off"
                  />
                </div>
                <div class="education-field education-field-full">
                  <label for={`edu-dates-${eduIndex}`}>Dates</label>
                  <input
                    id={`edu-dates-${eduIndex}`}
                    type="text"
                    bind:value={entry.dates}
                    placeholder="e.g. Aug 2023 – May 2025"
                    autocomplete="off"
                  />
                </div>
                <div class="education-field education-field-full">
                  <label for={`edu-details-${eduIndex}`}>Details</label>
                  <textarea
                    id={`edu-details-${eduIndex}`}
                    class="education-details-input"
                    bind:value={entry.details}
                    rows="3"
                    spellcheck="true"
                    placeholder="Honors, coursework, GPA in major, etc."
                  ></textarea>
                </div>
                <div class="education-field education-field-full">
                  <label for={`edu-field-${eduIndex}`}>Field</label>
                  <input
                    id={`edu-field-${eduIndex}`}
                    type="text"
                    bind:value={entry.field}
                    placeholder="e.g. Management Information Systems"
                    autocomplete="off"
                  />
                </div>
                <div class="education-field">
                  <label for={`edu-gpa-${eduIndex}`}>GPA</label>
                  <input
                    id={`edu-gpa-${eduIndex}`}
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
          <label for="skillFilter">Skills <span class="hint">(optional)</span></label>
          <input
            id="skillFilter"
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
          <p class="field-hint">Canonical names from the program skill list; resume upload adds matches automatically.</p>
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

  .education-section {
    gap: 0.75rem;
  }

  .education-section-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .education-card {
    padding: 1rem 1rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    margin-top: 0.5rem;
  }

  .education-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.65rem;
  }

  .education-card-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--maroon);
  }

  .btn-remove-edu {
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
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
    gap: 0.65rem 1rem;
  }

  @media (max-width: 520px) {
    .education-grid {
      grid-template-columns: 1fr;
    }
  }

  .education-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .education-field-full {
    grid-column: 1 / -1;
  }

  .education-field label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .education-details-input {
    padding: 0.55rem 0.75rem;
    font-size: 0.9rem;
    font-family: inherit;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--text);
    resize: vertical;
    min-height: 4rem;
  }

  .education-details-input:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
  }

  .btn-add-edu {
    margin-top: 0.35rem;
    padding: 0.45rem 0.85rem;
    font-size: 0.88rem;
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
    font-size: 0.8rem;
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
    max-height: 10rem;
    overflow-y: auto;
    padding: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .skill-option {
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
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

  .mentor-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3000;
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
