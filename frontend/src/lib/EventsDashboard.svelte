<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import { authUser } from "./stores/authStore";
  import { currentRole } from "./stores/roleStore";
  import {
    listEvents,
    createEvent,
    deleteEvent,
    rsvpToEvent,
    cancelRsvp,
    getUserRsvps,
    type EventItem,
    type CreateEventPayload,
  } from "./events-api";

  // ── State ──────────────────────────────────────
  let events: EventItem[] = $state([]);
  let userRsvpIds: Set<string> = $state(new Set());
  let loading = $state(true);
  let error = $state("");
  let actionMsg = $state("");

  // Filters
  let filterCategory = $state("");
  let filterDate = $state("");
  let categories: string[] = $state([]);

  // Create-event form
  let showCreateForm = $state(false);
  let form: CreateEventPayload = $state({
    title: "",
    date: "",
    category: "",
    capacity: 50,
    description: "",
    location: "",
  });
  let formError = $state("");
  let formLoading = $state(false);

  // ── Derived ────────────────────────────────────
  let filteredEvents = $derived.by(() => {
    let list = events;
    if (filterCategory)
      list = list.filter((e) => e.category === filterCategory);
    if (filterDate) list = list.filter((e) => e.date?.startsWith(filterDate));
    return [...list].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  });

  // ── Lifecycle ──────────────────────────────────
  onMount(async () => {
    // Gate: require login to view events
    if (!$authUser) {
      loading = false;
      return;
    }
    await loadData();
  });

  async function loadData() {
    loading = true;
    error = "";
    try {
      events = await listEvents();
      categories = [...new Set(events.map((e) => e.category).filter(Boolean))];
      // Load user RSVPs if signed in
      try {
        const rsvps = await getUserRsvps();
        userRsvpIds = new Set(rsvps.map((r) => r.eventId));
      } catch {
        /* not signed in or no rsvps */
      }
    } catch (e: any) {
      error = e.message || "Failed to load events";
    } finally {
      loading = false;
    }
  }

  // ── Actions ────────────────────────────────────
  function goBack(e: MouseEvent) {
    e.preventDefault();
    currentView.set("landing");
  }

  async function handleCreate() {
    formError = "";
    formLoading = true;
    try {
      await createEvent({ ...form, capacity: Number(form.capacity) });
      showCreateForm = false;
      form = {
        title: "",
        date: "",
        category: "",
        capacity: 50,
        description: "",
        location: "",
      };
      actionMsg = "Event created!";
      await loadData();
      setTimeout(() => (actionMsg = ""), 3000);
    } catch (e: any) {
      formError = e.message;
    } finally {
      formLoading = false;
    }
  }

  async function handleRsvp(eventId: string) {
    actionMsg = "";
    try {
      await rsvpToEvent(eventId);
      userRsvpIds = new Set([...userRsvpIds, eventId]);
      // Optimistically update count
      events = events.map((e) =>
        e.eventId === eventId ? { ...e, currentRsvps: e.currentRsvps + 1 } : e,
      );
      actionMsg = "RSVP confirmed!";
    } catch (e: any) {
      actionMsg = e.message;
    }
    setTimeout(() => (actionMsg = ""), 3000);
  }

  async function handleCancelRsvp(eventId: string) {
    actionMsg = "";
    try {
      await cancelRsvp(eventId);
      const copy = new Set(userRsvpIds);
      copy.delete(eventId);
      userRsvpIds = copy;
      events = events.map((e) =>
        e.eventId === eventId
          ? { ...e, currentRsvps: Math.max(0, e.currentRsvps - 1) }
          : e,
      );
      actionMsg = "RSVP cancelled.";
    } catch (e: any) {
      actionMsg = e.message;
    }
    setTimeout(() => (actionMsg = ""), 3000);
  }

  async function handleDelete(eventId: string) {
    if (!confirm("Delete this event?")) return;
    try {
      await deleteEvent(eventId);
      await loadData();
      actionMsg = "Event deleted.";
    } catch (e: any) {
      actionMsg = e.message;
    }
    setTimeout(() => (actionMsg = ""), 3000);
  }

  function fmtDate(d: string) {
    try {
      return new Date(d).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return d;
    }
  }
</script>

<div class="events-page">
  <div class="events-inner">
    <button type="button" class="back-link" onclick={goBack}>
      <span class="back-arrow">←</span> Back to home
    </button>

    {#if !$authUser}
      <div class="promo-card">
        <div class="card-glow" aria-hidden="true"></div>
        <div class="title-wrap">
          <h1 class="collab-title">Events</h1>
          <span class="title-emoji" aria-hidden="true">📅</span>
        </div>
        <p class="collab-content">Discover and register for company info sessions, career fairs, and networking events.</p>
        
        <div class="auth-prompt">
          <span class="lock-icon" aria-hidden="true">🔒</span>
          <p>Please sign in to view and RSVP to events.</p>
          <button class="btn-create" onclick={() => {
            currentView.set("landing"); // User can click Sign In on the landing page
          }}>Go to Sign In</button>
        </div>

        <div class="floating-dots" aria-hidden="true">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    {:else}
      <div class="dashboard-header">
        <div class="header-row">
          <div>
            <h1 class="page-title">Events</h1>
            <p class="page-subtitle">Discover and RSVP to upcoming events</p>
          </div>
          {#if $currentRole === "admins"}
            <button class="btn-create" onclick={() => (showCreateForm = true)}
              >+ Create Event</button
            >
          {/if}
        </div>
      </div>

    {#if actionMsg}
      <div class="action-toast">{actionMsg}</div>
    {/if}

    <!-- ── Create Form Modal ── -->
    {#if showCreateForm}
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <h2>Create New Event</h2>
          <label
            >Title <input
              type="text"
              bind:value={form.title}
              placeholder="Company Info Session"
            /></label
          >
          <label
            >Date <input type="datetime-local" bind:value={form.date} /></label
          >
          <label
            >Category
            <input
              type="text"
              bind:value={form.category}
              placeholder="Info Session, Career Fair, Networking…"
            />
          </label>
          <label
            >Capacity <input
              type="number"
              bind:value={form.capacity}
              min="1"
            /></label
          >
          <label
            >Location <input
              type="text"
              bind:value={form.location}
              placeholder="Wehner 110"
            /></label
          >
          <label
            >Description <textarea
              bind:value={form.description}
              rows="3"
              placeholder="Optional description…"
            ></textarea></label
          >
          {#if formError}<p class="form-error">{formError}</p>{/if}
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => (showCreateForm = false)}
              >Cancel</button
            >
            <button
              class="btn-submit"
              onclick={handleCreate}
              disabled={formLoading}
            >
              {formLoading ? "Creating…" : "Create Event"}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Filters ── -->
    {#if !loading && events.length > 0}
      <div class="filters">
        <select bind:value={filterCategory}>
          <option value="">All Categories</option>
          {#each categories as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
        <input
          type="date"
          bind:value={filterDate}
          placeholder="Filter by date"
        />
        {#if filterCategory || filterDate}
          <button
            class="btn-clear"
            onclick={() => {
              filterCategory = "";
              filterDate = "";
            }}>Clear</button
          >
        {/if}
      </div>
    {/if}

    <!-- ── Content ── -->
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading events…</p>
      </div>
    {:else if error}
      <div class="error-card">
        <h3>Error</h3>
        <p>{error}</p>
      </div>
    {:else if filteredEvents.length === 0}
      <div class="empty-state">
        <p class="empty-icon">📅</p>
        <p>
          No events found{filterCategory || filterDate
            ? " matching filters"
            : ""}.
        </p>
        {#if $authUser}<p>
            Create your first event with the button above!
          </p>{/if}
      </div>
    {:else}
      <div class="event-grid">
        {#each filteredEvents as evt (evt.eventId)}
          <div class="event-card">
            <div class="card-top">
              <span class="category-badge">{evt.category}</span>
              <span
                class="spots-badge"
                class:full={evt.currentRsvps >= evt.capacity}
              >
                {evt.currentRsvps}/{evt.capacity} spots
              </span>
            </div>
            <h3 class="event-title">{evt.title}</h3>
            <div class="event-meta">
              <span>📅 {fmtDate(evt.date)}</span>
              {#if evt.location}<span>📍 {evt.location}</span>{/if}
            </div>
            {#if evt.description}
              <p class="event-desc">{evt.description}</p>
            {/if}
            <div class="card-actions">
              {#if $authUser}
                {#if userRsvpIds.has(evt.eventId)}
                  <button
                    class="btn-cancel-rsvp"
                    onclick={() => handleCancelRsvp(evt.eventId)}
                    >Cancel RSVP</button
                  >
                {:else if evt.currentRsvps < evt.capacity}
                  <button
                    class="btn-rsvp"
                    onclick={() => handleRsvp(evt.eventId)}>RSVP</button
                  >
                {:else}
                  <button class="btn-full" disabled>Full</button>
                {/if}
                <button
                  class="btn-delete"
                  onclick={() => handleDelete(evt.eventId)}
                  title="Delete">🗑️</button
                >
              {:else}
                <button
                  class="btn-rsvp"
                  onclick={() => currentView.set("landing")}
                  >Sign in to RSVP</button
                >
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
    {/if}
  </div>
</div>

<style>
  .events-page {
    width: 100%;
    min-height: 100vh;
    padding: 2rem 1.5rem 3.5rem;
    font-family: var(--font-body);
    background: linear-gradient(
      180deg,
      var(--bg) 0%,
      var(--bg-warm) 50%,
      #f0ebe6 100%
    );
    color: var(--text);
    position: relative;
    overflow: hidden;
  }

  .events-page::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -30%;
    width: 80%;
    height: 80%;
    background: radial-gradient(ellipse, var(--maroon-muted) 0%, transparent 70%);
    pointer-events: none;
  }

  .events-inner {
    position: relative;
    max-width: 1100px;
    margin: 0 auto;
  }

  /* ── Promo Card (Unauthenticated) ── */
  .promo-card {
    position: relative;
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    padding: 2.5rem 2rem 3.5rem;
    box-shadow: var(--shadow-lg), 0 0 0 1px var(--border);
    animation: cardIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    overflow: hidden;
    max-width: 640px;
    margin: 2rem auto;
    text-align: center;
  }

  @keyframes cardIn {
    from { opacity: 0; transform: translateY(24px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .card-glow {
    position: absolute;
    top: -60px;
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, var(--gold-light) 0%, transparent 70%);
    animation: glowPulse 4s ease-in-out infinite;
  }

  @keyframes glowPulse {
    0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
    50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
  }

  .title-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  .collab-title {
    font-family: var(--font-heading);
    margin: 0;
    font-size: clamp(1.75rem, 4vw, 2.25rem);
    font-weight: 700;
    color: var(--maroon);
    letter-spacing: -0.02em;
    animation: titleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
  }

  @keyframes titleIn {
    from { opacity: 0; transform: translateY(-12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .title-emoji {
    font-size: 2rem;
    animation: emojiBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both, float 3s ease-in-out 1s infinite;
  }

  @keyframes emojiBounce {
    from { opacity: 0; transform: scale(0) rotate(-20deg); }
    to { opacity: 1; transform: scale(1) rotate(0deg); }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }

  .collab-content {
    margin: 0 0 2rem;
    font-size: clamp(1.1rem, 2.5vw, 1.2rem);
    line-height: 1.6;
    color: var(--text-muted);
    animation: contentIn 0.5s ease 0.3s both;
  }

  @keyframes contentIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .auth-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding-top: 2rem;
    border-top: 1px dashed var(--border);
    animation: contentIn 0.5s ease 0.4s both;
  }

  .auth-prompt p {
    font-size: 1rem;
    color: var(--maroon);
    font-weight: 600;
    margin: 0;
  }

  .lock-icon {
    font-size: 2rem;
    opacity: 0.8;
  }

  .floating-dots {
    position: absolute;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gold);
    opacity: 0.6;
    animation: dotBounce 1.2s ease-in-out infinite;
  }

  .dot:nth-child(1) { animation-delay: 0s; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dotBounce {
    0%, 100% { transform: translateY(0); opacity: 0.6; }
    50% { transform: translateY(-6px); opacity: 1; }
  }

  /* ── Original Dashboard Styles ── */
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 2rem;
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    transition: transform 0.2s;
  }
  .back-link:hover {
    transform: translateX(-4px);
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .page-title {
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(2rem, 4vw, 2.75rem);
    font-weight: 700;
    margin: 0 0 0.25rem;
    letter-spacing: -0.02em;
  }
  .page-subtitle {
    color: var(--text-muted);
    font-size: 1.1rem;
    margin: 0;
  }

  .btn-create {
    padding: 0.6rem 1.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
    background: var(--maroon, #500000);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.15s;
  }
  .btn-create:hover {
    background: var(--maroon-dark, #3a0000);
    transform: translateY(-1px);
  }

  /* Action toast */
  .action-toast {
    padding: 0.75rem 1.25rem;
    margin-bottom: 1rem;
    background: #def7ec;
    color: #03543f;
    border-radius: var(--radius, 8px);
    font-weight: 500;
    animation: slideDown 0.3s ease;
  }
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Filters */
  .filters {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .filters select,
  .filters input[type="date"] {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border, #d1d5db);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
    background: #fff;
  }
  .btn-clear {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border, #d1d5db);
    border-radius: var(--radius, 8px);
    background: #fff;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--maroon);
  }

  /* Event grid */
  .event-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.25rem;
  }

  .event-card {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: var(--radius-lg, 12px);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    transition:
      box-shadow 0.25s,
      transform 0.2s;
    animation: fadeUp 0.35s ease;
  }
  .event-card:hover {
    box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.08));
    transform: translateY(-2px);
  }
  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .category-badge {
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--maroon, #500000);
    color: #fff;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .spots-badge {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .spots-badge.full {
    color: #dc2626;
  }

  .event-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.2rem;
    color: var(--text, #111);
  }
  .event-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.88rem;
    color: var(--text-muted);
  }
  .event-desc {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: auto;
    padding-top: 0.5rem;
  }
  .btn-rsvp {
    flex: 1;
    padding: 0.5rem;
    font-weight: 600;
    color: #fff;
    background: var(--maroon, #500000);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-rsvp:hover {
    background: var(--maroon-dark, #3a0000);
  }
  .btn-cancel-rsvp {
    flex: 1;
    padding: 0.5rem;
    font-weight: 600;
    color: var(--maroon, #500000);
    background: transparent;
    border: 2px solid var(--maroon, #500000);
    border-radius: var(--radius, 8px);
    cursor: pointer;
  }
  .btn-full {
    flex: 1;
    padding: 0.5rem;
    font-weight: 600;
    color: #999;
    background: #f3f4f6;
    border: none;
    border-radius: var(--radius, 8px);
    cursor: not-allowed;
  }
  .btn-delete {
    padding: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .btn-delete:hover {
    opacity: 1;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-card {
    width: min(520px, 100%);
    background: var(--card-bg, #fff);
    border-radius: var(--radius-lg, 12px);
    padding: 1.75rem;
    box-shadow: var(--shadow-lg);
    display: grid;
    gap: 0.85rem;
  }
  .modal-card h2 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .modal-card label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
  }
  .modal-card input,
  .modal-card textarea,
  .modal-card select {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border, #d1d5db);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
  }
  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }
  .btn-cancel {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    background: transparent;
    cursor: pointer;
  }
  .btn-submit {
    padding: 0.5rem 1.25rem;
    font-weight: 600;
    color: #fff;
    background: var(--maroon, #500000);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
  }
  .btn-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .form-error {
    margin: 0;
    color: #b91c1c;
    font-size: 0.88rem;
  }

  /* States */
  .loading-state {
    text-align: center;
    padding: 5rem 0;
    color: var(--text-muted);
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem;
    border: 3px solid var(--border, #e5e7eb);
    border-top-color: var(--maroon, #500000);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error-card {
    background: #fef2f2;
    border: 1px solid #f87171;
    padding: 1.75rem;
    border-radius: var(--radius-lg, 12px);
    color: #991b1b;
  }
  .error-card h3 {
    margin: 0 0 0.5rem;
  }
  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }
  .empty-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }
</style>
