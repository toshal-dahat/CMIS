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

  let pdfUrl = $state("");
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      const result = await getSubmissionDownloadUrl(competitionId, teamId);
      pdfUrl = result.downloadUrl;
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
  <div class="modal-content">
    <div class="modal-header">
      <h2>{teamName} — Submission</h2>
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
      {:else}
        <iframe
          src={pdfUrl}
          title="Team Submission PDF"
          class="pdf-frame"
        ></iframe>
        <div class="download-bar">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" class="download-link">
            Open in new tab
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

  .loading-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #6b7280);
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
