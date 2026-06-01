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

  // ---------- Types used by analytics aggregation ----------
  // These types define the normalized shapes this component computes in-memory.
  // The backend APIs return broader payloads; this card projects them into a
  // small set of structures used by ranking, KPI calculations, and heatmap rendering.
  type StudentProfile = NonNullable<ListProfilesResult["profiles"]>[number];

  type TopAttendeeMode = "checkin" | "rsvp" | "attendanceRate";

  type TopAttendee = {
    userId: string;
    name: string;
    email: string;
    checkins: number;
    rsvps: number;
    /** Percent of confirmed RSVPs in scope where the student checked in; null if rsvps === 0 */
    attendanceRate: number | null;
  };

  type HeatmapCell = {
    row: string;
    col: string;
    count: number;
  };

  const PREVIEW_TOP = 5;
  const PREVIEW_ZERO = 8;

  // ---------- Reactive UI state ----------
  // `cachedProfiles` + `cachedAllRsvpRows` are the canonical snapshot inputs.
  // All visible metrics are derived from these snapshots via `recomputeAnalytics()`.
  // This separation helps keep rendering deterministic even when refresh requests overlap.
  let loading = $state(true);
  let error = $state("");
  let warning = $state("");
  let totalEvents = $state(0);
  let totalCheckins = $state(0);
  /** Full sorted list (student role only); preview uses first N */
  let topAttendeesList = $state<TopAttendee[]>([]);
  let zeroAttendance = $state<StudentProfile[]>([]);
  let heatmapRows = $state<string[]>([]);
  let heatmapCols = $state<string[]>([]);
  let heatmapCells = $state<HeatmapCell[]>([]);
  let heatmapMax = $state(0);
  let topAttendeeMode = $state<TopAttendeeMode>("checkin");
  let listModal = $state<"top" | "zero" | null>(null);

  /** Stable heatmap column id: degree|||major (raw major from profile) */
  const HEATMAP_COL_SEP = "|||";
  /** Joins class year row to column key (must not appear in year or col) */
  const HEATMAP_ROWCOL_SEP = "\x1e";

  const ALL_EVENTS_KEY = "__ALL__";
  let selectedEventKey = $state<string>(ALL_EVENTS_KEY);
  let eventsList = $state<EventItem[]>([]);
  let cachedProfiles: StudentProfile[] = [];
  let cachedAllRsvpRows: RsvpRecord[] = [];
  let latestRequestId = 0;
  let hasLastKnownGoodSnapshot = false;

  onMount(async () => {
    await loadAnalytics();
  });

  // ---------- Normalization + grouping helpers ----------
  // Helpers in this block standardize profile fields into consistent buckets
  // (class year, degree, heatmap keys) so analytics are stable despite input variance
  // such as different degree spellings or missing profile attributes.
  /** Dashboard shows only users with the STUDENT role (not former_student, no UIN fallback). */
  function isDashboardStudent(role?: string): boolean {
    return (role ?? "").toUpperCase() === "STUDENT";
  }

  function getClassYear(profile: StudentProfile): string {
    const classYear = (profile as { classYear?: string }).classYear?.trim();
    if (classYear) return classYear;
    const gradDate = profile.gradDate?.trim() ?? "";
    if (/^\d{4}-\d{2}/.test(gradDate)) return gradDate.slice(0, 4);
    return "Unknown";
  }

  /** BS / MS / PhD buckets for heatmap; everything else → Other / Undeclared */
  function normalizeDegree(profile: StudentProfile): string {
    const raw = (profile.degree ?? "").trim().toUpperCase();
    if (!raw) return "Undeclared";
    if (raw === "BS" || raw === "B.S." || raw === "BACHELOR") return "BS";
    if (raw === "MS" || raw === "M.S." || raw === "MASTER" || raw === "MASTERS") return "MS";
    if (raw === "PHD" || raw === "PH.D" || raw === "DOCTOR" || raw === "DOCTORATE") return "PhD";
    return "Other";
  }

  function majorLabelForHeatmapColumn(deg: string, majorRaw: string): string {
    void deg;
    return majorRaw.trim() || "Undeclared";
  }

  function heatmapColKey(deg: string, majorRaw: string): string {
    const major = majorRaw.trim() || "Undeclared";
    return `${deg}${HEATMAP_COL_SEP}${major}`;
  }

  function parseHeatmapColKey(key: string): { deg: string; major: string } {
    const i = key.indexOf(HEATMAP_COL_SEP);
    if (i === -1) return { deg: "Other", major: key };
    return {
      deg: key.slice(0, i),
      major: key.slice(i + HEATMAP_COL_SEP.length),
    };
  }

  function heatmapColDisplay(colKey: string): string {
    const { deg, major } = parseHeatmapColKey(colKey);
    const label = majorLabelForHeatmapColumn(deg, major);
    return `${deg} ${label}`;
  }

  const DEGREE_COL_ORDER = ["BS", "MS", "PhD", "Undeclared", "Other"];
  const DEFAULT_HEATMAP_COLUMNS: Array<{ degree: string; major: string }> = [
    { degree: "MS", major: "Management Information Systems" },
    { degree: "BS", major: "Management Information Systems" },
    { degree: "BS", major: "Finance" },
    { degree: "BS", major: "Accounting" },
  ];

  function degreeColRank(deg: string): number {
    const idx = DEGREE_COL_ORDER.indexOf(deg);
    return idx >= 0 ? idx : 50;
  }

  function compareHeatmapColKeys(a: string, b: string): number {
    const A = parseHeatmapColKey(a);
    const B = parseHeatmapColKey(b);
    const rd = degreeColRank(A.deg) - degreeColRank(B.deg);
    if (rd !== 0) return rd;
    return A.major.localeCompare(B.major);
  }

  function defaultColRank(colKey: string): number {
    const { deg, major } = parseHeatmapColKey(colKey);
    const idx = DEFAULT_HEATMAP_COLUMNS.findIndex(
      (c) => c.degree === deg && c.major === major,
    );
    return idx === -1 ? 999 : idx;
  }

  function compareHeatmapColKeysWithDefaultsFirst(a: string, b: string): number {
    const da = defaultColRank(a);
    const db = defaultColRank(b);
    if (da !== db) return da - db;
    return compareHeatmapColKeys(a, b);
  }

  function compareClassYearRows(a: string, b: string): number {
    if (a === "Unknown" && b !== "Unknown") return 1;
    if (b === "Unknown" && a !== "Unknown") return -1;
    return a.localeCompare(b);
  }

  // ---------- Data fetching resilience helpers ----------
  // This block provides resilient network behavior:
  // - retries for transient failures,
  // - bounded fan-out to avoid request storms,
  // - and settled-result collection so one failing event does not crash the entire refresh.
  async function fetchWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
    let last: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
        }
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async function mapWithConcurrency<T, U>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<U>,
  ): Promise<PromiseSettledResult<U>[]> {
    const cap = Math.max(1, Math.min(limit, items.length || 1));
    const out: PromiseSettledResult<U>[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        try {
          out[idx] = { status: "fulfilled", value: await fn(items[idx] as T) };
        } catch (err) {
          out[idx] = { status: "rejected", reason: err };
        }
      }
    }
    await Promise.all(Array.from({ length: cap }, () => worker()));
    return out;
  }

  async function loadProfilesWithRetry(): Promise<NonNullable<ListProfilesResult["profiles"]>> {
    let lastErr = "";
    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = await listProfiles();
      if (result.ok && result.profiles) return result.profiles;
      lastErr = result.error ?? "Failed to load profiles";
      if (attempt < 4) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
    }
    throw new Error(lastErr);
  }

  function toHeatColor(count: number, max: number): string {
    if (max <= 0 || count <= 0) return "rgba(80, 0, 0, 0.06)";
    const intensity = count / max;
    const alpha = 0.12 + intensity * 0.68;
    return `rgba(80, 0, 0, ${alpha.toFixed(2)})`;
  }

  function cellCount(row: string, col: string): number {
    return heatmapCells.find((c) => c.row === row && c.col === col)?.count ?? 0;
  }

  function isCheckedIn(r: RsvpRecord): boolean {
    return r.checkedIn === true || !!r.checkedInAt;
  }

  function isConfirmedRsvp(r: RsvpRecord): boolean {
    const s = (r.status ?? "CONFIRMED").toUpperCase();
    return s === "CONFIRMED";
  }

  function sortEventsForPicker(events: EventItem[]): EventItem[] {
    return [...events].sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  function attendanceRatePct(checkins: number, rsvps: number): number | null {
    if (rsvps <= 0) return null;
    return Math.round((checkins / rsvps) * 1000) / 10;
  }

  function sortTopAttendees(rows: TopAttendee[], mode: TopAttendeeMode): TopAttendee[] {
    const copy = [...rows];
    if (mode === "checkin") {
      copy.sort(
        (a, b) =>
          b.checkins - a.checkins ||
          b.rsvps - a.rsvps ||
          a.name.localeCompare(b.name),
      );
    } else if (mode === "rsvp") {
      copy.sort(
        (a, b) =>
          b.rsvps - a.rsvps ||
          b.checkins - a.checkins ||
          a.name.localeCompare(b.name),
      );
    } else {
      copy.sort(
        (a, b) =>
          (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1) ||
          b.rsvps - a.rsvps ||
          b.checkins - a.checkins ||
          a.name.localeCompare(b.name),
      );
    }
    return copy;
  }

  // ---------- Core aggregation pipeline ----------
  // Transforms the canonical snapshots into all UI outputs:
  // - KPI totals,
  // - ranked top-attendee list,
  // - zero-attendance roster,
  // - heatmap rows/cols/cells.
  // Keep business rules centralized here to avoid drift between panels.
  function recomputeAnalytics() {
    const profiles = cachedProfiles;
    const students = profiles.filter((p) => isDashboardStudent(p.role));
    const studentIdSet = new Set(students.map((s) => s.userId ?? "").filter(Boolean));

    const scopedRows =
      selectedEventKey === ALL_EVENTS_KEY
        ? cachedAllRsvpRows
        : cachedAllRsvpRows.filter((r) => r.eventId === selectedEventKey);

    const eventInList = eventsList.some((e) => e.eventId === selectedEventKey);
    totalEvents =
      selectedEventKey === ALL_EVENTS_KEY
        ? eventsList.length
        : eventInList
          ? 1
          : 0;

    const studentScopedCheckins = scopedRows.filter(isCheckedIn).filter((r) => studentIdSet.has(r.userId));
    const uniqueCheckins = Array.from(
      new Map(studentScopedCheckins.map((r) => [`${r.eventId}:${r.userId}`, r])).values(),
    );
    totalCheckins = uniqueCheckins.length;

    const checkinCounts = new Map<string, number>();
    for (const row of uniqueCheckins) {
      checkinCounts.set(row.userId, (checkinCounts.get(row.userId) ?? 0) + 1);
    }

    const studentScopedConfirmed = scopedRows.filter(isConfirmedRsvp).filter((r) => studentIdSet.has(r.userId));
    const uniqueRsvps = Array.from(
      new Map(studentScopedConfirmed.map((r) => [`${r.eventId}:${r.userId}`, r])).values(),
    );
    const rsvpCounts = new Map<string, number>();
    for (const row of uniqueRsvps) {
      rsvpCounts.set(row.userId, (rsvpCounts.get(row.userId) ?? 0) + 1);
    }

    const profileById = new Map(profiles.map((p) => [p.userId ?? "", p]));

    const candidateIds = new Set<string>([...checkinCounts.keys(), ...rsvpCounts.keys()]);
    const built: TopAttendee[] = [];
    for (const userId of candidateIds) {
      const checkins = checkinCounts.get(userId) ?? 0;
      const rsvps = rsvpCounts.get(userId) ?? 0;
      if (checkins === 0 && rsvps === 0) continue;
      const profile = profileById.get(userId);
      if (!profile || !isDashboardStudent(profile.role)) continue;
      built.push({
        userId,
        checkins,
        rsvps,
        attendanceRate: attendanceRatePct(checkins, rsvps),
        name: profile.name ?? "Unknown student",
        email: profile.email ?? userId,
      });
    }

    topAttendeesList = sortTopAttendees(built, topAttendeeMode);

    zeroAttendance = students
      .filter((s) => (checkinCounts.get(s.userId ?? "") ?? 0) === 0)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    const heatCounts = new Map<string, number>();
    for (const student of students) {
      const major = student.major?.trim() || "Undeclared";
      const year = getClassYear(student);
      const deg = normalizeDegree(student);
      const col = heatmapColKey(deg, major);
      const key = `${year}${HEATMAP_ROWCOL_SEP}${col}`;
      const count = checkinCounts.get(student.userId ?? "") ?? 0;
      heatCounts.set(key, (heatCounts.get(key) ?? 0) + count);
    }

    heatmapCells = Array.from(heatCounts.entries()).map(([key, count]) => {
      const i = key.indexOf(HEATMAP_ROWCOL_SEP);
      const row = i === -1 ? key : key.slice(0, i);
      const col = i === -1 ? "" : key.slice(i + HEATMAP_ROWCOL_SEP.length);
      return { row, col, count };
    });
    heatmapRows = Array.from(new Set(heatmapCells.map((c) => c.row))).sort(compareClassYearRows);
    const colSet = new Set(heatmapCells.map((c) => c.col));
    for (const c of DEFAULT_HEATMAP_COLUMNS) {
      colSet.add(heatmapColKey(c.degree, c.major));
    }
    heatmapCols = Array.from(colSet).sort(compareHeatmapColKeysWithDefaultsFirst);
    heatmapMax = Math.max(0, ...heatmapCells.map((c) => c.count));
  }

  function onScopeChange(ev: Event) {
    const el = ev.currentTarget as HTMLSelectElement;
    selectedEventKey = el.value;
    recomputeAnalytics();
  }

  function onTopModeChange(ev: Event) {
    const el = ev.currentTarget as HTMLSelectElement;
    topAttendeeMode = el.value as TopAttendeeMode;
    recomputeAnalytics();
  }

  function closeListModal() {
    listModal = null;
  }

  // Loads source datasets, applies resilience guardrails, then recomputes derived metrics.
  // Handoff note:
  // - We only replace canonical snapshots after a complete refresh OR first successful load.
  // - On partial failures, we keep prior snapshots and show a warning.
  // This prevents refresh-to-refresh KPI inconsistency caused by partial API outages.
  async function loadAnalytics() {
    const requestId = ++latestRequestId;
    loading = true;
    if (!hasLastKnownGoodSnapshot) {
      error = "";
    }
    warning = "";
    try {
      const [events, profiles] = await Promise.all([
        fetchWithRetry(() => listEvents()),
        loadProfilesWithRetry(),
      ]);
      if (requestId !== latestRequestId) return;
      const eventIds = events.map((e) => e.eventId);

      const perEventRsvpsSettled = await mapWithConcurrency(
        eventIds,
        6,
        (eventId) => fetchWithRetry(() => getEventRsvps(eventId)),
      );
      if (requestId !== latestRequestId) return;
      const fulfilledRows = perEventRsvpsSettled
        .filter((r): r is PromiseFulfilledResult<RsvpRecord[]> => r.status === "fulfilled")
        .map((r) => r.value);
      const successCount = fulfilledRows.length;
      const failedCount = perEventRsvpsSettled.length - successCount;
      const rsvpRows = fulfilledRows.flat();

      // Keep a stable dashboard by only replacing canonical snapshot on complete loads.
      if (failedCount === 0 || !hasLastKnownGoodSnapshot) {
        eventsList = sortEventsForPicker(events);
        cachedProfiles = profiles;
        cachedAllRsvpRows = rsvpRows;
        hasLastKnownGoodSnapshot = true;
        error = "";
      } else {
        warning = `Partial refresh: loaded RSVP data for ${successCount}/${perEventRsvpsSettled.length} events. Showing last complete snapshot.`;
      }

      const validIds = new Set(eventsList.map((e) => e.eventId));
      if (selectedEventKey !== ALL_EVENTS_KEY && !validIds.has(selectedEventKey)) {
        selectedEventKey = ALL_EVENTS_KEY;
      }

      recomputeAnalytics();
    } catch (e: unknown) {
      if (!hasLastKnownGoodSnapshot) {
        error = e instanceof Error ? e.message : "Failed to load engagement analytics.";
      } else {
        warning = "Refresh failed. Showing last complete snapshot.";
      }
    } finally {
      if (requestId === latestRequestId) {
        loading = false;
      }
    }
  }

  function formatRate(rate: number | null): string {
    if (rate == null) return "—";
    return `${rate}%`;
  }

  function topAttendeesEmptyMessage(mode: TopAttendeeMode): string {
    if (mode === "rsvp") return "No confirmed student RSVPs in this scope yet.";
    if (mode === "attendanceRate") return "No student attendance-rate data in this scope yet.";
    return "No student check-in data in this scope yet.";
  }
</script>

<!-- ---------- Card shell + global controls ----------
  Entry point for card-level actions:
  - manual refresh trigger,
  - event-scope selector.
  Downstream panels consume derived state only (not raw API responses).
-->
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

  <!-- ---------- Load/error/snapshot warning states ----------
    Priority order:
    1) loading placeholder,
    2) hard error (only when no usable snapshot exists),
    3) content + warning (when showing last-known-good snapshot).
  -->
  {#if loading}
    <p class="muted">Loading check-in analytics...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    {#if warning}
      <p class="warn">{warning}</p>
    {/if}
    <!-- ---------- KPI strip ----------
      High-level summary numbers for the active event scope.
      These are intentionally simple and deterministic so admins can quickly
      spot trend changes before drilling into detailed panels.
    -->
    <div class="kpis">
      <div class="kpi">
        <span class="label">{selectedEventKey === ALL_EVENTS_KEY ? "Events" : "Event"}</span>
        <strong>{totalEvents}</strong>
      </div>
      <div class="kpi">
        <span class="label">Student check-ins</span>
        <strong>{totalCheckins}</strong>
      </div>
      <div class="kpi">
        <span class="label">Zero attendance (students)</span>
        <strong>{zeroAttendance.length}</strong>
      </div>
    </div>

    <!-- ---------- Primary insight panels ----------
      Two complementary lists:
      - top performers (positive signal),
      - zero-attendance roster (intervention signal).
    -->
    <div class="grid">
      <!-- Top attendee ranking panel
        Supports multiple ranking modes without re-fetching data.
        Ranking recalculates from the same snapshot to keep mode switches consistent.
      -->
      <div class="panel">
        <div class="panel-head">
          <h4>Top attendees</h4>
          <label class="inline-label" for="top-attendee-mode">Rank by</label>
          <select
            id="top-attendee-mode"
            class="scope-select narrow"
            value={topAttendeeMode}
            onchange={onTopModeChange}
          >
            <option value="checkin">Check-ins</option>
            <option value="rsvp">RSVPs</option>
            <option value="attendanceRate">Attendance rate</option>
          </select>
        </div>
        {#if topAttendeesList.length === 0}
          <p class="muted">{topAttendeesEmptyMessage(topAttendeeMode)}</p>
        {:else}
          <ul>
            {#each topAttendeesList.slice(0, PREVIEW_TOP) as student}
              <li>
                <span>{student.name}</span>
                <small>{student.email}</small>
                <div class="metrics-line">
                  <span><strong>{student.checkins}</strong> check-in{student.checkins === 1 ? "" : "s"}</span>
                  <span class="sep">·</span>
                  <span><strong>{student.rsvps}</strong> RSVP{student.rsvps === 1 ? "" : "s"}</span>
                  <span class="sep">·</span>
                  <span>Att. rate <strong>{formatRate(student.attendanceRate)}</strong></span>
                </div>
              </li>
            {/each}
          </ul>
          {#if topAttendeesList.length > PREVIEW_TOP}
            <button type="button" class="btn-see-more" onclick={() => (listModal = "top")}>
              See more ({topAttendeesList.length} students)
            </button>
          {/if}
        {/if}
      </div>

      <!-- Zero-attendance roster panel
        Uses the current scope and STUDENT-role filter to identify students
        with no recorded check-ins.
      -->
      <div class="panel">
        <h4>Zero attendance students</h4>
        <p class="muted small-note">Students with role STUDENT and no check-in in the selected scope.</p>
        {#if zeroAttendance.length === 0}
          <p class="muted">All students have at least one check-in.</p>
        {:else}
          <ul>
            {#each zeroAttendance.slice(0, PREVIEW_ZERO) as student}
              <li>
                <span>{student.name || "Unnamed student"}</span>
                <small>{student.email || student.userId || "No email"}</small>
              </li>
            {/each}
          </ul>
          {#if zeroAttendance.length > PREVIEW_ZERO}
            <button type="button" class="btn-see-more" onclick={() => (listModal = "zero")}>
              See more ({zeroAttendance.length} students)
            </button>
          {/if}
        {/if}
      </div>
    </div>

    <!-- Attendance heatmap panel
      Aggregates check-ins by (class year x degree+major) to expose distribution patterns,
      not individual student performance.
    -->
    <div class="panel">
      <h4>Attendance heatmap</h4>
      <p class="muted small-note">
        Rows: class year. Columns: degree plus major (e.g. <span class="nowrap">MS Management Information Systems</span>,
        <span class="nowrap">BS Management Information Systems</span>). Cells sum student check-ins in scope.
      </p>
      {#if heatmapRows.length === 0 || heatmapCols.length === 0}
        <p class="muted">Not enough data to render heatmap.</p>
      {:else}
        <div class="heatmap-wrap">
          <table class="heatmap-table">
            <thead>
              <tr>
                <th>Class year \ Degree + major</th>
                {#each heatmapCols as col}
                  <th class="heatmap-col-head">{heatmapColDisplay(col)}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each heatmapRows as row}
                <tr>
                  <th>{row}</th>
                  {#each heatmapCols as col}
                    {@const count = cellCount(row, col)}
                    <td
                      style={`background:${toHeatColor(count, heatmapMax)}`}
                      title={`${row} / ${heatmapColDisplay(col)}: ${count} check-in(s)`}
                    >
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

<!-- ---------- Full-list modals ----------
  Expanded views for long lists so the main card remains compact.
  Modals read from already-derived state and do not trigger additional API calls.
-->
{#if listModal === "top"}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => e.target === e.currentTarget && closeListModal()} role="presentation">
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-top-title">
      <div class="modal-header">
        <h2 id="modal-top-title">Top attendees</h2>
        <button type="button" class="modal-close" onclick={closeListModal} aria-label="Close">×</button>
      </div>
      <p class="muted modal-sub">Ranked by {topAttendeeMode === "checkin" ? "check-ins" : topAttendeeMode === "rsvp" ? "RSVPs" : "attendance rate"} · STUDENT role only</p>
      <ul class="modal-list">
        {#each topAttendeesList as student}
          <li>
            <span class="modal-name">{student.name}</span>
            <small>{student.email}</small>
            <div class="metrics-line">
              <span><strong>{student.checkins}</strong> check-in{student.checkins === 1 ? "" : "s"}</span>
              <span class="sep">·</span>
              <span><strong>{student.rsvps}</strong> RSVP{student.rsvps === 1 ? "" : "s"}</span>
              <span class="sep">·</span>
              <span>Att. rate <strong>{formatRate(student.attendanceRate)}</strong></span>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

{#if listModal === "zero"}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => e.target === e.currentTarget && closeListModal()} role="presentation">
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-zero-title">
      <div class="modal-header">
        <h2 id="modal-zero-title">Zero attendance students</h2>
        <button type="button" class="modal-close" onclick={closeListModal} aria-label="Close">×</button>
      </div>
      <p class="muted modal-sub">{zeroAttendance.length} students with no check-in in this scope</p>
      <ul class="modal-list">
        {#each zeroAttendance as student}
          <li>
            <span class="modal-name">{student.name || "Unnamed student"}</span>
            <small>{student.email || student.userId || "No email"}</small>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  /* ---------- Card layout + interaction styling ----------
    Styling is grouped by UI region (shell, controls, panels, tables, modals)
    to make handoff edits easier for future teams.
  */
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
  .scope-row,
  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-bottom: 1rem;
  }
  .panel-head {
    margin-bottom: 0.65rem;
  }
  .panel-head h4 {
    margin-right: auto;
  }
  .inline-label {
    font-weight: 600;
    color: var(--text);
    font-size: 0.85rem;
    white-space: nowrap;
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
  .scope-select.narrow {
    min-width: 11rem;
    flex: 0 1 auto;
    max-width: 100%;
  }
  .scope-select:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
  h3,
  h4 {
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
  .btn-see-more {
    margin-top: 0.65rem;
    border: 1px solid var(--maroon);
    background: transparent;
    color: var(--maroon);
    border-radius: var(--radius);
    padding: 0.4rem 0.75rem;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .btn-see-more:hover {
    background: rgba(80, 0, 0, 0.06);
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
  .small-note {
    font-size: 0.8rem;
    margin: 0 0 0.5rem;
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
  .metrics-line {
    font-size: 0.85rem;
    color: var(--text);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.35rem;
  }
  .metrics-line .sep {
    color: var(--text-muted);
    user-select: none;
  }
  small,
  .muted {
    color: var(--text-muted);
  }
  .error {
    color: #b3261e;
  }
  .warn {
    color: #8a5a00;
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
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
  .heatmap-col-head {
    max-width: 11rem;
    font-size: 0.78rem;
    line-height: 1.25;
    font-weight: 600;
    white-space: normal;
  }
  .nowrap {
    white-space: nowrap;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 2rem 1rem;
    overflow-y: auto;
  }
  .modal-dialog {
    width: min(520px, 100%);
    max-height: min(85vh, 720px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--maroon);
    font-family: var(--font-heading);
  }
  .modal-close {
    border: none;
    background: transparent;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.15rem 0.35rem;
  }
  .modal-close:hover {
    color: var(--text);
  }
  .modal-sub {
    margin: 0;
    padding: 0.5rem 1rem 0;
    font-size: 0.82rem;
  }
  .modal-list {
    margin: 0;
    padding: 0.75rem 1rem 1rem;
    overflow-y: auto;
    list-style: none;
    display: grid;
    gap: 0.6rem;
  }
  .modal-list li {
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
  }
  .modal-list li:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .modal-name {
    font-weight: 600;
  }
</style>
