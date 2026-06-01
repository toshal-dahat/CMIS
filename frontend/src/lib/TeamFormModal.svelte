<script lang="ts">
  import type { Team, TeamMember } from "./competition-api";

  interface Props {
    open: boolean;
    team: Team | null;
    saving?: boolean;
    error?: string;
    onClose: () => void;
    onSave: (payload: { teamName: string; memberDetails: TeamMember[] }) => void | Promise<void>;
  }

  const { open, team, saving = false, error = "", onClose, onSave }: Props = $props();

  let teamName = $state("");
  let memberDraft = $state<TeamMember>({ name: "", email: "" });
  let memberDetails = $state<TeamMember[]>([]);
  let formError = $state("");

  $effect(() => {
    if (!open) return;
    teamName = team?.teamName || "";
    memberDetails = (team?.memberDetails && team.memberDetails.length > 0)
      ? team.memberDetails.map((m) => ({ name: m.name || "", email: m.email }))
      : (team?.members || []).map((email) => ({ name: "", email }));
    memberDraft = { name: "", email: "" };
    formError = "";
  });

  function addMember() {
    const email = (memberDraft.email || "").trim().toLowerCase();
    if (!email) {
      formError = "Member email is required.";
      return;
    }
    if (memberDetails.some((m) => m.email === email)) {
      formError = "That email is already added.";
      return;
    }
    memberDetails = [...memberDetails, { name: (memberDraft.name || "").trim(), email }];
    memberDraft = { name: "", email: "" };
    formError = "";
  }

  function removeMember(email: string) {
    memberDetails = memberDetails.filter((m) => m.email !== email);
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    formError = "";
    if (!teamName.trim()) {
      formError = "Team name is required.";
      return;
    }
    await onSave({ teamName: teamName.trim(), memberDetails });
  }
</script>

{#if open}
  <div class="modal-backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={team ? "Edit team" : "New team"}>
      <header>
        <h2>{team ? "Edit Team" : "New Team"}</h2>
        <button type="button" class="icon-btn" onclick={onClose} aria-label="Close">×</button>
      </header>

      <form onsubmit={handleSubmit}>
        <label>
          Team name
          <input type="text" bind:value={teamName} required />
        </label>

        <fieldset>
          <legend>Members</legend>
          {#if memberDetails.length === 0}
            <p class="empty">No members added yet.</p>
          {:else}
            <ul class="member-list">
              {#each memberDetails as member (member.email)}
                <li>
                  <span class="member-name">{member.name || member.email}</span>
                  {#if member.name}
                    <span class="member-email">{member.email}</span>
                  {/if}
                  <button type="button" class="remove" onclick={() => removeMember(member.email)} aria-label="Remove">×</button>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="member-add">
            <input type="text" placeholder="Name (optional)" bind:value={memberDraft.name} />
            <input type="email" placeholder="email@tamu.edu" bind:value={memberDraft.email} />
            <button type="button" class="add-row" onclick={addMember}>+ Add</button>
          </div>
        </fieldset>

        {#if formError}
          <div class="banner error">{formError}</div>
        {:else if error}
          <div class="banner error">{error}</div>
        {/if}

        <footer>
          <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving}>
            {saving ? "Saving…" : team ? "Save Changes" : "Create"}
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
    max-width: 560px;
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
  input[type="email"] {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
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
  .empty {
    margin: 0 0 0.5rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .member-list {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .member-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 0.9rem;
  }
  .member-name { font-weight: 700; }
  .member-email {
    color: var(--text-muted);
    font-size: 0.82rem;
    margin-left: auto;
  }
  .member-add {
    display: grid;
    grid-template-columns: 1fr 1.2fr auto;
    gap: 0.4rem;
  }
  .member-add input {
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
    padding: 0 0.5rem;
    font-size: 0.95rem;
    margin-left: 0.4rem;
  }
  .add-row {
    padding: 0.4rem 0.7rem;
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
