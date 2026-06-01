<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import NavBar from "./NavBar.svelte";
  import {
    getCompetitionScores,
    getCompetition,
    listCompetitions,
    listJudges,
    listTeams,
    updateCompetition,
    triggerSynthesis,
    type Competition,
    type JudgeAssignment,
    type Score,
    type Team,
  } from "./competition-api";

  interface CompetitionPanel {
    competition: Competition;
    teams: Team[];
    judges: JudgeAssignment[];
    scores: Score[];
    releaseDateInput: string;
    expanded: boolean;
    loading: boolean;
    error: string;
    saveStatus: string;
    triggerStatus: string;
    /** Per-team synthesis state: teamId → { loading, status, error } */
    teamSynthesis: Record<string, { loading: boolean; status: string; error: string }>;
  }

  let panels: CompetitionPanel[] = $state([]);
  let loading = $state(true);
  let pageError = $state("");

  onMount(async () => {
    await loadCompetitions();
  });

  async function loadCompetitions() {
    loading = true;
    pageError = "";
    try {
      const competitions = await listCompetitions();
      panels = await Promise.all(
        competitions
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
          .map(async (competition) => {
            try {
              const [teams, judges, scores] = await Promise.all([
                listTeams(competition.competitionId),
                listJudges(competition.competitionId),
                getCompetitionScores(competition.competitionId),
              ]);
              return {
                competition,
                teams: teams.sort((a, b) => (a.teamName || "").localeCompare(b.teamName || "")),
                judges,
                scores,
                releaseDateInput: toDatetimeLocal(competition.feedbackReleaseDate),
                expanded: true,
                loading: false,
                error: "",
                saveStatus: "",
                triggerStatus: "",
                teamSynthesis: {},
              };
            } catch (err: unknown) {
              return {
                competition,
                teams: [],
                judges: [],
                scores: [],
                releaseDateInput: toDatetimeLocal(competition.feedbackReleaseDate),
                expanded: true,
                loading: false,
                error: (err as Error)?.message || "Failed to load competition details",
                saveStatus: "",
                triggerStatus: "",
                teamSynthesis: {},
              };
            }
          })
      );
    } catch (err: unknown) {
      pageError = (err as Error)?.message || "Failed to load competitions";
    } finally {
      loading = false;
    }
  }

  async function expandPanel(panel: CompetitionPanel) {
    panel.expanded = !panel.expanded;
    panel.error = "";
    panel.saveStatus = "";
    panel.triggerStatus = "";
    if (!panel.expanded || panel.teams.length > 0) return;

    panel.loading = true;
    try {
      const competitionId = panel.competition.competitionId;
      const [teams, judges, scores] = await Promise.all([
        listTeams(competitionId),
        listJudges(competitionId),
        getCompetitionScores(competitionId),
      ]);
      panel.teams = teams.sort((a, b) => (a.teamName || "").localeCompare(b.teamName || ""));
      panel.judges = judges;
      panel.scores = scores;
    } catch (err: unknown) {
      panel.error = (err as Error)?.message || "Failed to load competition details";
    } finally {
      panel.loading = false;
    }
  }

  async function refreshPanel(panel: CompetitionPanel) {
    panel.loading = true;
    panel.error = "";
    panel.saveStatus = "";
    panel.triggerStatus = "";
    try {
      const competitionId = panel.competition.competitionId;
      const [competition, teams, judges, scores] = await Promise.all([
        getCompetition(competitionId),
        listTeams(competitionId),
        listJudges(competitionId),
        getCompetitionScores(competitionId),
      ]);
      panel.competition = competition;
      panel.releaseDateInput = toDatetimeLocal(competition.feedbackReleaseDate);
      panel.teams = teams.sort((a, b) => (a.teamName || "").localeCompare(b.teamName || ""));
      panel.judges = judges;
      panel.scores = scores;
    } catch (err: unknown) {
      panel.error = (err as Error)?.message || "Failed to refresh competition details";
    } finally {
      panel.loading = false;
    }
  }

  async function saveReleaseDate(panel: CompetitionPanel) {
    panel.saveStatus = "";
    panel.error = "";
    try {
      const feedbackReleaseDate = panel.releaseDateInput
        ? new Date(panel.releaseDateInput).toISOString()
        : null;
      const updated = await updateCompetition(panel.competition.competitionId, { feedbackReleaseDate });
      panel.competition = updated;
      panel.releaseDateInput = toDatetimeLocal(updated.feedbackReleaseDate);
      panel.saveStatus = "Release date saved.";
    } catch (err: unknown) {
      panel.error = (err as Error)?.message || "Failed to save release date";
    }
  }

  function handleTrigger(panel: CompetitionPanel) {
    if (!allTeamsReady(panel)) {
      panel.triggerStatus = "Some teams are still waiting on assigned judges. You can trigger synthesis for teams marked Ready.";
      return;
    }
    panel.triggerStatus = "All ready teams can be synthesized from their own team rows.";
  }

  async function handleTeamTrigger(panel: CompetitionPanel, team: Team) {
    if (!teamReady(panel, team.teamId)) {
      panel.triggerStatus = `${team.teamName} is still waiting on all assigned judge scores and written feedback.`;
      return;
    }

    // Initialise per-team state
    panel.teamSynthesis[team.teamId] = { loading: true, status: "", error: "" };
    panel.triggerStatus = "";

    try {
      const result = await triggerSynthesis(panel.competition.competitionId, team.teamId);
      panel.teamSynthesis[team.teamId] = {
        loading: false,
        status: `✅ Synthesized ${result.judgeCount} judge comment(s) for ${team.teamName}.`,
        error: "",
      };
    } catch (err: unknown) {
      panel.teamSynthesis[team.teamId] = {
        loading: false,
        status: "",
        error: (err as Error)?.message || "Synthesis failed. Please try again.",
      };
    }
  }

  function assignedJudgeCount(panel: CompetitionPanel, teamId: string): number {
    return panel.judges.filter((judge) => (judge.teamIds || []).includes(teamId)).length;
  }

  function teamScores(panel: CompetitionPanel, teamId: string): Score[] {
    return panel.scores.filter((score) => score.teamId === teamId);
  }

  function feedbackCount(panel: CompetitionPanel, teamId: string): number {
    return teamScores(panel, teamId).filter((score) => (score.feedback || "").trim().length > 0).length;
  }

  function scoredCount(panel: CompetitionPanel, teamId: string): number {
    return teamScores(panel, teamId).filter((score) => score.status === "GRADED").length;
  }

  function teamReady(panel: CompetitionPanel, teamId: string): boolean {
    const assigned = assignedJudgeCount(panel, teamId);
    return assigned > 0 && scoredCount(panel, teamId) >= assigned && feedbackCount(panel, teamId) >= assigned;
  }

  function readyTeamCount(panel: CompetitionPanel): number {
    return panel.teams.filter((team) => teamReady(panel, team.teamId)).length;
  }

  function allTeamsReady(panel: CompetitionPanel): boolean {
    return panel.teams.length > 0 && readyTeamCount(panel) === panel.teams.length;
  }

  function formatDate(value: string | null): string {
    if (!value) return "Not set";
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function toDatetimeLocal(value: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }
</script>

<NavBar />

<div class="page">
  <div class="page-header">
    <button class="back-link" type="button" onclick={() => currentView.set("landing")}>
      <span>&larr;</span>
      Back to home
    </button>
    <h1>Case Competitions</h1>
    <p>Manage feedback synthesis readiness and release dates.</p>
  </div>

  <main class="content">
    {#if loading}
      <div class="status-block">Loading competitions...</div>
    {:else if pageError}
      <div class="error-banner">{pageError}</div>
    {:else if panels.length === 0}
      <div class="status-block">No competitions found.</div>
    {:else}
      <div class="competition-list">
        {#each panels as panel (panel.competition.competitionId)}
          <section class="competition-card">
            <div class="card-main">
              <div>
                <span class="eyebrow">Case Competition</span>
                <h2>{panel.competition.name}</h2>
                {#if panel.competition.description}
                  <p class="description">{panel.competition.description}</p>
                {/if}
                <div class="meta-row">
                  <span>Submission deadline: {formatDate(panel.competition.submissionDeadline)}</span>
                  <span>Feedback release: {formatDate(panel.competition.feedbackReleaseDate)}</span>
                </div>
              </div>
              <button class="btn-secondary" type="button" onclick={() => expandPanel(panel)}>
                {panel.expanded ? "Hide Teams" : "Manage Feedback"}
              </button>
            </div>

            {#if panel.expanded}
              <div class="details">
                <div class="release-row">
                  <label>
                    Feedback release date
                    <input type="datetime-local" bind:value={panel.releaseDateInput} />
                  </label>
                  <button class="btn-primary" type="button" onclick={() => saveReleaseDate(panel)}>
                    Save Release Date
                  </button>
                  <button class="btn-secondary" type="button" onclick={() => refreshPanel(panel)}>
                    Refresh
                  </button>
                </div>

                {#if panel.saveStatus}
                  <div class="success-banner">{panel.saveStatus}</div>
                {/if}
                {#if panel.error}
                  <div class="error-banner">{panel.error}</div>
                {/if}

                {#if panel.loading}
                  <div class="status-block compact">Loading teams and judge progress...</div>
                {:else}
                  <div class="synthesis-bar">
                    <div>
                      <strong>{readyTeamCount(panel)}/{panel.teams.length}</strong>
                      teams ready for feedback synthesis
                    </div>
                    <button class="btn-secondary" type="button" onclick={() => handleTrigger(panel)}>
                      Check Readiness
                    </button>
                  </div>

                  {#if panel.triggerStatus}
                    <div class="notice-banner">{panel.triggerStatus}</div>
                  {/if}

                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Assigned Judges</th>
                          <th>Scores Submitted</th>
                          <th>Feedback Submitted</th>
                          <th>Readiness</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each panel.teams as team (team.teamId)}
                          {@const assigned = assignedJudgeCount(panel, team.teamId)}
                          {@const scored = scoredCount(panel, team.teamId)}
                          {@const feedback = feedbackCount(panel, team.teamId)}
                          {@const synth = panel.teamSynthesis[team.teamId]}
                          <tr>
                            <td class="team-name">{team.teamName}</td>
                            <td>{assigned}</td>
                            <td>{scored}/{assigned}</td>
                            <td>{feedback}/{assigned}</td>
                            <td>
                              {#if teamReady(panel, team.teamId)}
                                <span class="badge ready">Ready</span>
                              {:else}
                                <span class="badge pending">Waiting</span>
                              {/if}
                            </td>
                            <td>
                              <button
                                class="btn-table"
                                type="button"
                                disabled={!teamReady(panel, team.teamId) || synth?.loading}
                                onclick={() => handleTeamTrigger(panel, team)}
                              >
                                {synth?.loading ? "Synthesizing…" : "Trigger AI Synthesis"}
                              </button>
                              {#if synth?.status}
                                <div class="synth-status success">{synth.status}</div>
                              {:else if synth?.error}
                                <div class="synth-status error">{synth.error}</div>
                              {/if}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .page {
    min-height: 100vh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
  }

  .page-header {
    max-width: 1120px;
    margin: 0 auto;
    padding: 7rem 1.5rem 2rem;
    text-align: center;
    position: relative;
  }

  .back-link {
    position: absolute;
    left: 1.5rem;
    top: 2rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--maroon);
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
  }

  .page-header h1 {
    margin: 0 0 0.75rem;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: clamp(2rem, 5vw, 3rem);
  }

  .page-header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 1.05rem;
  }

  .content {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 1.5rem 4rem;
  }

  .competition-list {
    display: grid;
    gap: 1rem;
  }

  .competition-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .card-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    padding: 1.5rem;
  }

  .eyebrow {
    display: inline-block;
    margin-bottom: 0.4rem;
    color: var(--maroon);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: 1.35rem;
  }

  .description {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    margin-top: 0.85rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .details {
    border-top: 1px solid var(--border);
    padding: 1.25rem 1.5rem 1.5rem;
    display: grid;
    gap: 1rem;
  }

  .release-row,
  .synthesis-bar {
    display: flex;
    align-items: end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .release-row label {
    display: grid;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }

  input[type="datetime-local"] {
    min-width: 240px;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
  }

  .synthesis-bar {
    justify-content: space-between;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
  }

  .btn-primary,
  .btn-secondary,
  .btn-table {
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.6rem 1rem;
  }

  .btn-primary {
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-secondary {
    color: var(--maroon);
    background: var(--card-bg);
    border: 1px solid var(--maroon);
  }

  .btn-table {
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
    padding: 0.45rem 0.7rem;
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .btn-table:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .synth-status {
    margin-top: 0.4rem;
    font-size: 0.78rem;
    line-height: 1.4;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
  }
  .synth-status.success { color: #166534; background: #dcfce7; }
  .synth-status.error   { color: #991b1b; background: #fee2e2; }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }

  th,
  td {
    padding: 0.8rem 0.9rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    background: var(--bg);
    color: var(--maroon);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  tr:last-child td {
    border-bottom: 0;
  }

  .team-name {
    font-weight: 700;
  }

  .badge {
    display: inline-block;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .badge.ready {
    background: #dcfce7;
    color: #166534;
  }

  .badge.pending {
    background: #fef3c7;
    color: #92400e;
  }

  .status-block,
  .error-banner,
  .success-banner,
  .notice-banner {
    border-radius: var(--radius);
    padding: 1rem;
  }

  .status-block {
    text-align: center;
    color: var(--text-muted);
  }

  .status-block.compact {
    padding: 0.75rem;
  }

  .error-banner {
    background: #fee2e2;
    border: 1px solid #fca5a5;
    color: #991b1b;
  }

  .success-banner {
    background: #dcfce7;
    border: 1px solid #86efac;
    color: #166534;
  }

  .notice-banner {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1e40af;
  }

  @media (max-width: 720px) {
    .page-header {
      padding-top: 4rem;
    }

    .card-main,
    .synthesis-bar {
      align-items: stretch;
      flex-direction: column;
    }

    .btn-primary,
    .btn-secondary {
      width: 100%;
    }
  }
</style>
