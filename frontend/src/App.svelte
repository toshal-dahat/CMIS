<script>
  import { onMount } from 'svelte';
  import Register from './views/Register.svelte';
  import Login from './views/Login.svelte';
  import ForgotPassword from './views/ForgotPassword.svelte';
  import ResetPassword from './views/ResetPassword.svelte';
  import Handover from './views/Handover.svelte';
  import Profile from './views/Profile.svelte';
  import Claim from './views/Claim.svelte';

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

<main>
  <div class="container">
    <header class="page-header">
      <div class="header-title">
        <h1>CMIS Engagement Platform</h1>
        <p class="subtitle">Sign in to manage your profile, link your student record with your UIN, and access engagement features.</p>
      </div>
      <nav class="nav-links" aria-label="Main navigation">
      {#if accessToken}
        <button class="btn btn-secondary" on:click={() => setView('profile')}>Profile</button>
        <button class="btn btn-secondary" on:click={() => setView('handover')}>Graduation Handover</button>
        <button class="btn btn-secondary" on:click={onLogout}>Log out</button>
      {:else}
        <button class="btn btn-secondary" on:click={() => setView('login')}>Log in</button>
        <button class="btn btn-secondary" on:click={() => setView('register')}>Register</button>
      {/if}
      </nav>
    </header>

    {#if view === 'claim'}
      <Claim token={claimToken} onSuccess={onClaimSuccess} onCancel={onClaimCancel} />
    {:else if view === 'forgot-password'}
      <ForgotPassword
        onBackToLogin={() => setView('login')}
        onSentResetCode={(email) => { resetPasswordEmail = email; setView('reset-password'); }}
      />
    {:else if view === 'reset-password'}
      <ResetPassword
        emailPreFill={resetPasswordEmail}
        onDone={() => { resetPasswordEmail = ''; setView('login'); }}
        onBack={() => { resetPasswordEmail = ''; setView('login'); }}
      />
    {:else if view === 'register'}
      <Register onDone={onRegister} />
    {:else if view === 'login'}
      <Login
        onLogin={onLogin}
        onGoToClaim={(token) => { claimToken = token; view = 'claim'; }}
        onGoToRegister={() => setView('register')}
        onGoToForgotPassword={() => setView('forgot-password')}
      />
    {:else if view === 'profile'}
      <Profile {accessToken} {user} onLogout={onLogout} onGoToHandover={() => setView('handover')} />
    {:else if view === 'handover'}
      <Handover {accessToken} {user} onDone={onHandoverDone} onCancel={() => setView('profile')} />
    {/if}
  </div>
</main>

<style>
  .subtitle {
    color: var(--text-muted);
    margin-top: -0.5rem;
    margin-bottom: 1rem;
  }
</style>
