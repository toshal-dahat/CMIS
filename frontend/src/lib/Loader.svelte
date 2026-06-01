<script>
  import { onDestroy } from 'svelte';

  export let show = false;
  export let title = 'Applying Changes';
  export let stepMsg = '';
  export let waitSeconds = 2;

  let countdown = 0;
  let countdownInterval = null;

  onDestroy(() => {
    if (countdownInterval) clearInterval(countdownInterval);
  });

  // Called by parent after the API call succeeds to start the countdown
  export function startCountdown() {
    countdown = waitSeconds;
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }, 1000);
  }

  $: progressWidth = countdown > 0 ? ((waitSeconds - countdown) / waitSeconds) * 100 : 100;
</script>

{#if show}
  <div class="overlay">
    <div class="card">
      <div class="spinner"></div>
      <p class="title">{title}</p>
      <p class="step">{stepMsg}</p>

      {#if countdown > 0}
        <div class="countdown-block">
          <span class="countdown-number">{countdown}s</span>
          <span class="countdown-label">remaining</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: {progressWidth}%"></div>
        </div>
      {/if}

      <p class="note">
        <slot name="note">
          Changes propagate in a few seconds.
        </slot>
      </p>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 2.5rem 3rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 380px;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--border);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
    margin-bottom: 0.25rem;
  }

  .title {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .step {
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 500;
    margin: 0;
    min-height: 1.2em;
  }

  .countdown-block {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    margin: 0.25rem 0;
  }

  .countdown-number {
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--primary-color);
    font-family: 'Space Mono', monospace;
    line-height: 1;
  }

  .countdown-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .progress-track {
    width: 100%;
    height: 6px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color);
    border-radius: 999px;
    transition: width 1s linear;
  }

  .note {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin: 0.25rem 0 0;
    line-height: 1.5;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>