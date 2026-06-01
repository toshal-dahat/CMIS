<script lang="ts">
  import { onMount } from "svelte";
  import { currentView } from "./stores/viewStore";
  import {
    getEventSuccessAnalytics,
    getSurveyTemplate,
    saveSurveyTemplate,
    sendSurveyEmails,
    listEvents,
    type EventSuccessAnalytics,
    type EventCategoryAnalytics,
    type EventItem,
    type SurveyQuestion,
  } from "./events-api";

  let loading = $state(true);
  let error = $state("");
  let data = $state<EventSuccessAnalytics | null>(null);

  // Survey management section
  let surveyPanelOpen = $state(false);
  let eventsList = $state<EventItem[]>([]);
  let selectedEventId = $state("");
  let templateQuestions = $state<SurveyQuestion[]>([]);
  let templateLoading = $state(false);
  let templateSaving = $state(false);
  let templateError = $state("");
  let sendingSurvey = $state(false);
  let sendResult = $state<{ sent: number; total: number } | null>(null);

  const CHART_HEIGHT = 200;

  onMount(async () => {
    await loadAnalytics();
  });

  async function loadAnalytics() {
    loading = true;
    error = "";
    try {
      data = await getEventSuccessAnalytics();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load analytics.";
    } finally {
      loading = false;
    }
  }

  async function openSurveyPanel() {
    surveyPanelOpen = true;
    if (eventsList.length === 0) {
      try {
        const events = await listEvents();
        eventsList = [...events].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        if (eventsList.length > 0 && !selectedEventId) {
          selectedEventId = eventsList[0].eventId;
          await loadTemplate(selectedEventId);
        }
      } catch {
        templateError = "Failed to load events.";
      }
    }
  }

  async function loadTemplate(eventId: string) {
    templateLoading = true;
    templateError = "";
    sendResult = null;
    try {
      const tpl = await getSurveyTemplate(eventId);
      templateQuestions = tpl.questions.map(q => ({ ...q }));
    } catch (e) {
      templateError = e instanceof Error ? e.message : "Failed to load template.";
    } finally {
      templateLoading = false;
    }
  }

  async function onEventChange(ev: Event) {
    const id = (ev.currentTarget as HTMLSelectElement).value;
    selectedEventId = id;
    if (id) await loadTemplate(id);
  }

  function addQuestion() {
    templateQuestions = [
      ...templateQuestions,
      { id: `q${Date.now()}`, text: "", type: "rating", min: 1, max: 5 },
    ];
  }

  function removeQuestion(index: number) {
    templateQuestions = templateQuestions.filter((_, i) => i !== index);
  }

  function updateQuestion(index: number, field: keyof SurveyQuestion, value: string | number) {
    templateQuestions = templateQuestions.map((q, i) =>
      i === index ? { ...q, [field]: value } : q
    );
  }

  async function saveTemplate() {
    if (!selectedEventId) return;
    templateSaving = true;
    templateError = "";
    try {
      await saveSurveyTemplate(selectedEventId, templateQuestions);
    } catch (e) {
      templateError = e instanceof Error ? e.message : "Failed to save template.";
    } finally {
      templateSaving = false;
    }
  }

  async function sendSurvey() {
    if (!selectedEventId) return;
    const event = eventsList.find(e => e.eventId === selectedEventId);
    const confirmed = window.confirm(
      `Send survey emails to all checked-in attendees of "${event?.title || selectedEventId}"?`
    );
    if (!confirmed) return;
    sendingSurvey = true;
    sendResult = null;
    templateError = "";
    try {
      sendResult = await sendSurveyEmails(selectedEventId);
    } catch (e) {
      templateError = e instanceof Error ? e.message : "Failed to send surveys.";
    } finally {
      sendingSurvey = false;
    }
  }

  function maxCount(categories: EventCategoryAnalytics[]): number {
    return Math.max(1, ...categories.map(c => Math.max(c.rsvpCount, c.checkinCount)));
  }

  function barHeight(value: number, max: number): number {
    return Math.round((value / max) * CHART_HEIGHT);
  }

  function ratingBarHeight(rating: number | null): number {
    if (rating === null) return 0;
    return Math.round((rating / 5) * CHART_HEIGHT);
  }

  function titleCase(s: string): string {
    return s.charAt(0) + s.slice(1).toLowerCase();
  }

  function formatRate(rate: number): string {
    return `${rate}%`;
  }

  function formatRating(r: number | null): string {
    return r === null ? "—" : r.toFixed(1);
  }

  function goBack() {
    currentView.set("landing");
  }
</script>

<div class="page">
  <div class="inner">
    <button type="button" class="back-link" onclick={goBack}>
      <span class="back-arrow">←</span> Back to home
    </button>
    <h1>Event Success Analytics</h1>
    <p>RSVP count vs. actual check-ins vs. survey rating — by event category.</p>

    {#if loading}
      <p class="muted">Loading analytics...</p>
    {:else if error}
      <p class="error">{error}</p>
      <button type="button" class="btn-secondary" onclick={loadAnalytics}>Retry</button>
    {:else if data}
      <!-- KPI row -->
      <div class="kpis">
        <div class="kpi">
          <span class="kpi-label">Total Events</span>
          <strong class="kpi-value">{data.totals.totalEvents}</strong>
        </div>
        <div class="kpi">
          <span class="kpi-label">Total RSVPs</span>
          <strong class="kpi-value">{data.totals.totalRsvps}</strong>
        </div>
        <div class="kpi">
          <span class="kpi-label">Total Check-ins</span>
          <strong class="kpi-value">{data.totals.totalCheckins}</strong>
        </div>
        <div class="kpi">
          <span class="kpi-label">Overall Check-in Rate</span>
          <strong class="kpi-value">{formatRate(data.totals.overallCheckinRate)}</strong>
        </div>
        <div class="kpi">
          <span class="kpi-label">Overall Avg Rating</span>
          <strong class="kpi-value">{formatRating(data.totals.overallAvgRating)} <span class="kpi-sub">/ 5</span></strong>
        </div>
      </div>

      {#if data.categories.length === 0}
        <p class="muted">No event data yet.</p>
      {:else}
        {@const cmax = maxCount(data.categories)}

        <!-- Chart -->
        <div class="panel chart-panel">
          <h3>RSVP vs Check-ins vs Survey Rating by Category</h3>
          <div class="legend">
            <span class="legend-dot rsvp-dot"></span><span>RSVPs</span>
            <span class="legend-dot checkin-dot"></span><span>Check-ins</span>
            <span class="legend-dot rating-dot"></span><span>Avg Rating (×{(CHART_HEIGHT / 5).toFixed(0)} px/point, max 5)</span>
          </div>
          <div class="chart-wrap">
            <div class="y-axis">
              <span>{cmax}</span>
              <span>{Math.round(cmax / 2)}</span>
              <span>0</span>
            </div>
            <div class="chart-body">
              {#each data.categories as cat (cat.category)}
                <div class="chart-group">
                  <div class="bars">
                    <div
                      class="bar rsvp-bar"
                      style="height:{barHeight(cat.rsvpCount, cmax)}px"
                      title="RSVPs: {cat.rsvpCount}"
                    >
                      {#if barHeight(cat.rsvpCount, cmax) > 22}
                        <span class="bar-label">{cat.rsvpCount}</span>
                      {/if}
                    </div>
                    <div
                      class="bar checkin-bar"
                      style="height:{barHeight(cat.checkinCount, cmax)}px"
                      title="Check-ins: {cat.checkinCount}"
                    >
                      {#if barHeight(cat.checkinCount, cmax) > 22}
                        <span class="bar-label">{cat.checkinCount}</span>
                      {/if}
                    </div>
                    {#if cat.avgSurveyRating !== null}
                      <div
                        class="bar rating-bar"
                        style="height:{ratingBarHeight(cat.avgSurveyRating)}px"
                        title="Avg Rating: {formatRating(cat.avgSurveyRating)} / 5"
                      >
                        {#if ratingBarHeight(cat.avgSurveyRating) > 22}
                          <span class="bar-label">{formatRating(cat.avgSurveyRating)}</span>
                        {/if}
                      </div>
                    {:else}
                      <div class="bar-no-rating" title="No survey responses yet">—</div>
                    {/if}
                  </div>
                  <div class="chart-label">{titleCase(cat.category)}</div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Detail table -->
        <div class="panel">
          <h3>Category Breakdown</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="num">Events</th>
                  <th class="num">RSVPs</th>
                  <th class="num">Check-ins</th>
                  <th class="num">Check-in Rate</th>
                  <th class="num">Avg Rating</th>
                  <th class="num">Survey Responses</th>
                </tr>
              </thead>
              <tbody>
                {#each data.categories as cat (cat.category)}
                  <tr>
                    <td>{titleCase(cat.category)}</td>
                    <td class="num">{cat.eventCount}</td>
                    <td class="num">{cat.rsvpCount}</td>
                    <td class="num">{cat.checkinCount}</td>
                    <td class="num">{formatRate(cat.checkinRate)}</td>
                    <td class="num">{formatRating(cat.avgSurveyRating)}</td>
                    <td class="num">{cat.surveyResponseCount}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    {/if}

    <!-- Survey management -->
    <div class="panel survey-panel">
      <button
        type="button"
        class="collapsible-head"
        onclick={() => { surveyPanelOpen = !surveyPanelOpen; if (surveyPanelOpen) openSurveyPanel(); }}
      >
        <h3>Manage Surveys</h3>
        <span class="chevron">{surveyPanelOpen ? "▲" : "▼"}</span>
      </button>

      {#if surveyPanelOpen}
        <div class="survey-body">
          {#if eventsList.length === 0 && !templateLoading}
            <p class="muted">No events found.</p>
          {:else}
            <div class="form-row">
              <label for="survey-event-select">Event</label>
              <select
                id="survey-event-select"
                value={selectedEventId}
                onchange={onEventChange}
                disabled={templateLoading}
              >
                {#each eventsList as evt (evt.eventId)}
                  <option value={evt.eventId}>{evt.title || evt.eventId}</option>
                {/each}
              </select>
            </div>

            {#if templateLoading}
              <p class="muted">Loading template...</p>
            {:else}
              <div class="questions-list">
                {#each templateQuestions as q, i (i)}
                  <div class="question-row">
                    <span class="q-num">{i + 1}.</span>
                    <input
                      type="text"
                      class="q-text"
                      placeholder="Question text"
                      value={q.text}
                      oninput={(e) => updateQuestion(i, "text", (e.currentTarget as HTMLInputElement).value)}
                    />
                    <span class="q-type">Rating 1–5</span>
                    {#if q.id !== "overall"}
                      <button type="button" class="btn-remove" onclick={() => removeQuestion(i)}>✕</button>
                    {/if}
                  </div>
                {/each}
              </div>

              <div class="survey-actions">
                <button type="button" class="btn-secondary" onclick={addQuestion}>+ Add Question</button>
                <button
                  type="button"
                  class="btn-primary"
                  onclick={saveTemplate}
                  disabled={templateSaving}
                >
                  {templateSaving ? "Saving..." : "Save Template"}
                </button>
                <button
                  type="button"
                  class="btn-send"
                  onclick={sendSurvey}
                  disabled={sendingSurvey || !selectedEventId}
                >
                  {sendingSurvey ? "Sending..." : "Send Survey to Attendees"}
                </button>
              </div>

              {#if sendResult}
                <p class="send-success">
                  Sent {sendResult.sent} of {sendResult.total} survey email{sendResult.total === 1 ? "" : "s"}.
                </p>
              {/if}
              {#if templateError}
                <p class="error">{templateError}</p>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .page {
    width: 100%;
    min-height: 100vh;
    padding: 2rem 1.5rem 3.5rem;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 50%, #f0ebe6 100%);
  }
  .inner {
    max-width: 1200px;
    margin: 0 auto;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 1rem;
    color: var(--maroon);
    font-weight: 600;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .back-arrow { font-size: 1.2rem; }
  h1 {
    margin: 0 0 0.25rem;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(1.9rem, 4vw, 2.5rem);
  }
  h3 { margin: 0; color: var(--maroon); font-family: var(--font-heading); }
  p { margin: 0 0 1rem; color: var(--text-muted); }
  .muted { color: var(--text-muted); }
  .error { color: #b3261e; margin: 0.5rem 0 0; }

  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .kpi {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    display: grid;
    gap: 0.2rem;
  }
  .kpi-label { color: var(--text-muted); font-size: 0.8rem; }
  .kpi-value { font-size: 1.5rem; font-weight: 700; color: var(--maroon); }
  .kpi-sub { font-size: 0.85rem; font-weight: 400; color: var(--text-muted); }

  .panel {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: var(--shadow);
  }
  .chart-panel h3 { margin-bottom: 0.75rem; }

  /* Legend */
  .legend {
    display: flex;
    align-items: center;
    gap: 0.5rem 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    color: var(--text);
  }
  .legend-dot {
    width: 12px; height: 12px;
    border-radius: 2px;
    display: inline-block;
  }
  .rsvp-dot    { background: var(--maroon); }
  .checkin-dot { background: #2e7d32; }
  .rating-dot  { background: #b45309; }

  /* Chart */
  .chart-wrap {
    display: flex;
    align-items: flex-end;
    gap: 0;
    overflow-x: auto;
    padding-bottom: 0.5rem;
  }
  .y-axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: calc(200px + 1rem);
    padding-bottom: 1.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: right;
    min-width: 2.5rem;
    flex-shrink: 0;
  }
  .chart-body {
    display: flex;
    align-items: flex-end;
    gap: 1.25rem;
    padding: 0 0.5rem;
    min-height: calc(200px + 1.5rem);
  }
  .chart-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 200px;
  }
  .bar {
    width: 28px;
    border-radius: 3px 3px 0 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 3px;
    transition: height 0.3s ease;
    min-height: 2px;
  }
  .bar-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: #fff;
    line-height: 1;
  }
  .rsvp-bar    { background: var(--maroon); }
  .checkin-bar { background: #2e7d32; }
  .rating-bar  { background: #b45309; min-height: 0; }
  .bar-no-rating {
    width: 28px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 2px;
    color: var(--text-muted);
    font-size: 0.75rem;
    border-bottom: 1px dashed var(--border);
  }
  .chart-label {
    font-size: 0.78rem;
    color: var(--text);
    text-align: center;
    max-width: 90px;
    line-height: 1.2;
    word-break: break-word;
  }

  /* Table */
  .table-wrap { overflow-x: auto; margin-top: 0.75rem; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 0.45rem 0.6rem;
    text-align: left;
  }
  th {
    background: var(--bg);
    font-weight: 600;
    color: var(--text);
  }
  td.num, th.num { text-align: right; }

  /* Survey management */
  .survey-panel { padding: 0; }
  .collapsible-head {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .chevron { color: var(--text-muted); font-size: 0.85rem; }
  .survey-body { padding: 0 1.25rem 1.25rem; border-top: 1px solid var(--border); }

  .form-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
    flex-wrap: wrap;
  }
  .form-row label { font-weight: 600; font-size: 0.9rem; }
  .form-row select {
    flex: 1 1 16rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 0.9rem;
  }

  .questions-list { display: grid; gap: 0.5rem; margin-bottom: 1rem; }
  .question-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .q-num { font-weight: 600; color: var(--text-muted); min-width: 1.2rem; }
  .q-text {
    flex: 1 1 16rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 0.9rem;
  }
  .q-type { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; }
  .btn-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0.2rem 0.35rem;
  }
  .btn-remove:hover { color: #b3261e; }

  .survey-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.75rem; }

  .btn-primary, .btn-secondary, .btn-send {
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--maroon);
    color: #fff;
    border: none;
  }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-secondary {
    background: transparent;
    color: var(--maroon);
    border: 1px solid var(--maroon);
  }
  .btn-send {
    background: #2e7d32;
    color: #fff;
    border: none;
  }
  .btn-send:disabled { opacity: 0.6; cursor: not-allowed; }

  .send-success { color: #2e7d32; font-weight: 600; margin-top: 0.5rem; }
</style>
