<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import { getCognitoIdToken } from "./auth";
  import { eventCheckinContext } from "./stores/eventCheckinStore";
  import { authUser } from "./stores/authStore";
  import { currentRole } from "./stores/roleStore";
  import {
    listEvents,
    createEvent,
    updateEvent,
    rsvpToEvent,
    cancelRsvp,
    getUserRsvps,
    getEventRsvps,
    getEventQr,
    type EventItem,
    type CreateEventPayload,
    type RsvpRecord,
    type EventQrPayload,
  } from "./events-api";
  import { velvetRopeStore, initializeVelvetRope } from "./stores/velvetRopeStore";
  import { computeVelvetRopeStatus } from "./velvetRope";

  // ── State ──────────────────────────────────────
  let events: EventItem[] = $state([]);
  let userRsvpIds: Set<string> = $state(new Set());
  let userRsvpsMap: Map<string, any> = $state(new Map());
  let loading = $state(true);
  let error = $state("");
  let actionMsg = $state("");

  // Filters
  let filterCategory = $state("");
  let filterDate = $state("");
  let categories: string[] = $state([]);
  let showPastEvents = $state(false);

  // Attendees Modal
  let showAttendeesModal = $state(false);
  let attendeesList = $state<RsvpRecord[]>([]);
  let attendeesLoading = $state(false);
  let attendeesError = $state("");

  // Create/Edit form
  let showCreateForm = $state(false);
  let editingEventId = $state<string | null>(null);

  // Cancel form
  let showCancelModal = $state(false);
  let cancelingEventId = $state<string | null>(null);
  let cancelLoading = $state(false);

  // Event details / QR modal
  let showEventDetailsModal = $state(false);
  let selectedEventForDetails = $state<EventItem | null>(null);
  let eventQr = $state<EventQrPayload | null>(null);
  let eventQrLoading = $state(false);
  let eventQrError = $state("");

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
    const now = new Date().getTime();
    
    // Hide canceled events from non-admin users
    if ($currentRole !== "admins") {
      list = list.filter((e) => e.status !== "CANCELED");
    }

    // Time filter
    if (!showPastEvents) {
      list = list.filter((e) => new Date(e.date).getTime() >= now);
    } else {
      list = list.filter((e) => new Date(e.date).getTime() < now);
    }

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
    initializeVelvetRope();
    if (($authUser as any)?.groups?.some((g: string) => /^admins?$/i.test(g))) {
      currentRole.set("admins");
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
        userRsvpsMap = new Map(rsvps.map((r) => [r.eventId, r]));
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

  let formDateOnly = "";
  let formTimeOnly = "";

  function openEditForm(evt: EventItem) {
    editingEventId = evt.eventId;
    
    if (evt.date) {
      const d = new Date(evt.date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      formDateOnly = `${yyyy}-${mm}-${dd}`;
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      formTimeOnly = `${hh}:${min}`;
    } else {
      formDateOnly = "";
      formTimeOnly = "";
    }

    form = {
      title: evt.title,
      date: evt.date,
      category: evt.category,
      capacity: evt.capacity,
      description: evt.description || "",
      location: evt.location || "",
    };
    showCreateForm = true;
  }

  async function handleCreate() {
    formError = "";
    formLoading = true;
    form.category = form.category.trim().toUpperCase();
    try {
      // Combine the cleanly split local date and time strings back into standard ISO
      if (formDateOnly && formTimeOnly) {
          form.date = new Date(`${formDateOnly}T${formTimeOnly}`).toISOString();
      }
      
      const isEditing = !!editingEventId;
      let createdOrUpdated: EventItem | null = null;
      if (editingEventId) {
        createdOrUpdated = await updateEvent(editingEventId, { ...form, capacity: Number(form.capacity) });
        actionMsg = "Event updated!";
      } else {
        createdOrUpdated = await createEvent({ ...form, capacity: Number(form.capacity) });
        actionMsg = "Event created!";
      }
      showCreateForm = false;
      editingEventId = null;
      formDateOnly = "";
      formTimeOnly = "";
      form = {
        title: "",
        date: "",
        category: "",
        capacity: 50,
        description: "",
        location: "",
      };
      actionMsg = isEditing ? "Event updated!" : "Event created!";
      await loadData();
      if (!isEditing && createdOrUpdated) {
        await openEventDetails(createdOrUpdated);
      }
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
      const result = await rsvpToEvent(eventId);
      userRsvpIds = new Set([...userRsvpIds, eventId]);
      
      const newStatus = result.status?.toUpperCase() || "CONFIRMED";
      userRsvpsMap.set(eventId, { eventId, status: newStatus });
      userRsvpsMap = userRsvpsMap; // trigger Svelte reactivity
      
      if (newStatus === "WAITLISTED") {
        actionMsg = result.message || "Event is full. You've been added to the waitlist.";
      } else {
        actionMsg = "RSVP confirmed!";
        // Optimistically update count
        events = events.map((e) =>
          e.eventId === eventId ? { ...e, currentRsvps: e.currentRsvps + 1 } : e,
        );
      }
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
      
      const isWaitlisted = userRsvpsMap.get(eventId)?.status?.toUpperCase() === "WAITLISTED";
      userRsvpsMap.delete(eventId);
      userRsvpsMap = userRsvpsMap; // reactivity
      
      if (!isWaitlisted) {
        events = events.map((e) =>
          e.eventId === eventId
            ? { ...e, currentRsvps: Math.max(0, e.currentRsvps - 1) }
            : e,
        );
      }
      
      actionMsg = isWaitlisted ? "Left the waitlist." : "RSVP cancelled.";
    } catch (e: any) {
      actionMsg = e.message;
    }
    setTimeout(() => (actionMsg = ""), 3000);
  }

  async function handleViewAttendees(eventId: string) {
    showAttendeesModal = true;
    attendeesLoading = true;
    attendeesError = "";
    attendeesList = [];
    try {
      attendeesList = await getEventRsvps(eventId);
    } catch (e: any) {
      attendeesError = e.message;
    } finally {
      attendeesLoading = false;
    }
  }

  async function openEventDetails(evt: EventItem) {
    selectedEventForDetails = evt;
    showEventDetailsModal = true;
    eventQrLoading = true;
    eventQrError = "";
    eventQr = null;
    try {
      eventQr = await getEventQr(evt.eventId);
    } catch (e: any) {
      eventQrError = e.message || "Failed to generate QR code.";
    } finally {
      eventQrLoading = false;
    }
  }

  async function openSelfCheckinScanner(eventId: string) {
    actionMsg = "";
    try {
      const token = await getCognitoIdToken(true);
      if (!token) {
        actionMsg = "Unable to open check-in scanner: sign in again to refresh your session.";
        setTimeout(() => (actionMsg = ""), 4000);
        return;
      }
      const evt = events.find((e) => e.eventId === eventId);
      eventCheckinContext.set({
        eventId,
        eventTitle: evt?.title || "",
      });
      currentView.set("event-checkin-scanner");
    } catch (e: any) {
      actionMsg = e?.message || "Unable to open check-in scanner.";
      setTimeout(() => (actionMsg = ""), 4000);
    }
  }

  function openCancelModal(eventId: string) {
    cancelingEventId = eventId;
    showCancelModal = true;
  }

  async function handleCancelEvent() {
    if (!cancelingEventId) return;
    actionMsg = "";
    cancelLoading = true;
    try {
      await updateEvent(cancelingEventId, { status: 'CANCELED' });
      const idx = events.findIndex(e => e.eventId === cancelingEventId);
      if (idx !== -1 && events[idx]) {
        events[idx].status = 'CANCELED';
      }
      actionMsg = "Event canceled.";
      showCancelModal = false;
      cancelingEventId = null;
    } catch (e: any) {
      actionMsg = e.message;
    } finally {
      cancelLoading = false;
      setTimeout(() => (actionMsg = ""), 3000);
    }
  }

  function fmtDate(d: string) {
    try {
      return new Date(d).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
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
          <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
            {#if $currentRole === "admins"}
              <button class="btn-create" onclick={() => {
                editingEventId = null;
                form = { title: "", date: "", category: "", capacity: 50, description: "", location: "" };
                showCreateForm = true;
              }}>+ Create Event</button>
            {/if}
          </div>
        </div>
      </div>

    {#if actionMsg}
      <div class="action-toast">{actionMsg}</div>
    {/if}

    <!-- ── Create/Edit Form Modal ── -->
    {#if showCreateForm}
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <h2>{editingEventId ? "Edit Event" : "Create New Event"}</h2>
          <label
            >Title <input
              type="text"
              bind:value={form.title}
              placeholder="Company Info Session"
            /></label
          >
          <div style="display: flex; gap: 1rem;">
            <label style="flex:1"
              >Date <input type="date" bind:value={formDateOnly} required /></label
            >
            <label style="flex:1"
              >Time <input type="time" bind:value={formTimeOnly} required /></label
            >
          </div>
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
              {formLoading ? "Saving…" : (editingEventId ? "Save Changes" : "Create Event")}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── View Attendees Modal ── -->
    {#if showAttendeesModal}
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <h2>Event Attendees</h2>
          {#if attendeesLoading}
            <div class="loading-state" style="padding: 2rem 0;">
              <div class="spinner"></div>
              <p>Loading attendees...</p>
            </div>
          {:else if attendeesError}
            <p class="form-error" style="padding: 1rem 0;">{attendeesError}</p>
          {:else if attendeesList.length === 0}
            <p style="text-align: center; padding: 2rem 0; color: var(--text-muted);">No one has RSVP'd yet.</p>
          {:else}
            <ul style="max-height: 300px; overflow-y: auto; text-align: left; padding: 0 0.5rem; margin: 0; list-style: none;">
              {#each attendeesList as user}
                <li style="margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
                  <strong>{user.userEmail || user.userId}</strong> <br/>
                  <small style="color: var(--text-muted);">RSVP'd at: {new Date(user.rsvpAt).toLocaleString()}</small>
                </li>
              {/each}
            </ul>
            <p style="text-align: right; color: var(--text-muted); font-size: 0.85rem; margin: 0;">Total: {attendeesList.length}</p>
          {/if}
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => showAttendeesModal = false}>Close</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Cancel Event Modal ── -->
    {#if showCancelModal}
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <h2>Cancel Event</h2>
          <p>Are you sure you want to cancel this event? This will mark it as CANCELED and preserve RSVPs, but prevent new registrations.</p>
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => showCancelModal = false} disabled={cancelLoading}>Back</button>
            <button class="btn-submit" style="background: var(--error-text, #b91c1c);" onclick={handleCancelEvent} disabled={cancelLoading}>
              {cancelLoading ? "Canceling..." : "Confirm Cancel"}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Event Details / QR Modal ── -->
    {#if showEventDetailsModal}
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <h2>Event Details</h2>
          {#if selectedEventForDetails}
            <p style="margin: 0; color: var(--text-muted);"><strong>Title:</strong> {selectedEventForDetails.title}</p>
            <p style="margin: 0; color: var(--text-muted);"><strong>Date:</strong> {fmtDate(selectedEventForDetails.date)}</p>
            <p style="margin: 0; color: var(--text-muted);"><strong>Event ID:</strong> <code>{selectedEventForDetails.eventId}</code></p>
          {/if}
          {#if eventQrLoading}
            <div class="loading-state" style="padding: 1.25rem 0;">
              <div class="spinner"></div>
              <p>Generating event QR...</p>
            </div>
          {:else if eventQrError}
            <p class="form-error">{eventQrError}</p>
          {:else if eventQr?.qrCodeDataUrl}
            <div style="display:flex; justify-content:center; padding: 0.5rem 0;">
              <img src={eventQr.qrCodeDataUrl} alt="Event QR code" style="max-width: 260px; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 10px;" />
            </div>
            <p style="margin: 0; color: var(--text-muted); font-size: 0.85rem; text-align: center;">
              Stable event QR generated from Event ID.
            </p>
          {/if}
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => showEventDetailsModal = false}>Close</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Filters ── -->
    {#if !loading && events.length > 0}
      <div class="filters">
        <label style="display: flex; align-items: center; gap: 0.5rem; margin-right: 1rem; cursor: pointer; font-weight: 500;">
          <input type="checkbox" bind:checked={showPastEvents} />
          Show Past Events
        </label>
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
          <div class="event-card" class:canceled={evt.status === 'CANCELED'}>
            <div class="card-top">
              <span class="category-badge">{evt.category}</span>
              {#if evt.status === 'CANCELED'}
                <span class="spots-badge" style="color: var(--error-text, #dc2626); font-weight: bold;">CANCELED</span>
              {:else if userRsvpsMap.has(evt.eventId) && userRsvpsMap.get(evt.eventId)?.status?.toUpperCase() === "WAITLISTED"}
                <span class="spots-badge" style="background: var(--gold-light); color: var(--maroon);">WAITLISTED</span>
              {:else}
                <span
                  class="spots-badge"
                  class:full={evt.currentRsvps >= evt.capacity}
                >
                  {evt.currentRsvps}/{evt.capacity} spots
                </span>
              {/if}
            </div>
            <h3 class="event-title" style={evt.status === 'CANCELED' ? 'text-decoration: line-through; opacity: 0.7;' : ''}>{evt.title}</h3>
            <div class="event-meta">
              <span>📅 {fmtDate(evt.date)}</span>
              {#if evt.location}<span>📍 {evt.location}</span>{/if}
            </div>
            {#if evt.description}
              <p class="event-desc">{evt.description}</p>
            {/if}
            <div class="card-actions">
              {#if $authUser}
                {@const velvetStatus = computeVelvetRopeStatus(evt.date, evt.createdBy || "", ($authUser as any)?.userId || ($authUser as any)?.username || "", $velvetRopeStore)}
                {#if velvetStatus.countdownMessage && !userRsvpIds.has(evt.eventId) && evt.currentRsvps < evt.capacity && evt.status !== 'CANCELED'}
                  <div class="velvet-countdown">
                    {velvetStatus.countdownMessage}
                  </div>
                {/if}

                {#if evt.status === 'CANCELED'}
                  <button class="btn-full" disabled>Canceled</button>
                {:else if userRsvpIds.has(evt.eventId)}
                  {@const isCheckedIn = userRsvpsMap.get(evt.eventId)?.checkedIn === true || !!userRsvpsMap.get(evt.eventId)?.checkedInAt}
                  <button
                    class="btn-cancel-rsvp"
                    onclick={() => handleCancelRsvp(evt.eventId)}
                  >{userRsvpsMap.get(evt.eventId)?.status?.toUpperCase() === "WAITLISTED" ? "Leave Waitlist" : "Cancel RSVP"}</button>
                  {#if isCheckedIn}
                    <button class="btn-full checked-in" disabled>Already Checked In</button>
                  {:else if $currentRole !== "admins" && userRsvpsMap.get(evt.eventId)?.status?.toUpperCase() === "CONFIRMED"}
                    <button class="btn-rsvp" onclick={() => openSelfCheckinScanner(evt.eventId)}>Checkin</button>
                  {/if}
                {:else if evt.currentRsvps < evt.capacity}
                  <button
                    class="btn-rsvp"
                    disabled={!velvetStatus.canRsvpRightNow}
                    title={!velvetStatus.canRsvpRightNow ? "Early access has not opened for you yet." : ""}
                    onclick={() => handleRsvp(evt.eventId)}>RSVP</button
                  >
                {:else}
                  <button class="btn-rsvp" style="background: var(--gold); color: var(--maroon);" onclick={() => handleRsvp(evt.eventId)}>Join Waitlist</button>
                {/if}
                {#if $currentRole === "admins"}
                  <button
                    class="btn-delete"
                    onclick={() => openEventDetails(evt)}
                    title="Event Details / QR">🔳</button
                  >
                  <button
                    class="btn-delete"
                    onclick={() => openEditForm(evt)}
                    disabled={evt.status === 'CANCELED'}
                    title="Edit">✏️</button
                  >
                  <button
                    class="btn-delete"
                    onclick={() => handleViewAttendees(evt.eventId)}
                    disabled={evt.status === 'CANCELED'}
                    title="View Attendees">👥</button
                  >
                  <button
                    class="btn-delete"
                    onclick={() => openCancelModal(evt.eventId)}
                    disabled={evt.status === 'CANCELED'}
                    title="Cancel Event">🚫</button
                  >
                {/if}
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

  .velvet-countdown {
    text-align: center;
    background: var(--maroon-muted);
    color: var(--maroon);
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    margin-bottom: 0.75rem;
    display: block;
    width: 100%;
    animation: fadeIn 0.4s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
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
    color: var(--card-bg, #fff);
    background: var(--maroon);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.15s;
  }
  .btn-create:hover {
    background: var(--maroon-dark);
    transform: translateY(-1px);
  }

  /* Action toast */
  .action-toast {
    padding: 0.75rem 1.25rem;
    margin-bottom: 1rem;
    background: var(--success-bg, #def7ec);
    color: var(--success-text, #03543f);
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
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
    background: var(--card-bg, #fff);
  }
  .btn-clear {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    background: var(--card-bg, #fff);
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
    background: var(--card-bg);
    border: 1px solid var(--border);
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
    background: var(--maroon);
    color: var(--card-bg, #fff);
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .spots-badge {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .spots-badge.full {
    color: var(--error-text, #dc2626);
  }

  .event-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 1.2rem;
    color: var(--text);
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
    color: var(--card-bg, #fff);
    background: var(--maroon);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn-rsvp:hover:not(:disabled) {
    background: var(--maroon-dark);
  }
  .btn-rsvp:disabled {
    color: var(--text-muted);
    background: var(--bg-muted, #f3f4f6);
    cursor: not-allowed;
  }
  .btn-cancel-rsvp {
    flex: 1;
    padding: 0.5rem;
    font-weight: 600;
    color: var(--maroon);
    background: transparent;
    border: 2px solid var(--maroon);
    border-radius: var(--radius, 8px);
    cursor: pointer;
  }
  .btn-full {
    flex: 1;
    padding: 0.5rem;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--bg-muted, #f3f4f6);
    border: none;
    border-radius: var(--radius, 8px);
    cursor: not-allowed;
  }
  .btn-full.checked-in {
    background: var(--success-bg, #def7ec);
    color: var(--success-text, #03543f);
    border: 1px solid rgba(3, 84, 63, 0.2);
    cursor: default;
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
  .btn-delete:hover:not(:disabled) {
    opacity: 1;
  }
  .btn-delete:disabled {
    opacity: 0.2;
    cursor: not-allowed;
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
    background: var(--card-bg);
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
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    font-size: 0.9rem;
    background: var(--card-bg, #fff);
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
    color: var(--card-bg, #fff);
    background: var(--maroon);
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
    color: var(--error-text, #b91c1c);
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
    border: 3px solid var(--border);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error-card {
    background: var(--error-bg, #fef2f2);
    border: 1px solid var(--error-border, #f87171);
    padding: 1.75rem;
    border-radius: var(--radius-lg, 12px);
    color: var(--error-text, #991b1b);
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
