<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView } from './stores/viewStore';
  import NavBar from './NavBar.svelte';
  import type { Company, Tier } from './types';
  import type { NormalizedTheme } from '../admin-api/theme';
  import CacheLoader from '../lib/Loader.svelte';
  import { getConfig } from '../admin-api/config';
  import { getCompanies, createCompany, updateCompany, deleteCompany } from '../admin-api/companies';
  import { getTiers, createTier, updateTier, deleteTier } from '../admin-api/tiers';
  import { updateTheme } from '../admin-api/theme';

  // ── Data ──────────────────────────────────────────────────────────────────
  let companies: Company[] = [];
  let tiers: Tier[] = [];
  let theme: NormalizedTheme | null = null;

  // ── UI state ──────────────────────────────────────────────────────────────
  let loading = true;
  let error: string | null = null;

  // CacheLoader
  let cacheLoading = false;
  let cacheMsg = '';

  // Theme saved notice dialog
  let showThemeNotice = false;

  // Inline edit/add state
  let editingCompanyId: string | null = null;
  let editingTierId: string | null = null;
  let showNewCompanyForm = false;
  let showNewTierForm = false;
  let editingTheme = false;

  // Form values
  let companyForm = { companyId: '', name: '', domain: '', tierId: '' };
  let tierForm = { tierId: '', name: '', rank: 1, earlyAccessHours: 0 };
  let themeForm = { primaryColor: '#500000', secondaryColor: '#FFFFFF', logoUrl: '' };

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Look up tier name from tierId for display in company badge
  function getTierName(tierId: string): string {
    return tiers.find(t => t.tierId === tierId)?.name ?? tierId;
  }

  // ── Load on mount ─────────────────────────────────────────────────────────
  onMount(async () => {
    await loadAll();
  });

  async function loadAll() {
    try {
      loading = true;
      error = null;
      const [companiesData, tiersData, config] = await Promise.all([
        getCompanies(),
        getTiers(),
        getConfig()
      ]);
      companies = companiesData;
      tiers = tiersData;
      theme = config.theme;
    } catch (err: any) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  // ── Company handlers ──────────────────────────────────────────────────────
  function handleAddCompany() {
    companyForm = { companyId: '', name: '', domain: '', tierId: tiers[0]?.tierId ?? '' };
    showNewCompanyForm = true;
  }

  function handleEditCompany(company: Company) {
    companyForm = { companyId: company.companyId, name: company.name, domain: company.domain, tierId: company.tierId };
    editingCompanyId = company.companyId;
  }

  async function handleSaveCompany() {
    cacheLoading = true;
    cacheMsg = editingCompanyId ? 'Updating company...' : 'Creating company...';
    error = null;
    try {
      if (editingCompanyId) {
        await updateCompany(editingCompanyId, companyForm);
        editingCompanyId = null;
      } else {
        await createCompany(companyForm);
        showNewCompanyForm = false;
      }
      // Companies API doesn't go through config cache — reload directly
      companies = await getCompanies();
      cacheLoading = false;
      cacheMsg = '';
    } catch (err: any) {
      cacheLoading = false;
      cacheMsg = '';
      error = err.message;
    }
  }

  async function handleDeleteCompany(company: Company) {
    if (!confirm(`Are you sure you want to delete ${company.name}?`)) return;
    cacheLoading = true;
    cacheMsg = 'Deleting company...';
    error = null;
    try {
      await deleteCompany(company.companyId);
      // Companies API doesn't go through config cache — reload directly
      companies = await getCompanies();
      cacheLoading = false;
      cacheMsg = '';
    } catch (err: any) {
      cacheLoading = false;
      cacheMsg = '';
      error = err.message;
    }
  }

  // ── Tier handlers ─────────────────────────────────────────────────────────
  function handleAddTier() {
    tierForm = { tierId: '', name: '', rank: 1, earlyAccessHours: 0 };
    showNewTierForm = true;
  }

  function handleEditTier(tier: Tier) {
    tierForm = { tierId: tier.tierId, name: tier.name, rank: tier.rank, earlyAccessHours: tier.earlyAccessHours };
    editingTierId = tier.tierId;
  }

  async function handleSaveTier() {
    cacheLoading = true;
    cacheMsg = editingTierId ? 'Updating tier...' : 'Creating tier...';
    error = null;
    try {
      if (editingTierId) {
        await updateTier(editingTierId, tierForm);
        editingTierId = null;
      } else {
        await createTier(tierForm);
        showNewTierForm = false;
      }
      // Reload tiers directly (no cache wait needed)
      tiers = await getTiers();
      cacheLoading = false;
      cacheMsg = '';
    } catch (err: any) {
      cacheLoading = false;
      cacheMsg = '';
      error = err.message;
    }
  }

  async function handleDeleteTier(tier: Tier) {
    if (!confirm(`Are you sure you want to delete the ${tier.name} tier?`)) return;
    cacheLoading = true;
    cacheMsg = 'Deleting tier...';
    error = null;
    try {
      await deleteTier(tier.tierId);
      // Reload tiers directly (no cache wait needed)
      tiers = await getTiers();
      cacheLoading = false;
      cacheMsg = '';
    } catch (err: any) {
      cacheLoading = false;
      cacheMsg = '';
      error = err.message;
    }
  }

  // ── Theme handlers ────────────────────────────────────────────────────────
  function handleEditTheme() {
    if (!theme) return;
    themeForm = { primaryColor: theme.primaryColor, secondaryColor: theme.secondaryColor, logoUrl: theme.logoUrl };
    editingTheme = true;
  }

  async function handleSaveTheme() {
    cacheLoading = true;
    cacheMsg = 'Saving theme...';
    error = null;
    try {
      await updateTheme(themeForm);
      editingTheme = false;
      cacheLoading = false;
      cacheMsg = '';
      showThemeNotice = true;
    } catch (err: any) {
      cacheLoading = false;
      cacheMsg = '';
      error = err.message;
    }
  }

  function cancelEdit() {
    editingCompanyId = null;
    editingTierId = null;
    editingTheme = false;
    showNewCompanyForm = false;
    showNewTierForm = false;
  }
</script>

<style>
  .admin-container {
    min-height: 100vh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    position: relative;
  }
  
  .admin-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, var(--maroon-muted) 0%, transparent 70%);
    pointer-events: none;
  }
  
  .admin-header {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 7rem 1.5rem 2rem;
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
  
  .admin-header h1 {
    font-family: var(--font-heading);
    font-size: clamp(2.25rem, 5vw, 3.25rem);
    font-weight: 700;
    color: var(--maroon);
    margin: 0 0 0.85rem;
    letter-spacing: -0.02em;
    line-height: 1.12;
  }
  
  .admin-header p {
    font-size: 1.2rem;
    line-height: 1.6;
    color: var(--text);
    margin: 0;
    font-weight: 500;
  }
  
  .section {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  
  .section-title {
    font-family: var(--font-heading);
    font-size: 1.65rem;
    font-weight: 600;
    color: var(--text);
    text-align: center;
    margin: 0 0 2.25rem;
    letter-spacing: -0.01em;
  }
  
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.75rem;
  }
  
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 2rem 1.75rem;
    text-align: center;
    transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s ease;
    position: relative;
    overflow: hidden;
  }
  
  .card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--maroon), var(--gold));
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  
  .card:hover {
    box-shadow: var(--shadow-lg);
    border-color: var(--maroon-light);
    transform: translateY(-2px);
  }
  
  .card:hover::before {
    opacity: 1;
  }
  
  .card-icon {
    font-size: 2.5rem;
    margin-bottom: 0.85rem;
    line-height: 1;
  }
  
  .card-title {
    font-family: var(--font-heading);
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 0.5rem;
  }
  
  .card-badge {
    display: inline-block;
    padding: 0.35rem 0.85rem;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 600;
    background: var(--gold-light);
    color: var(--maroon);
    margin-bottom: 1rem;
  }
  
  .card-content {
    margin-top: 1rem;
  }
  
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  
  .card-row:last-child {
    border-bottom: none;
  }
  
  .card-label {
    font-weight: 500;
    color: var(--text-muted);
    text-align: left;
  }
  
  .card-value {
    color: var(--text);
    font-weight: 500;
    text-align: right;
  }
  
  .color-preview {
    display: inline-block;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 2px solid var(--border);
    vertical-align: middle;
    margin-left: 0.5rem;
  }
  
  .theme-card .card-content {
    text-align: left;
  }
  
  .theme-card .card-value {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2.25rem;
  }
  
  .section-header .section-title {
    margin: 0;
  }
  
  .btn-add {
    padding: 0.65rem 1.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.15s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .btn-add:hover {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
    box-shadow: var(--shadow);
    transform: translateY(-1px);
  }
  
  .btn-add:active {
    transform: translateY(0);
  }
  
  .btn-add:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  
  .card-actions {
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 0.75rem;
  }
  
  .btn-edit {
    flex: 1;
    padding: 0.6rem 1.2rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--maroon);
    background: var(--card-bg);
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, color 0.2s, transform 0.15s;
  }
  
  .btn-edit:hover {
    background: var(--maroon);
    color: var(--card-bg);
    transform: translateY(-1px);
  }
  
  .btn-edit:active {
    transform: translateY(0);
  }
  
  .btn-edit:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  
  .btn-delete {
    flex: 1;
    padding: 0.6rem 1.2rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #dc2626;
    background: var(--card-bg);
    border: 2px solid #dc2626;
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, color 0.2s, transform 0.15s;
  }
  
  .btn-delete:hover {
    background: #dc2626;
    color: var(--card-bg);
    transform: translateY(-1px);
  }
  
  .btn-delete:active {
    transform: translateY(0);
  }
  
  .btn-delete:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .inline-form {
    text-align: left;
    margin-bottom: 1.5rem;
    padding: 1.5rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .inline-form h3 {
    font-family: var(--font-heading);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 1rem;
  }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-bottom: 1rem;
  }

  .form-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .form-grid input[type="text"],
  .form-grid input[type="number"],
  .form-grid select {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.9rem;
    background: var(--card-bg);
    color: var(--text);
    box-sizing: border-box;
  }

  .form-grid input:focus,
  .form-grid select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px var(--maroon-muted);
  }

  .color-input-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-input-row input[type="color"] {
    width: 40px;
    height: 38px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    flex-shrink: 0;
  }

  .color-input-row input[type="text"] {
    flex: 1;
  }

  .form-actions {
    display: flex;
    gap: 0.75rem;
  }

  .error-banner {
    max-width: 1200px;
    margin: 0 auto 0;
    padding: 0 1.5rem;
  }

  .error-message {
    background: #dc2626;
    color: white;
    padding: 1rem;
    border-radius: var(--radius);
  }

  .loading {
    text-align: center;
    padding: 4rem;
    color: var(--text-muted);
  }
  
  .notice-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .notice-dialog {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    padding: 2rem;
    max-width: 420px;
    width: 100%;
    box-shadow: var(--shadow-lg);
    text-align: center;
  }

  .notice-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  .notice-title {
    font-family: var(--font-heading);
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--maroon);
    margin: 0 0 0.75rem;
  }

  .notice-body {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0 0 1.5rem;
  }

  .btn-ok {
    padding: 0.65rem 2rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--card-bg);
    background: var(--maroon);
    border: 2px solid var(--maroon);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
  }

  .btn-ok:hover {
    background: var(--maroon-dark);
    transform: translateY(-1px);
  }

  .btn-ok:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  @media (max-width: 768px) {
    .admin-header {
      padding: 3rem 1.5rem 1.5rem;
    }
    
    .admin-header h1 {
      font-size: 2rem;
    }
    
    .section {
      padding: 1.5rem 1.5rem;
    }
    
    .cards-grid {
      grid-template-columns: 1fr;
    }
    
    .section-header {
      flex-direction: column;
      gap: 1rem;
      align-items: stretch;
    }
    
    .btn-add {
      width: 100%;
      justify-content: center;
    }
  }
</style>

<!-- Theme saved notice dialog -->
{#if showThemeNotice}
  <div class="notice-overlay" role="dialog" aria-modal="true">
    <div class="notice-dialog">
      <div class="notice-icon">🎨</div>
      <h2 class="notice-title">Theme Saved</h2>
      <p class="notice-body">
        Theme saved successfully. It may take a few minutes for the updated theme to appear across the platform. Please refresh the page after some time to see the changes.
      </p>
      <button class="btn-ok" onclick={() => showThemeNotice = false}>OK</button>
    </div>
  </div>
{/if}

<!-- Shared CacheLoader for all operations -->
<CacheLoader
  show={cacheLoading}
  title="Updating Configuration"
  stepMsg={cacheMsg}
>
  <svelte:fragment slot="note">
    Applying changes...
  </svelte:fragment>
</CacheLoader>

<NavBar />

<div class="admin-container">
  <div class="admin-header">
    <button type="button" class="back-link" onclick={() => currentView.set('landing')}>
      <span class="back-arrow">←</span>
      Back to home
    </button>
    <h1>Admin Dashboard</h1>
    <p>Manage companies, tiers, and themes</p>
  </div>

  {#if error}
    <div class="error-banner">
      <div class="error-message"><strong>Error:</strong> {error}</div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading dashboard...</div>
  {:else}
    <!-- ── Companies ── -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Companies</h2>
        <button class="btn-add" onclick={handleAddCompany}>
          <span>➕</span>
          <span>Add Company</span>
        </button>
      </div>

      {#if showNewCompanyForm}
        <div class="inline-form">
          <h3>New Company</h3>
          <div class="form-grid">
            <label>Name
              <input type="text" bind:value={companyForm.name} placeholder="e.g. Microsoft" />
            </label>
            <label>Domain
              <input type="text" bind:value={companyForm.domain} placeholder="microsoft.com" />
            </label>
            <label>Tier
              <select bind:value={companyForm.tierId}>
                {#each tiers as t}
                  <option value={t.tierId}>{t.name}</option>
                {/each}
              </select>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn-add" onclick={handleSaveCompany}>Create Company</button>
            <button class="btn-edit" onclick={cancelEdit}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="cards-grid">
        {#each companies as company (company.companyId)}
          <div class="card">
            <div class="card-icon">🏢</div>

            {#if editingCompanyId === company.companyId}
              <div class="inline-form">
                <div class="form-grid">
                  <label>Name
                    <input type="text" bind:value={companyForm.name} />
                  </label>
                  <label>Domain
                    <input type="text" bind:value={companyForm.domain} />
                  </label>
                  <label>Tier
                    <select bind:value={companyForm.tierId}>
                      {#each tiers as t}
                        <option value={t.tierId}>{t.name}</option>
                      {/each}
                    </select>
                  </label>
                </div>
                <div class="form-actions">
                  <button class="btn-add" onclick={handleSaveCompany}>Save</button>
                  <button class="btn-edit" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="card-title">{company.name}</div>
              <!-- Show resolved tier name instead of raw tierId -->
              <div class="card-badge">{getTierName(company.tierId)}</div>
              <div class="card-content">
                <div class="card-row">
                  <span class="card-label">Domain</span>
                  <span class="card-value">{company.domain}</span>
                </div>
                <div class="card-row">
                  <span class="card-label">Tier</span>
                  <span class="card-value">{company.tierId}</span>
                </div>
                <div class="card-row">
                  <span class="card-label">Early Access</span>
                  <span class="card-value">
                    {tiers.find(t => t.tierId === company.tierId)?.earlyAccessHours ?? '—'}h
                  </span>
                </div>
              </div>
              <div class="card-actions">
                <button class="btn-edit" onclick={() => handleEditCompany(company)}>✏️ Edit</button>
                <button class="btn-delete" onclick={() => handleDeleteCompany(company)}>🗑️ Delete</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- ── Tiers ── -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Tiers</h2>
        <button class="btn-add" onclick={handleAddTier}>
          <span>➕</span>
          <span>Add Tier</span>
        </button>
      </div>

      {#if showNewTierForm}
        <div class="inline-form">
          <h3>New Tier</h3>
          <div class="form-grid">
            <label>Tier ID (Internal)
              <input type="text" bind:value={tierForm.tierId} placeholder="e.g. test2" />
            </label>
            <label>Name
              <input type="text" bind:value={tierForm.name} placeholder="e.g. Gold" />
            </label>
            <label>Rank
              <input type="number" bind:value={tierForm.rank} min="1" />
            </label>
            <label>Early Access Hours
              <input type="number" bind:value={tierForm.earlyAccessHours} min="0" />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn-add" onclick={handleSaveTier}>Create Tier</button>
            <button class="btn-edit" onclick={cancelEdit}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="cards-grid">
        {#each tiers as tier (tier.tierId)}
          <div class="card">
            <div class="card-icon">🏆</div>

            {#if editingTierId === tier.tierId}
              <div class="inline-form">
                <div class="form-grid">
                  <label>Tier ID (Warning: modifying this will create a new tier)
                    <input type="text" bind:value={tierForm.tierId} />
                  </label>
                  <label>Name
                    <input type="text" bind:value={tierForm.name} />
                  </label>
                  <label>Rank
                    <input type="number" bind:value={tierForm.rank} min="1" />
                  </label>
                  <label>Early Access Hours
                    <input type="number" bind:value={tierForm.earlyAccessHours} min="0" />
                  </label>
                </div>
                <div class="form-actions">
                  <button class="btn-add" onclick={handleSaveTier}>Save</button>
                  <button class="btn-edit" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="card-title">{tier.name}</div>
              <div class="card-badge">Rank {tier.rank}</div>
              <div class="card-content">
                <div class="card-row">
                  <span class="card-label">Tier ID</span>
                  <span class="card-value">{tier.tierId}</span>
                </div>
                <div class="card-row">
                  <span class="card-label">Early Access</span>
                  <span class="card-value">{tier.earlyAccessHours}h</span>
                </div>
              </div>
              <div class="card-actions">
                <button class="btn-edit" onclick={() => handleEditTier(tier)}>✏️ Edit</button>
                <button class="btn-delete" onclick={() => handleDeleteTier(tier)}>🗑️ Delete</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- ── Theme ── -->
    <div class="section">
      <h2 class="section-title">Themes</h2>
      {#if theme}
        <div class="cards-grid">
          <div class="card theme-card">
            <div class="card-icon">🎨</div>
            <div class="card-title">Platform Theme</div>

            {#if editingTheme}
              <div class="inline-form">
                <div class="form-grid">
                  <label>Primary Color
                    <div class="color-input-row">
                      <input type="color" bind:value={themeForm.primaryColor} />
                      <input type="text" bind:value={themeForm.primaryColor} placeholder="#500000" />
                    </div>
                  </label>
                  <label>Secondary Color
                    <div class="color-input-row">
                      <input type="color" bind:value={themeForm.secondaryColor} />
                      <input type="text" bind:value={themeForm.secondaryColor} placeholder="#FFFFFF" />
                    </div>
                  </label>
                  <label>Logo URL
                    <input type="text" bind:value={themeForm.logoUrl} placeholder="https://example.com/logo.png" />
                  </label>
                </div>
                <div class="form-actions">
                  <button class="btn-add" onclick={handleSaveTheme}>Save Theme</button>
                  <button class="btn-edit" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="card-content">
                <div class="card-row">
                  <span class="card-label">Primary Color</span>
                  <span class="card-value">
                    {theme.primaryColor}
                    <span class="color-preview" style="background-color: {theme.primaryColor}"></span>
                  </span>
                </div>
                <div class="card-row">
                  <span class="card-label">Secondary Color</span>
                  <span class="card-value">
                    {theme.secondaryColor}
                    <span class="color-preview" style="background-color: {theme.secondaryColor}"></span>
                  </span>
                </div>
                <div class="card-row">
                  <span class="card-label">Logo URL</span>
                  <span class="card-value" style="font-size: 0.85rem; word-break: break-all;">
                    {theme.logoUrl || '—'}
                  </span>
                </div>
              </div>
              <div class="card-actions">
                <button class="btn-edit" onclick={() => handleEditTheme()}>✏️ Edit Theme</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>

  {/if}
</div>