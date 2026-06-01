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
    fetchMentorshipSuggestedMentors,
    fetchUserProfile,
    postMentorshipMenteeRequest,
    putMentorshipMentorPause,
    reviveMentorshipMatch,
    type MentorshipAllocatorMeta,
    type MentorshipMenteeStatusPayload,
    type MentorshipMatchRow,
    type MentorshipMentorBoardInfo,
    type MentorshipProfileEmbeddingBlock,
    type MentorshipSuggestedMentorRow,
  } from './api';

  /** Show first N rows; rest behind expandable summary when list is long */
  const MENTOR_HISTORY_PREVIEW = 4;

  let loading = $state(false);
  let loadingCandidates = $state(false);
  let error = $state('');
  let success = $state('');
  let candidates = $state<MentorshipMatchRow[]>([]);
  let matches = $state<MentorshipMatchRow[]>([]);
  let menteeMatches = $state<MentorshipMatchRow[]>([]);
  let mentorPausedForMore = $state(false);
  let showMentorLaterPrompt = $state(false);
  let mentorReminderDate = $state('');
  let mentorReminderUntil = $state('');
  let menteeStatus = $state<MentorshipMenteeStatusPayload>({
    state: 'MATCHING_IN_PROGRESS',
    isMatching: true,
    matchedMentor: null,
    matches: [],
    count: 0,
  });

  let embedLoading = $state(false);
  let embedError = $state('');
  let embedSource = $state('');
  let embedUserId = $state('');
  let embedMentor = $state<MentorshipProfileEmbeddingBlock | null>(null);
  let embedMentee = $state<MentorshipProfileEmbeddingBlock | null>(null);
  let showEmbeddingVectors = $state(false);
  let embedConfigText = $state('');
  let embedConfigObj = $state<Record<string, unknown> | null>(null);

  /** Shown after GET matches / Find mentees — helps users understand board + allocator */
  let mentorBoardInfo = $state<MentorshipMentorBoardInfo | null>(null);
  let mentorAllocatorInfo = $state<MentorshipAllocatorMeta | undefined>(undefined);
  let mentorCandidatesTotal = $state<number | null>(null);

  /** Mentee: GET /mentorship/suggested-mentors + POST mentee/request */
  let suggestedMentors = $state<MentorshipSuggestedMentorRow[]>([]);
  let loadingSuggestions = $state(false);
  let suggestionsError = $state('');
  let requestingMentorId = $state<string | null>(null);

  /** Mentor primary navigation: active suggestions vs declined revival list */
  let mentorPanelTab = $state<'queue' | 'declined'>('queue');

  function withDetail(base: string, detail: string | undefined): string {
    const d = (detail || '').trim();
    return d ? `${base} — ${d}` : base;
  }

  function todayIsoDate(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function syncMentorPauseFromApi(pauseUntil: string | null | undefined): void {
    if (pauseUntil && String(pauseUntil).trim()) {
      mentorReminderUntil = String(pauseUntil).trim().slice(0, 10);
    } else {
      mentorReminderUntil = '';
    }
  }

  async function showNextMenteeNow(): Promise<void> {
    error = '';
    const res = await putMentorshipMentorPause({ clear: true });
    if (!res.ok) {
      error = res.error || 'Could not clear reminder pause.';
      return;
    }
    mentorReminderUntil = '';
    mentorPausedForMore = false;
    await fetchUserProfile();
  }

  function isMentorReminderActive(untilDateIso: string): boolean {
    if (!untilDateIso) return false;
    const untilMs = Date.parse(`${untilDateIso}T23:59:59`);
    return Number.isFinite(untilMs) && untilMs >= Date.now();
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
    if (t === 'bronze') return 'Bronze board';
    if (t && t !== 'none') return formatAdminTierWords(t) + ' board';
    return '';
  }

  /** Title-case admin tier slugs like platinum / board-gold for UI copy. */
  function formatAdminTierWords(slug: string): string {
    return slug
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /** Short headline for mentor board tier (including standard). */
  function boardPartnerHeadline(tier: string | undefined): string {
    const t = (tier || 'none').toLowerCase();
    if (t === 'none' || !t) return 'Standard partner';
    if (t === 'gold') return 'Gold board partner';
    if (t === 'silver') return 'Silver board partner';
    return `${formatAdminTierWords(t)} board partner`;
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
      syncMentorPauseFromApi(res.data?.mentorPauseUntil);
      const mb = res.data?.mentorBoard;
      mentorBoardInfo = mb ?? null;
      return true;
    }
    error = res.error || 'Failed to load matches.';
    return false;
  }

  async function loadMenteeStatus(): Promise<void> {
    const res = await fetchMentorshipMenteeMatches();
    if (res.ok) {
      const d = res.data ?? {};
      const hasMatchedMentor = !!d.matchedMentor;
      const normalized: MentorshipMenteeStatusPayload = {
        state: d.state === 'MATCHED' ? 'MATCHED' : 'MATCHING_IN_PROGRESS',
        isMatching: d.isMatching ?? !hasMatchedMentor,
        matchedMentor: d.matchedMentor ?? null,
        updatedAt: d.updatedAt,
        matches: hasMatchedMentor ? [d.matchedMentor!] : [],
        count: hasMatchedMentor ? 1 : 0,
        menteeProgramLimits: d.menteeProgramLimits,
      };
      menteeStatus = normalized;
      menteeMatches = normalized.matches ?? [];
    } else {
      error = res.error || 'Failed to load your requests.';
    }
  }

  async function loadSuggestedMentors(): Promise<void> {
    suggestionsError = '';
    loadingSuggestions = true;
    const res = await fetchMentorshipSuggestedMentors();
    loadingSuggestions = false;
    if (!res.ok) {
      suggestionsError = res.error || 'Could not load ranked mentors.';
      suggestedMentors = [];
      return;
    }
    suggestedMentors = res.data?.suggestions ?? [];
  }

  async function requestMentorIntroduction(mentorUserId: string): Promise<void> {
    error = '';
    success = '';
    requestingMentorId = mentorUserId;
    const res = await postMentorshipMenteeRequest(mentorUserId);
    requestingMentorId = null;
    if (!res.ok) {
      error = res.error || 'Could not send introduction request.';
      return;
    }
    success = 'Introduction request sent. The mentor will see it when they open Mentorship.';
    await loadMenteeStatus();
  }

  async function refreshCandidates(): Promise<void> {
    loadingCandidates = true;
    error = '';
    success = '';
    mentorPausedForMore = false;
    showMentorLaterPrompt = false;
    mentorReminderDate = '';
    const res = await fetchMentorshipCandidates();
    if (!res.ok) {
      const errPayload = res.data as unknown as { detail?: string } | undefined;
      const detail = typeof errPayload?.detail === 'string' ? errPayload.detail : '';
      error = withDetail(res.error || 'Could not build mentee suggestions.', detail);
      loadingCandidates = false;
      return;
    }
    candidates = res.data?.candidates ?? [];
    syncMentorPauseFromApi(res.data?.mentorPauseUntil);
    mentorBoardInfo = res.data?.mentorBoard ?? mentorBoardInfo;
    mentorAllocatorInfo = res.data?.allocator;
    mentorCandidatesTotal =
      typeof res.data?.totalCandidates === 'number' ? res.data.totalCandidates : candidates.length;
    const matchesOk = await loadMentorMatches();
    loadingCandidates = false;
    if (matchesOk) {
      if (res.data?.mentorPaused) {
        success = `Suggestions are paused until ${res.data?.mentorPauseUntil || 'your reminder date'}.`;
      } else {
        success = 'Suggestions updated.';
      }
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
        const joined = parts.join(' — ');
        if (/mentee_at_match_cap|maximum active matches|Limit is\s+\d/i.test(joined)) {
          error =
            'This student already has the maximum number of active mentors for now. They may need to finish an existing pairing before you can accept.';
        } else if (/Mentor has reached|mentor.*capacity/i.test(joined)) {
          error =
            'You have reached your mentee capacity. Free a slot or raise your capacity in My profile, then try again.';
        } else {
          error =
            joined ||
            res.error ||
            'This match could not be confirmed (capacity or program limits).';
        }
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
    if (mentorRemainingSlots > 0) {
      success += ' Are you open to mentoring one more mentee?';
    } else {
      mentorPausedForMore = true;
    }
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

  function startMentorLaterFlow(): void {
    showMentorLaterPrompt = true;
    if (!mentorReminderDate) mentorReminderDate = todayIsoDate();
  }

  async function confirmMentorLaterReminder(): Promise<void> {
    if (!mentorReminderDate) {
      error = 'Please choose a reminder date.';
      return;
    }
    if (mentorReminderDate < todayIsoDate()) {
      error = 'Reminder date must be today or later.';
      return;
    }
    error = '';
    const res = await putMentorshipMentorPause({ until: mentorReminderDate });
    if (!res.ok) {
      error = res.error || 'Could not save reminder.';
      return;
    }
    syncMentorPauseFromApi(res.data?.mentorPauseUntil ?? mentorReminderDate);
    showMentorLaterPrompt = false;
    mentorPausedForMore = true;
    success = `Okay — we will show the next mentee on ${mentorReminderDate}.`;
    await fetchUserProfile();
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

  const mentorPendingMatches = $derived(
    matches.filter((m) => m.status === 'SUGGESTED' || m.status === 'PENDING_MENTOR'),
  );

  const mentorPendingIds = $derived(new Set(mentorPendingMatches.map((m) => m.menteeUserId).filter(Boolean)));

  const rankedCandidates = $derived(candidates.filter((c) => c.menteeUserId && !mentorPendingIds.has(c.menteeUserId)));
  const mentorOrderedPendingMatches = $derived([...mentorPendingMatches, ...rankedCandidates].sort(menteeRankSort));
  const mentorCurrentMentee = $derived(mentorOrderedPendingMatches[0] ?? null);
  const mentorMatchedCount = $derived(matches.filter((m) => m.status === 'CHANNEL_OPENED').length);
  const mentorConfiguredCapacity = $derived(
    typeof $profile.mentorCapacity === 'number' && Number.isFinite($profile.mentorCapacity)
      ? Math.max(1, Math.min(10, Math.trunc($profile.mentorCapacity)))
      : 5,
  );
  const mentorRemainingSlots = $derived(Math.max(0, mentorConfiguredCapacity - mentorMatchedCount));
  const mentorPausedByReminder = $derived(isMentorReminderActive(mentorReminderUntil));

  const mentorDeclinedMatches = $derived(
    [...matches.filter((m) => m.status === 'DECLINED_BY_MENTOR')].sort(menteeRankSort),
  );

  const mentorCapacityPercent = $derived(
    mentorConfiguredCapacity > 0
      ? Math.min(100, Math.round((mentorMatchedCount / mentorConfiguredCapacity) * 100))
      : 0,
  );

  const mentorHistoryHead = $derived(matches.slice(0, MENTOR_HISTORY_PREVIEW));
  const mentorHistoryTail = $derived(
    matches.length > MENTOR_HISTORY_PREVIEW ? matches.slice(MENTOR_HISTORY_PREVIEW) : [],
  );

  const menteeLimitsHint = $derived.by(() => {
    const L = menteeStatus.menteeProgramLimits;
    if (L?.maxActiveMentorMatches == null || !Number.isFinite(L.maxActiveMentorMatches)) return '';
    const max = L.maxActiveMentorMatches;
    const n = L.activeOpenedCount ?? 0;
    return `You can have up to ${max} active mentor pairing${max === 1 ? '' : 's'} at a time (${n} now).`;
  });

  /** False only when at program max active mentors (from API). */
  const menteeCanRequestMore = $derived.by(() => {
    const L = menteeStatus.menteeProgramLimits;
    if (L?.maxActiveMentorMatches == null || !Number.isFinite(L.maxActiveMentorMatches)) return true;
    return (L.activeOpenedCount ?? 0) < L.maxActiveMentorMatches;
  });

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

{#snippet matchHistoryItem(m: MentorshipMatchRow)}
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
          Find mentors ranked for your goals — board partners get a fair ranking boost. When a mentor accepts, you will see their contact details below.
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
      <section class="situation-strip" aria-label="Mentor dashboard overview">
        <div class="capacity-block">
          <div class="capacity-head">
            <span class="capacity-label">Your mentee capacity</span>
            <span class="capacity-numbers">{mentorMatchedCount} / {mentorConfiguredCapacity} active</span>
          </div>
          <div
            class="capacity-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax={mentorConfiguredCapacity}
            aria-valuenow={mentorMatchedCount}
            aria-label={`${mentorMatchedCount} of ${mentorConfiguredCapacity} mentee slots filled`}
          >
            <div class="capacity-fill" style={`width: ${mentorCapacityPercent}%`}></div>
          </div>
          {#if mentorRemainingSlots === 0}
            <p class="situation-callout situation-callout-warn">
              <strong>Capacity full.</strong> New mentees will not appear until you free a slot or raise your capacity in
              <strong>My profile</strong>.
            </p>
          {:else if mentorRemainingSlots <= 2 && mentorRemainingSlots > 0}
            <p class="situation-callout situation-callout-muted">
              {mentorRemainingSlots === 1
                ? 'One mentee slot left at your current capacity.'
                : `${mentorRemainingSlots} mentee slots left.`}
            </p>
          {/if}
        </div>

        {#if mentorBoardInfo && ((mentorBoardInfo.tier && mentorBoardInfo.tier !== 'none') || mentorBoardInfo.reason?.trim())}
          <div class="board-hint">
            <strong>Your board ranking</strong>
            {#if mentorBoardInfo.tier && mentorBoardInfo.tier !== 'none'}
              <span class="pill pill-board">{boardPartnerHeadline(mentorBoardInfo.tier)}</span>
            {/if}
            {#if typeof mentorBoardInfo.multiplier === 'number'}
              <span class="muted small">
                · students see you with a ×{mentorBoardInfo.multiplier.toFixed(2)} ranking boost when browsing mentors</span
              >
            {/if}
            {#if mentorBoardInfo.reason?.trim()}
              <details class="board-reason-details">
                <summary>Why we show this</summary>
                <p class="muted small board-reason-body">{mentorBoardInfo.reason}</p>
              </details>
            {/if}
          </div>
        {/if}

        {#if mentorAllocatorInfo != null && (mentorAllocatorInfo.exclusiveLocks ?? 0) > 0}
          <p class="situation-callout situation-callout-info">
            <strong>Fair matching:</strong>
            {mentorAllocatorInfo.note ||
              `${mentorAllocatorInfo.exclusiveLocks} other mentor–mentee introductions are in progress. Suggestions stay focused until those resolve.`}
          </p>
        {/if}

        {#if mentorCandidatesTotal != null && mentorCandidatesTotal >= 0}
          <p class="muted small list-meta">
            {#if mentorCandidatesTotal === 0}
              Last run: no mentees were available to rank (check back or tap Find mentees).
            {:else}
              Last <strong>Find mentees</strong> run ranked <strong>{mentorCandidatesTotal}</strong> student{mentorCandidatesTotal === 1 ? '' : 's'}.
            {/if}
          </p>
        {/if}

        <details class="help-mentor-details">
          <summary>How this page works</summary>
          <ul class="help-list">
            <li><strong>Find mentees</strong> builds a ranked list from your profile and student goals.</li>
            <li>We show <strong>one student at a time</strong> — accept, decline, or set a reminder.</li>
            <li><strong>Board tier</strong> only changes how you rank in mentor lists for students (not fees).</li>
            <li>Use <strong>Previously declined</strong> if you change your mind.</li>
          </ul>
        </details>
      </section>

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
      <section class="panel panel-highlight animate-in-up" class:panel-busy={loadingCandidates}>
        <h2 class="panel-title">Find mentees</h2>
        <p class="panel-desc">
          The displayed mentee is best matched to your profile. Usually takes a few seconds. You can run this again anytime to refresh.
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

      {#if mentorCurrentMentee && !mentorPausedForMore && !mentorPausedByReminder}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Current mentee candidate</h2>
          <p class="panel-desc">
            We show one mentee at a time. After you accept a match, you can choose whether to mentor one more based on your
            capacity ({mentorMatchedCount}/{mentorConfiguredCapacity} filled).
          </p>
          <article class="simple-row pending-card">
            <div class="pending-top">
              <div class="pending-headline">
                <div class="pending-name-row">
                  <strong>{mentorCurrentMentee.menteeName || 'Student'}</strong>
                  <span class="pill">{statusLabel(mentorCurrentMentee.status)}</span>
                </div>
              </div>
            </div>
            {#if mentorCurrentMentee.reasonSummary}
              <p class="muted small reason-fade">{mentorCurrentMentee.reasonSummary}</p>
            {/if}
            {#if mentorCurrentMentee.matchedSignals?.length}
              <p class="muted small"><strong>Signals:</strong> {mentorCurrentMentee.matchedSignals.join(' · ')}</p>
            {/if}
            {@render menteeReviewDetails(mentorCurrentMentee)}
            {#if mentorCurrentMentee.menteeUserId}
              <div class="row-actions">
                <button class="btn-primary" type="button" onclick={() => acceptCandidate(mentorCurrentMentee.menteeUserId!)}>Accept</button>
                <button class="btn-ghost" type="button" onclick={() => declineCandidate(mentorCurrentMentee.menteeUserId!)}>Decline</button>
                <button class="btn-secondary" type="button" onclick={startMentorLaterFlow}>Can't mentor right now</button>
              </div>
            {/if}
            {#if showMentorLaterPrompt}
              <div class="mentee-detail-block">
                <p class="muted small"><strong>When should we show your next mentee?</strong></p>
                <div class="row-actions">
                  <input type="date" bind:value={mentorReminderDate} min={todayIsoDate()} />
                  <button class="btn-primary" type="button" onclick={() => void confirmMentorLaterReminder()}>Save reminder</button>
                  <button
                    class="btn-ghost"
                    type="button"
                    onclick={() => {
                      showMentorLaterPrompt = false;
                      mentorReminderDate = '';
                    }}>Cancel</button
                  >
                </div>
              </div>
            {/if}
          </article>
        </section>
      {/if}

      {#if mentorPausedByReminder}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Reminder set</h2>
          <p class="panel-desc">
            You asked to pause mentoring for now. The next mentee will be shown on <strong>{mentorReminderUntil}</strong>.
          </p>
          <div class="row-actions">
            <button class="btn-primary" type="button" onclick={() => void showNextMenteeNow()}>Show next mentee now</button>
          </div>
        </section>
      {/if}

      {#if mentorPausedForMore && mentorRemainingSlots > 0 && !mentorPausedByReminder}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Mentor one more?</h2>
          <p class="panel-desc">
            You still have {mentorRemainingSlots} slot{mentorRemainingSlots === 1 ? '' : 's'} left in your configured capacity
            ({mentorConfiguredCapacity}). Do you want to review one more mentee now?
          </p>
          <div class="row-actions">
            <button class="btn-primary" type="button" onclick={() => (mentorPausedForMore = false)}>Yes, show next mentee</button>
            <button class="btn-secondary" type="button" onclick={() => (mentorPausedForMore = true)}>Not now</button>
          </div>
        </section>
      {/if}

      {#if !mentorCurrentMentee && !mentorPausedForMore && !mentorPausedByReminder}
        <section class="panel animate-in-up">
          <h2 class="panel-title">No pending mentee right now</h2>
          <p class="panel-desc">
            When a candidate is available, we will show one at a time here. You can run <strong>Find mentees for me</strong> to refresh.
          </p>
        </section>
      {/if}

      <section class="panel">
        <h2 class="panel-title">All match records</h2>
        {#if matches.length === 0}
          <p class="muted">No history yet.</p>
        {:else if matches.length <= MENTOR_HISTORY_PREVIEW}
          <ul class="simple-list compact">
            {#each matches as m}
              {@render matchHistoryItem(m)}
            {/each}
          </ul>
        {:else}
          <p class="muted small history-summary">
            Showing the {MENTOR_HISTORY_PREVIEW} most recent records. Open the menu below for older entries.
          </p>
          <ul class="simple-list compact">
            {#each mentorHistoryHead as m}
              {@render matchHistoryItem(m)}
            {/each}
          </ul>
          <details class="match-history-dropdown">
            <summary
              >Older history ({mentorHistoryTail.length} more record{mentorHistoryTail.length === 1 ? '' : 's'})</summary
            >
            <ul class="simple-list compact history-rest">
              {#each mentorHistoryTail as m}
                {@render matchHistoryItem(m)}
              {/each}
            </ul>
          </details>
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
        <ol class="mentee-steps" aria-label="What happens next">
          <li class="mentee-step-done">
            <span class="mentee-step-n" aria-hidden="true">1</span>
            Your profile is available to mentors.
          </li>
          <li
            class:mentee-step-active={menteeStatus.state !== 'MATCHED'}
            class:mentee-step-done={menteeStatus.state === 'MATCHED'}
          >
            <span class="mentee-step-n" aria-hidden="true">2</span>
            A mentor reviews and accepts the pairing.
          </li>
          <li
            class:mentee-step-active={menteeStatus.state === 'MATCHED'}
            class:mentee-step-done={menteeStatus.state === 'MATCHED'}
          >
            <span class="mentee-step-n" aria-hidden="true">3</span>
            You receive their contact details below.
          </li>
        </ol>
        {#if menteeLimitsHint}
          <p class="mentee-limit-hint" role="status">{menteeLimitsHint}</p>
        {/if}
        <button class="btn-secondary btn-inline" type="button" onclick={loadMenteeStatus}>Refresh status</button>
        {#if menteeStatus.state !== 'MATCHED'}
          <p class="muted" style="margin-top: 0.85rem;">
            A mentor match is in progress. Please check back soon; this page updates as soon as a mentor has accepted your
            pairing.
          </p>
        {/if}
        <details class="help-mentee-details">
          <summary>Need help?</summary>
          <p class="muted small help-mentee-body">
            You cannot pick a mentor directly—mentors confirm first. If nothing changes after a few days, strengthen your profile
            and resume under <strong>My profile</strong>, then tap <strong>Refresh status</strong>.
          </p>
        </details>
      </section>

      {#if menteeStatus.state !== 'MATCHED'}
        <section class="panel animate-in-up mentee-suggest-panel">
          <h2 class="panel-title">Browse mentors ranked for you</h2>
          <p class="panel-desc">
            Optional: load a ranked list (this can take a few seconds). You can send an <strong>introduction request</strong> to
            nudge one mentor—they still choose whether to accept in the app.
          </p>
          {#if !menteeCanRequestMore}
            <p class="situation-callout situation-callout-warn" role="status">
              You are at your program limit for active mentors. Finish or adjust existing pairings before sending new requests.
            </p>
          {/if}
          <div class="row-actions">
            <button
              class="btn-secondary"
              type="button"
              onclick={() => void loadSuggestedMentors()}
              disabled={loadingSuggestions}
            >
              {loadingSuggestions ? 'Loading ranked mentors…' : 'Load ranked mentors'}
            </button>
          </div>
          {#if suggestionsError}
            <p class="error" role="alert" style="margin-top: 0.65rem;">{suggestionsError}</p>
          {/if}
          {#if suggestedMentors.length > 0}
            <ul class="simple-list mentee-suggest-list">
              {#each suggestedMentors.slice(0, 12) as sm, si (sm.mentorUserId || String(si))}
                <li class="simple-row mentee-suggest-row">
                  <div>
                    <strong>{sm.mentorName || 'Mentor'}</strong>
                    {#if sm.mentorCompany || sm.mentorJobTitle}
                      <p class="muted small">
                        {[sm.mentorCompany, sm.mentorJobTitle].filter(Boolean).join(' · ')}
                      </p>
                    {/if}
                    {#if sm.reasonSummary}
                      <p class="muted small">{sm.reasonSummary}</p>
                    {/if}
                    {#if sm.boardTier && sm.boardTier !== 'none'}
                      <p class="muted small">
                        Board: {boardPartnerHeadline(sm.boardTier)}
                        {#if typeof sm.boardMultiplier === 'number'}
                          · ×{sm.boardMultiplier.toFixed(2)}
                        {/if}
                      </p>
                    {/if}
                  </div>
                  {#if sm.mentorUserId}
                    <button
                      class="btn-primary"
                      type="button"
                      disabled={!menteeCanRequestMore || requestingMentorId !== null}
                      onclick={() => void requestMentorIntroduction(sm.mentorUserId!)}
                    >
                      {requestingMentorId === sm.mentorUserId ? 'Sending…' : 'Request introduction'}
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if suggestedMentors.length > 12}
              <p class="muted small">Showing 12 of {suggestedMentors.length} ranked mentors.</p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if menteeStatus.state === 'MATCHED' && menteeStatus.matchedMentor}
        {@const mm = menteeStatus.matchedMentor}
        <section class="panel animate-in-up">
          <h2 class="panel-title">Your mentor</h2>
            <article class="card-easy" style="margin-top: 0.75rem;">
              <h3>{mm.mentorName || 'Your mentor'}</h3>
              {#if mm.mentorBoard}
                {@const bt = (mm.mentorBoard.tier || 'none').toLowerCase()}
                <div class="mentor-board-line">
                  {#if bt === 'gold'}
                    <span class="pill pill-gold">{tierBadge('gold')}</span>
                  {:else if bt === 'silver'}
                    <span class="pill pill-silver">{tierBadge('silver')}</span>
                  {:else if bt === 'bronze'}
                    <span class="pill pill-bronze">{tierBadge('bronze')}</span>
                  {:else if bt === 'none'}
                    <span class="pill pill-standard">{boardPartnerHeadline('none')}</span>
                  {:else}
                    <span class="pill pill-board">{boardPartnerHeadline(mm.mentorBoard.tier)}</span>
                  {/if}
                  {#if bt !== 'none' && typeof mm.mentorBoard.multiplier === 'number'}
                    <span class="muted small mentor-board-meta"
                      >Board ranking boost ×{mm.mentorBoard.multiplier.toFixed(2)} (used when mentors are ranked for students).</span
                    >
                  {:else if bt === 'none'}
                    <span class="muted small mentor-board-meta">No board ranking boost for this mentor.</span>
                  {/if}
                </div>
                {#if mm.mentorBoard.reason?.trim()}
                  <p class="muted small board-reason">{mm.mentorBoard.reason}</p>
                {/if}
              {/if}
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
  .pill-silver {
    background: rgba(120, 130, 145, 0.14);
    border-color: rgba(100, 110, 125, 0.35);
    margin-left: 0;
    margin-bottom: 0.25rem;
  }
  .pill-standard {
    background: var(--bg);
    border-color: var(--border);
    color: var(--text-muted);
    margin-left: 0;
    margin-bottom: 0.25rem;
  }
  .pill-bronze {
    background: rgba(140, 90, 50, 0.12);
    border-color: rgba(140, 90, 50, 0.35);
    margin-left: 0;
    margin-bottom: 0.25rem;
  }
  .pill-board {
    background: rgba(128, 0, 0, 0.08);
    border-color: rgba(128, 0, 0, 0.28);
    color: var(--maroon);
    margin-left: 0;
    margin-bottom: 0.25rem;
  }
  .situation-strip {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 1rem;
    border-radius: var(--radius);
    border: 1px solid rgba(128, 0, 0, 0.18);
    background: var(--card-bg, #fff);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  }
  .capacity-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .capacity-label {
    font-weight: 700;
    font-size: 0.92rem;
  }
  .capacity-numbers {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .capacity-bar {
    height: 0.45rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.08);
    overflow: hidden;
    margin-top: 0.35rem;
  }
  .capacity-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--maroon), #a52a2a);
    transition: width 0.25s ease;
  }
  .situation-callout {
    margin: 0.4rem 0 0;
    font-size: 0.86rem;
    line-height: 1.45;
    padding: 0.45rem 0.55rem;
    border-radius: calc(var(--radius) * 0.85);
  }
  .situation-callout-warn {
    background: rgba(180, 120, 0, 0.12);
    border: 1px solid rgba(180, 120, 0, 0.35);
    color: var(--text, #222);
  }
  .situation-callout-muted {
    background: rgba(0, 0, 0, 0.03);
    color: var(--text-muted);
  }
  .situation-callout-info {
    background: rgba(0, 80, 160, 0.06);
    border: 1px solid rgba(0, 80, 160, 0.2);
    color: var(--text, #222);
  }
  .board-hint {
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .board-hint strong {
    display: block;
    margin-bottom: 0.25rem;
  }
  .board-reason-details {
    margin: 0.35rem 0 0;
  }
  .board-reason-details > summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--maroon);
  }
  .board-reason-body {
    margin: 0.35rem 0 0;
  }
  .list-meta {
    margin: 0;
  }
  .help-mentor-details,
  .help-mentee-details {
    font-size: 0.86rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.55rem;
    background: rgba(0, 0, 0, 0.02);
  }
  .help-mentor-details > summary,
  .help-mentee-details > summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--text-muted);
  }
  .help-list {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    line-height: 1.5;
    color: var(--text-muted);
    font-size: 0.86rem;
  }
  .help-mentee-body {
    margin: 0.4rem 0 0;
    line-height: 1.45;
  }
  .mentee-steps {
    list-style: none;
    margin: 0.65rem 0 0.75rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .mentee-steps li {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--text-muted);
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius);
    border: 1px solid transparent;
  }
  .mentee-step-n {
    flex-shrink: 0;
    width: 1.35rem;
    height: 1.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    background: rgba(0, 0, 0, 0.06);
    color: var(--text-muted);
  }
  .mentee-step-active {
    border-color: rgba(128, 0, 0, 0.2);
    background: rgba(128, 0, 0, 0.04);
    color: var(--text, #222);
  }
  .mentee-step-done .mentee-step-n {
    background: var(--maroon);
    color: #fff;
  }
  .mentee-step-done {
    color: var(--text, #222);
  }
  .mentee-limit-hint {
    margin: 0 0 0.65rem;
    font-size: 0.86rem;
    padding: 0.45rem 0.55rem;
    border-radius: var(--radius);
    background: rgba(0, 0, 0, 0.04);
    color: var(--text-muted);
  }
  .mentee-suggest-list {
    margin-top: 0.65rem;
  }
  .mentee-suggest-row {
    flex-direction: column;
    align-items: stretch !important;
    gap: 0.5rem;
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
  }
  .mentee-suggest-row:last-child {
    border-bottom: none;
  }
  .mentee-suggest-row .btn-primary {
    align-self: flex-start;
  }
  .history-summary {
    margin: 0 0 0.5rem;
  }
  .match-history-dropdown {
    margin-top: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.35rem 0.55rem;
    background: var(--surface-alt, rgba(0, 0, 0, 0.02));
  }
  .match-history-dropdown > summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--maroon);
    font-size: 0.88rem;
  }
  .history-rest {
    margin-top: 0.45rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border);
  }
  .mentor-board-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0.35rem 0 0.15rem;
  }
  .mentor-board-meta {
    margin: 0;
    flex: 1 1 12rem;
  }
  .board-reason {
    margin: 0.25rem 0 0;
    line-height: 1.35;
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
