<script lang="ts">
  import { onMount } from "svelte";
  import { listProfiles } from "./api";
  import {
    getEventRsvps,
    listEvents,
    type EventItem,
    type RsvpRecord,
  } from "./events-api";
  import type { ListProfilesResult } from "./types";

  type StudentProfile = NonNullable<ListProfilesResult["profiles"]>[number];

  type TopAttendee = {
    userId: string;
    name: string;
    email: string;
    count: number;
  };

  type HeatmapCell = {
    major: string;
    year: string;
    count: number;
  };

  let loading = $state(true);
  let error = $state("");
  let totalEvents = $state(0);
  let totalCheckins = $state(0);
  let topAttendees = $state<TopAttendee[]>([]);
  let zeroAttendance = $state<StudentProfile[]>([]);
  let heatmapRows = $state<string[]>([]);
  let heatmapCols = $state<string[]>([]);
  let heatmapCells = $state<HeatmapCell[]>([]);
  let heatmapMax = $state(0);

  const ALL_EVENTS_KEY = "__ALL__";
  let selectedEventKey = $state<string>(ALL_EVENTS_KEY);
  let eventsList = $state<EventItem[]>([]);
  let cachedProfiles: StudentProfile[] = [];
  let cachedCheckinRows: RsvpRecord[] = [];

  onMount(async () => {
    await loadAnalytics();
  });

  function isStudentRole(role?: string): boolean {
    const normalized = (role ?? "").toUpperCase();
    return normalized === "STUDENT" || normalized === "FORMER_STUDENT";
  }

  function getClassYear(profile: StudentProfile): string {
    const classYear = (profile as { classYear?: string }).classYear?.trim();
    if (classYear) return classYear;
    const gradDate = profile.gradDate?.trim() ?? "";
    if (/^\d{4}-\d{2}/.test(gradDate)) return gradDate.slice(0, 4);
    return "Unknown";
  }

  function toHeatColor(count: number, max: number): string {
    if (max <= 0 || count <= 0) return "rgba(80, 0, 0, 0.06)";
    const intensity = count / max;
    const alpha = 0.12 + intensity * 0.68;
    return `rgba(80, 0, 0, ${alpha.toFixed(2)})`;
  }

  function cellCount(major: string, year: string): number {
    return heatmapCells.find((c) => c.major === major && c.year === year)?.count ?? 0;
  }

  /** RSVP row includes check-in fields written at scan time (same table as RSVPs). */
  function isCheckedIn(r: RsvpRecord): boolean {
    return r.checkedIn === true || !!r.checkedInAt;
  }

  function sortEventsForPicker(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  function recomputeAnalytics() {
    const profiles = cachedProfiles;
    const checkinRecords =
      selectedEventKey === ALL_EVENTS_KEY
        ? cachedCheckinRows
        : cachedCheckinRows.filter((r) => r.eventId === selectedEventKey);

    const eventInList = eventsList.some((e) => e.eventId === selectedEventKey);
    totalEvents =
      selectedEventKey === ALL_EVENTS_KEY
        ? eventsList.length
        : eventInList
          ? 1
          : 0;

    const uniqueCheckins = Array.from(
      new Map(checkinRecords.map((r) => [`${r.eventId}:${r.userId}`, r])).values(),
    );
    totalCheckins = uniqueCheckins.length;

    const checkinCounts = new Map<string, number>();
    for (const row of uniqueCheckins) {
      checkinCounts.set(row.userId, (checkinCounts.get(row.userId) ?? 0) + 1);
    }

    const profileById = new Map(profiles.map((p) => [p.userId ?? "", p]));
    topAttendees = Array.from(checkinCounts.entries())
      .map(([userId, count]) => {
        const profile = profileById.get(userId);
        return {
          userId,
          count,
          name: profile?.name ?? "Unknown student",
          email: profile?.email ?? userId,
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5);

    const students = profiles.filter(
      (p) => isStudentRole(p.role) || (!p.role && !!p.uin),
    );
    zeroAttendance = students
      .filter((s) => (checkinCounts.get(s.userId ?? "") ?? 0) === 0)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    const heatCounts = new Map<string, number>();
    for (const student of students) {
      const major = student.major?.trim() || "Undeclared";
      const year = getClassYear(student);
      const key = `${major}||${year}`;
      const count = checkinCounts.get(student.userId ?? "") ?? 0;
      heatCounts.set(key, (heatCounts.get(key) ?? 0) + count);
    }

    heatmapCells = Array.from(heatCounts.entries()).map(([key, count]) => {
      const parts = key.split("||");
      const major = parts[0] ?? "";
      const year = parts[1] ?? "";
      return { major, year, count };
    });
    heatmapRows = Array.from(new Set(heatmapCells.map((c) => c.major))).sort();
    heatmapCols = Array.from(new Set(heatmapCells.map((c) => c.year))).sort();
    heatmapMax = Math.max(0, ...heatmapCells.map((c) => c.count));
  }

  function onScopeChange(ev: Event) {
    const el = ev.currentTarget as HTMLSelectElement;
    selectedEventKey = el.value;
    recomputeAnalytics();
  }

  async function loadAnalytics() {
    loading = true;
    error = "";
    try {
      const [events, profilesResult] = await Promise.all([listEvents(), listProfiles()]);
      const profiles = profilesResult.ok ? (profilesResult.profiles ?? []) : [];
      const eventIds = events.map((e) => e.eventId);

      const attendeeResults = await Promise.allSettled(
        eventIds.map((eventId) => getEventRsvps(eventId)),
      );
      const rsvpRows = attendeeResults
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getEventRsvps>>> => r.status === "fulfilled")
        .flatMap((r) => r.value);

      eventsList = sortEventsForPicker(events);
      cachedProfiles = profiles;
      cachedCheckinRows = rsvpRows.filter(isCheckedIn);

      const validIds = new Set(eventsList.map((e) => e.eventId));
      if (selectedEventKey !== ALL_EVENTS_KEY && !validIds.has(selectedEventKey)) {
        selectedEventKey = ALL_EVENTS_KEY;
      }

      recomputeAnalytics();
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "Failed to load engagement analytics.";
    } finally {
      loading = false;
    }
  }
</script>

<section class="analytics-card">
  <div class="card-head">
    <h3>Student Engagement Analytics</h3>
    <button class="btn-refresh" type="button" onclick={loadAnalytics} disabled={loading}>
      {loading ? "Loading..." : "Refresh"}
    </button>
  </div>

  <div class="scope-row">
    <label class="scope-label" for="engagement-event-scope">Event scope</label>
    <select
      id="engagement-event-scope"
      class="scope-select"
      value={selectedEventKey}
      onchange={onScopeChange}
      disabled={loading || eventsList.length === 0}
    >
      <option value={ALL_EVENTS_KEY}>All events</option>
      {#each eventsList as evt (evt.eventId)}
        <option value={evt.eventId}>{evt.title || evt.eventId}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <p class="muted">Loading check-in analytics...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <div class="kpis">
      <div class="kpi">
        <span class="label">{selectedEventKey === ALL_EVENTS_KEY ? "Events" : "Event"}</span>
        <strong>{totalEvents}</strong>
      </div>
      <div class="kpi">
        <span class="label">Total check-ins</span>
        <strong>{totalCheckins}</strong>
      </div>
      <div class="kpi">
        <span class="label">Zero Attendance</span>
        <strong>{zeroAttendance.length}</strong>
      </div>
    </div>

    <div class="grid">
      <div class="panel">
        <h4>Top Attendees</h4>
        {#if topAttendees.length === 0}
          <p class="muted">No check-in data yet.</p>
        {:else}
          <ul>
            {#each topAttendees as student}
              <li>
                <span>{student.name}</span>
                <small>{student.email}</small>
                <strong>{student.count} check-in{student.count === 1 ? "" : "s"}</strong>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="panel">
        <h4>Zero Attendance Students</h4>
        {#if zeroAttendance.length === 0}
          <p class="muted">All students have at least one check-in.</p>
        {:else}
          <ul>
            {#each zeroAttendance.slice(0, 8) as student}
              <li>
                <span>{student.name || "Unnamed student"}</span>
                <small>{student.email || student.userId || "No email"}</small>
              </li>
            {/each}
          </ul>
          {#if zeroAttendance.length > 8}
            <p class="muted">+{zeroAttendance.length - 8} more</p>
          {/if}
        {/if}
      </div>
    </div>

    <div class="panel">
      <h4>Attendance Heatmap (Major x Class Year)</h4>
      {#if heatmapRows.length === 0 || heatmapCols.length === 0}
        <p class="muted">Not enough data to render heatmap.</p>
      {:else}
        <div class="heatmap-wrap">
          <table class="heatmap-table">
            <thead>
              <tr>
                <th>Major \ Year</th>
                {#each heatmapCols as year}
                  <th>{year}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each heatmapRows as major}
                <tr>
                  <th>{major}</th>
                  {#each heatmapCols as year}
                    {@const count = cellCount(major, year)}
                    <td style={`background:${toHeatColor(count, heatmapMax)}`} title={`${major} / ${year}: ${count} check-in(s)`}>
                      {count}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .analytics-card {
    margin-top: 1.25rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    box-shadow: var(--shadow);
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    margin-bottom: 0.9rem;
  }
  .scope-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
  .scope-label {
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
  }
  .scope-select {
    min-width: min(100%, 22rem);
    max-width: 100%;
    flex: 1 1 16rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 0.9rem;
  }
  .scope-select:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
  h3, h4 {
    margin: 0;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .btn-refresh {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    border-radius: var(--radius);
    padding: 0.45rem 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-refresh:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.9rem;
  }
  .kpi {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.7rem;
    display: grid;
    gap: 0.25rem;
  }
  .label {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.85rem;
    margin-bottom: 0.9rem;
  }
  .panel {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    padding: 0.8rem;
  }
  ul {
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.55rem;
  }
  li {
    display: grid;
    gap: 0.15rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
  }
  li:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  small, .muted {
    color: var(--text-muted);
  }
  .error {
    color: #b3261e;
  }
  .heatmap-wrap {
    overflow-x: auto;
    margin-top: 0.6rem;
  }
  .heatmap-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 620px;
    font-size: 0.85rem;
  }
  .heatmap-table th,
  .heatmap-table td {
    border: 1px solid var(--border);
    padding: 0.45rem 0.5rem;
    text-align: center;
  }
  .heatmap-table tbody th {
    text-align: left;
    background: var(--card-bg);
    font-weight: 600;
  }
</style>
