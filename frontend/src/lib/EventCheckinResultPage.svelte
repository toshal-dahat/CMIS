<script lang="ts">
  import { currentView } from "./stores/viewStore";
  import { eventCheckinResult } from "./stores/eventCheckinResultStore";

  function goToLanding() {
    eventCheckinResult.set(null);
    currentView.set("landing");
  }

  const successMark = "✓";
  const failMark = "✕";
</script>

<div class="result-page">
  <div class="result-card">
    {#if $eventCheckinResult}
      {@const ok = $eventCheckinResult.status === "success"}
      <div class="badge {ok ? 'ok' : 'bad'}" aria-hidden="true">
        {ok ? successMark : failMark}
      </div>
      <h1>{$eventCheckinResult.title}</h1>
      <p class="message">{$eventCheckinResult.message}</p>
      {#if $eventCheckinResult.eventId}
        <p class="event-id">Event ID: <code>{$eventCheckinResult.eventId}</code></p>
      {/if}
      <button type="button" class="btn-primary" onclick={goToLanding}>
        Continue
      </button>
    {:else}
      <h1>No check-in result</h1>
      <p class="message">Open this page by scanning an event QR code.</p>
      <button type="button" class="btn-primary" onclick={goToLanding}>
        Back to Home
      </button>
    {/if}
  </div>
</div>

<style>
  .result-page {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
  }

  .result-card {
    width: min(560px, 100%);
    background: var(--card-bg, #fff);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.5rem 1.25rem;
    text-align: center;
    box-shadow: var(--shadow-lg, 0 10px 32px rgba(0, 0, 0, 0.08));
  }

  .badge {
    width: 84px;
    height: 84px;
    border-radius: 999px;
    margin: 0 auto 0.9rem;
    display: grid;
    place-items: center;
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1;
  }

  .badge.ok {
    background: #e9f8ef;
    color: #136733;
    border: 2px solid #4ade80;
  }

  .badge.bad {
    background: #fdecec;
    color: #9f1d1d;
    border: 2px solid #f87171;
  }

  h1 {
    margin: 0;
    color: var(--text, #111);
    font-size: 1.5rem;
  }

  .message {
    margin: 0.65rem 0 0;
    color: var(--text-muted, #555);
    font-size: 1.02rem;
  }

  .event-id {
    margin: 0.85rem 0 0;
    color: var(--text-muted, #666);
    font-size: 0.9rem;
  }

  .btn-primary {
    margin-top: 1.2rem;
    border: none;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    min-width: 180px;
    font-weight: 700;
    color: #fff;
    background: var(--maroon);
    cursor: pointer;
  }
</style>
