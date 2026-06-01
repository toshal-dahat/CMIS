<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getLatestMentorshipMatchingRun,
    getMentorshipMatchingSchedule,
    listMentorshipMatchingRuns,
    putMentorshipMatchingSchedule,
    startMentorshipMatchingRun,
    type MentorshipMatchingRunDetail,
    type MentorshipMatchingRunSummary,
    type MentorshipMatchingSchedule,
  } from '../../admin-api/mentorship-matching';

  let busyRun = false;
  let busySchedule = false;
  let loading = true;
  let error: string | null = null;
  let success: string | null = null;

  let latestRun: MentorshipMatchingRunDetail | null = null;
  let runHistory: MentorshipMatchingRunSummary[] = [];
  let schedule: MentorshipMatchingSchedule = {
    enabled: true,
    cronExpression: 'cron(0 6 1 9 ? *)',
    timezone: 'UTC',
  };
  let scheduleDate = '';
  let scheduleTime = '06:00';
  let selectedTimezone = 'UTC';

  const TIMEZONE_OPTIONS = [
    'UTC',
    'America/Chicago',
    'America/New_York',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Asia/Kolkata',
    'Asia/Singapore',
  ];

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  function toDateInputValue(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseSimpleCron(cronExpression: string | undefined): { date: string; time: string } | null {
    const raw = String(cronExpression || '').trim();
    const m = raw.match(/^cron\((\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+\?\s+\*\)$/);
    if (!m) return null;
    const minute = Number(m[1]);
    const hour = Number(m[2]);
    const day = Number(m[3]);
    const month = Number(m[4]);
    if (
      !Number.isInteger(minute) || minute < 0 || minute > 59 ||
      !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(day) || day < 1 || day > 31 ||
      !Number.isInteger(month) || month < 1 || month > 12
    ) {
      return null;
    }
    const year = new Date().getFullYear();
    return {
      date: `${year}-${pad2(month)}-${pad2(day)}`,
      time: `${pad2(hour)}:${pad2(minute)}`,
    };
  }

  function composeSimpleCronFromInputs(): string {
    const now = new Date();
    const datePart = scheduleDate || toDateInputValue(now);
    const [yearStr, monthStr, dayStr] = datePart.split('-');
    const [hourStr, minuteStr] = (scheduleTime || '06:00').split(':');
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 31 ||
      !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59
    ) {
      throw new Error('Please select a valid schedule date and time.');
    }
    void yearStr;
    return `cron(${minute} ${hour} ${day} ${month} ? *)`;
  }

  function syncScheduleInputsFromModel(): void {
    selectedTimezone = String(schedule.timezone || 'UTC').trim() || 'UTC';
    const parsed = parseSimpleCron(schedule.cronExpression);
    if (parsed) {
      scheduleDate = parsed.date;
      scheduleTime = parsed.time;
      return;
    }
    const today = new Date();
    scheduleDate = toDateInputValue(today);
    scheduleTime = '06:00';
  }

  function asPairs(): Array<Record<string, unknown>> {
    const raw = latestRun?.snapshot?.pairs;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p === 'object')
      .slice()
      .sort((a, b) => {
        const ta = String(a.updatedAt || '');
        const tb = String(b.updatedAt || '');
        return tb.localeCompare(ta);
      });
  }

  function latestScheduledRun(): MentorshipMatchingRunSummary | MentorshipMatchingRunDetail | null {
    if (latestRun && String(latestRun.triggerSource || '').toLowerCase() === 'schedule') return latestRun;
    for (const r of runHistory) {
      if (String(r.triggerSource || '').toLowerCase() === 'schedule') return r;
    }
    return null;
  }

  function latestManualRun(): MentorshipMatchingRunSummary | MentorshipMatchingRunDetail | null {
    if (latestRun && String(latestRun.triggerSource || '').toLowerCase() === 'manual') return latestRun;
    for (const r of runHistory) {
      if (String(r.triggerSource || '').toLowerCase() === 'manual') return r;
    }
    return null;
  }

  function configuredScheduleLabel(): string {
    const date = (scheduleDate || '').trim();
    const time = (scheduleTime || '').trim();
    const tz = (selectedTimezone || 'UTC').trim();
    if (!date || !time) return `Configured timezone: ${tz}`;
    return `${date} at ${time} (${tz})`;
  }
  onMount(async () => {
    await refreshAll();
  });

  async function refreshAll(): Promise<void> {
    loading = true;
    error = null;
    try {
      const [latest, history, sched] = await Promise.all([
        getLatestMentorshipMatchingRun().catch(() => ({ run: undefined })),
        listMentorshipMatchingRuns(20).catch(() => ({ runs: [] })),
        getMentorshipMatchingSchedule().catch(() => ({
          enabled: true,
          cronExpression: 'cron(0 6 1 9 ? *)',
          timezone: 'UTC',
          source: 'defaults',
        })),
      ]);
      latestRun = latest.run ?? null;
      runHistory = history.runs ?? [];
      schedule = { ...schedule, ...sched };
      syncScheduleInputsFromModel();
    } catch (e: any) {
      error = e?.message || 'Failed to load mentorship operator data.';
    } finally {
      loading = false;
    }
  }

  async function runNow(resetMatches: boolean): Promise<void> {
    busyRun = true;
    error = null;
    success = null;
    try {
      const run = await startMentorshipMatchingRun({ resetMatches, runBatchMatching: true });
      success = resetMatches
        ? `Matching run completed after reset (runId: ${run.runId || 'n/a'}).`
        : `Matching run completed (runId: ${run.runId || 'n/a'}).`;

      // POST returns a summary payload; fetch latest run detail to get full snapshot pairs.
      const latest = await getLatestMentorshipMatchingRun().catch(() => ({ run: undefined }));
      latestRun = latest.run ?? run;

      const hist = await listMentorshipMatchingRuns(20).catch(() => ({ runs: [] }));
      runHistory = hist.runs ?? [];
    } catch (e: any) {
      error = e?.message || 'Failed to run mentorship matching.';
    } finally {
      busyRun = false;
    }
  }

  async function saveSchedule(): Promise<void> {
    busySchedule = true;
    error = null;
    success = null;
    try {
      const computedCron = composeSimpleCronFromInputs();
      schedule = await putMentorshipMatchingSchedule({
        enabled: Boolean(schedule.enabled),
        cronExpression: computedCron,
        timezone: selectedTimezone,
      });
      syncScheduleInputsFromModel();
      success = 'Mentorship schedule settings saved.';
    } catch (e: any) {
      error = e?.message || 'Failed to update mentorship schedule.';
    } finally {
      busySchedule = false;
    }
  }
</script>

<section class="section">
  <div class="section-header">
    <h2 class="section-title">🎛️ Mentorship Operator</h2>
    <button class="btn-add" onclick={() => void refreshAll()} disabled={loading}>Refresh</button>
  </div>

  {#if error}
    <div class="error-message"><strong>Error:</strong> {error}</div>
  {/if}
  {#if success}
    <div class="success-message">{success}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading mentorship operator panel…</div>
  {:else}
    <div class="cards-grid">
      <div class="card">
        <div class="card-icon">🚀</div>
        <div class="card-title">Run matching</div>
        <div class="card-content">
          <p class="hint">Manually trigger a mentorship matching batch now.</p>
          <div class="card-actions">
            <button class="btn-add" onclick={() => void runNow(false)} disabled={busyRun}>
              {busyRun ? 'Running…' : 'Run now'}
            </button>
            <button
              class="btn-delete"
              onclick={() => {
                if (confirm('Reset all mentorship match rows and run matching now?')) {
                  void runNow(true);
                }
              }}
              disabled={busyRun}>Reset + run</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-icon">⏱️</div>
        <div class="card-title">Matching schedule</div>
        <div class="card-content form-grid">
          <label>Enabled
            <select bind:value={schedule.enabled}>
              <option value={true}>Yes</option>
              <option value={false}>No</option>
            </select>
          </label>
          <label>Date
            <input type="date" bind:value={scheduleDate} />
          </label>
          <label>Time
            <input type="time" bind:value={scheduleTime} />
          </label>
          <label>Timezone
            <select bind:value={selectedTimezone}>
              {#each TIMEZONE_OPTIONS as tz}
                <option value={tz}>{tz}</option>
              {/each}
            </select>
          </label>
          <button class="btn-add" onclick={() => void saveSchedule()} disabled={busySchedule}>
            {busySchedule ? 'Saving…' : 'Save schedule'}
          </button>
          <div
            class="schedule-status"
            class:schedule-status-ok={!!latestScheduledRun()}
            class:schedule-status-warn={!latestScheduledRun()}
            role="status"
          >
            <div class="schedule-status-title">
              {#if latestScheduledRun()}
                ✅ Yes - schedule ran
              {:else}
                ⏳ Not yet - no scheduled run recorded
              {/if}
            </div>
            <div class="schedule-status-line">
              {#if latestScheduledRun()}
                Last scheduled run: {String(latestScheduledRun()?.finishedAt || latestScheduledRun()?.startedAt || '—')}
                · {String(latestScheduledRun()?.status || 'COMPLETED')}
              {:else}
                Current schedule: {configuredScheduleLabel()}
              {/if}
            </div>
            {#if latestManualRun() && !latestScheduledRun()}
              <div class="schedule-status-subline">
                Latest manual run exists: {String(latestManualRun()?.finishedAt || latestManualRun()?.startedAt || '—')}.
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-icon">📌</div>
        <div class="card-title">Last run</div>
        <div class="card-content">
          {#if latestRun}
            <div class="card-row"><span class="card-label">Run ID</span><span class="card-value">{latestRun.runId || '—'}</span></div>
            <div class="card-row"><span class="card-label">Status</span><span class="card-value">{latestRun.status || '—'}</span></div>
            <div class="card-row"><span class="card-label">Started</span><span class="card-value">{latestRun.startedAt || '—'}</span></div>
            <div class="card-row"><span class="card-label">Finished</span><span class="card-value">{latestRun.finishedAt || '—'}</span></div>
            <div class="card-row">
              <span class="card-label">Snapshot</span>
              <span class="card-value">
                {latestRun.snapshotSummary?.pairCount ?? 0} pairs · {latestRun.snapshotSummary?.mentorCount ?? 0} mentors
              </span>
            </div>
          {:else}
            <p class="hint">No stored run data yet.</p>
          {/if}
        </div>
      </div>

      <div class="card">
        <div class="card-icon">🕒</div>
        <div class="card-title">Recent history</div>
        <div class="card-content">
          {#if runHistory.length === 0}
            <p class="hint">No runs found.</p>
          {:else}
            {#each runHistory.slice(0, 6) as r}
              <div class="card-row">
                <span class="card-label">{r.runId?.slice(0, 8) || 'run'}</span>
                <span class="card-value">{r.status || '—'} · {r.triggerSource || 'manual'}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>

    <div class="card matches-card">
      <div class="card-icon">🧩</div>
      <div class="card-title">All matches (who matched with whom)</div>
      <div class="card-content">
        {#if asPairs().length === 0}
          <p class="hint">No match pairs available yet. Run matching and refresh to view all pairings.</p>
        {:else}
          <div class="matches-table-wrap">
            <table class="matches-table">
              <thead>
                <tr>
                  <th>Mentor</th>
                  <th>Mentee</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {#each asPairs() as p}
                  <tr>
                    <td>{String(p.mentorName || p.mentorUserId || '—')}</td>
                    <td>{String(p.menteeName || p.menteeUserId || '—')}</td>
                    <td>{String(p.status || '—')}</td>
                    <td>{String(p.updatedAt || '—')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>

    <div class="freshness-note">
      Embedding freshness policy: runs may wait up to 60 minutes for profile/resume updates, then proceed best-effort.
    </div>
  {/if}
</section>

<style>
  .section {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .section-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: clamp(1.7rem, 3vw, 2.2rem);
    color: var(--maroon);
    letter-spacing: -0.01em;
  }

  .loading {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0;
    font-size: 1rem;
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 1.1rem 1rem;
  }

  .matches-card {
    margin-top: 1rem;
  }

  .card-icon {
    font-size: 1.1rem;
    margin-bottom: 0.35rem;
  }

  .card-title {
    margin: 0;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: 1.1rem;
    font-weight: 700;
  }

  .card-content {
    margin-top: 0.6rem;
  }

  .hint {
    margin: 0 0 0.8rem;
    color: var(--text-muted);
    font-size: 0.92rem;
    line-height: 1.45;
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }

  .card-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
  }

  .card-row:last-child {
    border-bottom: none;
  }

  .card-label {
    color: var(--text-muted);
    font-weight: 600;
  }

  .card-value {
    color: var(--text);
    text-align: right;
    word-break: break-word;
  }

  .matches-table-wrap {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .schedule-status {
    margin-top: 0.3rem;
    border-radius: var(--radius);
    padding: 0.5rem 0.6rem;
    border: 1px solid transparent;
  }

  .schedule-status-ok {
    border-color: #86efac;
    background: #f0fdf4;
    color: #166534;
  }

  .schedule-status-warn {
    border-color: #fbbf24;
    background: #fffbeb;
    color: #92400e;
  }

  .schedule-status-title {
    font-size: 0.88rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .schedule-status-line {
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.35;
    margin-top: 0.15rem;
  }

  .schedule-status-subline {
    margin-top: 0.2rem;
    font-size: 0.82rem;
    opacity: 0.9;
  }
  .matches-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    min-width: 680px;
    background: var(--card-bg);
  }

  .matches-table th,
  .matches-table td {
    text-align: left;
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  .matches-table th {
    font-weight: 700;
    color: var(--maroon);
    background: var(--bg-warm);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .matches-table tr:last-child td {
    border-bottom: none;
  }

  .error-message {
    background: #dc2626;
    color: #fff;
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .success-message {
    background: #166534;
    color: #fff;
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .form-grid {
    display: grid;
    gap: 0.7rem;
  }

  .form-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.88rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .form-grid input[type='text'],
  .form-grid input[type='date'],
  .form-grid input[type='time'],
  .form-grid select {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--text);
    padding: 0.55rem 0.65rem;
    font-size: 0.92rem;
    box-sizing: border-box;
  }

  .form-grid input:focus,
  .form-grid select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px var(--maroon-muted);
  }

  .btn-add,
  .btn-delete {
    border-radius: var(--radius);
    padding: 0.55rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 700;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-add {
    color: #fff;
    background: var(--maroon);
    border-color: var(--maroon);
  }

  .btn-add:hover:not(:disabled) {
    background: var(--maroon-dark);
    border-color: var(--maroon-dark);
    transform: translateY(-1px);
  }

  .btn-delete {
    color: #b42318;
    background: #fff;
    border-color: #ef4444;
  }

  .btn-delete:hover:not(:disabled) {
    background: #ef4444;
    color: #fff;
    transform: translateY(-1px);
  }

  .btn-add:disabled,
  .btn-delete:disabled {
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }

  .freshness-note {
    margin-top: 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
    text-align: center;
  }

  @media (max-width: 768px) {
    .section {
      padding: 1.2rem 1rem 2rem;
    }

    .section-header {
      flex-direction: column;
      align-items: stretch;
    }

    .btn-add {
      width: 100%;
      justify-content: center;
    }

    .cards-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
