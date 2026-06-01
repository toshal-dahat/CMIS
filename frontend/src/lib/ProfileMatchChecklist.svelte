<script lang="ts">
  import type { ProfileEducationEntry } from './types';

  type MentorshipKind = '' | 'mentee' | 'mentor';

  type Row = { label: string; ok: boolean; optional?: boolean };

  let {
    active = false,
    mentorshipKind = '' as MentorshipKind,
    skillKeysCount = 0,
    goalsTrimmed = '',
    educationEntries = [] as ProfileEducationEntry[],
    profileGpaStr = '',
    major = '',
    gradDate = '',
    linkedinUrl = '',
    mentorSkillsCsv = '',
    mentorIndustriesCount = 0,
    mentorCompany = '',
    mentorJobTitle = '',
    mentorYearsStr = '' as string | number,
  } = $props();

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

  function educationHasSubstance(entries: ProfileEducationEntry[]): boolean {
    return entries.some((e) => {
      const inst = (e?.institution ?? '').trim();
      const deg = (e?.degree ?? '').trim();
      const field = (e?.field ?? '').trim();
      return !!(inst || deg || field);
    });
  }

  function hasAnyGpa(entries: ProfileEducationEntry[], topGpa: string): boolean {
    if ((topGpa ?? '').trim() !== '') return true;
    return entries.some((e) => e?.gpa != null && String(e.gpa).trim() !== '');
  }

  function mentorYearsValid(y: string | number): boolean {
    const t = String(y ?? '').trim();
    if (!t) return false;
    return /^\d+$/.test(t) && Number(t) >= 0 && Number(t) <= 80;
  }

  const rows = $derived.by((): { core: Row[]; bonus: Row[] } => {
    if (!active || (mentorshipKind !== 'mentee' && mentorshipKind !== 'mentor')) {
      return { core: [], bonus: [] };
    }

    if (mentorshipKind === 'mentee') {
      const goals = (goalsTrimmed ?? '').trim();
      const core: Row[] = [
        { label: 'Pick at least 3 skills from the list', ok: skillKeysCount >= 3 },
        { label: 'Write career goals (35+ characters)', ok: goals.length >= 35 },
        { label: 'Add at least one education block (school or degree)', ok: educationHasSubstance(educationEntries) },
        { label: 'Choose your major', ok: !!(major ?? '').trim() },
        { label: 'Set your graduation date', ok: !!(gradDate ?? '').trim() },
      ];
      const bonus: Row[] = [
        { label: 'Add GPA (profile or a school row)', ok: hasAnyGpa(educationEntries, profileGpaStr), optional: true },
        { label: 'Add LinkedIn URL', ok: (linkedinUrl ?? '').trim().length > 8, optional: true },
      ];
      return { core, bonus };
    }

    const mSkills = parseCsvTags(mentorSkillsCsv);
    const core: Row[] = [
      { label: 'Add at least one mentor skill (in mentor details)', ok: mSkills.length >= 1 },
      { label: 'Select at least one industry', ok: mentorIndustriesCount >= 1 },
      { label: 'Enter your company', ok: !!(mentorCompany ?? '').trim() },
    ];
    const bonus: Row[] = [
      { label: 'Add job title', ok: !!(mentorJobTitle ?? '').trim(), optional: true },
      { label: 'Add years of experience (0–80)', ok: mentorYearsValid(mentorYearsStr), optional: true },
      { label: 'Add LinkedIn URL', ok: (linkedinUrl ?? '').trim().length > 8, optional: true },
    ];
    return { core, bonus };
  });

  const coreDone = $derived(rows.core.filter((r) => r.ok).length);
  const coreTotal = $derived(rows.core.length);
  const corePct = $derived(coreTotal === 0 ? 0 : Math.round((100 * coreDone) / coreTotal));
  const bonusDone = $derived(rows.bonus.filter((r) => r.ok).length);
  const bonusTotal = $derived(rows.bonus.length);
</script>

{#if active && (mentorshipKind === 'mentee' || mentorshipKind === 'mentor')}
  <section class="match-check" aria-labelledby="match-check-title">
    <div class="match-check-head">
      <h3 id="match-check-title" class="match-check-title">Profile strength for mentorship</h3>
      <span class="match-check-pill" aria-live="polite">{coreDone}/{coreTotal} core</span>
    </div>
    <p class="match-check-lead">
      {#if mentorshipKind === 'mentee'}
        Especially if you skip a resume, these fields drive how mentors find you.
      {:else}
        Completing these helps mentees discover you and improves match quality.
      {/if}
    </p>

    <div class="match-meter" aria-hidden="true">
      <div class="match-meter-fill" style="width: {corePct}%"></div>
    </div>
    <p class="match-meter-label"><strong>{corePct}%</strong> of core checklist</p>

    <ul class="match-list" aria-label="Core profile items for matching">
      {#each rows.core as item}
        <li class="match-item" class:match-item-done={item.ok}>
          <span class="match-icon" aria-hidden="true">{item.ok ? '✓' : '○'}</span>
          <span class="match-text">{item.label}</span>
        </li>
      {/each}
    </ul>

    {#if rows.bonus.length > 0}
      <p class="match-bonus-head">Boost your profile <span class="match-bonus-count">({bonusDone}/{bonusTotal})</span></p>
      <ul class="match-list match-list-bonus" aria-label="Optional extras">
        {#each rows.bonus as item}
          <li class="match-item" class:match-item-done={item.ok} class:match-item-bonus={item.optional}>
            <span class="match-icon match-icon-bonus" aria-hidden="true">{item.ok ? '✓' : '○'}</span>
            <span class="match-text">{item.label}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .match-check {
    margin: 1rem 0 0.25rem;
    padding: 0.85rem 1rem;
    border-radius: var(--radius, 8px);
    border: 1px solid rgba(128, 0, 0, 0.22);
    background: linear-gradient(160deg, rgba(128, 0, 0, 0.07), rgba(128, 0, 0, 0.02));
  }

  .match-check-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .match-check-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--maroon);
    font-family: var(--font-heading);
  }

  .match-check-pill {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: rgba(128, 0, 0, 0.12);
    color: var(--maroon);
    border: 1px solid rgba(128, 0, 0, 0.2);
  }

  .match-check-lead {
    margin: 0.4rem 0 0.65rem;
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--text-muted, #555);
  }

  .match-meter {
    height: 8px;
    border-radius: 999px;
    background: rgba(128, 0, 0, 0.12);
    overflow: hidden;
  }

  .match-meter-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--maroon, #500000), #9a3030);
    transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .match-meter-label {
    margin: 0.35rem 0 0.6rem;
    font-size: 0.78rem;
    color: var(--text-muted, #555);
  }

  .match-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .match-item {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    font-size: 0.84rem;
    line-height: 1.35;
    color: #333;
  }

  .match-item-done .match-text {
    color: #1a5c1a;
  }

  .match-item-bonus.match-item-done .match-text {
    color: #5c4a1a;
  }

  .match-icon {
    flex-shrink: 0;
    width: 1.1rem;
    text-align: center;
    font-weight: 700;
    color: var(--maroon);
    opacity: 0.85;
  }

  .match-item-done .match-icon {
    opacity: 1;
  }

  .match-icon-bonus {
    font-size: 0.78rem;
    opacity: 0.65;
  }

  .match-item-bonus.match-item-done .match-icon-bonus {
    opacity: 1;
  }

  .match-text {
    flex: 1;
    min-width: 0;
  }

  .match-bonus-head {
    margin: 0.75rem 0 0.35rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, #555);
  }

  .match-bonus-count {
    font-weight: 600;
    color: var(--maroon);
  }

  .match-list-bonus .match-item {
    font-size: 0.8rem;
    color: #444;
  }
</style>
