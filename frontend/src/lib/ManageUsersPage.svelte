<script lang="ts">
  import { onMount } from 'svelte';
  import { listProfiles, updateUserRole } from './api';
  import { currentView } from './stores/viewStore';
  import Loader from './Loader.svelte';
  import type { ListProfilesResult } from './types';

  const ROLES = ['STUDENT', 'FORMER_STUDENT', 'FRIEND', 'INVESTOR', 'FACULTY', 'ALUMNI', 'ADMIN'] as const;

  let loading = $state(true);
  let error = $state('');
  let users = $state<ListProfilesResult['profiles']>([]);

  // Search and filter state
  let searchQuery = $state('');
  let roleFilter = $state('');

  // Track per-user role editing state
  let selectedRoles = $state<Record<string, string>>({});
  let savingUsers = $state<Record<string, boolean>>({});
  let saveErrors = $state<Record<string, string>>({});

  onMount(async () => {
    loading = true;
    error = '';
    const result = await listProfiles();
    if (result.ok && result.profiles) {
      users = result.profiles;
      for (const user of users ?? []) {
        if (user.userId) {
          selectedRoles[user.userId] = user.role || '';
        }
      }
    } else {
      error = result.error || 'Failed to load users';
    }
    loading = false;
  });

  function goBack() {
    currentView.set('landing');
  }

  let filteredUsers = $derived.by(() => {
    if (!users) return [];
    const q = searchQuery.toLowerCase().trim();
    return users.filter((user) => {
      if (roleFilter && (user.role || '') !== roleFilter) return false;
      if (q) {
        const name = (user.name || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
  });

  function hasChanged(userId: string, currentRole: string): boolean {
    return selectedRoles[userId] !== undefined && selectedRoles[userId] !== currentRole;
  }

  async function saveRole(userId: string) {
    const newRole = selectedRoles[userId];
    if (!newRole || !userId || !users) return;

    savingUsers[userId] = true;
    saveErrors[userId] = '';

    const result = await updateUserRole(userId, newRole);
    if (result.ok) {
      const idx = users.findIndex((u) => u.userId === userId);
      if (idx >= 0) users[idx] = { ...users[idx], role: newRole };
    } else {
      saveErrors[userId] = result.error || 'Failed to update role';
      const user = users.find((u) => u.userId === userId);
      selectedRoles[userId] = user?.role || '';
    }
    savingUsers[userId] = false;
  }
</script>

<div class="page">
  <header class="page-header">
    <button type="button" class="btn-back" onclick={goBack}>
      ← Back
    </button>
    <h1>Manage Users</h1>
  </header>

  <main class="page-content">
    {#if loading}
      <Loader />
    {:else if error}
      <div class="error-message">
        <p>{error}</p>
      </div>
    {:else if !users || users.length === 0}
      <div class="empty-state">
        <p>No users found.</p>
      </div>
    {:else}
      <div class="filters">
        <input
          type="text"
          class="search-input"
          placeholder="Search by name or email..."
          bind:value={searchQuery}
        />
        <select class="role-filter" bind:value={roleFilter}>
          <option value="">All Roles</option>
          {#each ROLES as role}
            <option value={role}>{role}</option>
          {/each}
        </select>
        <span class="results-count">{filteredUsers.length} of {users?.length ?? 0} users</span>
      </div>

      {#if filteredUsers.length === 0}
        <div class="empty-state">
          <p>No users match your search.</p>
        </div>
      {:else}
        <div class="users-table-container">
          <table class="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredUsers as user}
                {@const uid = user.userId ?? ''}
                <tr>
                  <td>{user.name || '—'}</td>
                  <td>{user.email || '—'}</td>
                  <td>
                    {#if uid}
                      <select
                        class="role-select"
                        value={selectedRoles[uid] ?? user.role ?? ''}
                        onchange={(e) => { selectedRoles[uid] = (e.target as HTMLSelectElement).value; }}
                        disabled={savingUsers[uid]}
                      >
                        {#each ROLES as role}
                          <option value={role}>{role}</option>
                        {/each}
                      </select>
                    {:else}
                      <span class="role-badge">{user.role || 'No role'}</span>
                    {/if}
                  </td>
                  <td>
                    {#if !uid}
                      <span class="no-change">—</span>
                    {:else if savingUsers[uid]}
                      <span class="saving-indicator">Saving...</span>
                    {:else if hasChanged(uid, user.role || '')}
                      <button type="button" class="btn-save" onclick={() => saveRole(uid)}>
                        Save
                      </button>
                    {:else}
                      <span class="no-change">—</span>
                    {/if}
                    {#if uid && saveErrors[uid]}
                      <span class="save-error">{saveErrors[uid]}</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  .page {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  }
  .page-header {
    background: var(--card-bg);
    border-bottom: 2px solid var(--maroon);
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }
  .btn-back {
    padding: 0.5rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--maroon);
    background: transparent;
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }
  .btn-back:hover {
    background: var(--maroon);
    color: var(--card-bg);
  }
  .page-header h1 {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.75rem;
    color: var(--maroon);
  }
  .page-content {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .error-message {
    background: var(--maroon-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    color: var(--maroon);
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    min-width: 200px;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--text);
  }
  .search-input::placeholder {
    color: var(--text-muted);
  }
  .role-filter {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--text);
    cursor: pointer;
  }
  .results-count {
    font-size: 0.85rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-muted);
  }
  .users-table-container {
    flex: 1;
    overflow: auto;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    min-height: 0;
  }
  .users-table {
    width: 100%;
    border-collapse: collapse;
  }
  .users-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--maroon);
    color: var(--card-bg);
  }
  .users-table th {
    padding: 1rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--maroon);
  }
  .users-table td {
    padding: 0.875rem 1rem;
    border-top: 1px solid var(--border);
    color: var(--text);
  }
  .users-table tbody tr:hover {
    background: var(--bg-warm);
  }
  .role-select {
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--maroon);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .role-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-save {
    padding: 0.4rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .btn-save:hover {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
  }
  .saving-indicator {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
  }
  .no-change {
    color: var(--text-muted);
  }
  .save-error {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: var(--maroon);
  }
</style>
