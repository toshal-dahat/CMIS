<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import { authUser } from "./stores/authStore";
  import {
    getMyAssignments,
    getMyTeams,
    getCompetition,
    submitScore,
    type JudgeAssignment,
    type Team,
    type Competition,
  } from "./competition-api";
  import SubmissionViewer from "./SubmissionViewer.svelte";

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

  // Default scoring criteria (1-10 scale)
  const CRITERIA = [
    { key: "presentation", label: "Presentation Quality" },
    { key: "analysis", label: "Analysis & Research" },
    { key: "creativity", label: "Creativity & Innovation" },
    { key: "feasibility", label: "Feasibility of Solution" },
    { key: "teamwork", label: "Teamwork & Delivery" },
  ];

  // ── Derived ────────────────────────────────────
  let selectedCompetition = $derived(
    selectedCompetitionId ? competitions.get(selectedCompetitionId) ?? null : null
  );
  let gradedCount = $derived(teams.filter(t => t.gradingStatus === 'GRADED').length);
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
          } catch { /* skip if competition not found */ }
        })
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
  function goBack(e: MouseEvent) {
    e.preventDefault();
    currentView.set("landing");
  }

  function openSubmission(team: Team) {
    if (!team.hasSubmission) return;
    viewingTeam = team;
  }

  function openScoring(team: Team) {
    scoringTeam = team;
    scoreError = "";
    // Pre-fill if team was already graded
    if (team.score) {
      scoreRatings = { ...team.score.ratings };
      scoreFeedback = team.score.feedback || "";
    } else {
      scoreRatings = {};
      CRITERIA.forEach(c => scoreRatings[c.key] = 5);
      scoreFeedback = "";
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
        month: "short", day: "numeric", year: "numeric",
      });
    } catch { return d; }
  }
</script>

<div class="judge-page">
  <div class="judge-inner">
    <button type="button" class="back-link" onclick={goBack}>
      <span class="back-arrow">&larr;</span> Back to home
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
          <p class="page-subtitle">Review submissions and grade assigned teams</p>
        </div>
      </div>

      {#if actionMsg}
        <div class="action-toast">{actionMsg}</div>
      {/if}

      <!-- Competition Selector (shown if multiple assignments) -->
      {#if assignments.length > 1}
        <div class="competition-selector">
          <label for="comp-select">Competition:</label>
          <select
            id="comp-select"
            value={selectedCompetitionId || ""}
            onchange={(e) => selectCompetition((e.target as HTMLSelectElement).value)}
          >
            <option value="" disabled>Select a competition</option>
            {#each assignments as a}
              <option value={a.competitionId}>
                {competitions.get(a.competitionId)?.name || a.competitionId}
              </option>
            {/each}
          </select>
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
            <span>Deadline: {fmtDate(selectedCompetition.submissionDeadline)}</span>
            <span class="progress-badge">{gradedCount}/{totalCount} Graded</span>
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
                      {#if team.gradingStatus === 'GRADED'}
                        <span class="badge badge-graded">Graded</span>
                      {:else}
                        <span class="badge badge-pending">Pending</span>
                      {/if}
                    </td>
                    <td class="actions-cell">
                      <button
                        class="btn-action btn-view"
                        onclick={() => openSubmission(team)}
                        disabled={!team.hasSubmission}
                        title={team.hasSubmission ? "View submission PDF" : "No submission yet"}
                      >
                        View
                      </button>
                      <button
                        class="btn-action btn-grade"
                        onclick={() => openScoring(team)}
                        title={team.gradingStatus === 'GRADED' ? "Edit grade" : "Grade team"}
                      >
                        {team.gradingStatus === 'GRADED' ? 'Edit' : 'Grade'}
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

<!-- ── Scoring Modal ── -->
{#if scoringTeam && selectedCompetitionId}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-card">
      <h2>Grade: {scoringTeam.teamName}</h2>

      <div class="criteria-grid">
        {#each CRITERIA as criterion}
          <div class="criterion-row">
            <label for="rating-{criterion.key}">{criterion.label}</label>
            <div class="rating-input">
              <input
                id="rating-{criterion.key}"
                type="range"
                min="1"
                max="10"
                bind:value={scoreRatings[criterion.key]}
              />
              <span class="rating-value">{scoreRatings[criterion.key] || 5}</span>
            </div>
          </div>
        {/each}
      </div>

      <label class="feedback-label">
        Written Feedback
        <textarea
          bind:value={scoreFeedback}
          rows="4"
          placeholder="Provide constructive feedback for this team..."
        ></textarea>
      </label>

      {#if scoreError}
        <p class="form-error">{scoreError}</p>
      {/if}

      <div class="modal-actions">
        <button class="btn-cancel" onclick={() => (scoringTeam = null)}>Cancel</button>
        <button class="btn-submit" onclick={handleSubmitScore} disabled={scoreLoading}>
          {scoreLoading
            ? "Submitting..."
            : scoringTeam.gradingStatus === 'GRADED' ? "Update Score" : "Submit Score"}
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
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 50%, #f0ebe6 100%);
    color: var(--text);
    position: relative;
    overflow: hidden;
  }
  .judge-page::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -30%;
    width: 80%;
    height: 80%;
    background: radial-gradient(ellipse, var(--maroon-muted) 0%, transparent 70%);
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
  .back-link:hover { transform: translateX(-4px); }

  /* ── Header ── */
  .dashboard-header { margin-bottom: 1.5rem; }
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

  /* ── Competition selector ── */
  .competition-selector {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .competition-selector label {
    font-weight: 600;
    color: var(--text);
  }
  .competition-selector select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    font-size: 0.95rem;
    background: var(--card-bg, #fff);
    min-width: 250px;
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
  .teams-table tbody tr:last-child td { border-bottom: none; }
  .teams-table tbody tr:hover { background: var(--bg-warm, #f8f5f2); }
  .team-name { font-weight: 600; }
  .team-members { text-align: center; }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .badge-graded { background: #def7ec; color: #03543f; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-submitted { background: #dbeafe; color: #1e40af; }
  .badge-none { background: #f3f4f6; color: #6b7280; }

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
    transition: background 0.2s, transform 0.15s;
  }
  .btn-action:disabled { opacity: 0.4; cursor: not-allowed; }
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
  .btn-grade:hover { background: var(--maroon-dark); transform: translateY(-1px); }

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
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Scoring modal ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-card {
    width: min(560px, 100%);
    background: var(--card-bg, #fff);
    border-radius: var(--radius-lg, 12px);
    padding: 1.75rem;
    box-shadow: var(--shadow-lg);
    display: grid;
    gap: 1rem;
    max-height: 85vh;
    overflow-y: auto;
  }
  .modal-card h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
  }

  .criteria-grid { display: grid; gap: 0.85rem; }
  .criterion-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 1rem;
  }
  .criterion-row label { font-weight: 500; font-size: 0.95rem; }
  .rating-input { display: flex; align-items: center; gap: 0.5rem; }
  .rating-input input[type="range"] {
    width: 140px;
    accent-color: var(--maroon, #500000);
  }
  .rating-value {
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--maroon);
    min-width: 1.5rem;
    text-align: center;
  }

  .feedback-label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .feedback-label textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
  }

  .modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
  .btn-cancel {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    background: transparent;
    cursor: pointer;
  }
  .btn-submit {
    padding: 0.5rem 1.25rem;
    font-weight: 600;
    color: var(--card-bg, #fff);
    background: var(--maroon);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
  }
  .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
  .form-error { margin: 0; color: var(--error-text, #b91c1c); font-size: 0.88rem; }

  /* ── Shared states ── */
  .loading-state { text-align: center; padding: 5rem 0; color: var(--text-muted); }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem;
    border: 3px solid var(--border);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-card {
    background: var(--error-bg, #fef2f2);
    border: 1px solid var(--error-border, #f87171);
    padding: 1.75rem;
    border-radius: var(--radius-lg, 12px);
    color: var(--error-text, #991b1b);
  }
  .error-card h3 { margin: 0 0 0.5rem; }
  .btn-retry {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--maroon);
    color: #fff;
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
  }

  .empty-state { text-align: center; padding: 4rem 1rem; color: var(--text-muted); }
  .empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }
</style>
