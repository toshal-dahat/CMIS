<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView } from './stores/viewStore';
  import { profile } from './stores/profileStore';
  import {
    acceptMentorshipMatch,
    declineMentorshipMatch,
    fetchMentorshipCandidates,
    fetchMentorshipEmbeddingConfig,
    fetchMentorshipMatches,
    fetchMentorshipMenteeMatches,
    fetchMentorshipProfileEmbeddings,
    fetchUserProfile,
    reviveMentorshipMatch,
    type MentorshipMatchRow,
    type MentorshipMentorBoardInfo,
    type MentorshipProfileEmbeddingBlock,
  } from './api';

  let loading = $state(false);
  let loadingCandidates = $state(false);
  let error = $state('');
  let success = $state('');
  let candidates = $state<MentorshipMatchRow[]>([]);
  let matches = $state<MentorshipMatchRow[]>([]);
  let mentorBoard = $state<MentorshipMentorBoardInfo | null>(null);
  let menteeMatches = $state<MentorshipMatchRow[]>([]);

  let embedLoading = $state(false);
  let embedError = $state('');
  let embedSource = $state('');
  let embedUserId = $state('');
  let embedMentor = $state<MentorshipProfileEmbeddingBlock | null>(null);
  let embedMentee = $state<MentorshipProfileEmbeddingBlock | null>(null);
  let showEmbeddingVectors = $state(false);
  let embedConfigText = $state('');
  let embedConfigObj = $state<Record<string, unknown> | null>(null);

  /** Mentor primary navigation: active suggestions vs declined revival list */
  let mentorPanelTab = $state<'queue' | 'declined'>('queue');

  function withDetail(base: string, detail: string | undefined): string {
    const d = (detail || '').trim();
    return d ? `${base} — ${d}` : base;
  }

  const isMentor = $derived($profile.mentorshipInterested === true && $profile.mentorship === 'mentor');
  const isMentee = $derived($profile.mentorshipInterested === true && $profile.mentorship === 'mentee');

  function goBack(): void {
    currentView.set('landing');
  }

  function statusLabel(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'PENDING_MENTOR') return 'Waiting for mentor';
    if (s === 'SUGGESTED') return 'Suggested';
    if (s === 'CHANNEL_OPENED') return 'Matched';
    if (s === 'DECLINED_BY_MENTOR') return 'Declined';
    if (s === 'SKIPPED_BY_MENTOR') return 'Passed';
    return status || '—';
  }

  function tierBadge(tier: string | undefined): string {
    const t = (tier || 'none').toLowerCase();
    if (t === 'gold') return 'Gold board';
    if (t === 'silver') return 'Silver board';
    return '';
  }

  function numericScore(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** Best available composite / rank score for a match or candidate row. */
  function primaryMatchScore(row: MentorshipMatchRow): number | null {
    return (
      numericScore(row.finalScore) ??
      numericScore(row.boostedScore) ??
      numericScore(row.semanticScore) ??
      numericScore(row.similarityScore)
    );
  }

  /** Order mentee rows best-first when scores exist; otherwise preserve input order (stable sort). */
  function menteeRankSort(a: MentorshipMatchRow, b: MentorshipMatchRow): number {
    const sa = primaryMatchScore(a);
    const sb = primaryMatchScore(b);
    if (sa != null && sb != null && sa !== sb) return sb - sa;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    return 0;
  }

  async function loadMentorMatches(): Promise<boolean> {
    const res = await fetchMentorshipMatches();
    if (res.ok) {
      matches = res.data?.matches ?? [];
      return true;
    }
    error = res.error || 'Failed to load matches.';
    return false;
  }

  async function loadMenteeStatus(): Promise<void> {
    const res = await fetchMentorshipMenteeMatches();
    if (res.ok) {
      menteeMatches = res.data?.matches ?? [];
    } else {
      error = res.error || 'Failed to load your requests.';
    }
  }

  async function refreshCandidates(): Promise<void> {
    loadingCandidates = true;
    error = '';
    success = '';
    const res = await fetchMentorshipCandidates();
    if (!res.ok) {
      const errPayload = res.data as unknown as { detail?: string } | undefined;
      const detail = typeof errPayload?.detail === 'string' ? errPayload.detail : '';
      error = withDetail(res.error || 'Could not build mentee suggestions.', detail);
      loadingCandidates = false;
      return;
    }
    candidates = res.data?.candidates ?? [];
    mentorBoard = res.data?.mentorBoard ?? null;
    const matchesOk = await loadMentorMatches();
    loadingCandidates = false;
    if (matchesOk) {
      success = 'Suggestions updated.';
    }
  }

  async function acceptCandidate(menteeUserId: string): Promise<void> {
    error = '';
    success = '';
    const res = await acceptMentorshipMatch(menteeUserId);
    if (!res.ok) {
      if (res.status === 409) {
        const errPayload = res.data as unknown as { error?: string; detail?: string } | undefined;
        const parts = [errPayload?.error, errPayload?.detail].filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        );
        error =
          parts.join(' — ') ||
          res.error ||
          'This match could not be confirmed (capacity or program limits).';
      } else {
        error = res.error || 'Accept failed.';
      }
      return;
    }
    const ice = res.data?.accepted?.suggestedIcebreaker;
    success = ice
      ? 'Match confirmed. Suggested icebreaker (also saved on the match): ' + ice
      : 'Match confirmed. The mentee will be notified.';
    await loadMentorMatches();
    candidates = candidates.filter((c) => c.menteeUserId !== menteeUserId);
  }

  async function declineCandidate(menteeUserId: string): Promise<void> {
    error = '';
    success = '';
    const res = await declineMentorshipMatch(menteeUserId);
    if (!res.ok) {
      error = res.error || 'Could not decline.';
      return;
    }
    success = 'Declined.';
    await loadMentorMatches();
    candidates = candidates.filter((c) => c.menteeUserId !== menteeUserId);
  }

  async function reviveDeclined(menteeUserId: string): Promise<void> {
    error = '';
    success = '';
    const res = await reviveMentorshipMatch(menteeUserId);
    if (!res.ok) {
      error = res.error || 'Could not restore this match.';
      return;
    }
    success = 'Match moved back to your suggestions. Use Find mentees if you want a fresh ranked list.';
    mentorPanelTab = 'queue';
    await loadMentorMatches();
  }

  async function loadEmbeddingConfig(): Promise<void> {
    embedConfigText = '';
    embedConfigObj = null;
    const res = await fetchMentorshipEmbeddingConfig();
    if (!res.ok) {
      embedConfigText = res.error || 'Could not load embedding config.';
      return;
    }
    embedConfigObj = (res.data as Record<string, unknown>) ?? null;
    embedConfigText = JSON.stringify(res.data ?? {}, null, 2);
  }

  async function loadProfileEmbeddings(refresh: boolean): Promise<void> {
    embedLoading = true;
    embedError = '';
    const res = await fetchMentorshipProfileEmbeddings({
      refresh,
      includeVector: showEmbeddingVectors,
    });
    embedLoading = false;
    if (!res.ok) {
      const errPayload = res.data as unknown as { detail?: string } | undefined;
      const detail = typeof errPayload?.detail === 'string' ? errPayload.detail : '';
      embedError = withDetail(res.error || 'Could not load or save profile vectors.', detail);
      embedSource = '';
      embedUserId = '';
      embedMentor = null;
      embedMentee = null;
      return;
    }
    const d = res.data;
    embedSource = (d?.source as string) || '';
    embedUserId = (d?.userId as string) || '';
    embedMentor = (d?.mentor as MentorshipProfileEmbeddingBlock) ?? null;
    embedMentee = (d?.mentee as MentorshipProfileEmbeddingBlock) ?? null;
  }

  const mentorPendingMatches = $derived(matches.filter((m) => m.status === 'SUGGESTED'));

  const mentorPendingIds = $derived(new Set(mentorPendingMatches.map((m) => m.menteeUserId).filter(Boolean)));

  const rankedCandidates = $derived(candidates.filter((c) => c.menteeUserId && !mentorPendingIds.has(c.menteeUserId)));

  const mentorOrderedPendingMatches = $derived([...mentorPendingMatches].sort(menteeRankSort));

  /** Up to 10 mentees, strongest match first; scores are not shown in the UI. */
  const mentorTopTenMentees = $derived([...rankedCandidates].sort(menteeRankSort).slice(0, 10));

  const mentorDeclinedMatches = $derived(
    [...matches.filter((m) => m.status === 'DECLINED_BY_MENTOR')].sort(menteeRankSort),
  );

  onMount(() => {
    (async () => {
      loading = true;
      await fetchUserProfile();
      if (isMentor) {
        await loadMentorMatches();
      } else if (isMentee) {
        await loadMenteeStatus();
      }
      loading = false;
    })();
  });
</script>

{#snippet menteeReviewDetails(r: MentorshipMatchRow)}
  <div class="mentee-detail-block">
    {#if r.menteeEmail}
      <p class="muted small"><strong>Email:</strong> <a href={`mailto:${r.menteeEmail}`}>{r.menteeEmail}</a></p>
    {/if}
    {#if r.menteeLinkedInUrl}
      <p class="muted small">
        <a href={r.menteeLinkedInUrl} target="_blank" rel="noopener noreferrer">Student LinkedIn</a>
      </p>
    {/if}
    {#if r.menteeDegree || r.menteeUniversity}
      <p class="muted small">
        <strong>Program:</strong>
        {[r.menteeDegree, r.menteeUniversity].filter(Boolean).join(' · ')}
      </p>
    {/if}
    {#if r.menteeProfileGpa != null && String(r.menteeProfileGpa).trim() !== ''}
      <p class="muted small"><strong>GPA:</strong> {r.menteeProfileGpa}</p>
    {/if}
    {#if r.menteeEducationSummary}
      <p class="muted small"><strong>Education:</strong></p>
      <pre class="education-preview">{r.menteeEducationSummary}</pre>
    {/if}
    {#if r.menteeMentorshipGoals}
      <p class="muted small"><strong>Career / mentorship goals:</strong> {r.menteeMentorshipGoals}</p>
    {/if}
    {#if r.menteeStudentGoals}
      <p class="muted small"><strong>Student goals:</strong> {r.menteeStudentGoals}</p>
    {/if}
    {#if r.menteeResumeDownloadUrl}
      <p class="muted small resume-dl-line">
        <a
          href={r.menteeResumeDownloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="resume-dl-link"
          download={r.menteeResumeFileName || undefined}>Download resume</a
        >
        {#if r.menteeResumeFileName}<span class="muted"> · {r.menteeResumeFileName}</span>{/if}
      </p>
    {:else}
      <p class="muted small">No resume download link yet (upload pending or storage not configured).</p>
    {/if}
  </div>
{/snippet}

<div class="mentorship-page">
  <div class="inner">
    <button class="back-link" type="button" onclick={goBack}>← Back to home</button>

    <header class="hero hero-animated">
      <h1>Mentorship</h1>
      <p class="hero-sub">
        {#if isMentor}
          Review suggested students and confirm a match when you are ready to mentor them.
        {:else if isMentee}
          Mentors are matched to you here. When a mentor accepts, you will see their contact details below.
        {:else}
          Opt in under <strong>My profile</strong> to use mentorship.
        {/if}
      </p>
    </header>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    {#if success}
      <p class="success" role="status">{success}</p>
    {/if}

    {#if loading}
      <p class="hint">Loading…</p>
    {:else if isMentor}
      <div class="mentor-tabs" role="tablist" aria-label="Mentorship sections">
        <button
          type="button"
          role="tab"
          class="mentor-tab"
          class:mentor-tab-active={mentorPanelTab === 'queue'}
          aria-selected={mentorPanelTab === 'queue'}
          onclick={() => (mentorPanelTab = 'queue')}
        >
          Suggestions &amp; matches
        </button>
        <button
          type="button"
          role="tab"
          class="mentor-tab"
          class:mentor-tab-active={mentorPanelTab === 'declined'}
          aria-selected={mentorPanelTab === 'declined'}
          onclick={() => (mentorPanelTab = 'declined')}
        >
          Previously declined{#if mentorDeclinedMatches.length > 0}<span class="mentor-tab-badge">{mentorDeclinedMatches.length}</span>{/if}
        </button>
      </div>

      {#if mentorPanelTab === 'queue'}
      {#if mentorBoard?.tier && mentorBoard.tier !== 'none'}
        <div class="tier-banner animate-in-up" role="status">
          <span class="tier-label">{tierBadge(mentorBoard.tier)}</span>
          <span class="tier-meta"
            >Ranking boost ×{typeof mentorBoard.multiplier === 'number' ? mentorBoard.multiplier.toFixed(2) : '—'} applied when we rank students for you.</span
          >
        </div>
      {/if}

      <section class="panel panel-highlight animate-in-up" class:panel-busy={loadingCandidates}>
        <h2 class="panel-title">Find mentees</h2>
        <p class="panel-desc">
          We rank up to 10 students using your profile and their goals (best match first; scores stay private). Usually takes a few seconds. You can run this again anytime to refresh the list.
        </p>
        <button
          class="btn-primary btn-large btn-pulse-wrap"
          type="button"
          onclick={refreshCandidates}
          disabled={loadingCandidates}
        >
          {#if loadingCandidates}
            <span class="btn-shimmer" aria-hidden="true"></span>
          {/if}
          <span class="btn-label">{loadingCandidates ? 'Building suggestions…' : 'Find mentees for me'}</span>
        </button>
      </section>

      {#if mentorOrderedPendingMatches.length > 0}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Needs your response</h2>
          <p class="panel-desc">Suggestions waiting on you, listed with the closest fit first. Match scores are not shown.</p>
          <ul class="simple-list">
            {#each mentorOrderedPendingMatches as m, mi (m.menteeUserId || String(mi))}
              <li class="simple-row pending-card stagger-item" style="--stagger: {mi}">
                <div class="pending-top">
                  <div class="pending-headline">
                    <div class="pending-name-row">
                      <strong>{m.menteeName || 'Student'}</strong>
                      <span class="pill">{statusLabel(m.status)}</span>
                    </div>
                  </div>
                </div>
                {#if m.reasonSummary}
                  <p class="muted small reason-fade">{m.reasonSummary}</p>
                {/if}
                {#if m.matchedSignals?.length}
                  <p class="muted small"><strong>Signals:</strong> {m.matchedSignals.join(' · ')}</p>
                {/if}
                {@render menteeReviewDetails(m)}
                <div class="row-actions">
                  {#if m.menteeUserId}
                    <button class="btn-primary" type="button" onclick={() => acceptCandidate(m.menteeUserId!)}>Accept</button>
                    <button class="btn-ghost" type="button" onclick={() => declineCandidate(m.menteeUserId!)}>Decline</button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if mentorTopTenMentees.length > 0}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Suggested mentees</h2>
          <p class="panel-desc">
            Up to <strong>10</strong> students, <strong>best match first</strong>. The first row is your <strong>top match</strong>; the rest follow in order. Match scores are not shown.
          </p>
          <ul class="mentee-rank-list">
            {#each mentorTopTenMentees as c, ci (c.menteeUserId || String(ci))}
              <li class="mentee-rank-row stagger-item" style="--stagger: {ci}">
                <div class="mentee-rank-row-head">
                  {#if ci === 0}
                    <span class="pill pill-accent mentee-rank-label">Top match</span>
                  {:else}
                    <span class="mentee-rank-label muted small" aria-label="Match rank {ci + 1}">#{ci + 1}</span>
                  {/if}
                  <div class="mentee-rank-identity">
                    <strong class="mentee-rank-name">{c.menteeName || 'Student'}</strong>
                    <span class="muted small mentee-rank-meta"
                      >{c.menteeMajor || 'Major n/a'} · Grad {c.menteeGradDate || '—'}</span
                    >
                  </div>
                </div>
                {#if c.reasonSummary}
                  <p class="reason mentee-rank-reason">{c.reasonSummary}</p>
                {/if}
                {#if c.matchedSignals?.length}
                  <p class="muted small"><strong>Signals:</strong> {c.matchedSignals.join(' · ')}</p>
                {/if}
                {#if c.skillGapOpportunities?.length}
                  <div class="gap-box">
                    <p class="muted small"><strong>Skill growth ideas</strong></p>
                    <ul class="tiny-list">
                      {#each c.skillGapOpportunities as g}
                        <li><strong>{g.skill || 'Skill'}</strong> — {g.rationale || ''}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {@render menteeReviewDetails(c)}
                {#if c.menteeUserId}
                  <div class="row-actions">
                    <button class="btn-primary" type="button" onclick={() => acceptCandidate(c.menteeUserId!)}>Accept match</button>
                    <button class="btn-ghost" type="button" onclick={() => declineCandidate(c.menteeUserId!)}>Decline</button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="panel">
        <h2 class="panel-title">All match records</h2>
        {#if matches.length === 0}
          <p class="muted">No history yet.</p>
        {:else}
          <ul class="simple-list compact">
            {#each matches as m}
              <li class="simple-row compact">
                <div>
                  <span>{m.menteeName || m.menteeUserId}</span>
                  <span class="pill">{statusLabel(m.status)}</span>
                  {#if m.channelId}<code class="tiny">{m.channelId.slice(0, 24)}…</code>{/if}
                  {#if m.status === 'CHANNEL_OPENED' && m.suggestedIcebreaker}
                    <p class="muted small"><strong>Icebreaker:</strong> {m.suggestedIcebreaker}</p>
                  {/if}
                  {#if m.status === 'SUGGESTED' || m.status === 'CHANNEL_OPENED' || m.status === 'SKIPPED_BY_MENTOR'}
                    {@render menteeReviewDetails(m)}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
      {:else}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Previously declined</h2>
          <p class="panel-desc">
            Restore a student to your active suggestions if you change your mind. Revival is only allowed while they still have
            room for more mentors (same limit as new matches).
          </p>
          {#if mentorDeclinedMatches.length === 0}
            <p class="muted">No declined students yet.</p>
          {:else}
            <ul class="simple-list">
              {#each mentorDeclinedMatches as dm, di (dm.menteeUserId || String(di))}
                <li class="simple-row pending-card stagger-item" style="--stagger: {di}">
                  <div class="pending-name-row">
                    <strong>{dm.menteeName || 'Student'}</strong>
                    <span class="pill">Declined</span>
                  </div>
                  {#if dm.declineReason}
                    <p class="muted small"><strong>Your note:</strong> {dm.declineReason}</p>
                  {/if}
                  {@render menteeReviewDetails(dm)}
                  {#if dm.menteeUserId}
                    <div class="row-actions">
                      <button class="btn-primary" type="button" onclick={() => reviveDeclined(dm.menteeUserId!)}>
                        Restore to suggestions
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    {:else if isMentee}
      <section class="panel panel-highlight animate-in-up">
        <h2 class="panel-title">Your mentorship status</h2>
        <p class="panel-desc">
          Mentors are paired with you from your profile and goals. You do not choose a mentor yourself—a mentor confirms the
          match first. When they do, their contact details appear below. You may also receive an email notification.
        </p>
        <button class="btn-secondary btn-inline" type="button" onclick={loadMenteeStatus}>Refresh status</button>
        {#if menteeMatches.length === 0}
          <p class="muted" style="margin-top: 0.85rem;">
            A mentor match is in progress. Please check back soon; this page updates as soon as a mentor has accepted your
            pairing.
          </p>
        {/if}
      </section>

      {#if menteeMatches.length > 0}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Your mentor</h2>
          {#each menteeMatches as mm (mm.mentorUserId || mm.channelId || '')}
            <article class="card-easy" style="margin-top: 0.75rem;">
              <h3>{mm.mentorName || 'Your mentor'}</h3>
              {#if mm.mentorCompany || mm.mentorJobTitle}
                <p class="muted">
                  {mm.mentorCompany || ''}{mm.mentorCompany && mm.mentorJobTitle ? ' · ' : ''}{mm.mentorJobTitle || ''}
                </p>
              {/if}
              {#if mm.mentorDegree || mm.mentorMajor}
                <p class="muted small">{[mm.mentorDegree, mm.mentorMajor].filter(Boolean).join(' · ')}</p>
              {/if}
              {#if mm.mentorIndustries?.length}
                <p class="muted small"><strong>Industries:</strong> {mm.mentorIndustries.join(', ')}</p>
              {/if}
              {#if mm.mentorEmail}
                <p><strong>Email:</strong> <a href={`mailto:${mm.mentorEmail}`}>{mm.mentorEmail}</a></p>
              {/if}
              {#if mm.mentorLinkedInUrl}
                <p>
                  <a href={mm.mentorLinkedInUrl} target="_blank" rel="noopener noreferrer">LinkedIn profile</a>
                </p>
              {/if}
              {#if mm.channelId}
                <p class="muted small">
                  <strong>Connection reference:</strong> <code class="tiny">{mm.channelId}</code>
                </p>
              {/if}
              {#if mm.suggestedIcebreaker}
                <p class="muted small"><strong>Suggested introduction:</strong> {mm.suggestedIcebreaker}</p>
              {/if}
            </article>
          {/each}
        </section>
      {/if}
    {:else}
      <section class="panel">
        <p class="muted">Open <strong>My profile</strong> and opt into the mentorship program to continue.</p>
      </section>
    {/if}

    <details
      class="debug-details"
      ontoggle={(e) => {
        const el = e.currentTarget as HTMLDetailsElement;
        if (el.open) void loadEmbeddingConfig();
      }}
    >
      <summary>Troubleshooting &amp; embedding tools</summary>
      <div class="embed-inner">
        <p class="hint embed-lead">
          Optional. Use this if matching seems stuck or support asked you to refresh vectors. Most mentors never need this.
        </p>

        <h3 class="embed-h3">Embedding service</h3>
        {#if embedConfigObj && embedConfigObj.status === 'ok'}
          {@const meta = embedConfigObj.meta as Record<string, unknown> | undefined}
          <div class="embed-status-ok" role="status">
            <span class="embed-ok-dot" aria-hidden="true"></span>
            <div>
              <strong>Connected</strong>
              <span class="embed-status-line">
                {(meta?.provider as string) || '—'} · {(meta?.model as string) || ''}
                {#if meta?.dimensions != null}
                  · {String(meta.dimensions)} dimensions{/if}
              </span>
            </div>
          </div>
        {:else if embedConfigText && !embedConfigObj}
          <p class="embed-err">{embedConfigText}</p>
        {/if}
        {#if embedConfigObj}
          <details class="embed-raw">
            <summary>View raw probe JSON</summary>
            <pre class="embed-pre">{embedConfigText}</pre>
          </details>
        {/if}

        <h3 class="embed-h3">Stored profile vectors</h3>
        <p class="hint">
          Loads or rebuilds the numbers we store for your account (used for semantic matching). Requires a saved student
          profile and resume when the app needs them.
        </p>
        <label class="embed-toggle">
          <input type="checkbox" bind:checked={showEmbeddingVectors} />
          Include full vector in response (large download)
        </label>
        <div class="row-actions">
          <button class="btn-secondary" type="button" onclick={() => loadProfileEmbeddings(false)} disabled={embedLoading}>
            {embedLoading ? 'Loading…' : 'Load from storage'}
          </button>
          <button class="btn-primary" type="button" onclick={() => loadProfileEmbeddings(true)} disabled={embedLoading}>
            Recompute &amp; save
          </button>
        </div>
        {#if embedError}
          <p class="embed-err" role="alert">{embedError}</p>
        {/if}
        {#if embedSource || embedUserId}
          <p class="hint embed-meta">
            <strong>Last result:</strong> {embedSource || '—'} · user <code>{embedUserId || '—'}</code>
          </p>
        {/if}
        {#if embedMentor?.canonicalTextPreview}
          <p class="embed-preview-label">Mentor-side text sent to the model (preview)</p>
          <pre class="preview">{embedMentor.canonicalTextPreview}</pre>
        {/if}
        {#if embedMentee?.canonicalTextPreview}
          <p class="embed-preview-label">Mentee-side text sent to the model (preview)</p>
          <pre class="preview">{embedMentee.canonicalTextPreview}</pre>
        {/if}
      </div>
    </details>
  </div>
</div>

<style>
  .embed-pre {
    font-size: 0.72rem;
    overflow: auto;
    max-height: 12rem;
    padding: 0.5rem;
    background: var(--surface-alt, #f5f5f5);
    border-radius: var(--radius);
  }
  .tiny-list {
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
  }
  .gap-box {
    margin-top: 0.35rem;
  }
  .mentor-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }
  .mentor-tab {
    border: 1px solid rgba(128, 0, 0, 0.25);
    background: var(--surface, #fff);
    color: var(--text, #222);
    padding: 0.45rem 0.75rem;
    border-radius: var(--radius);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.88rem;
  }
  .mentor-tab-active {
    background: var(--maroon);
    color: #fff;
    border-color: var(--maroon);
  }
  .mentor-tab-badge {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.72rem;
    background: rgba(255, 255, 255, 0.25);
  }
  .mentor-tab-active .mentor-tab-badge {
    background: rgba(255, 255, 255, 0.3);
  }
  .resume-dl-link {
    font-weight: 600;
    color: var(--maroon);
  }
  .resume-dl-line {
    margin-top: 0.35rem;
  }
  .mentee-detail-block {
    margin-top: 0.5rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius);
    background: var(--surface-alt, rgba(0, 0, 0, 0.03));
    border: 1px solid rgba(128, 0, 0, 0.12);
  }
  .mentee-detail-block > p:first-child {
    margin-top: 0;
  }
  .education-preview {
    margin: 0.35rem 0 0;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow: auto;
    max-height: 8rem;
    padding: 0.45rem 0.5rem;
    background: var(--surface, #fff);
    border-radius: calc(var(--radius) * 0.85);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }
  .mentorship-page {
    min-height: 100vh;
    background: var(--bg);
    padding: 1.25rem 1rem 2rem;
  }
  .inner {
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .back-link {
    width: fit-content;
    background: transparent;
    border: none;
    color: var(--maroon);
    cursor: pointer;
    font-weight: 600;
    padding: 0;
  }
  .hero h1 {
    margin: 0 0 0.35rem;
    font-size: 1.65rem;
  }
  .hero-sub {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.45;
    font-size: 0.95rem;
  }
  .tier-banner {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius);
    background: linear-gradient(135deg, rgba(128, 0, 0, 0.08), rgba(180, 140, 60, 0.12));
    border: 1px solid rgba(128, 0, 0, 0.2);
  }
  .tier-label {
    font-weight: 700;
    color: var(--maroon);
    font-size: 0.9rem;
  }
  .tier-meta {
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .panel {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.1rem;
  }
  .panel-highlight {
    border-color: rgba(128, 0, 0, 0.25);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  }
  .panel-title {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
  }
  .panel-desc {
    margin: 0 0 0.85rem;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .btn-large {
    padding: 0.55rem 1.1rem;
    font-size: 1rem;
    width: 100%;
    justify-content: center;
  }
  .btn-inline {
    margin-bottom: 0.65rem;
  }
  .btn-primary {
    background: var(--maroon);
    color: #fff;
    border: 1px solid var(--maroon);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }
  .btn-ghost {
    background: transparent;
    border: 1px dashed var(--border);
    color: var(--text-muted);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.88rem;
  }
  .card-easy {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.85rem;
    margin-top: 0.65rem;
    background: var(--bg);
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .card-head h3 {
    margin: 0;
    font-size: 1rem;
  }
  .muted {
    color: var(--text-muted);
    margin: 0.2rem 0 0;
    font-size: 0.88rem;
  }
  .muted.small {
    font-size: 0.78rem;
    display: block;
  }
  .score-block {
    text-align: right;
    flex-shrink: 0;
  }
  .score-big {
    display: block;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--maroon);
    line-height: 1.1;
  }
  .boost-line {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.5rem 0 0;
  }
  .reason {
    font-size: 0.88rem;
    margin: 0.5rem 0 0.65rem;
    line-height: 1.35;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .mentee-rank-list {
    list-style: none;
    padding: 0;
    margin: 0.65rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .mentee-rank-row {
    padding: 0.85rem 0;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .mentee-rank-row:first-child {
    border-top: none;
    padding-top: 0;
  }
  .mentee-rank-row-head {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
  }
  .mentee-rank-label {
    flex-shrink: 0;
    min-width: 4.75rem;
    margin-top: 0.1rem;
  }
  .mentee-rank-label.pill {
    margin-left: 0;
    margin-top: 0;
  }
  .mentee-rank-identity {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .mentee-rank-name {
    font-size: 1rem;
  }
  .mentee-rank-meta {
    margin: 0;
  }
  .mentee-rank-reason {
    margin: 0;
    padding-left: 0;
  }
  .simple-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  .simple-list.compact {
    margin-top: 0.35rem;
  }
  .simple-row {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.65rem 0;
    border-top: 1px solid var(--border);
  }
  .simple-row:first-child {
    border-top: none;
    padding-top: 0;
  }
  .simple-row.compact {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0.4rem 0;
  }
  .pill {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    margin-left: 0.35rem;
    vertical-align: middle;
  }
  .pill-accent {
    background: rgba(128, 0, 0, 0.08);
    border-color: rgba(128, 0, 0, 0.25);
    color: var(--maroon);
  }
  .pill-gold {
    background: rgba(180, 140, 60, 0.15);
    border-color: rgba(180, 140, 60, 0.4);
    margin-left: 0;
    margin-bottom: 0.25rem;
  }
  .tiny {
    font-size: 0.72rem;
    word-break: break-all;
  }
  .hint {
    color: var(--text-muted);
  }
  .error {
    color: #721c24;
    background: #f8d7da;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius);
    margin: 0;
  }
  .success {
    color: #155724;
    background: #d4edda;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius);
    margin: 0;
  }
  .debug-details {
    margin-top: 0.75rem;
    font-size: 0.88rem;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.75rem 0.65rem;
    background: var(--card-bg, #fff);
  }
  .debug-details > summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--text-muted);
  }
  .embed-inner {
    padding: 0.5rem 0 0;
  }
  .embed-lead {
    margin: 0 0 0.75rem;
    line-height: 1.45;
  }
  .embed-h3 {
    margin: 0.85rem 0 0.35rem;
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .embed-h3:first-of-type {
    margin-top: 0.25rem;
  }
  .embed-status-ok {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius);
    background: rgba(21, 87, 36, 0.08);
    border: 1px solid rgba(21, 87, 36, 0.22);
    color: var(--text, #1a1a1a);
    font-size: 0.85rem;
  }
  .embed-ok-dot {
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.28rem;
    border-radius: 50%;
    background: #1e7e34;
    flex-shrink: 0;
  }
  .embed-status-line {
    display: block;
    font-weight: 400;
    color: var(--text-muted);
    margin-top: 0.15rem;
    font-size: 0.8rem;
    word-break: break-word;
  }
  .embed-raw {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
  }
  .embed-raw > summary {
    cursor: pointer;
    color: var(--maroon);
    font-weight: 600;
  }
  .embed-meta {
    margin-top: 0.5rem;
  }
  .embed-preview-label {
    margin: 0.5rem 0 0.2rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .embed-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    margin: 0.35rem 0;
  }
  .embed-err {
    color: #721c24;
    background: #f8d7da;
    padding: 0.4rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
  }
  .preview {
    font-size: 0.68rem;
    max-height: 8rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem;
    margin: 0.35rem 0 0;
  }

  /* —— Lively mentorship visuals —— */
  .hero-animated {
    animation: hero-fade 0.55s ease-out both;
  }
  @keyframes hero-fade {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .animate-in-up {
    animation: panel-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes panel-up {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .stagger-item {
    animation: card-enter 0.48s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: calc(var(--stagger, 0) * 0.055s);
  }
  @keyframes card-enter {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .card-lively {
    transition:
      box-shadow 0.2s ease,
      border-color 0.2s ease,
      transform 0.2s ease;
  }
  .card-lively:hover {
    border-color: rgba(128, 0, 0, 0.28);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.07);
    transform: translateY(-2px);
  }

  .panel-busy {
    position: relative;
  }

  .btn-pulse-wrap {
    position: relative;
    overflow: hidden;
  }
  .btn-pulse-wrap .btn-label {
    position: relative;
    z-index: 1;
  }
  .btn-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      transparent 0%,
      rgba(255, 255, 255, 0.22) 45%,
      transparent 55%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.35s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  .btn-primary:not(:disabled):hover,
  .btn-secondary:not(:disabled):hover {
    transform: translateY(-1px);
  }
  .btn-primary:not(:disabled):active,
  .btn-secondary:not(:disabled):active {
    transform: translateY(0);
  }
  .btn-primary,
  .btn-secondary {
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      opacity 0.15s ease;
  }

  .score-meter-cluster {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .score-block-rich {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .score-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }

  .score-pct-lg {
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--maroon);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .fit-donut {
    --fit-pct: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    flex-shrink: 0;
    background: conic-gradient(
      var(--maroon, #500000) calc(var(--fit-pct) * 1%),
      rgba(128, 0, 0, 0.14) 0
    );
    -webkit-mask: radial-gradient(circle at center, transparent 62%, #000 63%);
    mask: radial-gradient(circle at center, transparent 62%, #000 63%);
    animation: donut-in 0.65s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    animation-delay: inherit;
  }
  .fit-donut-lg {
    width: 52px;
    height: 52px;
  }
  @keyframes donut-in {
    from {
      opacity: 0;
      transform: scale(0.5) rotate(-40deg);
    }
    to {
      opacity: 1;
      transform: scale(1) rotate(0deg);
    }
  }

  .fit-bar-track {
    height: 7px;
    border-radius: 999px;
    background: rgba(128, 0, 0, 0.1);
    overflow: hidden;
    margin-top: 0.55rem;
  }
  .fit-bar-inner {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--maroon, #500000), #9a3030);
    transform-origin: left center;
  }
  .fit-bar-animated .fit-bar-inner {
    animation: bar-grow 0.95s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes bar-grow {
    from {
      transform: scaleX(0.04);
    }
    to {
      transform: scaleX(1);
    }
  }

  .pending-card {
    padding: 0.75rem 0;
  }
  .pending-top {
    display: flex;
    gap: 0.65rem;
    align-items: flex-start;
  }
  .pending-top .fit-donut {
    margin-top: 0.15rem;
  }
  .pending-headline {
    flex: 1;
    min-width: 0;
  }
  .pending-name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.35rem;
  }
  .score-inline {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.2rem 0.35rem;
    margin-top: 0.25rem;
    font-size: 0.9rem;
  }
  .score-value {
    font-weight: 800;
    color: var(--maroon);
    font-variant-numeric: tabular-nums;
  }
  .score-pct {
    font-weight: 800;
    color: var(--maroon);
  }
  .score-sep {
    color: var(--text-muted);
    font-weight: 400;
  }
  .score-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pending-top .fit-bar-track {
    margin-top: 0.4rem;
  }

  .reason-fade {
    animation: reason-in 0.6s ease 0.12s both;
  }
  @keyframes reason-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-animated,
    .animate-in-up,
    .stagger-item,
    .fit-donut,
    .fit-bar-animated .fit-bar-inner,
    .btn-shimmer,
    .reason-fade {
      animation: none !important;
    }
    .card-lively:hover {
      transform: none;
    }
    .btn-primary:not(:disabled):hover,
    .btn-secondary:not(:disabled):hover {
      transform: none;
    }
  }
</style>
