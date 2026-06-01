<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import { authUser } from "./stores/authStore";
  import {
    getMyAssignments,
    getMyTeams,
    getCompetition,
    submitScore,
    generateSummary,
    type JudgeAssignment,
    type Team,
    type Competition,
    type SummaryResult,
  } from "./competition-api";
  import SubmissionViewer from "./SubmissionViewer.svelte";
  import { marked } from "marked";

  // ── State ──────────────────────────────────────
  let assignments: JudgeAssignment[] = $state([]);
  let competitions: Map<string, Competition> = $state(new Map());
  let selectedCompetitionId: string | null = $state(null);
  let teams: Team[] = $state([]);
  let loading = $state(true);
  let teamsLoading = $state(false);
  let error = $state("");
  let actionMsg = $state("");

  // Submission viewer
  let viewingTeam: Team | null = $state(null);

  // Scoring form
  let scoringTeam: Team | null = $state(null);
  let scoreRatings: Record<string, number> = $state({});
  let scoreFeedback = $state("");
  let scoreLoading = $state(false);
  let scoreError = $state("");

  // AI Summary
  let aiSummary: SummaryResult | null = $state(null);
  let summaryLoading = $state(false);
  let summaryError = $state("");
  let summaryCache = $state<Record<string, SummaryResult>>({});

  let renderedSummary = $derived.by(() => {
    const s = aiSummary;
    if (s && s.summary) {
      return marked.parse(s.summary) as string;
    }
    return "";
  });

  // Default scoring criteria (used if competition.rubric is absent)
  const DEFAULT_RUBRIC = [
    { key: "presentation", label: "Presentation Quality", min: 1, max: 10 },
    { key: "analysis", label: "Analysis & Research", min: 1, max: 10 },
    { key: "creativity", label: "Creativity & Innovation", min: 1, max: 10 },
    { key: "feasibility", label: "Feasibility of Solution", min: 1, max: 10 },
    { key: "teamwork", label: "Teamwork & Delivery", min: 1, max: 10 },
  ];

  // ── Derived ────────────────────────────────────
  let selectedCompetition = $derived(
    selectedCompetitionId
      ? (competitions.get(selectedCompetitionId) ?? null)
      : null,
  );
  let criteria = $derived(
    selectedCompetition?.rubric?.length
      ? selectedCompetition.rubric
      : DEFAULT_RUBRIC,
  );
  let gradedCount = $derived(
    teams.filter((t) => t.gradingStatus === "GRADED").length,
  );
  let totalCount = $derived(teams.length);

  // ── Lifecycle ──────────────────────────────────
  onMount(async () => {
    if (!$authUser) {
      loading = false;
      return;
    }
    await loadAssignments();
  });

  async function loadAssignments() {
    loading = true;
    error = "";
    try {
      assignments = await getMyAssignments();

      // Fetch competition details for each assignment
      const compMap = new Map<string, Competition>();
      await Promise.all(
        assignments.map(async (a) => {
          try {
            const comp = await getCompetition(a.competitionId);
            compMap.set(a.competitionId, comp);
          } catch {
            /* skip if competition not found */
          }
        }),
      );
      competitions = compMap;

      // Auto-select if only one competition
      if (assignments.length === 1 && assignments[0]) {
        selectedCompetitionId = assignments[0].competitionId;
        await loadTeams(selectedCompetitionId);
      }
    } catch (e: any) {
      error = e.message || "Failed to load assignments";
    } finally {
      loading = false;
    }
  }

  async function loadTeams(competitionId: string) {
    teamsLoading = true;
    error = "";
    try {
      teams = await getMyTeams(competitionId);
    } catch (e: any) {
      error = e.message || "Failed to load teams";
    } finally {
      teamsLoading = false;
    }
  }

  async function selectCompetition(competitionId: string) {
    selectedCompetitionId = competitionId;
    await loadTeams(competitionId);
  }

  // ── Actions ────────────────────────────────────
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) scoringTeam = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      scoringTeam = null;
      viewingTeam = null;
    }
  }

  function goBack(e: MouseEvent) {
    e.preventDefault();
    if (selectedCompetitionId && assignments.length > 1) {
      selectedCompetitionId = null;
    } else {
      currentView.set("landing");
    }
  }

  function openSubmission(team: Team) {
    if (!team.hasSubmission) return;
    viewingTeam = team;
  }

  function openScoring(team: Team) {
    scoringTeam = team;
    scoreError = "";
    summaryError = "";

    // Check session cache first
    aiSummary = summaryCache[team.teamId] || null;

    const initialRatings: Record<string, number> = {};
    if (team.score) {
      Object.assign(initialRatings, team.score.ratings || {});
      scoreFeedback = team.score.feedback || "";
    } else {
      scoreFeedback = "";
    }

    // Ensure every rubric item has a starting value
    criteria.forEach((c) => {
      const min = c.min ?? 1;
      const max = c.max ?? 10;
      const midpoint = Math.round((min + max) / 2);
      initialRatings[c.key] = initialRatings[c.key] ?? midpoint;
    });

    scoreRatings = initialRatings;

    // B2: Automatically fetch or trigger summary if not in cache
    if (team.hasSubmission && !aiSummary) {
      handleGenerateSummary();
    }
  }

  async function handleGenerateSummary() {
    // Note: We use the local 'scoringTeam' state
    const team = scoringTeam;
    if (!team || !selectedCompetitionId) return;

    summaryLoading = true;
    summaryError = "";

    try {
      const result = await generateSummary(selectedCompetitionId, team.teamId);
      aiSummary = result;
      // Save it to the session cache
      summaryCache[team.teamId] = result;
    } catch (e: any) {
      summaryError = e.message || "Failed to fetch summary";
    } finally {
      summaryLoading = false;
    }
  }

  async function handleSubmitScore() {
    if (!scoringTeam || !selectedCompetitionId) return;
    scoreLoading = true;
    scoreError = "";
    try {
      await submitScore(selectedCompetitionId, scoringTeam.teamId, {
        ratings: scoreRatings,
        feedback: scoreFeedback,
      });
      actionMsg = `Score submitted for ${scoringTeam.teamName}!`;
      scoringTeam = null;
      // Reload teams to reflect updated grading status
      await loadTeams(selectedCompetitionId);
      setTimeout(() => (actionMsg = ""), 3000);
    } catch (e: any) {
      scoreError = e.message || "Failed to submit score";
    } finally {
      scoreLoading = false;
    }
  }

  function fmtDate(d: string | null) {
    if (!d) return "N/A";
    try {
      return new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return d;
    }
  }
</script>

<div class="judge-page">
  <div class="judge-inner">
    <button type="button" class="back-link" onclick={goBack}>
      <span class="back-arrow">&larr;</span>
      {selectedCompetitionId && assignments.length > 1
        ? "Back to competitions"
        : "Back to home"}
    </button>

    <!-- ── Not signed in ── -->
    {#if !$authUser}
      <div class="empty-state">
        <p>Please sign in to access the Judge Dashboard.</p>
      </div>

      <!-- ── Loading ── -->
    {:else if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading your assignments...</p>
      </div>

      <!-- ── Error ── -->
    {:else if error && assignments.length === 0}
      <div class="error-card">
        <h3>Error</h3>
        <p>{error}</p>
        <button class="btn-retry" onclick={loadAssignments}>Retry</button>
      </div>

      <!-- ── No assignments ── -->
    {:else if assignments.length === 0}
      <div class="empty-state">
        <p class="empty-icon">&#9878;</p>
        <h2>No Assignments</h2>
        <p>You are not currently assigned as a judge for any competition.</p>
      </div>

      <!-- ── Dashboard ── -->
    {:else}
      <div class="dashboard-header">
        <div>
          <h1 class="page-title">Judge Dashboard</h1>
          <p class="page-subtitle">
            Review submissions and grade assigned teams
          </p>
        </div>
      </div>

      {#if actionMsg}
        <div class="action-toast">{actionMsg}</div>
      {/if}

      <!-- Competition Selection Grid (shown if no competition selected) -->
      {#if !selectedCompetitionId}
        <div class="competition-grid">
          {#each assignments as a}
            {@const comp = competitions.get(a.competitionId)}
            <button
              class="competition-card"
              onclick={() => selectCompetition(a.competitionId)}
            >
              <div class="card-top">
                <span class="category-badge">Case Competition</span>
                <span class="status-badge">Judge</span>
              </div>
              <h3 class="comp-title">{comp?.name || "Loading..."}</h3>
              {#if comp?.description}
                <p class="comp-desc">{comp.description}</p>
              {/if}
              <div class="card-footer">
                <span class="deadline"
                  >📅 Deadline: {fmtDate(
                    comp?.submissionDeadline ?? null,
                  )}</span
                >
                <span class="enter-link">Select &rarr;</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Competition Info Card -->
      {#if selectedCompetition}
        <div class="comp-info">
          <h2 class="comp-name">{selectedCompetition.name}</h2>
          {#if selectedCompetition.description}
            <p class="comp-desc">{selectedCompetition.description}</p>
          {/if}
          <div class="comp-meta">
            <span
              >Deadline: {fmtDate(selectedCompetition.submissionDeadline)}</span
            >
            <span class="progress-badge">{gradedCount}/{totalCount} Graded</span
            >
          </div>
        </div>
      {/if}

      <!-- Teams Table -->
      {#if selectedCompetitionId}
        {#if teamsLoading}
          <div class="loading-state" style="padding: 3rem 0;">
            <div class="spinner"></div>
            <p>Loading teams...</p>
          </div>
        {:else if error}
          <div class="error-card">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        {:else if teams.length === 0}
          <div class="empty-state" style="padding: 3rem 0;">
            <p>No teams assigned to you for this competition.</p>
          </div>
        {:else}
          <div class="teams-table-wrap">
            <table class="teams-table">
              <thead>
                <tr>
                  <th>Team Name</th>
                  <th>Members</th>
                  <th>Submission</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each teams as team (team.teamId)}
                  <tr>
                    <td class="team-name">{team.teamName}</td>
                    <td class="team-members">{team.members?.length || 0}</td>
                    <td>
                      {#if team.hasSubmission}
                        <span class="badge badge-submitted">Submitted</span>
                      {:else}
                        <span class="badge badge-none">Not yet</span>
                      {/if}
                    </td>
                    <td>
                      {#if team.gradingStatus === "GRADED"}
                        <span class="badge badge-graded">Graded</span>
                      {:else}
                        <span class="badge badge-pending">Pending</span>
                      {/if}
                    </td>
                    <td class="team-score">
                      {#if team.scoreTotal != null}
                        <span class="score-value">{team.scoreTotal}</span>
                      {:else}
                        <span class="score-na">—</span>
                      {/if}
                    </td>
                    <td class="actions-cell">
                      <button
                        class="btn-action btn-view"
                        onclick={() => openSubmission(team)}
                        disabled={!team.hasSubmission}
                        title={team.hasSubmission
                          ? "View submission PDF"
                          : "No submission yet"}
                      >
                        View
                      </button>
                      <button
                        class="btn-action btn-grade"
                        onclick={() => openScoring(team)}
                        title={team.gradingStatus === "GRADED"
                          ? "Edit grade"
                          : "Grade team"}
                      >
                        {team.gradingStatus === "GRADED"
                          ? "Grade Submission"
                          : "Grade"}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>

<!-- ── Submission Viewer Modal ── -->
{#if viewingTeam && selectedCompetitionId}
  <SubmissionViewer
    competitionId={selectedCompetitionId}
    teamId={viewingTeam.teamId}
    teamName={viewingTeam.teamName}
    onClose={() => (viewingTeam = null)}
  />
{/if}

<svelte:window onkeydown={handleKeydown} />

<!-- ── Scoring Modal ── -->
{#if scoringTeam && selectedCompetitionId}
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    onclick={handleOverlayClick}
  >
    <div class="modal-card grading-modal">
      <div class="modal-header">
        <h2>Grade: {scoringTeam.teamName}</h2>
        <button class="btn-close-modal" onclick={() => (scoringTeam = null)}
          >&times;</button
        >
      </div>

      <div class="grading-layout">
        <!-- Left: AI Summary Section -->
        <div class="grading-sidebar">
          <div class="summary-panel improved">
            <div class="summary-header">
              <span class="summary-title">🤖 AI Insights</span>
              <div class="summary-actions-top">
                <button
                  class="btn-view-submission-mini"
                  onclick={() => {
                    if (scoringTeam) viewingTeam = scoringTeam;
                  }}
                  title="View actual PDF submission"
                >
                  📄 View PDF
                </button>
              </div>
            </div>

            <div class="summary-content">
              {#if !scoringTeam.hasSubmission}
                <div class="summary-empty">
                  <p>No submission uploaded yet — summary unavailable.</p>
                </div>
              {:else if summaryError}
                <p class="summary-error">{summaryError}</p>
              {:else if aiSummary}
                <div class="summary-markdown">
                  {@html renderedSummary}
                </div>
              {:else}
                <div class="summary-placeholder">
                  {#if summaryLoading}
                    <div class="spinner"></div>
                    <p>Fetching AI-powered insights...</p>
                  {:else}
                    <div class="placeholder-icon">✨</div>
                    <p>
                      AI insights are prepared automatically upon submission.
                      If not visible, check back in a few moments.
                    </p>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Right: Rubric and Feedback Section -->
        <div class="grading-main">
          <div class="section-title">Judging Rubric</div>
          <div class="criteria-list">
            {#each criteria as criterion (criterion.key)}
              <div class="criterion-card">
                <div class="criterion-info">
                  <span class="criterion-label">{criterion.label}</span>
                  <span class="criterion-range"
                    >({criterion.min ?? 1}–{criterion.max ?? 10})</span
                  >
                </div>
                <div class="rating-control">
                  <input
                    id="rating-{criterion.key}"
                    type="range"
                    min={criterion.min ?? 1}
                    max={criterion.max ?? 10}
                    step="1"
                    bind:value={scoreRatings[criterion.key]}
                  />
                  <div class="rating-display">
                    {scoreRatings[criterion.key] ?? criterion.min ?? 1}
                  </div>
                </div>
              </div>
            {/each}
          </div>

          <div class="section-title">Feedback for the Team</div>
          <textarea
            class="feedback-textarea"
            bind:value={scoreFeedback}
            rows="5"
            placeholder="Share constructive feedback on their strengths and areas for growth..."
          ></textarea>

          {#if scoreError}
            <p class="form-error">{scoreError}</p>
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={() => (scoringTeam = null)}
          >Cancel</button
        >
        <button
          class="btn-primary"
          onclick={handleSubmitScore}
          disabled={scoreLoading}
        >
          {scoreLoading
            ? "Saving..."
            : scoringTeam.gradingStatus === "GRADED"
              ? "Update Grade"
              : "Submit Grade"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Page layout (matches EventsDashboard) ── */
  .judge-page {
    width: 100%;
    min-height: 100vh;
    padding: 2rem 1.5rem 3.5rem;
    font-family: var(--font-body);
    background: linear-gradient(
      180deg,
      var(--bg) 0%,
      var(--bg-warm) 50%,
      #f0ebe6 100%
    );
    color: var(--text);
    position: relative;
    overflow: hidden;
  }
  .judge-page::before {
    content: "";
    position: absolute;
    top: -50%;
    right: -30%;
    width: 80%;
    height: 80%;
    background: radial-gradient(
      ellipse,
      var(--maroon-muted) 0%,
      transparent 70%
    );
    pointer-events: none;
  }
  .judge-inner {
    position: relative;
    max-width: 1100px;
    margin: 0 auto;
  }

  /* ── Navigation ── */
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 2rem;
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    transition: transform 0.2s;
  }
  .back-link:hover {
    transform: translateX(-4px);
  }

  /* ── Header ── */
  .dashboard-header {
    margin-bottom: 1.5rem;
  }
  .page-title {
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(2rem, 4vw, 2.75rem);
    font-weight: 700;
    margin: 0 0 0.25rem;
    letter-spacing: -0.02em;
  }
  .page-subtitle {
    color: var(--text-muted);
    font-size: 1.1rem;
    margin: 0;
  }

  /* ── Competition grid ── */
  .competition-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }
  .competition-card {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    padding: 1.75rem;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    cursor: pointer;
    transition:
      transform 0.2s,
      box-shadow 0.2s,
      border-color 0.2s;
    width: 100%;
    font-family: inherit;
  }
  .competition-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: var(--maroon);
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .category-badge {
    padding: 0.25rem 0.6rem;
    background: var(--maroon-muted);
    color: var(--maroon);
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .status-badge {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .comp-title {
    margin: 0;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: 1.4rem;
    line-height: 1.25;
  }
  .comp-desc {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    flex-grow: 1;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    line-clamp: 3;
    overflow: hidden;
  }
  .card-footer {
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  .deadline {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .enter-link {
    font-weight: 700;
    color: var(--maroon);
    font-size: 0.9rem;
  }

  /* ── Competition info card ── */
  .comp-info {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 12px);
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  .comp-name {
    margin: 0 0 0.25rem;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: 1.3rem;
  }
  .comp-desc {
    margin: 0 0 0.5rem;
    color: var(--text-muted);
    font-size: 0.95rem;
  }
  .comp-meta {
    display: flex;
    gap: 1.5rem;
    font-size: 0.88rem;
    color: var(--text-muted);
    align-items: center;
  }
  .progress-badge {
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
    background: var(--maroon);
    color: var(--card-bg, #fff);
  }

  /* ── Teams table ── */
  .teams-table-wrap {
    overflow-x: auto;
    border-radius: var(--radius-lg, 12px);
    border: 1px solid var(--border);
    background: var(--card-bg, #fff);
  }
  .teams-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .teams-table thead {
    background: var(--bg, #faf8f6);
  }
  .teams-table th {
    padding: 0.85rem 1rem;
    text-align: left;
    font-weight: 600;
    color: var(--maroon);
    border-bottom: 2px solid var(--border);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .teams-table td {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .teams-table tbody tr:last-child td {
    border-bottom: none;
  }
  .teams-table tbody tr:hover {
    background: var(--bg-warm, #f8f5f2);
  }
  .team-name {
    font-weight: 600;
  }
  .team-members {
    text-align: center;
  }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .badge-graded {
    background: #def7ec;
    color: #03543f;
  }
  .badge-pending {
    background: #fef3c7;
    color: #92400e;
  }
  .badge-submitted {
    background: #dbeafe;
    color: #1e40af;
  }
  .badge-none {
    background: #f3f4f6;
    color: #6b7280;
  }

  /* ── Action buttons in table ── */
  .actions-cell {
    display: flex;
    gap: 0.5rem;
  }
  .btn-action {
    padding: 0.4rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    border-radius: var(--radius, 8px);
    border: none;
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.15s;
  }
  .btn-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-view {
    background: transparent;
    border: 1.5px solid var(--maroon);
    color: var(--maroon);
  }
  .btn-view:hover:not(:disabled) {
    background: var(--maroon);
    color: var(--card-bg, #fff);
  }
  .btn-grade {
    background: var(--maroon);
    color: var(--card-bg, #fff);
  }
  .btn-grade:hover {
    background: var(--maroon-dark);
    transform: translateY(-1px);
  }

  /* ── Toast ── */
  .action-toast {
    padding: 0.75rem 1.25rem;
    margin-bottom: 1rem;
    background: var(--success-bg, #def7ec);
    color: var(--success-text, #03543f);
    border-radius: var(--radius, 8px);
    font-weight: 500;
    animation: slideDown 0.3s ease;
  }
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Scoring Modal Modernization ── */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    box-sizing: border-box;
  }

  .grading-modal {
    width: min(1000px, 95vw);
    max-height: 90vh;
    margin: auto; /* ensure centering even if flex fails */
    padding: 0;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    box-sizing: border-box;
  }

  .modal-header {
    padding: 1.25rem 1.75rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    background: #fafafa;
  }
  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .btn-close-modal {
    background: none;
    border: none;
    font-size: 1.75rem;
    color: var(--text-muted);
    cursor: pointer;
    line-height: 1;
    padding: 0;
  }

  .grading-layout {
    display: grid;
    grid-template-columns: 6fr 4fr;
    overflow: hidden;
    flex-grow: 1;
  }
  @media (max-width: 900px) {
    .grading-layout {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .grading-sidebar {
      border-right: none;
      border-bottom: 1px solid var(--border);
      max-height: 400px;
    }
  }

  /* Sidebar: AI Summary */
  .grading-sidebar {
    background: #fcfbf9;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .summary-panel.improved {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
  }
  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .summary-actions-top {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .summary-title {
    font-weight: 700;
    color: var(--maroon);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-grow: 1;
  }
  .btn-view-submission-mini {
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    color: #374151;
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    transition: all 0.2s;
  }
  .btn-view-submission-mini:hover {
    background: #e5e7eb;
    border-color: #9ca3af;
  }

  .btn-summary-mini {
    background: white;
    border: 1px solid var(--maroon);
    color: var(--maroon);
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.2s;
  }
  .btn-summary-mini:hover {
    background: var(--maroon);
    color: white;
  }

  .summary-content {
    flex-grow: 1;
  }

  .summary-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem 1rem;
    background: white;
    border: 2px dashed #e5e7eb;
    border-radius: 12px;
    height: 100%;
  }
  .placeholder-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }
  .summary-placeholder p {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 1.25rem;
    line-height: 1.5;
  }
  .btn-generate-big {
    background: var(--maroon);
    color: white;
    border: none;
    padding: 0.65rem 1rem;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
  }

  /* Markdown Styles */
  .summary-markdown {
    font-size: 0.9rem;
    line-height: 1.7;
    color: #374151;
  }
  .summary-markdown :global(h3) {
    font-size: 1rem;
    margin: 1.5rem 0 0.5rem;
    color: var(--maroon);
    border-bottom: 1px solid #f3f4f6;
    padding-bottom: 0.25rem;
  }
  .summary-markdown :global(p) {
    margin: 0.75rem 0;
  }
  .summary-markdown :global(ul) {
    padding-left: 1.25rem;
    margin: 0.75rem 0;
  }
  .summary-markdown :global(li) {
    margin-bottom: 0.4rem;
  }
  .summary-markdown :global(strong) {
    color: #111827;
  }

  .summary-error {
    font-size: 0.85rem;
    color: #dc2626;
    background: #fef2f2;
    padding: 0.75rem;
    border-radius: 8px;
    margin: 0;
  }

  /* Main: Rubric */
  .grading-main {
    padding: 1.5rem 2rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .section-title {
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .criteria-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .criterion-card {
    background: #f9fafb;
    border: 1px solid #f3f4f6;
    padding: 1rem 1.25rem;
    border-radius: 12px;
  }
  .criterion-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .criterion-label {
    font-weight: 600;
    color: #111827;
  }
  .criterion-range {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .rating-control {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  .rating-control input[type="range"] {
    flex-grow: 1;
    accent-color: var(--maroon);
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    cursor: pointer;
  }
  .rating-display {
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    background: white;
    border: 2px solid var(--maroon);
    color: var(--maroon);
    border-radius: 10px;
    font-size: 1.25rem;
    font-weight: 800;
  }

  .feedback-textarea {
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.95rem;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
  }
  .feedback-textarea:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(80, 0, 0, 0.05);
  }

  .form-error {
    margin: 0;
    color: var(--error-text, #b91c1c);
    font-size: 0.88rem;
  }

  /* Modal Footer */
  .modal-footer {
    padding: 1.25rem 1.75rem;
    background: #f9f9f9;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }
  .btn-secondary {
    padding: 0.6rem 1.25rem;
    background: white;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-secondary:hover {
    background: #f3f4f6;
  }

  .btn-primary {
    padding: 0.6rem 1.75rem;
    background: var(--maroon);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transition: all 0.2s;
  }
  .btn-primary:hover {
    background: var(--maroon-dark, #3a0000);
    transform: translateY(-1px);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  }

  /* ── Status States ── */
  .loading-state {
    text-align: center;
    padding: 5rem 0;
    color: var(--text-muted);
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }
  .spinner-sm {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-card {
    background: var(--error-bg, #fef2f2);
    border: 1px solid var(--error-border, #f87171);
    padding: 1.75rem;
    border-radius: 12px;
    color: var(--error-text, #991b1b);
  }

  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }
  .empty-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  /* ── Table Score column ── */
  .team-score {
    text-align: center;
  }
  .score-value {
    font-weight: 700;
    color: var(--maroon);
  }
  .score-na {
    color: var(--text-muted);
  }

  .summary-empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
