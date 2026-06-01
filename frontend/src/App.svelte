<script lang="ts">
  import LandingPage from './lib/LandingPage.svelte';
  import ProfileForm from './lib/ProfileForm.svelte';
  import CollaborationPage from './lib/CollaborationPage.svelte';
  import StudentsConnect from './lib/StudentsConnect.svelte';
  import { currentView } from './lib/stores/viewStore';
</script>

<style>
  .full-page-wrap {
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
  }
</style>

{#if $currentView === 'profile-form'}
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
