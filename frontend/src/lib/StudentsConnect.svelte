<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView } from './stores/viewStore';
  import { listProfilesByRole } from './api';
  import { DEGREE_OPTIONS, MAJOR_OPTIONS } from './profileOptions';
  import type { ListProfilesResult } from './types';

  let nameFilter = $state('');
  let majorFilter = $state('');
  let degreeFilter = $state('');
  let allProfiles = $state<NonNullable<ListProfilesResult['profiles']>>([]);
  let loading = $state(true);
  let error = $state('');

  const filteredProfiles = $derived(
    (() => {
      let list = allProfiles;
      const name = nameFilter.trim().toLowerCase();
      if (name) {
        list = list.filter((p) => (p.name ?? '').toLowerCase().includes(name));
      }
      if (majorFilter) {
        list = list.filter((p) => (p.major ?? '') === majorFilter);
      }
      if (degreeFilter) {
        list = list.filter((p) => (p.degree ?? '') === degreeFilter);
      }
      return list;
    })()
  );

  function goBack(e: MouseEvent) {
    e.preventDefault();
    currentView.set('landing');
  }

  async function load() {
    loading = true;
    error = '';
    const result = await listProfilesByRole('STUDENT');
    loading = false;
    if (result.ok) {
      allProfiles = result.profiles ?? [];
    } else {
      error = result.error ?? 'Failed to load students';
      allProfiles = [];
    }
  }

  function formatGradDate(gradDate: string | undefined): string {
    if (!gradDate || typeof gradDate !== 'string') return '—';
    const [y, m] = gradDate.split('-');
    if (y && m) return `${y}`;
    return gradDate;
  }

  onMount(() => {
    load();
  });
</script>

<div class="students-page">
  <div class="students-inner">
    <a href="#" class="back-link" onclick={goBack}>
      <span class="back-arrow" aria-hidden="true">←</span>
      Back to home
    </a>

    <header class="page-header">
      <div class="header-badge" aria-hidden="true">Connect</div>
      <h1 class="page-title">Students Connect</h1>
      <p class="page-subtitle">Browse CMIS students, filter by name, major, or degree, and connect via LinkedIn.</p>
    </header>

    <section class="filters-section" aria-label="Filter students">
      <h2 class="filters-heading">Filters</h2>
      <div class="filters">
        <div class="filter-group">
          <label for="filter-name" class="filter-label">Name</label>
          <input
            id="filter-name"
            type="search"
            class="filter-input"
            placeholder="Search by name…"
            bind:value={nameFilter}
            aria-label="Search by name"
          />
        </div>
        <div class="filter-group">
          <label for="filter-major" class="filter-label">Major</label>
          <select id="filter-major" class="filter-select" bind:value={majorFilter} aria-label="Filter by major">
            {#each MAJOR_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-degree" class="filter-label">Degree</label>
          <select id="filter-degree" class="filter-select" bind:value={degreeFilter} aria-label="Filter by degree">
            {#each DEGREE_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
      </div>
    </section>

    {#if error}
      <div class="error-banner" role="alert">
        <span class="error-icon" aria-hidden="true">!</span>
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="loading-state">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p class="loading-text">Loading students…</p>
      </div>
    {:else if filteredProfiles.length === 0}
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">👥</div>
        <p class="empty-title">No students found</p>
        <p class="empty-text">Try adjusting your filters or clear them to see everyone.</p>
      </div>
    {:else}
      <div class="results-bar">
        <span class="results-count">Showing {filteredProfiles.length} {filteredProfiles.length === 1 ? 'student' : 'students'}</span>
      </div>
      <div class="cards-grid">
        {#each filteredProfiles as student, i}
          <article class="student-card" style="animation-delay: {Math.min(i * 0.05, 0.4)}s">
            <div class="card-accent" aria-hidden="true"></div>
            <div class="card-avatar" aria-hidden="true">{(student.name ?? '?').charAt(0).toUpperCase()}</div>
            <h3 class="card-name">{student.name ?? '—'}</h3>
            <dl class="card-details">
              {#if student.email}
                <div class="detail">
                  <dt>Email</dt>
                  <dd><a href="mailto:{student.email}" class="card-email">{student.email}</a></dd>
                </div>
              {/if}
              <div class="detail">
                <dt>Degree</dt>
                <dd>{student.degree ?? '—'}</dd>
              </div>
              <div class="detail">
                <dt>Major</dt>
                <dd>{student.major ?? '—'}</dd>
              </div>
              <div class="detail">
                <dt>Graduation</dt>
                <dd>{formatGradDate(student.gradDate)}</dd>
              </div>
            </dl>
            {#if student.linkedInUrl ?? student.linkedinUrl}
              {@const linkedIn = student.linkedInUrl ?? student.linkedinUrl ?? ''}
              <a
                href={linkedIn.startsWith('http') ? linkedIn : `https://${linkedIn}`}
                target="_blank"
                rel="noopener noreferrer"
                class="card-linkedin"
              >
                <span class="linkedin-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </span>
                View LinkedIn
                <span class="link-arrow" aria-hidden="true">→</span>
              </a>
            {:else}
              <span class="card-no-linkedin">No LinkedIn</span>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .students-page {
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    padding: 2rem 1.5rem 3.5rem;
    font-family: var(--font-body);
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 50%, #f0ebe6 100%);
    color: var(--text);
    position: relative;
  }

  .students-page::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    background: radial-gradient(ellipse 85% 55% at 50% -10%, var(--maroon-muted) 0%, transparent 65%);
    pointer-events: none;
  }

  .students-inner {
    position: relative;
    max-width: 1100px;
    margin: 0 auto;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 2rem;
    font-size: 0.9rem;
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    letter-spacing: 0.02em;
    transition: color 0.2s, transform 0.2s;
  }

  .back-link:hover {
    color: var(--maroon-dark);
    transform: translateX(-4px);
    text-decoration: none;
  }

  .back-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .page-header {
    margin-bottom: 2.25rem;
  }

  .header-badge {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--gold);
    margin-bottom: 0.5rem;
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: clamp(2rem, 4.5vw, 2.5rem);
    font-weight: 700;
    color: var(--maroon);
    margin: 0 0 0.6rem;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .page-subtitle {
    font-size: 1.05rem;
    line-height: 1.55;
    color: var(--text-muted);
    margin: 0;
    max-width: 36em;
  }

  .filters-section {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.5rem 1.75rem;
    margin-bottom: 2rem;
    box-shadow: var(--shadow-sm);
  }

  .filters-heading {
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 1.25rem;
    letter-spacing: -0.01em;
  }

  .filters {
    display: grid;
    grid-template-columns: 1fr minmax(180px, auto) minmax(120px, auto);
    gap: 1rem 1.25rem;
    align-items: end;
  }

  @media (max-width: 700px) {
    .filters {
      grid-template-columns: 1fr;
    }
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .filter-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .filter-input,
  .filter-select {
    padding: 0.6rem 0.85rem;
    font-size: 0.95rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .filter-input::placeholder {
    color: var(--text-muted);
  }

  .filter-input:focus,
  .filter-select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px var(--maroon-muted);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.25rem;
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
    border-radius: var(--radius-lg);
    margin: 0 0 1.5rem;
    font-size: 0.95rem;
  }

  .error-icon {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fecaca;
    color: #991b1b;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    gap: 1.25rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    margin: 0;
    font-size: 1rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    background: var(--card-bg);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.7;
  }

  .empty-title {
    margin: 0 0 0.35rem;
    font-family: var(--font-heading);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }

  .empty-text {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  .results-bar {
    margin-bottom: 1.5rem;
  }

  .results-count {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
  }

  .student-card {
    position: relative;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.75rem;
    overflow: hidden;
    transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s ease;
    animation: cardFadeIn 0.4s ease backwards;
  }

  .student-card:hover {
    box-shadow: var(--shadow-lg);
    border-color: var(--maroon-light);
    transform: translateY(-2px);
  }

  @keyframes cardFadeIn {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-accent {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--maroon) 0%, var(--gold) 100%);
  }

  .card-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--maroon-muted) 0%, var(--gold-light) 100%);
    color: var(--maroon);
    font-family: var(--font-heading);
    font-size: 1.35rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.25rem;
    margin-bottom: 1rem;
  }

  .card-name {
    font-family: var(--font-heading);
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 1rem;
    line-height: 1.25;
  }

  .card-details {
    margin: 0 0 1.25rem;
    display: grid;
    gap: 0.5rem;
  }

  .detail {
    display: flex;
    gap: 0.5rem;
    font-size: 0.9rem;
    align-items: baseline;
  }

  .detail dt {
    margin: 0;
    font-weight: 600;
    color: var(--text-muted);
    min-width: 5.5rem;
    font-size: 0.85rem;
  }

  .detail dd {
    margin: 0;
    color: var(--text);
  }

  .card-email {
    color: var(--maroon);
    text-decoration: none;
    word-break: break-all;
  }

  .card-email:hover {
    text-decoration: underline;
  }

  .card-linkedin {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--maroon);
    text-decoration: none;
    padding: 0.5rem 0.75rem;
    margin-left: -0.75rem;
    border-radius: var(--radius);
    transition: color 0.2s, background 0.2s, gap 0.2s;
  }

  .card-linkedin:hover {
    color: var(--maroon-dark);
    background: var(--maroon-muted);
    gap: 0.6rem;
  }

  .card-linkedin:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .linkedin-icon {
    display: inline-flex;
    color: currentColor;
  }

  .link-arrow {
    font-size: 1.05em;
    opacity: 0.9;
  }

  .card-no-linkedin {
    font-size: 0.9rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
