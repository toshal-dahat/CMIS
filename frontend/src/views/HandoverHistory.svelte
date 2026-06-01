<script>
  import { handoverHistory } from '../lib/api.js';
  import { onMount } from 'svelte';

  export let accessToken;
  export let onBack = () => {};

  let entries = [];
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      const data = await handoverHistory(accessToken);
      entries = data.entries || [];
    } catch (e) {
      error = e.message || 'Failed to load history';
    } finally {
      loading = false;
    }
  });
</script>

<div class="card">
  <h2>Handover History</h2>
  <p class="hint">Admin view of recent graduation handover log entries.</p>
  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <div class="alert alert-error">{error}</div>
  {:else if entries.length === 0}
    <p>No entries yet.</p>
  {:else}
    <table class="history-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Status</th>
          <th>User ID</th>
          <th>UIN</th>
          <th>Personal email</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as entry}
          <tr>
            <td>{entry.timestamp || '—'}</td>
            <td><span class="status status-{entry.status?.toLowerCase()}">{entry.status || '—'}</span></td>
            <td class="mono">{entry.user_id || '—'}</td>
            <td>{entry.uin || '—'}</td>
            <td>{entry.personal_email || '—'}</td>
            <td>{entry.reason || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <button class="btn btn-secondary" style="margin-top: 1rem;" on:click={onBack}>Back</button>
</div>

<style>
  .history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .history-table th,
  .history-table td {
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color, #ddd);
  }
  .history-table th {
    font-weight: 600;
    color: var(--text-muted, #666);
  }
  .mono {
    font-family: monospace;
    font-size: 0.85em;
  }
  .status {
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-weight: 500;
  }
  .status-success {
    background: #d4edda;
    color: #155724;
  }
  .status-failed {
    background: #f8d7da;
    color: #721c24;
  }
  .status-initiated {
    background: #fff3cd;
    color: #856404;
  }
</style>
