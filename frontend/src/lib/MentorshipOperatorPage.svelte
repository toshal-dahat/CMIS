<script lang="ts">
  import NavBar from './NavBar.svelte';
  import { currentView } from './stores/viewStore';
  import AdminMentorshipMatchingPanel from './admin/AdminMentorshipMatchingPanel.svelte';
</script>

<NavBar />

<div class="operator-container">
  <div class="operator-header">
    <button type="button" class="back-link" onclick={() => currentView.set('landing')}>
      <span class="back-arrow">←</span>
      Back to home
    </button>
    <h1>Mentorship Operator</h1>
    <p>Run mentorship matching, manage schedule settings, and review run history</p>
  </div>

  <AdminMentorshipMatchingPanel />
</div>

<style>
  .operator-container {
    min-height: 100vh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    position: relative;
  }

  .operator-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, var(--maroon-muted) 0%, transparent 70%);
    pointer-events: none;
  }

  .operator-header {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 7rem 1.5rem 1rem;
    text-align: center;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: transform 0.2s ease;
    font-size: 1rem;
    position: absolute;
    left: 1.5rem;
    top: 2rem;
  }

  .back-link:hover {
    transform: translateX(-4px);
  }

  .back-arrow {
    font-size: 1.2rem;
  }

  .operator-header h1 {
    font-family: var(--font-heading);
    font-size: clamp(2.1rem, 5vw, 3rem);
    font-weight: 700;
    color: var(--maroon);
    margin: 0 0 0.7rem;
    letter-spacing: -0.02em;
    line-height: 1.12;
  }

  .operator-header p {
    font-size: 1.1rem;
    line-height: 1.5;
    color: var(--text);
    margin: 0;
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .operator-header {
      padding: 3rem 1rem 0.8rem;
    }

    .operator-header h1 {
      font-size: 2rem;
    }
  }
</style>
