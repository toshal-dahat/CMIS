<script lang="ts">
  import { onMount } from 'svelte';
  import { listProfiles } from './api';
  import { currentView } from './stores/viewStore';
  import Loader from './Loader.svelte';
  import type { ListProfilesResult } from './types';

  let loading = $state(true);
  let error = $state('');
  let users = $state<ListProfilesResult['profiles']>([]);

  onMount(async () => {
    loading = true;
    error = '';
    const result = await listProfiles();
    if (result.ok && result.profiles) {
      users = result.profiles;
    } else {
      error = result.error || 'Failed to load users';
    }
    loading = false;
  });

  function goBack() {
    currentView.set('landing');
  }

  async function updateRole(uin: string, currentRole: string) {
    // TODO: Implement API call to update role
    console.log('Update role for UIN:', uin, 'Current role:', currentRole);
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
            {#each users || [] as user}
              <tr>
                <td>{user.name || '—'}</td>
                <td>{user.email || '—'}</td>
                <td>
                  <span class="role-badge">{user.role || 'No role'}</span>
                </td>
                <td>
                  <button type="button" class="btn-update" onclick={() => updateRole(user.uin || '', user.role || '')}>
                    Update Role
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </main>
</div>

<style>
  .page {
    min-height: 100vh;
    background: var(--bg);
  }
  .page-header {
    background: var(--card-bg);
    border-bottom: 2px solid var(--maroon);
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
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
  }
  .error-message {
    background: #fee;
    border: 1px solid #fcc;
    border-radius: var(--radius);
    padding: 1rem;
    color: #c33;
  }
  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-muted);
  }
  .users-table-container {
    overflow-x: auto;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }
  .users-table {
    width: 100%;
    border-collapse: collapse;
  }
  .users-table thead {
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
  }
  .users-table td {
    padding: 0.875rem 1rem;
    border-top: 1px solid var(--border);
    color: var(--text);
  }
  .users-table tbody tr:hover {
    background: var(--bg-warm);
  }
  .role-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: var(--maroon-muted);
    color: var(--maroon);
    border-radius: var(--radius);
    font-size: 0.85rem;
    font-weight: 500;
  }
  .btn-update {
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 1px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .btn-update:hover {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
  }
</style>
