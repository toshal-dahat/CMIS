<script lang="ts">
  import { onMount } from "svelte";
  import { getSubmissionDownloadUrl } from "./competition-api";

  interface Props {
    competitionId: string;
    teamId: string;
    teamName: string;
    onClose: () => void;
  }

  let { competitionId, teamId, teamName, onClose }: Props = $props();

  let downloadUrl = $state("");
  let fileName = $state("");
  let fileType = $state("");
  let loading = $state(true);
  let error = $state("");

  // MIME type → classification for rendering decisions
  const PPT_MIME_TYPES = new Set([
    "application/vnd.ms-powerpoint",                                                 // .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",     // .pptx
  ]);

  let isPdf = $derived(fileType === "application/pdf");
  let isPowerPoint = $derived(PPT_MIME_TYPES.has(fileType));

  onMount(async () => {
    try {
      const result = await getSubmissionDownloadUrl(competitionId, teamId);
      downloadUrl = result.downloadUrl;
      fileName = result.submission?.fileName || "submission";
      fileType = result.submission?.fileType || "";
    } catch (e: any) {
      error = e.message || "Failed to load submission";
    } finally {
      loading = false;
    }
  });

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="modal-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Submission viewer for {teamName}"
  onclick={handleOverlayClick}
>
  <div class="modal-content" class:compact={!isPdf}>
    <div class="modal-header">
      <h2>{teamName} &mdash; Submission</h2>
      <button class="close-btn" onclick={onClose} aria-label="Close">&times;</button>
    </div>

    <div class="modal-body">
      {#if loading}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading submission...</p>
        </div>
      {:else if error}
        <div class="error-state">
          <p>{error}</p>
        </div>
      {:else if isPdf}
        <!-- ── PDF: inline iframe viewer ── -->
        <iframe
          src={downloadUrl}
          title="Team Submission PDF"
          class="pdf-frame"
        ></iframe>
        <div class="download-bar">
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" class="download-link">
            Open in new tab
          </a>
        </div>
      {:else if isPowerPoint}
        <!-- ── PPT/PPTX: download card (browsers don't render Office files inline) ── -->
        <div class="download-card">
          <div class="file-icon powerpoint-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="currentColor">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM9 12v6h2v-2h1.5a2.5 2.5 0 0 0 0-5H9zm2 3v-2h1.5a.5.5 0 1 1 0 1H11z"/>
            </svg>
          </div>
          <div class="file-info">
            <h3 class="file-name">{fileName}</h3>
            <p class="file-type-label">PowerPoint presentation</p>
          </div>
          <p class="info-message">
            Browsers can&apos;t preview PowerPoint files inline. Download to view on your device.
          </p>
          <a href={downloadUrl} download={fileName} class="btn-download">
            <span aria-hidden="true">&darr;</span> Download {fileName}
          </a>
          <p class="summary-note">
            The AI summary is available in the grading panel to help you review without opening the file.
          </p>
        </div>
      {:else}
        <!-- ── Unknown file type: generic download card ── -->
        <div class="download-card">
          <div class="file-icon generic-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="currentColor">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
            </svg>
          </div>
          <div class="file-info">
            <h3 class="file-name">{fileName}</h3>
            {#if fileType}
              <p class="file-type-label">{fileType}</p>
            {/if}
          </div>
          <p class="info-message">
            This file type can&apos;t be previewed in the browser. Download it to view on your device.
          </p>
          <a href={downloadUrl} download={fileName} class="btn-download">
            <span aria-hidden="true">&darr;</span> Download {fileName}
          </a>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .modal-content {
    width: min(900px, 95vw);
    height: min(85vh, 900px);
    background: var(--card-bg, #fff);
    border-radius: var(--radius-lg, 12px);
    box-shadow: var(--shadow-lg, 0 25px 50px rgba(0, 0, 0, 0.25));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Download-only modes (PPT/PPTX, unknown types) don't need full height */
  .modal-content.compact {
    width: min(540px, 95vw);
    height: auto;
    max-height: 85vh;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border, #e5e7eb);
  }
  .modal-header h2 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.15rem;
    color: var(--maroon, #500000);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.75rem;
    color: var(--text-muted, #6b7280);
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
    transition: color 0.2s;
  }
  .close-btn:hover { color: var(--text, #1f2937); }

  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── PDF iframe ── */
  .pdf-frame {
    flex: 1;
    width: 100%;
    border: none;
  }
  .download-bar {
    padding: 0.75rem 1.5rem;
    border-top: 1px solid var(--border, #e5e7eb);
    text-align: right;
  }
  .download-link {
    color: var(--maroon, #500000);
    font-weight: 600;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .download-link:hover { text-decoration: underline; }

  /* ── Download card (PPT/PPTX/unknown) ── */
  .download-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2.5rem 2rem;
    gap: 1rem;
    text-align: center;
  }

  .file-icon {
    width: 88px;
    height: 88px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    color: var(--card-bg, #fff);
  }
  .powerpoint-icon {
    background: linear-gradient(135deg, #d04423 0%, #b8330a 100%);
  }
  .generic-icon {
    background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 100%;
    overflow: hidden;
  }
  .file-name {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text, #1f2937);
    word-break: break-all;
    overflow-wrap: anywhere;
  }
  .file-type-label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .info-message {
    margin: 0;
    max-width: 380px;
    font-size: 0.95rem;
    color: var(--text-muted, #6b7280);
    line-height: 1.5;
  }

  .btn-download {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--maroon, #500000);
    color: var(--card-bg, #fff);
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    border-radius: var(--radius, 8px);
    transition: background 0.2s, transform 0.15s;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn-download:hover {
    background: var(--maroon-dark, #3a0000);
    transform: translateY(-1px);
  }

  .summary-note {
    margin: 0.5rem 0 0;
    max-width: 380px;
    font-size: 0.82rem;
    color: var(--text-muted, #6b7280);
    font-style: italic;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border, #e5e7eb);
  }

  /* ── Shared states ── */
  .loading-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #6b7280);
    padding: 3rem 2rem;
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin-bottom: 1.5rem;
    border: 3px solid var(--border, #e5e7eb);
    border-top-color: var(--maroon, #500000);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--error-text, #b91c1c);
    padding: 2rem;
  }
</style>
