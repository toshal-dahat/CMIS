<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView } from './stores/viewStore';
  import { getEventRootInfo, getEventHealth, type EventRootInfo, type EventHealth } from './events-api';

  let eventInfo: EventRootInfo | null = $state(null);
  let eventHealth: EventHealth | null = $state(null);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      // Fetch data from the newly integrated Live Events API
      const [info, health] = await Promise.all([
        getEventRootInfo(),
        getEventHealth()
      ]);
      eventInfo = info;
      eventHealth = health;
    } catch (e: any) {
      error = e.message || 'Failed to load live event data';
    } finally {
      loading = false;
    }
  });

  function goBack(e: MouseEvent) {
    e.preventDefault();
    currentView.set('landing');
  }
</script>

<div class="events-page">
  <div class="events-inner">
    <a href="#" class="back-link" onclick={goBack}>
      <span class="back-arrow">←</span>
      Back to home
    </a>

    <div class="dashboard-header">
      <h1 class="page-title">Events Dashboard</h1>
      <p class="page-subtitle">Live Connection to the AWS Event Backend</p>
    </div>

    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Connecting to Live Event Service...</p>
      </div>
    {:else if error}
      <div class="error-card">
        <h3>Connection Error</h3>
        <p>{error}</p>
        <p class="diagnostic">Please ensure the backend infrastructure has been deployed fully via the CI pipeline.</p>
      </div>
    {:else}
      <div class="data-grid">
        <!-- API Info Card -->
        <div class="data-card">
          <div class="card-header">
            <h3>Event Service Status</h3>
            <span class="status-badge {eventHealth?.status === 'healthy' ? 'healthy' : ''}">
              {eventHealth?.status ? eventHealth.status.toUpperCase() : 'UNKNOWN'}
            </span>
          </div>
          <div class="card-body">
            <p><strong>Message:</strong> {eventInfo?.message}</p>
            <p><strong>Service:</strong> {eventInfo?.service} (v{eventInfo?.version})</p>
            <div class="endpoint-list">
              <strong>Available Routes:</strong>
              <ul>
                {#if eventInfo?.endpoints}
                  {#each eventInfo.endpoints as endpoint}
                    <li><code>{endpoint}</code></li>
                  {/each}
                {/if}
              </ul>
            </div>
            <p class="timestamp">Last Synced: {new Date(eventHealth?.timestamp || '').toLocaleString()}</p>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .events-page {
    width: 100%;
    min-height: 100vh;
    padding: 2.5rem 1.5rem;
    font-family: var(--font-body);
    background: linear-gradient(160deg, var(--bg) 0%, var(--bg-warm) 40%, #ebe6e0 100%);
    color: var(--text);
  }

  .events-inner {
    max-width: 800px;
    margin: 0 auto;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 2.5rem;
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    transition: transform 0.2s ease;
  }

  .back-link:hover {
    transform: translateX(-4px);
  }

  .dashboard-header {
    margin-bottom: 2.5rem;
  }

  .page-title {
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(2rem, 4vw, 2.75rem);
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    letter-spacing: -0.02em;
  }

  .page-subtitle {
    color: var(--text-muted);
    font-size: 1.15rem;
    margin: 0;
  }

  .data-grid {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  }

  .data-card {
    background: var(--card-bg, #ffffff);
    border-radius: var(--radius-lg, 12px);
    padding: 1.75rem;
    box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.05));
    border: 1px solid var(--border, #e5e7eb);
    animation: slideUp 0.4s ease-out;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(15px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--border, #e5e7eb);
    padding-bottom: 1rem;
  }

  .card-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-family: var(--font-heading);
    color: var(--maroon, #500000);
  }

  .status-badge {
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    background: #f3f4f6;
    color: #4b5563;
    letter-spacing: 0.05em;
  }

  .status-badge.healthy {
    background: #def7ec;
    color: #03543f;
    box-shadow: 0 0 0 1px #84e1bc inset;
  }

  .card-body p {
    margin: 0.75rem 0;
    color: var(--text);
    font-size: 1.05rem;
    line-height: 1.5;
  }

  .card-body strong {
    color: var(--text-dark, #111827);
  }

  .endpoint-list {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--border, #e5e7eb);
  }

  .endpoint-list ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.5rem;
  }

  .endpoint-list li {
    margin-bottom: 0.25rem;
    color: var(--text);
  }

  .endpoint-list code {
    background: #f3f4f6;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .timestamp {
    margin-top: 1.5rem !important;
    font-size: 0.85rem !important;
    color: var(--text-muted) !important;
    font-style: italic;
  }

  .loading-state {
    text-align: center;
    padding: 5rem 0;
    color: var(--text-muted);
  }

  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem auto;
    border: 3px solid var(--border, #e5e7eb);
    border-top-color: var(--maroon, #500000);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-card {
    background: #fef2f2;
    border: 1px solid #f87171;
    padding: 1.75rem;
    border-radius: var(--radius-lg, 12px);
    color: #991b1b;
  }

  .error-card h3 {
    margin: 0 0 0.5rem 0;
    color: #b91c1c;
  }

  .diagnostic {
    font-size: 0.9rem;
    opacity: 0.8;
    margin-top: 0.5rem;
  }
</style>
