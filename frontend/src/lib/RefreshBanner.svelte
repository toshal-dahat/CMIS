<script lang="ts">
  import { onMount } from 'svelte';
  import { getConfig } from '../admin-api/config';

  let show = $state(false);
  let dismissed = $state(false);

  onMount(async () => {
    try {
      await getConfig();
      // Config loaded — show the refresh banner so user can reload with fresh data
      show = true;
    } catch {
      // Silently fail — don't block the UI
    }
  });

  function handleRefresh() {
    window.location.reload();
  }

  function handleDismiss() {
    dismissed = true;
  }
</script>

{#if show && !dismissed}
  <div class="refresh-banner" role="status">
    <span class="banner-text">✅ Configuration loaded — refresh to apply the latest settings.</span>
    <div class="banner-actions">
      <button class="btn-refresh" onclick={handleRefresh}>🔄 Refresh</button>
      <button class="btn-dismiss" onclick={handleDismiss} aria-label="Dismiss">✕</button>
    </div>
  </div>
{/if}

<style>
  .refresh-banner {
    position: fixed;
    top: var(--header-height, 4rem);
    left: 0;
    right: 0;
    z-index: 999;
    background: #1a7f4b;
    color: white;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1.5rem;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    gap: 1rem;
  }

  .banner-text {
    flex: 1;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn-refresh {
    padding: 0.35rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: white;
    color: #1a7f4b;
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn-refresh:hover {
    opacity: 0.85;
  }

  .btn-dismiss {
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    background: transparent;
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-dismiss:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  @media (max-width: 600px) {
    .refresh-banner {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
  }
</style>
