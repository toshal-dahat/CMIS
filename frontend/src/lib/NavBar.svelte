<script lang="ts">
  import { signOutUser } from './auth';
  import { authUser } from './stores/authStore';
  import { currentView } from './stores/viewStore';
  import ProfilePanel from './ProfilePanel.svelte';

  let showProfilePanel = $state(false);
  let showProfileDropdown = $state(false);
  let profileButtonRef = $state<HTMLDivElement | null>(null);

  function toggleProfileDropdown() {
    showProfileDropdown = !showProfileDropdown;
  }

  function openEditProfile() {
    showProfileDropdown = false;
    showProfilePanel = true;
  }

  async function handleSignOut() {
    showProfileDropdown = false;
    await signOutUser();
    authUser.set(null);
    currentView.set('landing');
  }

  $effect(() => {
    if (!showProfileDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (profileButtonRef && !profileButtonRef.contains(target)) {
        showProfileDropdown = false;
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });
</script>

<header class="header">
  <div class="header-inner">
    <a href="/" class="logo">
      <span class="logo-acronym">CMIS</span>
      <span class="logo-full">Council for the Management of Information Systems</span>
    </a>
    {#if $authUser}
      <div class="profile-dropdown-wrap" bind:this={profileButtonRef}>
        <button type="button" class="btn-profile-icon" onclick={toggleProfileDropdown} aria-label="View profile" aria-expanded={showProfileDropdown} aria-haspopup="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {#if showProfileDropdown}
          <div class="profile-dropdown" role="menu">
            <button type="button" class="dropdown-item" role="menuitem" onclick={openEditProfile}>
              Edit profile
            </button>
            <button type="button" class="dropdown-item dropdown-item-signout" role="menuitem" onclick={handleSignOut}>
              Sign out
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</header>

<ProfilePanel bind:open={showProfilePanel} />

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: 100;
    height: var(--header-height);
    background: var(--maroon);
    border-bottom: 3px solid var(--maroon-dark);
    box-shadow: var(--shadow-sm);
  }

  .header-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-decoration: none;
    color: var(--card-bg);
  }

  .logo:hover {
    text-decoration: none;
  }

  .logo-acronym {
    font-family: var(--font-heading);
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: var(--card-bg);
  }

  .logo-full {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .btn-profile-icon {
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--card-bg);
    border: 2px solid var(--card-bg);
    border-radius: 50%;
    cursor: pointer;
    color: var(--maroon);
    transition: background 0.2s, border-color 0.2s, transform 0.15s, color 0.2s;
  }

  .btn-profile-icon:hover {
    background: var(--maroon-dark);
    border-color: var(--card-bg);
    color: var(--card-bg);
    transform: scale(1.05);
  }

  .btn-profile-icon:active {
    transform: scale(0.98);
  }

  .btn-profile-icon:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .btn-profile-icon svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .profile-dropdown-wrap {
    position: relative;
  }

  .profile-dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 10rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 0.25rem;
    z-index: 150;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .dropdown-item {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
    background: transparent;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
    transition: background 0.15s, color 0.15s;
  }

  .dropdown-item:hover {
    background: var(--maroon-muted);
    color: var(--maroon);
  }

  .dropdown-item-signout {
    color: var(--text-muted);
  }

  .dropdown-item-signout:hover {
    color: var(--maroon);
  }
</style>
