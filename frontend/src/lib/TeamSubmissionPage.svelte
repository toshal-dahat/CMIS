<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import NavBar from "./NavBar.svelte";
  import {
    listCompetitions,
    listTeams,
    requestUploadUrl,
    confirmSubmission,
    getTeamSubmission,
    type Competition,
    type Team,
    type TeamMember,
    type SubmissionRecord,
  } from "./competition-api";
  import { getCognitoIdToken } from "./auth";
  import FeedbackCard from "./FeedbackCard.svelte";

  // ── Types ──────────────────────────────────────────────
  interface MyEntry {
    comp: Competition;
    team: Team;
    isOpen: boolean;
  }

  // ── Allowed file types ─────────────────────────────────
  const ALLOWED_TYPES: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  };
  const ACCEPT_ATTR = ".pdf,.ppt,.pptx";
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  // ── State ──────────────────────────────────────────────
  let myEntries: MyEntry[] = $state([]);
  let selectedEntry: MyEntry | null = $state(null);

  let existingSubmission: SubmissionRecord | null = $state(null);
  let submissionLoading = $state(false);

  let selectedFile: File | null = $state(null);
  let fileError = $state("");

  let uploading = $state(false);
  let uploadProgress = $state("");
  let uploadError = $state("");
  let uploadSuccess: SubmissionRecord | null = $state(null);

  let pageLoading = $state(true);
  let pageError = $state("");

  // ── Derived ────────────────────────────────────────────
  let deadlineStatus = $derived.by(() => {
    const comp = selectedEntry?.comp ?? null;
    if (!comp || !comp.submissionDeadline) return { open: true, label: "No deadline set" };
    const deadline = new Date(comp.submissionDeadline);
    const now = new Date();
    if (now > deadline) {
      return { open: false, label: formatDate(deadline) };
    }
    const msLeft = deadline.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    if (daysLeft === 1) return { open: true, label: `Closes tomorrow (${formatDate(deadline)})` };
    if (daysLeft <= 3) return { open: true, label: `${daysLeft} days left (${formatDate(deadline)})` };
    return { open: true, label: formatDate(deadline) };
  });

  // ── Student identity from JWT ──────────────────────────
  async function getStudentIdentity(): Promise<{ email: string; name: string }> {
    const token = await getCognitoIdToken();
    if (!token) return { email: "", name: "" };
    try {
      const b64 = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
      const email = ((payload["email"] as string) ?? "").trim().toLowerCase();
      const given = ((payload["given_name"] as string) ?? "").trim();
      const family = ((payload["family_name"] as string) ?? "").trim();
      const name = ((payload["name"] as string) ?? "").trim() || `${given} ${family}`.trim();
      return { email, name };
    } catch {
      return { email: "", name: "" };
    }
  }

  function memberMatchesStudent(member: string, email: string, name: string): boolean {
    const m = member.trim().toLowerCase();
    return (!!email && m === email) || (!!name && m === name.toLowerCase());
  }

  function teamMemberMatchesStudent(member: TeamMember, email: string, name: string): boolean {
    const memberEmail = (member.email || "").trim().toLowerCase();
    const memberName = (member.name || "").trim().toLowerCase();
    return (!!email && memberEmail === email) || (!!name && memberName === name.toLowerCase());
  }

  function displayMembers(team: Team): TeamMember[] {
    if (team.memberDetails?.length) return team.memberDetails;
    return (team.members || []).map((email) => ({ email }));
  }

  function displayMemberNames(team: Team): string[] {
    return (team.memberDetails || [])
      .map((member) => (member.name || "").trim())
      .filter((name) => name.length > 0);
  }

  function isDeadlineOpen(comp: Competition): boolean {
    if (!comp.submissionDeadline) return true;
    return new Date(comp.submissionDeadline) > new Date();
  }

  // ── Lifecycle ──────────────────────────────────────────
  onMount(async () => {
    try {
      const { email, name } = await getStudentIdentity();
      const allComps = await listCompetitions();

      // Include both ACTIVE and any competition the student is part of
      const results = await Promise.all(
        allComps.map(async (comp) => {
          try {
            const teams = await listTeams(comp.competitionId);
            const matched = teams.find((t) => {
              const memberDetails = displayMembers(t);
              return memberDetails.some((m) => teamMemberMatchesStudent(m, email, name))
                || (t.members || []).some((m) => memberMatchesStudent(m, email, name));
            });
            if (!matched) return null;
            return { comp, team: matched, isOpen: isDeadlineOpen(comp) };
          } catch {
            return null;
          }
        })
      );

      // Collect all matched, sort: open first, closed last
      const all = results.filter((r): r is MyEntry => r !== null);
      all.sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
        // Within open: sort by nearest deadline first
        const da = a.comp.submissionDeadline ? new Date(a.comp.submissionDeadline).getTime() : Infinity;
        const db = b.comp.submissionDeadline ? new Date(b.comp.submissionDeadline).getTime() : Infinity;
        return da - db;
      });

      myEntries = all;

      // Auto-select if only one
      if (all.length === 1) {
        await selectEntry(all[0]!);
      }
    } catch (err: unknown) {
      pageError = (err as Error)?.message || "Failed to load your competition assignments";
    } finally {
      pageLoading = false;
    }
  });

  async function selectEntry(entry: MyEntry) {
    selectedEntry = entry;
    existingSubmission = null;
    uploadSuccess = null;
    selectedFile = null;
    uploadError = "";
    fileError = "";
    submissionLoading = true;
    try {
      const result = await getTeamSubmission(entry.comp.competitionId, entry.team.teamId);
      existingSubmission = result?.submission as SubmissionRecord ?? null;
    } catch {
      // no prior submission
    } finally {
      submissionLoading = false;
    }
  }

  // ── File selection ─────────────────────────────────────
  function onFileChange(e: Event) {
    fileError = "";
    uploadError = "";
    uploadSuccess = null;
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) { selectedFile = null; return; }
    if (!ALLOWED_TYPES[file.type]) {
      fileError = "Only PDF, PPT, and PPTX files are accepted.";
      selectedFile = null;
      input.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      fileError = `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`;
      selectedFile = null;
      input.value = "";
      return;
    }
    selectedFile = file;
  }

  // ── Upload flow ────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedFile || !selectedEntry) return;
    const { comp, team } = selectedEntry;

    uploading = true;
    uploadError = "";
    uploadSuccess = null;

    try {
      uploadProgress = "Requesting secure upload URL…";
      const { uploadUrl, s3Key } = await requestUploadUrl(comp.competitionId, {
        teamId: team.teamId,
        fileName: selectedFile.name,
        fileType: selectedFile.type,
      });

      uploadProgress = "Uploading file to secure storage…";
      const s3Res = await fetch(uploadUrl, {
        method: "PUT",
        body: selectedFile,
        headers: { "Content-Type": selectedFile.type },
      });
      if (!s3Res.ok) throw new Error(`Upload to storage failed (HTTP ${s3Res.status})`);

      uploadProgress = "Confirming submission…";
      const record = await confirmSubmission(comp.competitionId, {
        teamId: team.teamId,
        s3Key,
        fileName: selectedFile.name,
      });

      uploadSuccess = record;
      existingSubmission = record;
      selectedFile = null;
      const input = document.getElementById("file-input") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (err: unknown) {
      uploadError = (err as Error)?.message || "Upload failed. Please try again.";
    } finally {
      uploading = false;
      uploadProgress = "";
    }
  }

  // ── Helpers ────────────────────────────────────────────
  function formatDate(d: Date): string {
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  function formatDeadlineShort(comp: Competition): string {
    if (!comp.submissionDeadline) return "No deadline";
    const d = new Date(comp.submissionDeadline);
    const now = new Date();
    if (d < now) return "Closed";
    const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 1) return "Closes tomorrow";
    if (days <= 3) return `${days} days left`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function fileTypeLabel(mimeType: string): string {
    return ALLOWED_TYPES[mimeType] ?? mimeType;
  }
</script>

<NavBar />

<div class="page">
  <div class="page-header">
    <button class="back-link" onclick={() => {
      if (selectedEntry && myEntries.length > 1) {
        selectedEntry = null;
      } else {
        currentView.set("landing");
      }
    }}>
      <span>←</span>
      {selectedEntry && myEntries.length > 1 ? "Back to competitions" : "Back to home"}
    </button>
    <h1 class="page-title">Case Competition Submission</h1>
    <p class="page-subtitle">Upload your team's submission file</p>
  </div>

  <div class="page-content">

    {#if pageLoading}
      <div class="status-block">
        <div class="spinner-lg"></div>
        <p>Finding your competition assignments…</p>
      </div>

    {:else if pageError}
      <div class="error-banner">{pageError}</div>

    {:else if myEntries.length === 0}
      <div class="status-block">
        <div class="status-icon">🏆</div>
        <p>You are not currently assigned to any case competition.</p>
        <p class="status-sub">Contact your administrator if you believe this is an error.</p>
      </div>

    {:else if !selectedEntry}
      <!-- ── Competition card grid ── -->
      <p class="section-hint">Select a competition to view or submit your file.</p>
      <div class="competition-grid">
        {#each myEntries as entry}
          <button class="comp-card" class:comp-card-closed={!entry.isOpen} onclick={() => selectEntry(entry)}>
            <div class="comp-card-top">
              <span class="category-badge">Case Competition</span>
              {#if entry.isOpen}
                <span class="open-badge"><span class="dot dot-open"></span>Open</span>
              {:else}
                <span class="closed-badge"><span class="dot dot-closed"></span>Closed</span>
              {/if}
            </div>
            <h3 class="comp-card-title">{entry.comp.name}</h3>
            {#if entry.comp.description}
              <p class="comp-card-desc">{entry.comp.description}</p>
            {/if}
            <div class="comp-card-footer">
              <span class="comp-card-deadline">📅 {formatDeadlineShort(entry.comp)}</span>
              <span class="comp-card-team">👥 {entry.team.teamName}</span>
            </div>
          </button>
        {/each}
      </div>

    {:else}
      <!-- ── Competition + Team info banner ── -->
      <div class="info-card">
        <div class="info-row">
          <div class="info-section">
            <span class="info-label">Competition</span>
            <span class="info-value">{selectedEntry.comp.name}</span>
          </div>
          <div class="info-section">
            <span class="info-label">Your Team</span>
            <span class="info-value">{selectedEntry.team.teamName}</span>
          </div>
          <div class="info-section">
            <span class="info-label">Deadline</span>
            <div class="deadline-badge" class:deadline-open={deadlineStatus.open} class:deadline-closed={!deadlineStatus.open}>
              <span class="deadline-dot" class:dot-open={deadlineStatus.open} class:dot-closed={!deadlineStatus.open}></span>
              {deadlineStatus.label}
            </div>
          </div>
        </div>
        {#if displayMemberNames(selectedEntry.team).length > 0}
          <div class="members-row">
            <span class="info-label">Team Members</span>
            <div class="members-list">
              {#each displayMemberNames(selectedEntry.team) as memberName}
                <span class="member-chip">{memberName}</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- ── Upload card ── -->
      <div class="card">
        <h2 class="card-title">Submit Your File</h2>

        {#if submissionLoading}
          <p class="muted">Checking for existing submission…</p>
        {:else if existingSubmission && !uploadSuccess}
          <div class="existing-banner">
            <span class="existing-icon">📄</span>
            <div>
              <strong>Already submitted:</strong> {existingSubmission.fileName}
              <div class="existing-meta">
                Submitted {formatDate(new Date(existingSubmission.submittedAt))}
                · {fileTypeLabel(existingSubmission.fileType)}
              </div>
            </div>
          </div>
          {#if deadlineStatus.open}
            <p class="resubmit-note">You can re-upload below to replace your submission before the deadline.</p>
          {/if}
        {/if}

        {#if uploadSuccess}
          <div class="success-banner">
            <span class="success-icon">✓</span>
            <div>
              <strong>Submission received!</strong>
              <div class="success-meta">
                {uploadSuccess.fileName} · submitted {formatDate(new Date(uploadSuccess.submittedAt))}
              </div>
            </div>
          </div>
        {/if}

        {#if !deadlineStatus.open}
          <div class="deadline-closed-msg">
            The submission deadline has passed. No new uploads are accepted.
          </div>
        {:else}
          <div class="upload-area">
            <label class="file-label" for="file-input">
              <span class="file-label-icon">📁</span>
              <span class="file-label-text">
                {selectedFile ? selectedFile.name : "Choose a PDF, PPT, or PPTX file"}
              </span>
              {#if selectedFile}
                <span class="file-meta">{formatFileSize(selectedFile.size)} · {fileTypeLabel(selectedFile.type)}</span>
              {:else}
                <span class="file-meta">Max 25 MB</span>
              {/if}
            </label>
            <input
              id="file-input"
              type="file"
              accept={ACCEPT_ATTR}
              class="file-input-hidden"
              onchange={onFileChange}
              disabled={uploading}
            />
          </div>

          {#if fileError}
            <div class="field-error">{fileError}</div>
          {/if}
          {#if uploadError}
            <div class="error-banner">{uploadError}</div>
          {/if}
          {#if uploading}
            <div class="upload-progress">
              <div class="spinner"></div>
              <span>{uploadProgress}</span>
            </div>
          {/if}

          <button
            class="btn-submit"
            disabled={!selectedFile || uploading}
            onclick={handleSubmit}
          >
            {#if uploading}Uploading…
            {:else if existingSubmission}Re-submit File
            {:else}Submit File
            {/if}
          </button>
        {/if}
      </div>

      <!-- ── AI Feedback Narrative ── -->
      <FeedbackCard 
        competitionId={selectedEntry.comp.competitionId} 
        teamId={selectedEntry.team.teamId} 
        feedbackReleaseDate={selectedEntry.comp.feedbackReleaseDate} 
      />
    {/if}

  </div>
</div>

<style>
  .page {
    min-height: 100vh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    position: relative;
  }
  .page::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 320px;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, var(--maroon-muted) 0%, transparent 70%);
    pointer-events: none;
  }

  .page-header {
    position: relative;
    max-width: 900px;
    margin: 0 auto;
    padding: 7rem 1.5rem 2rem;
    text-align: center;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--maroon);
    font-weight: 600;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    position: absolute;
    left: 1.5rem; top: 2rem;
    transition: transform 0.2s;
  }
  .back-link:hover { transform: translateX(-4px); }
  .page-title {
    font-family: var(--font-heading);
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 700;
    color: var(--maroon);
    margin: 0 0 0.75rem;
    letter-spacing: -0.02em;
  }
  .page-subtitle { font-size: 1.1rem; color: var(--text-muted); margin: 0; }

  .page-content {
    position: relative;
    max-width: 900px;
    margin: 0 auto;
    padding: 0 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section-hint {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin: 0;
  }

  /* ── Competition cards grid ── */
  .competition-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.25rem;
  }

  .comp-card {
    background: var(--card-bg);
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    font-family: inherit;
  }
  .comp-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    border-color: var(--maroon);
  }
  .comp-card-closed {
    opacity: 0.7;
  }
  .comp-card-closed:hover {
    border-color: var(--border);
    transform: translateY(-2px);
    box-shadow: 0 4px 10px rgba(0,0,0,0.07);
  }

  .comp-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .category-badge {
    padding: 0.25rem 0.6rem;
    background: var(--maroon-muted);
    color: var(--maroon);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .open-badge, .closed-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
  }
  .open-badge   { background: #dcfce7; color: #166534; }
  .closed-badge { background: #f1f5f9; color: #64748b; }

  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .dot-open   { background: #16a34a; }
  .dot-closed { background: #94a3b8; }

  .comp-card-title {
    margin: 0;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: 1.2rem;
    line-height: 1.25;
  }
  .comp-card-desc {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
    line-height: 1.5;
    flex-grow: 1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
  }
  .comp-card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.85rem;
    border-top: 1px solid var(--border);
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .comp-card-deadline, .comp-card-team {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  /* ── Info banner ── */
  .info-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.75rem 2rem;
  }
  .info-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
  }
  .info-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
    min-width: 150px;
  }
  .info-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
  }
  .info-value {
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--maroon);
  }
  .members-row {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .members-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .member-chip {
    padding: 0.3rem 0.75rem;
    background: var(--maroon-muted, rgba(80,0,0,0.06));
    color: var(--maroon);
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 500;
  }

  /* ── Deadline badge ── */
  .deadline-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    font-size: 0.82rem;
    font-weight: 600;
    width: fit-content;
  }
  .deadline-open   { background: #dcfce7; color: #166534; }
  .deadline-closed { background: #fee2e2; color: #991b1b; }
  .deadline-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* ── Upload card ── */
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem;
  }
  .card-title {
    font-family: var(--font-heading);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 1.25rem;
  }
  .muted { font-size: 0.9rem; color: var(--text-muted); margin: 0; }

  .existing-banner {
    display: flex; align-items: flex-start; gap: 0.85rem;
    padding: 1rem 1.25rem;
    background: var(--gold-light, #fef9c3);
    border: 1px solid #fde68a;
    border-radius: var(--radius);
    margin-bottom: 1rem;
    font-size: 0.9rem; color: var(--text); line-height: 1.5;
  }
  .existing-icon { font-size: 1.4rem; flex-shrink: 0; }
  .existing-meta { margin-top: 0.2rem; font-size: 0.82rem; color: var(--text-muted); }
  .resubmit-note { font-size: 0.88rem; color: var(--text-muted); margin: 0 0 1.25rem; }

  .success-banner {
    display: flex; align-items: flex-start; gap: 0.85rem;
    padding: 1rem 1.25rem;
    background: #dcfce7; border: 1px solid #86efac;
    border-radius: var(--radius); margin-bottom: 1.25rem;
    font-size: 0.9rem; color: #166534;
  }
  .success-icon { font-size: 1.25rem; font-weight: 700; flex-shrink: 0; color: #16a34a; }
  .success-meta { margin-top: 0.2rem; font-size: 0.82rem; opacity: 0.8; }

  .deadline-closed-msg {
    padding: 1.25rem;
    background: #fee2e2; border: 1px solid #fca5a5;
    border-radius: var(--radius);
    color: #991b1b; font-size: 0.9rem; font-weight: 500;
  }

  .upload-area { margin-bottom: 1rem; }
  .file-input-hidden {
    position: absolute; width: 1px; height: 1px;
    opacity: 0; pointer-events: none;
  }
  .file-label {
    display: flex; flex-direction: column; align-items: center;
    gap: 0.5rem; padding: 2rem 1.5rem;
    border: 2px dashed var(--border); border-radius: var(--radius-lg);
    cursor: pointer; text-align: center;
    transition: border-color 0.2s, background 0.2s;
  }
  .file-label:hover {
    border-color: var(--maroon);
    background: var(--maroon-muted, rgba(80,0,0,0.04));
  }
  .file-label-icon { font-size: 2rem; }
  .file-label-text { font-size: 0.95rem; font-weight: 500; color: var(--text); word-break: break-all; }
  .file-meta { font-size: 0.82rem; color: var(--text-muted); }

  .field-error { font-size: 0.875rem; color: #dc2626; margin-bottom: 0.75rem; }
  .error-banner {
    padding: 0.9rem 1.1rem;
    background: #fee2e2; border: 1px solid #fca5a5;
    border-radius: var(--radius); color: #991b1b;
    font-size: 0.9rem; margin-bottom: 1rem;
  }

  .upload-progress {
    display: flex; align-items: center; gap: 0.75rem;
    font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;
  }
  .spinner {
    width: 18px; height: 18px;
    border: 2px solid var(--border); border-top-color: var(--maroon);
    border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0;
  }
  .spinner-lg {
    width: 36px; height: 36px;
    border: 3px solid var(--border); border-top-color: var(--maroon);
    border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 1rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .btn-submit {
    width: 100%; padding: 0.8rem 1.5rem;
    font-size: 1rem; font-weight: 600;
    color: var(--card-bg); background: var(--maroon);
    border: 2px solid var(--maroon); border-radius: var(--radius);
    cursor: pointer; transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
  }
  .btn-submit:hover:not(:disabled) {
    background: var(--maroon-dark); border-color: var(--maroon-dark);
    box-shadow: var(--shadow); transform: translateY(-1px);
  }
  .btn-submit:active:not(:disabled) { transform: translateY(0); }
  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

  .status-block {
    text-align: center; padding: 4rem 1.5rem; color: var(--text-muted);
  }
  .status-icon { font-size: 2.5rem; margin-bottom: 1rem; }
  .status-sub { font-size: 0.9rem; margin-top: 0.5rem; }

  @media (max-width: 600px) {
    .page-header { padding: 3.5rem 1.5rem 1.5rem; }
    .card, .info-card { padding: 1.5rem 1.25rem; }
    .back-link { top: 1.25rem; }
    .info-row { gap: 1.25rem; }
  }
</style>
