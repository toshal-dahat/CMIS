<script>
  import { me } from '../lib/api.js';
  import { onMount } from 'svelte';

  export let accessToken;
  export let user;
  export let onLogout = () => {};
  export let onGoToHandover = () => {};

  let profile = user;
  let loading = true;
  let error = '';

  $: roleBadge = profile && (profile.role === 'FORMER_STUDENT'
    ? `Former Student${profile.classYear ? " '" + String(profile.classYear).slice(-2) : ''}` 
    : profile.role === 'PARTNER' 
      ? 'Recruiter' 
      : 'Community Member');

  onMount(async () => {
    if (!accessToken) {
      loading = false;
      if (user) {
        profile = user;
      } else {
        error = 'Not signed in';
      }
      return;
    }
    try {
      profile = await me(accessToken);
    } catch (e) {
      error = e.message;
      profile = null;
    } finally {
      loading = false;
    }
  });

  $: if (user && !profile && !loading) profile = user;
</script>

<div class="card">
  <h2>Your profile</h2>
  {#if loading}
    <p>Loading your profile…</p>
  {:else if error}
    <div class="alert alert-error">{error}</div>
    <button class="btn btn-secondary" on:click={onLogout}>Log out</button>
  {:else if profile}
    {#if roleBadge}
      <p class="role-badge">{roleBadge}</p>
    {/if}
    <p class="welcome-back">Welcome back{profile.email ? `, ${profile.email.split('@')[0]}` : ''}!</p>

    {#if !profile.linkedUin && onGoToHandover}
      <div class="link-banner">
        <p><strong>Link your student record</strong></p>
        <p class="hint">If you have a student UIN (9-digit ID), you can verify with it in Graduation Handover to connect this account to your student history.</p>
        <button type="button" class="btn btn-primary" on:click={onGoToHandover}>Verify with UIN</button>
      </div>
    {:else if profile.linkedUin}
      <div class="info-box success">
        <p>Your account is linked to student UIN <strong>{profile.linkedUin}</strong>. Your student history is connected to this profile.</p>
      </div>
    {/if}

    <section class="profile-section">
      <h3>Account information</h3>
      <dl class="profile-dl">
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        <dt>Role</dt>
        <dd>{profile.role} <span class="role-desc">({#if profile.role === 'PARTNER'}recruiter/partner{:else if profile.role === 'FORMER_STUDENT'}graduated student{:else}community member{/if})</span></dd>
        {#if profile.classYear}
          <dt>Class year</dt>
          <dd>{profile.classYear}</dd>
        {/if}
        {#if profile.linkedUin}
          <dt>Linked student UIN</dt>
          <dd>{profile.linkedUin}</dd>
        {/if}
      </dl>
      {#if !profile.linkedUin}
        <p class="hint">Go to <strong>Graduation Handover</strong> in the menu to link this account to your student record using your UIN.</p>
      {/if}
    </section>

    <button class="btn btn-secondary" style="margin-top: 1rem;" on:click={onLogout}>Log out</button>
  {/if}
</div>

<style>
  .role-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-dark));
    color: #fff;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 1rem;
    box-shadow: 0 2px 8px rgba(80, 0, 0, 0.3);
    animation: fadeInUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.1s backwards;
  }
  .welcome-back {
    font-size: 1.1rem;
    color: var(--primary-color);
    margin-bottom: 1rem;
  }
  .link-banner {
    padding: 1rem;
    background: linear-gradient(135deg, rgba(80, 0, 0, 0.08), rgba(80, 0, 0, 0.04));
    border: 2px solid var(--primary-color);
    border-radius: 8px;
    margin-bottom: 1.5rem;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }
  .link-banner:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(80, 0, 0, 0.12);
  }
  .link-banner .hint { margin: 0.25rem 0 0.75rem 0; }
  .profile-section h3 {
    font-size: 1rem;
    margin: 0 0 0.5rem 0;
    color: var(--text-muted, #666);
  }
  .profile-dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1.25rem;
    margin: 0;
  }
  .profile-dl dt { font-weight: 600; color: var(--text-muted, #555); }
  .profile-dl dd { margin: 0; }
  .role-desc {
    font-weight: normal;
    color: var(--text-muted, #666);
    font-size: 0.9rem;
  }
  .info-box.success {
    background: linear-gradient(135deg, rgba(10, 107, 10, 0.1), rgba(10, 107, 10, 0.06));
    border: 2px solid var(--success);
    margin-bottom: 1.25rem;
    animation: fadeIn 0.4s ease-out 0.2s backwards;
  }
</style>
