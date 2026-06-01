<script lang="ts">
  import type { Competition, Criterion } from "./competition-api";

  interface Props {
    open: boolean;
    competition: Competition | null;
    saving?: boolean;
    error?: string;
    onClose: () => void;
    onSave: (payload: Partial<Competition>) => void | Promise<void>;
  }

  const { open, competition, saving = false, error = "", onClose, onSave }: Props = $props();

  let name = $state("");
  let description = $state("");
  let submissionDeadline = $state("");
  let feedbackReleaseDate = $state("");
  let rubricRows = $state<Array<{ key: string; label: string; max: number }>>([]);
  let formError = $state("");

  function toDatetimeLocal(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function fromDatetimeLocal(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  $effect(() => {
    if (!open) return;
    name = competition?.name || "";
    description = competition?.description || "";
    submissionDeadline = toDatetimeLocal(competition?.submissionDeadline);
    feedbackReleaseDate = toDatetimeLocal(competition?.feedbackReleaseDate);
    rubricRows = (competition?.rubric || []).map((c: Criterion) => ({
      key: c.key,
      label: c.label || c.key,
      max: typeof c.max === "number" ? c.max : 10,
    }));
    formError = "";
  });

  function addCriterion() {
    rubricRows = [...rubricRows, { key: "", label: "", max: 10 }];
  }

  function removeCriterion(index: number) {
    rubricRows = rubricRows.filter((_, i) => i !== index);
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    formError = "";
    if (!name.trim()) {
      formError = "Name is required.";
      return;
    }
    const cleanRubric = rubricRows
      .map((r) => ({ key: r.key.trim(), label: r.label.trim() || r.key.trim(), max: Number(r.max) || 10 }))
      .filter((r) => r.key);

    const payload: Partial<Competition> = {
      name: name.trim(),
      description: description.trim(),
      submissionDeadline: fromDatetimeLocal(submissionDeadline),
      feedbackReleaseDate: fromDatetimeLocal(feedbackReleaseDate),
    };
    if (cleanRubric.length > 0) {
      payload.rubric = cleanRubric;
    }
    await onSave(payload);
  }
</script>

{#if open}
  <div class="modal-backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={competition ? "Edit competition" : "New competition"}>
      <header>
        <h2>{competition ? "Edit Competition" : "New Competition"}</h2>
        <button type="button" class="icon-btn" onclick={onClose} aria-label="Close">×</button>
      </header>

      <form onsubmit={handleSubmit}>
        <label>
          Name
          <input type="text" bind:value={name} required />
        </label>

        <label>
          Description
          <textarea bind:value={description} rows="3"></textarea>
        </label>

        <div class="row">
          <label>
            Submission deadline
            <input type="datetime-local" bind:value={submissionDeadline} />
          </label>
          <label>
            Feedback release date
            <input type="datetime-local" bind:value={feedbackReleaseDate} />
          </label>
        </div>

        <fieldset>
          <legend>Rubric criteria <span class="hint">(leave empty to use defaults)</span></legend>
          {#each rubricRows as row, i}
            <div class="rubric-row">
              <input type="text" placeholder="key (e.g. presentation)" bind:value={row.key} />
              <input type="text" placeholder="label" bind:value={row.label} />
              <input type="number" min="1" max="100" placeholder="max" bind:value={row.max} />
              <button type="button" class="remove" onclick={() => removeCriterion(i)} aria-label="Remove">×</button>
            </div>
          {/each}
          <button type="button" class="add-row" onclick={addCriterion}>+ Add criterion</button>
        </fieldset>

        {#if formError}
          <div class="banner error">{formError}</div>
        {:else if error}
          <div class="banner error">{error}</div>
        {/if}

        <footer>
          <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving}>
            {saving ? "Saving…" : competition ? "Save Changes" : "Create"}
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
    max-width: 640px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
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
  input[type="number"],
  input[type="datetime-local"],
  textarea {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
  }
  textarea {
    resize: vertical;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.9rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    margin: 0;
  }
  legend {
    color: var(--maroon);
    font-size: 0.85rem;
    font-weight: 700;
    padding: 0 0.4rem;
  }
  .hint {
    color: var(--text-muted);
    font-weight: 400;
  }
  .rubric-row {
    display: grid;
    grid-template-columns: 1fr 1fr 80px auto;
    gap: 0.4rem;
    margin-bottom: 0.35rem;
  }
  .rubric-row input {
    padding: 0.4rem 0.5rem;
    font-size: 0.85rem;
  }
  .remove,
  .add-row {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--maroon);
    font: inherit;
  }
  .remove {
    padding: 0 0.65rem;
    font-size: 1rem;
  }
  .add-row {
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
    margin-top: 0.25rem;
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
