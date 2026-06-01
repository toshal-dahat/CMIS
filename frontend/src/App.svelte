<script lang="ts">
  import LandingPage from './lib/LandingPage.svelte';
  import ProfileForm from './lib/ProfileForm.svelte';
  import CollaborationPage from './lib/CollaborationPage.svelte';
  import StudentsConnect from './lib/StudentsConnect.svelte';
  import AdminPage from './lib/AdminPage.svelte';
  import RoleToggle from './lib/RoleToggle.svelte';
  import { currentView } from './lib/stores/viewStore';
  import { onMount } from 'svelte';

  const VALID_VIEWS = ['login', 'register', 'profile', 'handover', 'forgot-password', 'reset-password', 'claim'];
  let view = 'login';
  let claimToken = '';
  let resetPasswordEmail = '';

  let accessToken = localStorage.getItem('accessToken') || '';
  let user = null;

  function setView(v) {
    view = v;
    if (typeof window !== 'undefined' && VALID_VIEWS.includes(v) && v !== 'claim') {
      window.location.hash = v;
    }
  }

  function viewFromHash() {
    if (typeof window === 'undefined') return 'login';
    const hash = (window.location.hash || '').replace(/^#/, '').split('?')[0];
    if (VALID_VIEWS.includes(hash)) return hash;
    return accessToken ? 'profile' : 'login';
  }

  onMount(async () => {
    const hash = (window.location.hash || '') || '';
    const search = (window.location.search || '') || '';
    const params = new URLSearchParams(hash.slice(1).split('?')[1] || search.slice(1));
    const token = params.get('token');
    if (token && (hash.includes('claim') || search.includes('token='))) {
      claimToken = token;
      view = 'claim';
    } else {
      if (accessToken) {
        try {
          const { me } = await import('./lib/api.js');
          user = await me(accessToken);
        } catch (_) {
          accessToken = '';
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
      }
      const fromHash = viewFromHash();
      if (fromHash === 'profile' || fromHash === 'handover') {
        view = accessToken ? fromHash : 'login';
      } else {
        view = fromHash;
      }
      if (view !== 'claim' && VALID_VIEWS.includes(view)) {
        window.location.hash = view;
      }
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  });

  function handleHashChange() {
    if (claimToken) return;
    const fromHash = viewFromHash();
    if (fromHash === 'profile' || fromHash === 'handover') {
      view = accessToken ? fromHash : 'login';
    } else {
      view = fromHash;
    }
  }

  function onLogin(payload) {
    accessToken = payload.accessToken;
    user = payload.user;
    localStorage.setItem('accessToken', payload.accessToken);
    if (payload.refreshToken) localStorage.setItem('refreshToken', payload.refreshToken);
    view = 'profile';
  }

  function onRegister() {
    view = 'login';
  }

  function onLogout() {
    accessToken = '';
    user = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    view = 'login';
  }

  function onHandoverDone(updatedUser) {
    user = updatedUser;
    view = 'profile';
  }

  function onClaimSuccess() {
    claimToken = '';
    view = 'login';
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname || '/');
    }
  }

  function onClaimCancel() {
    claimToken = '';
    view = 'login';
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname || '/');
    }
  }
</script>

<style>
  .full-page-wrap {
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
  }
</style>

<RoleToggle />

{#if $currentView === 'admin'}
  <AdminPage />
{:else if $currentView === 'profile-form'}
  <ProfileForm />
{:else if $currentView === 'events'}
  <div class="full-page-wrap">
    <CollaborationPage title="Events" content="Collaborate with Team 12th Man" />
  </div>
{:else if $currentView === 'mentorship'}
  <div class="full-page-wrap">
    <CollaborationPage title="Mentorship" content="Collaborate with Team Gig 'Em" />
  </div>
{:else if $currentView === 'case-competitions'}
  <div class="full-page-wrap">
    <CollaborationPage title="Case Competitions" content="Collaborate with Team 12th Man" />
  </div>
{:else if $currentView === 'students-connect'}
  <div class="full-page-wrap">
    <StudentsConnect />
  </div>
{:else}
  <div class="landing-page">
    <LandingPage />
  </div>
{/if}
