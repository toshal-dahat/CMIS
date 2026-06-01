<script lang="ts">
  import {
    listRooms,
    createRoom,
    updateRoom,
    deleteRoom,
    type Room,
    type Team,
    type JudgeAssignment,
  } from "./competition-api";

  interface Props {
    competitionId: string;
    teams: Team[];
    judges: JudgeAssignment[];
  }

  const { competitionId, teams, judges }: Props = $props();

  let rooms = $state<Room[]>([]);
  let selectedRoomId = $state<string | null>(null);
  let loading = $state(true);
  let pageError = $state("");

  // Working draft for the selected room (or new room).
  let draft = $state<{ roomName: string; judgeIds: string[]; teamIds: string[] }>({
    roomName: "",
    judgeIds: [],
    teamIds: [],
  });
  let saving = $state(false);
  let saveError = $state("");
  let saveStatus = $state("");
  let isNew = $state(false);

  async function loadRooms() {
    loading = true;
    pageError = "";
    try {
      rooms = await listRooms(competitionId);
      const first = rooms[0];
      if (first && !selectedRoomId) {
        selectRoom(first.roomId);
      } else if (selectedRoomId) {
        const found = rooms.find((r) => r.roomId === selectedRoomId);
        if (found) syncDraftFromRoom(found);
        else clearSelection();
      } else {
        clearSelection();
      }
    } catch (err: unknown) {
      pageError = (err as Error)?.message || "Failed to load rooms.";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (competitionId) loadRooms();
  });

  function syncDraftFromRoom(room: Room) {
    draft = {
      roomName: room.roomName || "",
      judgeIds: [...(room.judgeIds || [])],
      teamIds: [...(room.teamIds || [])],
    };
    saveError = "";
    saveStatus = "";
  }

  function selectRoom(roomId: string) {
    isNew = false;
    selectedRoomId = roomId;
    const room = rooms.find((r) => r.roomId === roomId);
    if (room) syncDraftFromRoom(room);
  }

  function startNewRoom() {
    isNew = true;
    selectedRoomId = null;
    draft = { roomName: "", judgeIds: [], teamIds: [] };
    saveError = "";
    saveStatus = "";
  }

  function clearSelection() {
    isNew = false;
    selectedRoomId = null;
    draft = { roomName: "", judgeIds: [], teamIds: [] };
  }

  function toggleJudge(judgeUserId: string) {
    if (draft.judgeIds.includes(judgeUserId)) {
      draft.judgeIds = draft.judgeIds.filter((id) => id !== judgeUserId);
    } else {
      draft.judgeIds = [...draft.judgeIds, judgeUserId];
    }
  }

  function toggleTeam(teamId: string) {
    if (draft.teamIds.includes(teamId)) {
      draft.teamIds = draft.teamIds.filter((id) => id !== teamId);
    } else {
      draft.teamIds = [...draft.teamIds, teamId];
    }
  }

  function teamOwner(teamId: string): Room | null {
    return rooms.find((r) =>
      r.roomId !== selectedRoomId && (r.teamIds || []).includes(teamId)
    ) || null;
  }

  async function handleSave() {
    saveError = "";
    saveStatus = "";
    if (!draft.roomName.trim()) {
      saveError = "Room name is required.";
      return;
    }
    saving = true;
    try {
      if (isNew) {
        const created = await createRoom(competitionId, {
          roomName: draft.roomName.trim(),
          judgeIds: draft.judgeIds,
          teamIds: draft.teamIds,
        });
        rooms = [...rooms, created];
        selectedRoomId = created.roomId;
        isNew = false;
        saveStatus = "Room created.";
      } else if (selectedRoomId) {
        const updated = await updateRoom(competitionId, selectedRoomId, {
          roomName: draft.roomName.trim(),
          judgeIds: draft.judgeIds,
          teamIds: draft.teamIds,
        });
        rooms = rooms.map((r) => (r.roomId === updated.roomId ? updated : r));
        saveStatus = "Room saved.";
      }
    } catch (err: unknown) {
      saveError = (err as Error)?.message || "Failed to save room.";
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!selectedRoomId) return;
    const room = rooms.find((r) => r.roomId === selectedRoomId);
    if (!room) return;
    if (!confirm(`Delete room "${room.roomName}"? Teams in this room will become unrooted and cannot be scored until placed in a new room.`)) {
      return;
    }
    saving = true;
    saveError = "";
    saveStatus = "";
    try {
      await deleteRoom(competitionId, selectedRoomId);
      rooms = rooms.filter((r) => r.roomId !== selectedRoomId);
      clearSelection();
      const next = rooms[0];
      if (next) selectRoom(next.roomId);
    } catch (err: unknown) {
      saveError = (err as Error)?.message || "Failed to delete room.";
    } finally {
      saving = false;
    }
  }

  function judgeLabel(j: JudgeAssignment): string {
    return j.judgeName || j.judgeEmail || j.judgeUserId;
  }
</script>

<div class="builder">
  {#if loading}
    <div class="status-block">Loading rooms…</div>
  {:else if pageError}
    <div class="banner error">{pageError}</div>
  {:else}
    <aside class="room-list">
      <div class="list-header">
        <h3>Rooms</h3>
        <button type="button" class="btn-secondary small" onclick={startNewRoom}>+ New</button>
      </div>
      {#if rooms.length === 0 && !isNew}
        <p class="empty">No rooms yet. Click "+ New" to create one.</p>
      {:else}
        <ul>
          {#each rooms as room (room.roomId)}
            <li>
              <button
                type="button"
                class="room-item"
                class:selected={room.roomId === selectedRoomId}
                onclick={() => selectRoom(room.roomId)}
              >
                <span class="room-item-name">{room.roomName}</span>
                <span class="room-item-meta">
                  {(room.judgeIds || []).length} judge{(room.judgeIds || []).length === 1 ? "" : "s"} ·
                  {(room.teamIds || []).length} team{(room.teamIds || []).length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <section class="editor">
      {#if !selectedRoomId && !isNew}
        <div class="empty-state">
          <p>Select a room on the left, or click "+ New" to create one.</p>
        </div>
      {:else}
        <div class="editor-row">
          <label class="full">
            Room name
            <input type="text" bind:value={draft.roomName} placeholder="e.g. Room A — Finals Panel 1" />
          </label>
        </div>

        <div class="picker-grid">
          <fieldset>
            <legend>Judges <span class="hint">({draft.judgeIds.length} selected)</span></legend>
            {#if judges.length === 0}
              <p class="empty">No judges have been added to this competition yet.</p>
            {:else}
              <ul class="picker">
                {#each judges as j (j.judgeUserId)}
                  {@const checked = draft.judgeIds.includes(j.judgeUserId)}
                  <li>
                    <label class="picker-item">
                      <input type="checkbox" checked={checked} onchange={() => toggleJudge(j.judgeUserId)} />
                      <span class="picker-name">{judgeLabel(j)}</span>
                      {#if j.judgeEmail && j.judgeName}
                        <span class="picker-meta">{j.judgeEmail}</span>
                      {/if}
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          </fieldset>

          <fieldset>
            <legend>Teams <span class="hint">({draft.teamIds.length} selected)</span></legend>
            {#if teams.length === 0}
              <p class="empty">No teams have been added to this competition yet.</p>
            {:else}
              <ul class="picker">
                {#each teams as t (t.teamId)}
                  {@const checked = draft.teamIds.includes(t.teamId)}
                  {@const owner = teamOwner(t.teamId)}
                  {@const blocked = !!owner && !checked}
                  <li>
                    <label class="picker-item" class:disabled={blocked}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onchange={() => toggleTeam(t.teamId)}
                      />
                      <span class="picker-name">{t.teamName}</span>
                      {#if blocked && owner}
                        <span class="picker-meta">in "{owner.roomName}"</span>
                      {/if}
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          </fieldset>
        </div>

        {#if saveError}
          <div class="banner error">{saveError}</div>
        {:else if saveStatus}
          <div class="banner success">{saveStatus}</div>
        {/if}

        <div class="actions">
          {#if !isNew && selectedRoomId}
            <button type="button" class="btn-danger" onclick={handleDelete} disabled={saving}>
              Delete Room
            </button>
          {/if}
          <div class="spacer"></div>
          <button type="button" class="btn-primary" onclick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isNew ? "Create Room" : "Save Changes"}
          </button>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .builder {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1rem;
    align-items: start;
  }
  .room-list {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.85rem;
    min-height: 360px;
  }
  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.6rem;
  }
  .list-header h3 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: 1rem;
  }
  .room-list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .room-item {
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.55rem 0.7rem;
    cursor: pointer;
    font: inherit;
    color: var(--text);
    display: grid;
    gap: 0.15rem;
  }
  .room-item:hover { background: var(--card-bg); }
  .room-item.selected {
    border-color: var(--maroon);
    box-shadow: 0 0 0 1px var(--maroon) inset;
    background: var(--card-bg);
  }
  .room-item-name { font-weight: 700; color: var(--maroon); }
  .room-item-meta { font-size: 0.78rem; color: var(--text-muted); }
  .empty {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .editor {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    display: grid;
    gap: 1rem;
  }
  .empty-state {
    color: var(--text-muted);
    text-align: center;
    padding: 2rem 1rem;
  }
  .editor-row label.full { width: 100%; }
  label {
    display: grid;
    gap: 0.35rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  input[type="text"] {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--card-bg);
    font: inherit;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    margin: 0;
    min-width: 0;
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
  .picker {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
    max-height: 280px;
    overflow-y: auto;
  }
  .picker-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.9rem;
    background: var(--bg);
    color: var(--text);
    font-weight: 500;
  }
  .picker-item:hover { background: var(--card-bg); }
  .picker-item.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .picker-name { flex: 1; }
  .picker-meta {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .actions .spacer { flex: 1; }
  .btn-primary,
  .btn-secondary,
  .btn-danger {
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
  .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-secondary {
    color: var(--maroon);
    background: var(--card-bg);
    border: 1px solid var(--maroon);
  }
  .btn-secondary.small {
    padding: 0.3rem 0.7rem;
    font-size: 0.82rem;
  }
  .btn-danger {
    color: #fff;
    background: #b91c1c;
    border: 1px solid #b91c1c;
  }
  .btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
  .banner {
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
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
  .status-block {
    text-align: center;
    color: var(--text-muted);
    padding: 1rem;
  }

  @media (max-width: 760px) {
    .builder { grid-template-columns: 1fr; }
    .picker-grid { grid-template-columns: 1fr; }
  }
</style>
