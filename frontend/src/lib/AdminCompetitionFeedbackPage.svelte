<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import NavBar from "./NavBar.svelte";
  import CompetitionFormModal from "./CompetitionFormModal.svelte";
  import TeamFormModal from "./TeamFormModal.svelte";
  import JudgeFormModal from "./JudgeFormModal.svelte";
  import RoomBuilder from "./RoomBuilder.svelte";
  import {
    getCompetitionScores,
    getCompetition,
    listCompetitions,
    listJudges,
    listTeams,
    updateCompetition,
    createCompetition,
    deleteCompetition,
    createTeam,
    updateTeam,
    deleteTeam,
    assignJudge,
    updateJudge,
    deleteJudge,
    type Competition,
    type JudgeAssignment,
    type Score,
    type Team,
    type TeamMember,
  } from "./competition-api";

  type TabKey = "competitions" | "teams" | "judges" | "rooms" | "feedback";

  interface CompetitionPanel {
    competition: Competition;
    teams: Team[];
    judges: JudgeAssignment[];
    scores: Score[];
    releaseDateInput: string;
    loading: boolean;
    error: string;
    saveStatus: string;
  }

  let panels = $state<CompetitionPanel[]>([]);
  let loading = $state(true);
  let pageError = $state("");
  let activeTab = $state<TabKey>("competitions");
  let selectedCompetitionId = $state<string | null>(null);

  // Competition modal state
  let competitionModalOpen = $state(false);
  let competitionEditing = $state<Competition | null>(null);
  let competitionSaving = $state(false);
  let competitionSaveError = $state("");

  // Team modal state
  let teamModalOpen = $state(false);
  let teamEditing = $state<Team | null>(null);
  let teamSaving = $state(false);
  let teamSaveError = $state("");

  // Judge modal state
  let judgeModalOpen = $state(false);
  let judgeEditing = $state<JudgeAssignment | null>(null);
  let judgeSaving = $state(false);
  let judgeSaveError = $state("");

  onMount(async () => {
    await loadCompetitions();
  });

  function findPanel(competitionId: string | null): CompetitionPanel | null {
    if (!competitionId) return null;
    return panels.find((p) => p.competition.competitionId === competitionId) || null;
  }

  let selectedPanel = $derived(findPanel(selectedCompetitionId));

  async function loadCompetitions() {
    loading = true;
    pageError = "";
    try {
      const competitions = await listCompetitions();
      const sorted = [...competitions].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      panels = await Promise.all(
        sorted.map(async (competition) => {
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
              loading: false,
              error: "",
              saveStatus: "",
            };
          } catch (err: unknown) {
            return {
              competition,
              teams: [],
              judges: [],
              scores: [],
              releaseDateInput: toDatetimeLocal(competition.feedbackReleaseDate),
              loading: false,
              error: (err as Error)?.message || "Failed to load competition details",
              saveStatus: "",
            };
          }
        })
      );

      // Default selection: first competition.
      const first = panels[0];
      if (!selectedCompetitionId && first) {
        selectedCompetitionId = first.competition.competitionId;
      } else if (selectedCompetitionId && !panels.some((p) => p.competition.competitionId === selectedCompetitionId)) {
        selectedCompetitionId = first ? first.competition.competitionId : null;
      }
    } catch (err: unknown) {
      pageError = (err as Error)?.message || "Failed to load competitions";
    } finally {
      loading = false;
    }
  }

  async function refreshSelectedPanel() {
    if (!selectedCompetitionId) return;
    const idx = panels.findIndex((p) => p.competition.competitionId === selectedCompetitionId);
    const target = idx >= 0 ? panels[idx] : undefined;
    if (!target) return;
    target.loading = true;
    try {
      const competitionId = target.competition.competitionId;
      const [competition, teams, judges, scores] = await Promise.all([
        getCompetition(competitionId),
        listTeams(competitionId),
        listJudges(competitionId),
        getCompetitionScores(competitionId),
      ]);
      panels[idx] = {
        ...target,
        competition,
        teams: teams.sort((a, b) => (a.teamName || "").localeCompare(b.teamName || "")),
        judges,
        scores,
        releaseDateInput: toDatetimeLocal(competition.feedbackReleaseDate),
        loading: false,
        error: "",
        saveStatus: target.saveStatus || "",
      };
    } catch (err: unknown) {
      target.loading = false;
      target.error = (err as Error)?.message || "Failed to refresh competition details";
    }
  }

  // ── Competition CRUD ────────────────────────────────
  function openNewCompetition() {
    competitionEditing = null;
    competitionSaveError = "";
    competitionModalOpen = true;
  }

  function openEditCompetition(competition: Competition) {
    competitionEditing = competition;
    competitionSaveError = "";
    competitionModalOpen = true;
  }

  async function saveCompetition(payload: Partial<Competition>) {
    competitionSaving = true;
    competitionSaveError = "";
    try {
      if (competitionEditing) {
        await updateCompetition(competitionEditing.competitionId, payload);
      } else {
        const created = await createCompetition(payload);
        selectedCompetitionId = created.competitionId;
      }
      competitionModalOpen = false;
      await loadCompetitions();
    } catch (err: unknown) {
      competitionSaveError = (err as Error)?.message || "Failed to save competition.";
    } finally {
      competitionSaving = false;
    }
  }

  async function handleDeleteCompetition(competition: Competition) {
    if (!confirm(`Delete "${competition.name}" and all its teams, judges, rooms, scores, and submissions? This cannot be undone.`)) return;
    try {
      await deleteCompetition(competition.competitionId);
      if (selectedCompetitionId === competition.competitionId) selectedCompetitionId = null;
      await loadCompetitions();
    } catch (err: unknown) {
      alert((err as Error)?.message || "Failed to delete competition.");
    }
  }

  // ── Team CRUD ───────────────────────────────────────
  function openNewTeam() {
    teamEditing = null;
    teamSaveError = "";
    teamModalOpen = true;
  }

  function openEditTeam(team: Team) {
    teamEditing = team;
    teamSaveError = "";
    teamModalOpen = true;
  }

  async function saveTeam(payload: { teamName: string; memberDetails: TeamMember[] }) {
    if (!selectedCompetitionId) return;
    teamSaving = true;
    teamSaveError = "";
    try {
      if (teamEditing) {
        await updateTeam(selectedCompetitionId, teamEditing.teamId, payload);
      } else {
        await createTeam(selectedCompetitionId, payload);
      }
      teamModalOpen = false;
      await refreshSelectedPanel();
    } catch (err: unknown) {
      teamSaveError = (err as Error)?.message || "Failed to save team.";
    } finally {
      teamSaving = false;
    }
  }

  async function handleDeleteTeam(team: Team) {
    if (!selectedCompetitionId) return;
    if (!confirm(`Delete team "${team.teamName}"? Their submission and any scores will also be removed, and they'll be pulled from any room.`)) return;
    try {
      await deleteTeam(selectedCompetitionId, team.teamId);
      await refreshSelectedPanel();
    } catch (err: unknown) {
      alert((err as Error)?.message || "Failed to delete team.");
    }
  }

  // ── Judge CRUD ──────────────────────────────────────
  function openNewJudge() {
    judgeEditing = null;
    judgeSaveError = "";
    judgeModalOpen = true;
  }

  function openEditJudge(judge: JudgeAssignment) {
    judgeEditing = judge;
    judgeSaveError = "";
    judgeModalOpen = true;
  }

  async function saveJudge(payload: { judgeUserId: string; judgeName: string; judgeEmail: string }) {
    if (!selectedCompetitionId) return;
    judgeSaving = true;
    judgeSaveError = "";
    try {
      if (judgeEditing) {
        await updateJudge(selectedCompetitionId, judgeEditing.judgeUserId, {
          judgeName: payload.judgeName,
          judgeEmail: payload.judgeEmail,
        });
      } else {
        await assignJudge(selectedCompetitionId, payload);
      }
      judgeModalOpen = false;
      await refreshSelectedPanel();
    } catch (err: unknown) {
      judgeSaveError = (err as Error)?.message || "Failed to save judge.";
    } finally {
      judgeSaving = false;
    }
  }

  async function handleDeleteJudge(judge: JudgeAssignment) {
    if (!selectedCompetitionId) return;
    if (!confirm(`Remove ${judge.judgeName || judge.judgeUserId} from this competition? They will also be removed from any room.`)) return;
    try {
      await deleteJudge(selectedCompetitionId, judge.judgeUserId);
      await refreshSelectedPanel();
    } catch (err: unknown) {
      alert((err as Error)?.message || "Failed to delete judge.");
    }
  }

  // ── Feedback tab (preserved auto-synthesis logic) ──
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
      panel.saveStatus = "Release date saved. AI synthesis will trigger automatically at release and refresh as more judges submit later.";
    } catch (err: unknown) {
      panel.error = (err as Error)?.message || "Failed to save release date";
    }
  }

  function matchesTeamAssignment(panel: CompetitionPanel, judge: JudgeAssignment, teamId: string): boolean {
    const teamIds = judge.teamIds || [];
    return teamIds.includes(teamId) || teamIds.includes(`${panel.competition.competitionId}_${teamId}`);
  }

  function assignedJudgeCount(panel: CompetitionPanel, teamId: string): number {
    return panel.judges.filter((judge) => matchesTeamAssignment(panel, judge, teamId)).length;
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

  function teamEligibleForAutomation(panel: CompetitionPanel, teamId: string): boolean {
    const assigned = assignedJudgeCount(panel, teamId);
    return assigned > 0 && scoredCount(panel, teamId) > 0 && feedbackCount(panel, teamId) > 0;
  }

  function eligibleTeamCount(panel: CompetitionPanel): number {
    return panel.teams.filter((team) => teamEligibleForAutomation(panel, team.teamId)).length;
  }

  function releaseHasPassed(value: string | null): boolean {
    return Boolean(value && new Date(value).getTime() <= Date.now());
  }

  function automationStatus(
    panel: CompetitionPanel,
    team: Team,
  ): { label: string; tone: "ready" | "pending" | "scheduled" } {
    const assigned = assignedJudgeCount(panel, team.teamId);
    const eligible = teamEligibleForAutomation(panel, team.teamId);
    const released = releaseHasPassed(panel.competition.feedbackReleaseDate);

    if (assigned === 0) {
      return { label: "No judges assigned (place team in a Room)", tone: "pending" };
    }
    if (!panel.competition.feedbackReleaseDate) {
      return { label: "Set release date to enable automation", tone: "pending" };
    }
    if (eligible && !released) {
      return { label: "Queued for release-time synthesis", tone: "scheduled" };
    }
    if (eligible && released) {
      return { label: "Automatic synthesis uses available judge feedback", tone: "ready" };
    }
    if (!eligible && !released) {
      return { label: "Waiting for first judge score and feedback", tone: "pending" };
    }
    return { label: "No judge feedback yet; synthesis will run once feedback arrives", tone: "pending" };
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
    <p>Manage competitions, teams, judges, rooms, and feedback synthesis.</p>
  </div>

  <main class="content">
    {#if loading}
      <div class="status-block">Loading competitions…</div>
    {:else if pageError}
      <div class="banner error">{pageError}</div>
    {:else}
      <!-- Competition selector + Tabs -->
      <div class="toolbar">
        <label>
          Competition
          <select bind:value={selectedCompetitionId} disabled={panels.length === 0}>
            {#if panels.length === 0}
              <option value={null}>No competitions yet</option>
            {:else}
              {#each panels as p (p.competition.competitionId)}
                <option value={p.competition.competitionId}>{p.competition.name}</option>
              {/each}
            {/if}
          </select>
        </label>
        <div class="spacer"></div>
        <button type="button" class="btn-secondary" onclick={refreshSelectedPanel} disabled={!selectedCompetitionId}>
          Refresh
        </button>
      </div>

      <nav class="tabs" role="tablist">
        <button class:active={activeTab === "competitions"} role="tab" type="button" onclick={() => (activeTab = "competitions")}>Competitions</button>
        <button class:active={activeTab === "teams"} role="tab" type="button" onclick={() => (activeTab = "teams")} disabled={!selectedPanel}>Teams</button>
        <button class:active={activeTab === "judges"} role="tab" type="button" onclick={() => (activeTab = "judges")} disabled={!selectedPanel}>Judges</button>
        <button class:active={activeTab === "rooms"} role="tab" type="button" onclick={() => (activeTab = "rooms")} disabled={!selectedPanel}>Rooms</button>
        <button class:active={activeTab === "feedback"} role="tab" type="button" onclick={() => (activeTab = "feedback")} disabled={!selectedPanel}>Feedback</button>
      </nav>

      <!-- ── Competitions tab ─────────────────────────── -->
      {#if activeTab === "competitions"}
        <section class="tab-panel">
          <div class="section-header">
            <h2>Competitions</h2>
            <button type="button" class="btn-primary" onclick={openNewCompetition}>+ New Competition</button>
          </div>
          {#if panels.length === 0}
            <div class="status-block">No competitions yet. Create the first one.</div>
          {:else}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Submission deadline</th>
                    <th>Feedback release</th>
                    <th>Teams</th>
                    <th>Judges</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each panels as panel (panel.competition.competitionId)}
                    <tr>
                      <td class="primary">
                        {panel.competition.name}
                        {#if panel.competition.description}
                          <div class="muted small">{panel.competition.description}</div>
                        {/if}
                      </td>
                      <td>{formatDate(panel.competition.submissionDeadline)}</td>
                      <td>{formatDate(panel.competition.feedbackReleaseDate)}</td>
                      <td>{panel.teams.length}</td>
                      <td>{panel.judges.length}</td>
                      <td class="actions-cell">
                        <button type="button" class="btn-table secondary" onclick={() => openEditCompetition(panel.competition)}>Edit</button>
                        <button type="button" class="btn-table danger" onclick={() => handleDeleteCompetition(panel.competition)}>Delete</button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Teams tab ─────────────────────────────── -->
      {#if activeTab === "teams" && selectedPanel}
        <section class="tab-panel">
          <div class="section-header">
            <h2>Teams in {selectedPanel.competition.name}</h2>
            <button type="button" class="btn-primary" onclick={openNewTeam}>+ New Team</button>
          </div>
          {#if selectedPanel.teams.length === 0}
            <div class="status-block">No teams yet.</div>
          {:else}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Members</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each selectedPanel.teams as team (team.teamId)}
                    <tr>
                      <td class="primary">{team.teamName}</td>
                      <td>
                        {#if team.memberDetails && team.memberDetails.length > 0}
                          {team.memberDetails.map((m) => m.name || m.email).join(", ")}
                        {:else if team.members && team.members.length > 0}
                          {team.members.join(", ")}
                        {:else}
                          <span class="muted">No members</span>
                        {/if}
                      </td>
                      <td class="actions-cell">
                        <button type="button" class="btn-table secondary" onclick={() => openEditTeam(team)}>Edit</button>
                        <button type="button" class="btn-table danger" onclick={() => handleDeleteTeam(team)}>Delete</button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Judges tab ────────────────────────────── -->
      {#if activeTab === "judges" && selectedPanel}
        <section class="tab-panel">
          <div class="section-header">
            <h2>Judges in {selectedPanel.competition.name}</h2>
            <button type="button" class="btn-primary" onclick={openNewJudge}>+ Add Judge</button>
          </div>
          <p class="muted small">
            Team assignments are managed in the Rooms tab — place judges into rooms to bind them to teams.
          </p>
          {#if selectedPanel.judges.length === 0}
            <div class="status-block">No judges yet.</div>
          {:else}
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Judge</th>
                    <th>Email</th>
                    <th>User ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each selectedPanel.judges as judge (judge.judgeUserId)}
                    <tr>
                      <td class="primary">{judge.judgeName || "(no name)"}</td>
                      <td>{judge.judgeEmail || "—"}</td>
                      <td class="muted small">{judge.judgeUserId}</td>
                      <td class="actions-cell">
                        <button type="button" class="btn-table secondary" onclick={() => openEditJudge(judge)}>Edit</button>
                        <button type="button" class="btn-table danger" onclick={() => handleDeleteJudge(judge)}>Delete</button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ── Rooms tab ─────────────────────────────── -->
      {#if activeTab === "rooms" && selectedPanel}
        <section class="tab-panel">
          <div class="section-header">
            <h2>Rooms in {selectedPanel.competition.name}</h2>
          </div>
          <p class="muted small">
            Rooms group judges with the teams they evaluate. A team can be in only one room; a judge may serve in multiple rooms.
          </p>
          <RoomBuilder
            competitionId={selectedPanel.competition.competitionId}
            teams={selectedPanel.teams}
            judges={selectedPanel.judges}
          />
        </section>
      {/if}

      <!-- ── Feedback tab (auto-synthesis status, preserved from teammate's work) ── -->
      {#if activeTab === "feedback" && selectedPanel}
        {@const panel = selectedPanel}
        <section class="tab-panel">
          <div class="section-header">
            <h2>Feedback Automation · {panel.competition.name}</h2>
          </div>

          <div class="release-row">
            <label>
              Feedback release date
              <input type="datetime-local" bind:value={panel.releaseDateInput} />
            </label>
            <button class="btn-primary" type="button" onclick={() => saveReleaseDate(panel)}>Save Release Date</button>
          </div>

          {#if panel.saveStatus}
            <div class="banner success">{panel.saveStatus}</div>
          {/if}
          {#if panel.error}
            <div class="banner error">{panel.error}</div>
          {/if}

          {#if panel.loading}
            <div class="status-block">Loading teams and judge progress…</div>
          {:else}
            <div class="synthesis-bar">
              <div>
                <strong>{eligibleTeamCount(panel)}/{panel.teams.length}</strong>
                teams currently eligible for automatic synthesis
              </div>
              <div class="automation-note">
                Automatic synthesis starts at the release time using available judge feedback and refreshes as more judges submit.
              </div>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Assigned Judges</th>
                    <th>Scores Submitted</th>
                    <th>Feedback Submitted</th>
                    <th>Eligibility</th>
                    <th>Automation Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each panel.teams as team (team.teamId)}
                    {@const assigned = assignedJudgeCount(panel, team.teamId)}
                    {@const scored = scoredCount(panel, team.teamId)}
                    {@const feedback = feedbackCount(panel, team.teamId)}
                    {@const status = automationStatus(panel, team)}
                    <tr>
                      <td class="primary">{team.teamName}</td>
                      <td>{assigned}</td>
                      <td>{scored}/{Math.max(assigned, 0)}</td>
                      <td>{feedback}/{Math.max(assigned, 0)}</td>
                      <td>
                        {#if teamEligibleForAutomation(panel, team.teamId)}
                          <span class="badge ready">Eligible</span>
                        {:else}
                          <span class="badge pending">Waiting</span>
                        {/if}
                      </td>
                      <td>
                        <div class={`automation-status ${status.tone}`}>{status.label}</div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}
    {/if}
  </main>
</div>

<CompetitionFormModal
  open={competitionModalOpen}
  competition={competitionEditing}
  saving={competitionSaving}
  error={competitionSaveError}
  onClose={() => (competitionModalOpen = false)}
  onSave={saveCompetition}
/>

<TeamFormModal
  open={teamModalOpen}
  team={teamEditing}
  saving={teamSaving}
  error={teamSaveError}
  onClose={() => (teamModalOpen = false)}
  onSave={saveTeam}
/>

<JudgeFormModal
  open={judgeModalOpen}
  judge={judgeEditing}
  saving={judgeSaving}
  error={judgeSaveError}
  onClose={() => (judgeModalOpen = false)}
  onSave={saveJudge}
/>

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
    margin: 0 0 0.5rem;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: clamp(1.8rem, 4vw, 2.4rem);
  }
  .page-header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 1rem;
  }
  .content {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 1.5rem 4rem;
    display: grid;
    gap: 1rem;
  }

  .toolbar {
    display: flex;
    gap: 0.75rem;
    align-items: end;
    flex-wrap: wrap;
  }
  .toolbar label {
    display: grid;
    gap: 0.3rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .toolbar .spacer { flex: 1; }
  select,
  input[type="datetime-local"] {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
    min-width: 240px;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: transparent;
    border: 0;
    padding: 0.65rem 1rem;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button:hover:not(:disabled) { color: var(--maroon); }
  .tabs button.active {
    color: var(--maroon);
    border-bottom-color: var(--maroon);
  }
  .tabs button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tab-panel {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
    display: grid;
    gap: 1rem;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }
  .section-header h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: 1.15rem;
  }

  .release-row {
    display: flex;
    align-items: end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .release-row label {
    display: grid;
    gap: 0.3rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .synthesis-bar {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.85rem 1rem;
    display: grid;
    gap: 0.4rem;
  }
  .automation-note {
    color: var(--text-muted);
    font-size: 0.88rem;
    line-height: 1.4;
    max-width: 36rem;
  }

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
  th, td {
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--bg);
    color: var(--maroon);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  tr:last-child td { border-bottom: 0; }
  td.primary { font-weight: 700; }
  td.actions-cell {
    white-space: nowrap;
  }
  td.actions-cell button + button { margin-left: 0.35rem; }

  .muted { color: var(--text-muted); }
  .small { font-size: 0.82rem; }

  .btn-primary,
  .btn-secondary,
  .btn-table {
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.55rem 1.05rem;
  }
  .btn-primary {
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
  }
  .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-secondary {
    color: var(--maroon);
    background: var(--card-bg);
    border: 1px solid var(--maroon);
  }
  .btn-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-table {
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
    padding: 0.4rem 0.7rem;
    font-size: 0.82rem;
  }
  .btn-table.secondary {
    color: var(--maroon);
    background: var(--card-bg);
  }
  .btn-table.danger {
    color: #fff;
    background: #b91c1c;
    border-color: #b91c1c;
  }
  .btn-table:disabled { opacity: 0.45; cursor: not-allowed; }

  .badge {
    display: inline-block;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .badge.ready { background: #dcfce7; color: #166534; }
  .badge.pending { background: #fef3c7; color: #92400e; }

  .automation-status {
    font-size: 0.88rem;
    line-height: 1.4;
    font-weight: 600;
  }
  .automation-status.ready { color: #166534; }
  .automation-status.pending { color: #92400e; }
  .automation-status.scheduled { color: #1d4ed8; }

  .status-block {
    text-align: center;
    color: var(--text-muted);
    padding: 1rem;
  }
  .banner {
    border-radius: var(--radius);
    padding: 0.65rem 0.85rem;
  }
  .banner.error {
    background: #fee2e2;
    border: 1px solid #fca5a5;
    color: #991b1b;
  }
  .banner.success {
    background: #dcfce7;
    border: 1px solid #86efac;
    color: #166534;
  }

  @media (max-width: 720px) {
    .page-header { padding-top: 4rem; }
    .toolbar select { min-width: 0; flex: 1; }
  }
</style>
