<script lang="ts">
  import { onMount } from 'svelte';
  import { profile } from './stores/profileStore';
  import { currentView } from './stores/viewStore';
  import { createProfile } from './api';
  import ResumeSection from './ResumeSection.svelte';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS, validateUin } from './profileOptions';

  let name = '';
  let email = '';
  let uin = '';
  let degree = '';
  let major = '';
  let gradDate = '';
  let linkedinUrl = '';
  let submitError = '';
  let uinError = '';
  let submitting = false;
  let submitted = false;

  onMount(() => {
    const p = $profile;
    if (p.name) name = p.name;
    if (p.email) email = p.email;
    if (p.uin) uin = p.uin;
    if (p.degree) degree = p.degree;
    if (p.major) major = p.major;
    if (p.gradDate) gradDate = p.gradDate;
    if (p.linkedinUrl) linkedinUrl = p.linkedinUrl;
  });

  function handleUinInput(e: Event) {
    const v = (e.target as HTMLInputElement | null)?.value ?? '';
    if (v === '' || /^\d*$/.test(v)) uin = v.slice(0, 9);
    uinError = '';
  }

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    submitError = '';
    uinError = '';

    if (!validateUin(uin)) {
      uinError = 'UIN must be exactly 9 digits.';
      return;
    }
    if (!email?.trim()) {
      submitError = 'Please enter your email.';
      return;
    }
    if (!degree) {
      submitError = 'Please select a degree.';
      return;
    }
    if (!major) {
      submitError = 'Please select a major.';
      return;
    }

    submitting = true;
    const result = await createProfile({
      name,
      email: email.trim(),
      uin: uin.trim(),
      degree,
      major,
      gradDate,
      linkedInUrl: linkedinUrl || undefined,
      resumeS3Key: $profile.resumeS3Key || undefined,
    });
    submitting = false;

    if (!result.ok) {
      submitError = result.error || 'Failed to create profile.';
      return;
    }

    submitted = true;
    setTimeout(() => {
      currentView.set('landing');
    }, 1500);
  };
</script>

<section class="profile-form-container">
  <h1 class="heading">Student Profile</h1>
  <p class="subheading">
    Fill out your details so TAMU CMIS recruiters can discover you.
  </p>

  <form class="profile-form" onsubmit={handleSubmit}>
    <div class="field">
      <label for="name">Name</label>
      <input
        id="name"
        type="text"
        bind:value={name}
        required
        placeholder="Your full name"
      />
    </div>

    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        type="email"
        bind:value={email}
        required
        placeholder="your.email@tamu.edu"
      />
    </div>

    <div class="field">
      <label for="uin">UIN (University Identification Number)</label>
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

    <div class="field">
      <label for="degree">Degree</label>
      <select id="degree" bind:value={degree} required>
        {#each DEGREE_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="major">Major</label>
      <select id="major" bind:value={major} required>
        {#each MAJOR_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="gradDate">Graduation Year</label>
      <input
        id="gradDate"
        type="month"
        bind:value={gradDate}
        required
      />
    </div>

    <div class="field">
      <label for="linkedinUrl">LinkedIn URL</label>
      <input
        id="linkedinUrl"
        type="url"
        bind:value={linkedinUrl}
        required
        placeholder="https://www.linkedin.com/in/your-handle"
      />
    </div>

    <ResumeSection open={true} />

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
