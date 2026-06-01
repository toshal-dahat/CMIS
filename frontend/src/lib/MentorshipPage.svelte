<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView } from './stores/viewStore';
  import { profile } from './stores/profileStore';
  import {
    acceptMentorshipMatch,
    fetchMentorshipCandidates,
    fetchMentorshipMatches,
    fetchUserProfile,
    skipMentorshipMatch,
    type MentorshipMatchRow,
  } from './api';

  let loading = $state(false);
  let loadingCandidates = $state(false);
  let error = $state('');
  let success = $state('');
  let candidates = $state<MentorshipMatchRow[]>([]);
  let matches = $state<MentorshipMatchRow[]>([]);

  const isMentor = $derived($profile.mentorshipInterested === true && $profile.mentorship === 'mentor');
  const isMentee = $derived($profile.mentorshipInterested === true && $profile.mentorship === 'mentee');

  function goBack(): void {
    currentView.set('landing');
  }

  async function loadMatchesOnly(): Promise<void> {
    const res = await fetchMentorshipMatches();
    if (res.ok) {
      matches = res.data?.matches ?? [];
    } else {
      error = res.error || 'Failed to load mentorship matches.';
    }
  }

  async function refreshCandidates(): Promise<void> {
    loadingCandidates = true;
    error = '';
    success = '';
    const res = await fetchMentorshipCandidates();
    if (!res.ok) {
      error = res.error || 'Failed to build candidates.';
      loadingCandidates = false;
      return;
    }
    candidates = res.data?.candidates ?? [];
    await loadMatchesOnly();
    loadingCandidates = false;
  }

  async function acceptCandidate(menteeUserId: string): Promise<void> {
    error = '';
    success = '';
    const res = await acceptMentorshipMatch(menteeUserId);
    if (!res.ok) {
      error = res.error || 'Failed to accept mentee.';
      return;
    }
    success = 'Mentee accepted. Channel opened and notification dispatched.';
    await loadMatchesOnly();
  }

  async function skipCandidate(menteeUserId: string): Promise<void> {
    error = '';
    success = '';
    const res = await skipMentorshipMatch(menteeUserId);
    if (!res.ok) {
      error = res.error || 'Failed to skip mentee.';
      return;
    }
    success = 'Candidate skipped.';
    await loadMatchesOnly();
  }

  onMount(() => {
    (async () => {
      loading = true;
      await fetchUserProfile();
      if (isMentor) {
        await loadMatchesOnly();
      }
      loading = false;
    })();
  });
</script>

<div class="mentorship-page">
  <div class="inner">
    <button class="back-link" type="button" onclick={goBack}>← Back to home</button>
    <h1>Mentorship</h1>

    {#if loading}
      <p class="hint">Loading mentorship data…</p>
    {:else if isMentor}
      <p class="hint">Mentor view: you can initiate matches and accept mentees.</p>
      <div class="actions">
        <button class="btn-primary" type="button" onclick={refreshCandidates} disabled={loadingCandidates}>
          {loadingCandidates ? 'Building candidates…' : 'Refresh candidate list'}
        </button>
      </div>

      <section class="card">
        <h2>Suggested mentees</h2>
        {#if candidates.length === 0}
          <p class="hint">No candidates generated yet. Click refresh to compute suggestions.</p>
        {:else}
          {#each candidates as c}
            <article class="candidate-row">
              <div class="top">
                <strong>{c.menteeName || 'Mentee'}</strong>
                <span class="score-pill">
                  Final: {typeof c.finalScore === 'number' ? c.finalScore.toFixed(3) : typeof c.similarityScore === 'number' ? c.similarityScore.toFixed(3) : 'n/a'}
                </span>
              </div>
              <div class="subscores">
                <span>Semantic: {typeof c.semanticScore === 'number' ? c.semanticScore.toFixed(3) : typeof c.similarityScore === 'number' ? c.similarityScore.toFixed(3) : 'n/a'}</span>
                <span>Rules: {typeof c.ruleScore === 'number' ? c.ruleScore.toFixed(3) : 'n/a'}</span>
              </div>
              <p class="hint">{c.reasonSummary || 'Similarity from profile and resume-derived data.'}</p>
              <p class="hint">Major: {c.menteeMajor || 'n/a'} | Grad: {c.menteeGradDate || 'n/a'}</p>
              {#if c.matchedSignals && c.matchedSignals.length > 0}
                <div class="signals">
                  {#each c.matchedSignals as signal}
                    <span class="signal-chip">{signal}</span>
                  {/each}
                </div>
              {/if}
              <div class="row-actions">
                <button class="btn-primary" type="button" onclick={() => c.menteeUserId && acceptCandidate(c.menteeUserId)}>Accept</button>
                <button class="btn-secondary" type="button" onclick={() => c.menteeUserId && skipCandidate(c.menteeUserId)}>Skip</button>
              </div>
            </article>
          {/each}
        {/if}
      </section>

      <section class="card">
        <h2>Current match records</h2>
        {#if matches.length === 0}
          <p class="hint">No match records yet.</p>
        {:else}
          {#each matches as m}
            <article class="match-row">
              <div class="top">
                <strong>{m.menteeName || m.menteeUserId}</strong>
                <span class="badge">{m.status || 'SUGGESTED'}</span>
              </div>
              <p class="hint">Final score: {typeof m.finalScore === 'number' ? m.finalScore.toFixed(3) : typeof m.similarityScore === 'number' ? m.similarityScore.toFixed(3) : 'n/a'}</p>
              {#if m.channelId}
                <p class="hint">Channel: <code>{m.channelId}</code></p>
              {/if}
            </article>
          {/each}
        {/if}
      </section>
    {:else if isMentee}
      <section class="card">
        <h2>Mentee status</h2>
        <p class="hint">
          Mentors initiate the conversation in this program. You are in the mentee pool and will be notified
          when a mentor accepts your profile.
        </p>
      </section>
    {:else}
      <section class="card">
        <h2>Not enrolled in mentorship</h2>
        <p class="hint">Update your profile and opt into the mentorship program to use this section.</p>
      </section>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
    {#if success}
      <p class="success">{success}</p>
    {/if}
  </div>
</div>

<style>
  .mentorship-page { min-height: 100vh; background: var(--bg); padding: 1.25rem; }
  .inner { max-width: 800px; margin: 0 auto; display: grid; gap: 0.9rem; }
  .back-link { width: fit-content; background: transparent; border: none; color: var(--maroon); cursor: pointer; font-weight: 600; }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.9rem; }
  .hint { color: var(--text-muted); margin: 0.2rem 0; }
  .actions, .row-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .subscores { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.35rem; color: var(--text-muted); font-size: 0.88rem; }
  .signals { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.45rem; }
  .signal-chip { font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); }
  .candidate-row, .match-row { border-top: 1px solid var(--border); padding-top: 0.7rem; margin-top: 0.7rem; }
  .top { display: flex; justify-content: space-between; gap: 0.6rem; }
  .badge { font-size: 0.78rem; border: 1px solid var(--border); padding: 0.1rem 0.35rem; border-radius: 999px; width: fit-content; }
  .score-pill { font-size: 0.8rem; font-weight: 600; border-radius: 999px; border: 1px solid rgba(128, 0, 0, 0.28); background: rgba(128, 0, 0, 0.06); padding: 0.15rem 0.5rem; }
  .btn-primary { background: var(--maroon); color: white; border: 1px solid var(--maroon); border-radius: var(--radius); padding: 0.35rem 0.7rem; cursor: pointer; }
  .btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.35rem 0.7rem; cursor: pointer; }
  .error { color: #721c24; background: #f8d7da; padding: 0.5rem; border-radius: var(--radius); }
  .success { color: #155724; background: #d4edda; padding: 0.5rem; border-radius: var(--radius); }
</style>
