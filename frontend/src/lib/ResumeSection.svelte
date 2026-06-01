<script lang="ts">
  import {
    getUploadUrl,
    uploadToPresignedUrl,
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

    uploading = false;
    uploadProgress = 100;

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

  export async function uploadSelectedFile(): Promise<{
    ok: boolean;
    s3Key?: string;
    error?: string;
    skipped?: boolean;
  }> {
    if (!selectedFile) {
      return { ok: true, skipped: true };
    }
    await handleUpload();
    if (uploadError) {
      return { ok: false, error: uploadError };
    }
    return { ok: true, s3Key: $profile.resumeS3Key ?? '' };
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
  <p class="resume-lead">
    A PDF helps us pre-fill GPA, education, and skills. If you cannot upload one, you can still get strong mentorship
    matches from the rest of your profile below.
  </p>

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
      <p class="upload-fallback-hint">
        You can still <strong>save your profile</strong>: skills, goals, GPA, and education are used for matching even
        without a resume file.
      </p>
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
    <p class="muted">Resume upload runs automatically when you save your profile.</p>
  </div>

  <div class="resume-list">
    <h4 class="resume-list-heading">My resumes</h4>
    {#if listLoading}
      <p class="muted">Loading…</p>
    {:else if listError}
      <p class="error-message">{listError}</p>
    {:else if resumes.length === 0}
      <div class="no-resume-engage" role="region" aria-labelledby="no-resume-engage-title">
        <h4 id="no-resume-engage-title" class="no-resume-title">Make your profile do the work</h4>
        <p class="no-resume-desc">
          Mentorship uses the same engine for everyone: semantic similarity plus rule checks. When there is no PDF, these
          fields carry most of the signal—treat them like a short, honest self-introduction.
        </p>
        <ol class="no-resume-steps">
          <li>
            <span class="step-title">Skills &amp; tags</span>
            <span class="step-body">Pick everything that fits. Overlap with mentors drives “shared skills” and better fit scores.</span>
          </li>
          <li>
            <span class="step-title">Career goals</span> <span class="step-tag">mentees</span>
            <span class="step-body">Name roles, tools, and industries you want—not generic “learn more.” Specific beats vague.</span>
          </li>
          <li>
            <span class="step-title">Mentor details</span> <span class="step-tag">mentors</span>
            <span class="step-body">Company, title, years of experience, and industries help mentees find you and improve ranking.</span>
          </li>
          <li>
            <span class="step-title">Education &amp; GPA</span>
            <span class="step-body">Add at least one school block and GPA if you can; it anchors your academic story without a file.</span>
          </li>
          <li>
            <span class="step-title">LinkedIn</span>
            <span class="step-body">Optional link adds trusted context when you do not have a resume on file.</span>
          </li>
        </ol>
        <p class="no-resume-foot muted">Scroll up to fill those sections, then save. You can add a PDF later anytime.</p>
      </div>
    {:else}
      <ul class="resume-items">
        {#each resumes as resume}
          {@const id = String(resume.id ?? resume.resumeId ?? '').trim()}
          {@const label = resume.fileName ?? resume.name ?? resume.s3Key ?? id}
          <li class="resume-item">
            <div class="resume-item-main">
              <span class="resume-item-label">{label}</span>
            </div>
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
    margin: 0 0 0.35rem;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--maroon);
  }

  .resume-lead {
    margin: 0 0 1rem;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--text-muted, #555);
    max-width: 40rem;
  }

  .upload-fallback-hint {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: #4a3728;
    background: rgba(180, 140, 60, 0.12);
    border: 1px solid rgba(180, 140, 60, 0.35);
    border-radius: 6px;
    padding: 0.5rem 0.65rem;
  }

  .no-resume-engage {
    margin: 0.35rem 0 0;
    padding: 0.85rem 1rem;
    border-radius: var(--radius, 8px);
    border: 1px solid rgba(128, 0, 0, 0.2);
    background: linear-gradient(145deg, rgba(128, 0, 0, 0.06), rgba(128, 0, 0, 0.02));
    box-shadow: 0 2px 14px rgba(0, 0, 0, 0.04);
  }

  .no-resume-title {
    margin: 0 0 0.4rem;
    font-size: 1rem;
    font-weight: 700;
    color: var(--maroon);
    font-family: var(--font-heading);
  }

  .no-resume-desc {
    margin: 0 0 0.75rem;
    font-size: 0.88rem;
    line-height: 1.45;
    color: #333;
  }

  .no-resume-steps {
    margin: 0;
    padding: 0 0 0 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    font-size: 0.86rem;
    line-height: 1.4;
    color: #2a2a2a;
  }

  .no-resume-steps li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .step-title {
    font-weight: 700;
    color: var(--maroon);
  }

  .step-tag {
    display: inline-block;
    margin-left: 0.25rem;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--maroon);
    background: rgba(128, 0, 0, 0.1);
    padding: 0.08rem 0.35rem;
    border-radius: 4px;
    vertical-align: middle;
  }

  .step-body {
    display: block;
    font-weight: 400;
    color: #444;
    padding-left: 0;
  }

  .no-resume-foot {
    margin: 0.75rem 0 0;
    font-size: 0.82rem;
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
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .resume-item-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
