<script lang="ts">
  import type { JudgeAssignment } from "./competition-api";

  interface Props {
    open: boolean;
    judge: JudgeAssignment | null;
    saving?: boolean;
    error?: string;
    onClose: () => void;
    onSave: (payload: { judgeUserId: string; judgeName: string; judgeEmail: string }) => void | Promise<void>;
  }

  const { open, judge, saving = false, error = "", onClose, onSave }: Props = $props();

  let judgeUserId = $state("");
  let judgeName = $state("");
  let judgeEmail = $state("");
  let formError = $state("");

  $effect(() => {
    if (!open) return;
    judgeUserId = judge?.judgeUserId || "";
    judgeName = judge?.judgeName || "";
    judgeEmail = judge?.judgeEmail || "";
    formError = "";
  });

  async function handleSubmit(event: Event) {
    event.preventDefault();
    formError = "";
    if (!judge && !judgeUserId.trim()) {
      formError = "Judge user ID is required.";
      return;
    }
    await onSave({
      judgeUserId: judgeUserId.trim(),
      judgeName: judgeName.trim(),
      judgeEmail: judgeEmail.trim(),
    });
  }
</script>

{#if open}
  <div class="modal-backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={judge ? "Edit judge" : "New judge"}>
      <header>
        <h2>{judge ? "Edit Judge" : "Add Judge"}</h2>
        <button type="button" class="icon-btn" onclick={onClose} aria-label="Close">×</button>
      </header>

      <form onsubmit={handleSubmit}>
        <label>
          Judge user ID (Cognito sub)
          <input type="text" bind:value={judgeUserId} disabled={!!judge} required={!judge} />
          {#if judge}
            <span class="hint">User ID cannot be changed.</span>
          {/if}
        </label>

        <div class="row">
          <label>
            Display name
            <input type="text" bind:value={judgeName} />
          </label>
          <label>
            Email
            <input type="email" bind:value={judgeEmail} />
          </label>
        </div>

        <div class="info">
          Team assignments are managed in the <strong>Rooms</strong> tab. Place this
          judge in a room to bind them to specific teams.
        </div>

        {#if formError}
          <div class="banner error">{formError}</div>
        {:else if error}
          <div class="banner error">{error}</div>
        {/if}

        <footer>
          <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving}>
            {saving ? "Saving…" : judge ? "Save Changes" : "Add Judge"}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    max-width: 540px;
    width: 100%;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  header h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: 1.2rem;
  }
  .icon-btn {
    background: transparent;
    border: 0;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--text-muted);
    line-height: 1;
  }
  form {
    padding: 1.25rem 1.5rem;
    display: grid;
    gap: 0.9rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  input[type="text"],
  input[type="email"] {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
  }
  input:disabled {
    background: var(--bg);
    color: var(--text-muted);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.9rem;
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 400;
  }
  .info {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1e40af;
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    font-size: 0.85rem;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
  .btn-primary,
  .btn-secondary {
    border-radius: var(--radius);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.55rem 1.1rem;
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
  .banner.error {
    background: #fee2e2;
    border: 1px solid #fca5a5;
    color: #991b1b;
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
  }
</style>
