<script lang="ts">
  import { currentRole } from './stores/roleStore';
  import { currentView } from './stores/viewStore';
  
  function toggleRole() {
    if ($currentRole === 'student') {
      currentRole.set('admin');
      currentView.set('admin');
    } else {
      currentRole.set('student');
      currentView.set('landing');
    }
  }
</script>

<style>
  .toggle-container {
    position: fixed;
    top: calc(var(--header-height) + 1rem);
    right: 20px;
    z-index: 1000;
  }
  
  .toggle-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: white;
    border: 2px solid #500000;
    border-radius: 25px;
    cursor: pointer;
    font-weight: 600;
    color: #500000;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }
  
  .toggle-button:hover {
    background: #500000;
    color: white;
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }
  
  .toggle-icon {
    font-size: 1.2rem;
  }
  
  .role-label {
    font-size: 0.9rem;
  }
  
  @media (max-width: 768px) {
    .toggle-container {
      top: 10px;
      right: 10px;
    }
    
    .toggle-button {
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
    }
    
    .role-label {
      display: none;
    }
  }
</style>

<div class="toggle-container">
  <button class="toggle-button" on:click={toggleRole}>
    <span class="toggle-icon">
      {#if $currentRole === 'student'}
        👤
      {:else}
        🔧
      {/if}
    </span>
    <span class="role-label">
      Switch to {$currentRole === 'student' ? 'Admin' : 'Student'}
    </span>
  </button>
</div>
