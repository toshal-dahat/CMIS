<script lang="ts">
  import EngagementAnalyticsCard from "./EngagementAnalyticsCard.svelte";
  import { currentView } from "./stores/viewStore";

  function goBack() {
    currentView.set("landing");
  }
</script>

<div class="page">
  <div class="inner">
    <button type="button" class="back-link" onclick={goBack}>
      <span class="back-arrow">←</span> Back to home
    </button>
    <h1>Student Engagement Analytics</h1>
    <p>Admin-only insights from student RSVPs and event check-ins.</p>
    <EngagementAnalyticsCard />
  </div>
</div>

<style>
  .page {
    width: 100%;
    min-height: 100vh;
    padding: 2rem 1.5rem 3.5rem;
    background: linear-gradient(
      180deg,
      var(--bg) 0%,
      var(--bg-warm) 50%,
      #f0ebe6 100%
    );
  }
  .inner {
    max-width: 1200px;
    margin: 0 auto;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 1rem;
    color: var(--maroon);
    font-weight: 600;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .back-arrow {
    font-size: 1.2rem;
  }
  h1 {
    margin: 0 0 0.25rem;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(1.9rem, 4vw, 2.5rem);
  }
  p {
    margin: 0 0 1rem;
    color: var(--text-muted);
  }
</style>
