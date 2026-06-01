<script lang="ts">
  import {
    getUploadUrl,
    uploadToPresignedUrl,
    completeUpload,
    listMyResumes,
    getDownloadUrl,
    PDF_MAX_BYTES_EXPORT as PDF_MAX_BYTES,
  } from './resumes';
  import { profile } from './stores/profileStore';

  interface Props {
    open?: boolean;
    onUploadSuccess?: () => void;
  }
  let { open = true, onUploadSuccess }: Props = $props();

  // Fetch from GET /api/resumes/me whenever the section is shown (no stale data).
  $effect(() => {
    if (open) {
      loadResumes();
    }
  });
  let selectedFile = $state<File | null>(null);
  let fileError = $state('');
  let uploadProgress = $state(0);
  let uploading = $state(false);
  let uploadSuccess = $state(false);
  let uploadError = $state('');
  interface ResumeItem {
    id?: string;
    resumeId?: string;
    fileName?: string;
    name?: string;
    s3Key?: string;
  }
  let resumes = $state<ResumeItem[]>([]);
  let listLoading = $state(false);
  let listError = $state('');
  let downloadLoadingId = $state<string | null>(null);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    selectedFile = null;
    fileError = '';
    uploadError = '';
    uploadSuccess = false;
    if (!file) return;

    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      fileError = 'File must be a PDF.';
      return;
    }
    if (file.size > PDF_MAX_BYTES) {
      fileError = `File must be ${PDF_MAX_BYTES / (1024 * 1024)}MB or smaller.`;
      return;
    }
    selectedFile = file;
  }

  async function loadResumes() {
    listError = '';
    resumes = [];
    listLoading = true;
    const result = await listMyResumes();
    listLoading = false;
    if (result.ok) {
      resumes = (result.resumes ?? []) as ResumeItem[];
    } else {
      listError = result.error || 'Failed to load resumes.';
      if (result.status === 401) listError = 'Session expired, please sign in again.';
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      fileError = 'Please select a PDF file.';
      return;
    }
    fileError = '';
    uploadError = '';
    uploadSuccess = false;
    uploadProgress = 0;
    uploading = true;

    const urlResult = await getUploadUrl(selectedFile.name, 'application/pdf');
    if (!urlResult.ok) {
      uploading = false;
      uploadError = urlResult.error || 'Could not get upload URL.';
      return;
    }

    const putResult = await uploadToPresignedUrl(
      urlResult.uploadUrl,
      selectedFile,
      (percent) => {
        uploadProgress = percent;
      }
    );
    if (!putResult.ok) {
      uploading = false;
      uploadError = putResult.error || 'Upload failed, please retry.';
      return;
    }

    const completeResult = await completeUpload(urlResult.resumeId);
    uploading = false;
    uploadProgress = 100;
    if (!completeResult.ok) {
      uploadError = completeResult.error || 'Upload failed, please retry.';
      return;
    }

    // Update profile store so create/update profile can persist this S3 key to DynamoDB
    const s3Key = urlResult.s3Key ?? '';
    const fileName = selectedFile?.name ?? (s3Key ? s3Key.split('/').pop() : '') ?? '';
    profile.update((p) => ({
      ...p,
      resumeS3Key: s3Key,
      resumeFileName: fileName,
    }));

    uploadSuccess = true;
    selectedFile = null;
    if (typeof onUploadSuccess === 'function') onUploadSuccess();
    await loadResumes();
  }

  async function handleDownload(resume: ResumeItem | string) {
    const id = typeof resume === 'object' ? (resume?.id ?? resume?.resumeId) : resume;
    if (!id) return;
    downloadLoadingId = id;
    const result = await getDownloadUrl(id);
    downloadLoadingId = null;
    if (!result.ok) return;
    window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
  }

  export function refresh() {
    loadResumes();
  }
</script>

<section class="resume-section" aria-labelledby="resume-section-heading">
  <h3 id="resume-section-heading" class="resume-heading">Resume</h3>

  <div class="resume-upload">
    <label for="resume-file" class="resume-label">Upload a PDF resume (max 5MB)</label>
    <input
      id="resume-file"
      type="file"
      accept="application/pdf"
      onchange={handleFileChange}
      disabled={uploading}
      class="resume-input"
    />
    {#if selectedFile}
      <p class="file-info">
        Selected: {selectedFile.name} — {formatSize(selectedFile.size)}
      </p>
    {/if}
    {#if fileError}
      <p class="error-message">{fileError}</p>
    {/if}
    {#if uploadError}
      <p class="error-message">{uploadError}</p>
    {/if}
    {#if uploadSuccess}
      <p class="success-message">Resume uploaded successfully.</p>
    {/if}
    {#if uploading}
      <div class="progress-wrap">
        <div class="progress-bar" style="width: {uploadProgress}%"></div>
        <span class="progress-text">{uploadProgress}%</span>
      </div>
    {/if}
    <button
      type="button"
      class="btn-upload"
      onclick={handleUpload}
      disabled={!selectedFile || uploading}
    >
      {uploading ? 'Uploading…' : 'Upload'}
    </button>
  </div>

  <div class="resume-list">
    <h4 class="resume-list-heading">My resumes</h4>
    {#if listLoading}
      <p class="muted">Loading…</p>
    {:else if listError}
      <p class="error-message">{listError}</p>
    {:else if resumes.length === 0}
      <p class="muted">No resumes uploaded yet.</p>
    {:else}
      <ul class="resume-items">
        {#each resumes as resume}
          {@const id = resume.id ?? resume.resumeId ?? resume}
          {@const label = resume.fileName ?? resume.name ?? resume.s3Key ?? id}
          <li class="resume-item">
            <span class="resume-item-label">{label}</span>
            <button
              type="button"
              class="btn-download"
              onclick={() => handleDownload(resume)}
              disabled={downloadLoadingId === id}
            >
              {downloadLoadingId === id ? '…' : 'Download'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .resume-section {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }

  .resume-heading {
    font-family: var(--font-heading);
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--maroon);
  }

  .resume-upload {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .resume-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #3a3a3a;
  }

  .resume-input {
    font-size: 0.9rem;
    max-width: 100%;
  }

  .file-info {
    margin: 0;
    font-size: 0.85rem;
    color: #3a3a3a;
  }

  .error-message {
    margin: 0;
    font-size: 0.85rem;
    color: #721c24;
    background: #f8d7da;
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
  }

  .success-message {
    margin: 0;
    font-size: 0.9rem;
    color: #155724;
    background: #d4edda;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }

  .progress-wrap {
    position: relative;
    height: 1.5rem;
    background: #eee;
    border-radius: 6px;
    overflow: hidden;
  }

  .progress-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--maroon);
    transition: width 0.2s ease;
  }

  .progress-text {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 0.8rem;
    font-weight: 600;
    color: #1a1a1a;
  }

  .btn-upload {
    align-self: flex-start;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn-upload:hover:not(:disabled) {
    background: var(--maroon-dark);
  }

  .btn-upload:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .resume-list-heading {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #3a3a3a;
  }

  .muted {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .resume-items {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .resume-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .resume-item-label {
    font-size: 0.9rem;
    color: #1a1a1a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-download {
    flex-shrink: 0;
    padding: 0.35rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--maroon);
    background: transparent;
    border: 1px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn-download:hover:not(:disabled) {
    background: var(--maroon);
    color: var(--card-bg);
  }

  .btn-download:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
