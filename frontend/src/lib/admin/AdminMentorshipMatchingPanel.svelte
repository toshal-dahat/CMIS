<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getMentorshipMenteeCapDiagnostics,
    getMentorshipMatchingRunById,
    getLatestMentorshipMatchingRun,
    getMentorshipMatchingSchedule,
    listMentorshipMatchingRuns,
    putMentorshipMatchingSchedule,
    repairMentorshipMenteeCapDiagnostics,
    startMentorshipMatchingRun,
    type MentorshipMenteeCapDiagnosticItem,
    type MentorshipMatchingRunDetail,
    type MentorshipMatchingRunSummary,
    type MentorshipMatchingSchedule,
  } from '../../admin-api/mentorship-matching';

  let busyRun = false;
  let busySchedule = false;
  let loading = true;
  let error: string | null = null;
  let success: string | null = null;
  let runProgressActive = false;
  let runProgressMessage = '';
  let runProgressStartedAt = 0;
  let busyDiagnostics = false;
  let busyRepair = false;
  let diagnosticsRows: MentorshipMenteeCapDiagnosticItem[] = [];
  let diagnosticsSummary = '';
  let diagnosticsDriftOnly = true;
  let diagnosticsLimit = 200;
  let runProgressTimer: ReturnType<typeof setInterval> | null = null;

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
  let matchSearch = '';
  let matchStatusFilter = 'ALL';
  let matchMentorFilter = 'ALL';

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

  function latestSnapshotSummary(): { pairCount: number; mentorCount: number } {
    const run = latestRun;
    if (!run) return { pairCount: 0, mentorCount: 0 };
    const fromSummary = run.snapshotSummary;
    if (fromSummary) {
      return {
        pairCount: Number(fromSummary.pairCount || 0),
        mentorCount: Number(fromSummary.mentorCount || 0),
      };
    }
    const snap = run.snapshot;
    return {
      pairCount: Number(snap?.pairCount || 0),
      mentorCount: Array.isArray(snap?.mentors) ? snap!.mentors!.length : 0,
    };
  }

  function uniqueStatuses(): string[] {
    const set = new Set<string>();
    for (const p of asPairs()) {
      const s = String(p.status || '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function uniqueMentors(): string[] {
    const set = new Set<string>();
    for (const p of asPairs()) {
      const m = String(p.mentorName || p.mentorUserId || '').trim();
      if (m) set.add(m);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function filteredPairs(): Array<Record<string, unknown>> {
    const q = matchSearch.trim().toLowerCase();
    return asPairs().filter((p) => {
      const mentor = String(p.mentorName || p.mentorUserId || '').trim();
      const mentee = String(p.menteeName || p.menteeUserId || '').trim();
      const status = String(p.status || '').trim();
      if (matchMentorFilter !== 'ALL' && mentor !== matchMentorFilter) return false;
      if (matchStatusFilter !== 'ALL' && status !== matchStatusFilter) return false;
      if (!q) return true;
      return (
        mentor.toLowerCase().includes(q) ||
        mentee.toLowerCase().includes(q) ||
        status.toLowerCase().includes(q) ||
        String(p.updatedAt || '').toLowerCase().includes(q)
      );
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

  function scheduleEnabledLabel(): string {
    return Boolean(schedule.enabled) ? 'Yes' : 'No';
  }

  function runProgressElapsedLabel(): string {
    if (!runProgressStartedAt) return '';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - runProgressStartedAt) / 1000));
    return `${elapsedSec}s elapsed`;
  }

  onMount(() => {
    void refreshAll();
    return () => {
      if (runProgressTimer) {
        clearInterval(runProgressTimer);
        runProgressTimer = null;
      }
    };
  });

  async function ensureLatestRunHasSnapshotPairs(): Promise<void> {
    // Keep the true latest run visible, even when it legitimately has 0 pairs.
    // Falling back to an older run with pairs makes the operator table look stale/confusing.
    if (latestRun && latestRun.snapshot) return;
    const candidateRunIds: string[] = [];
    const latestId = String(latestRun?.runId || '').trim();
    if (latestId) candidateRunIds.push(latestId);
    for (const r of runHistory) {
      const id = String(r?.runId || '').trim();
      if (!id || candidateRunIds.includes(id)) continue;
      candidateRunIds.push(id);
    }
    for (const rid of candidateRunIds) {
      try {
        const full = await getMentorshipMatchingRunById(rid);
        if (full.run && full.run.snapshot) {
          latestRun = full.run;
          return;
        }
      } catch {
        // Try next candidate.
      }
    }
  }

  function stopRunProgressWatcher(): void {
    if (runProgressTimer) {
      clearInterval(runProgressTimer);
      runProgressTimer = null;
    }
  }

  async function startRunProgressWatcher(
    previousRunId: string,
    previousFinishedAt: string,
    targetRunId: string,
  ): Promise<void> {
    stopRunProgressWatcher();
    runProgressActive = true;
    runProgressStartedAt = Date.now();
    runProgressMessage = 'Queued and running…';

    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        let latest: MentorshipMatchingRunDetail | null = null;
        const tr = String(targetRunId || '').trim();
        if (tr) {
          const probeById = await getMentorshipMatchingRunById(tr).catch(() => ({ run: undefined }));
          latest = (probeById.run as MentorshipMatchingRunDetail | undefined) ?? null;
        }
        if (!latest) {
          const probe = await getLatestMentorshipMatchingRun().catch(() => ({ run: undefined }));
          latest = (probe.run as MentorshipMatchingRunDetail | undefined) ?? null;
        }
        if (!latest) return;

        latestRun = latest;
        const phase = String(latest.phase || '').trim();
        runProgressMessage = phase
          ? `Latest status: ${String(latest.status || 'UNKNOWN')} · ${phase}`
          : `Latest status: ${String(latest.status || 'UNKNOWN')}`;

        const rid = String(latest.runId || '');
        const fin = String(latest.finishedAt || '');
        const isNewRun = !!rid && rid !== previousRunId;
        const sameRunFinished =
          !!rid &&
          rid === previousRunId &&
          !!fin &&
          !!previousFinishedAt &&
          fin !== previousFinishedAt;
        if (!isNewRun && !sameRunFinished) return;

        const st = String(latest.status || '').toUpperCase();
        if (st === 'QUEUED' || st === 'RUNNING') return;

        const hist = await listMentorshipMatchingRuns(20).catch(() => ({ runs: [] }));
        runHistory = hist.runs ?? [];
        await ensureLatestRunHasSnapshotPairs();

        if (st === 'COMPLETED') {
          success = `Matching run completed (runId: ${rid || 'n/a'}). Table refreshed with latest pairs.`;
          error = null;
        } else {
          error = `Run finished with status ${latest.status || 'UNKNOWN'} (runId: ${rid || 'n/a'}).`;
        }
        runProgressActive = false;
        runProgressMessage = '';
        runProgressStartedAt = 0;
        stopRunProgressWatcher();
      } finally {
        inFlight = false;
      }
    };

    // Run immediately, then keep polling until completion.
    await tick();
    if (!runProgressActive) return;
    runProgressTimer = setInterval(() => {
      void tick();
    }, 1500);
  }

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
      await ensureLatestRunHasSnapshotPairs();
      syncScheduleInputsFromModel();
    } catch (e: any) {
      error = e?.message || 'Failed to load mentorship operator data.';
    } finally {
      loading = false;
    }
  }

  async function runNow(resetMatches: boolean, runBatchMatching = true): Promise<void> {
    busyRun = true;
    error = null;
    success = null;
    const previousRunId = String(latestRun?.runId || '');
    const previousFinishedAt = String(latestRun?.finishedAt || '');
    try {
      const run = await startMentorshipMatchingRun({ resetMatches, runBatchMatching });
      const isQueued = String(run.status || '').toUpperCase() === 'QUEUED' || run.accepted === true;
      const queuedRunId = String(run.runId || '').trim();
      if (isQueued) {
        success = resetMatches && !runBatchMatching
          ? `Reset queued (requestId: ${run.requestId || 'n/a'}). Waiting for completion…`
          : `Matching run queued (requestId: ${run.requestId || 'n/a'}). Waiting for completion…`;
        if (resetMatches && latestRun) {
          latestRun = {
            ...latestRun,
            snapshot: { pairs: [], mentors: [], pairCount: 0 },
            snapshotSummary: { pairCount: 0, mentorCount: 0 },
          };
        }
        await startRunProgressWatcher(previousRunId, previousFinishedAt, queuedRunId);
      } else {
        if (resetMatches && !runBatchMatching) {
          success = `Reset completed (runId: ${run.runId || 'n/a'}). Matching was not run.`;
        } else {
          success = resetMatches
            ? `Matching run completed after reset (runId: ${run.runId || 'n/a'}).`
            : `Matching run completed (runId: ${run.runId || 'n/a'}).`;
        }
        latestRun = run;
        runProgressActive = false;
        stopRunProgressWatcher();
      }

      const hist = await listMentorshipMatchingRuns(20).catch(() => ({ runs: [] }));
      runHistory = hist.runs ?? [];
      await ensureLatestRunHasSnapshotPairs();
    } catch (e: any) {
      // API Gateway may return 503/504 for long-running runs even when Lambda keeps processing.
      const latest = await getLatestMentorshipMatchingRun().catch(() => ({ run: undefined }));
      const refreshedRun = latest.run ?? null;
      latestRun = refreshedRun;
      const hist = await listMentorshipMatchingRuns(20).catch(() => ({ runs: [] }));
      runHistory = hist.runs ?? [];
      await ensureLatestRunHasSnapshotPairs();

      const refreshedRunId = String(refreshedRun?.runId || '');
      const refreshedFinishedAt = String(refreshedRun?.finishedAt || '');
      const runAdvanced =
        !!refreshedRun &&
        ((refreshedRunId && refreshedRunId !== previousRunId) ||
          (refreshedRunId === previousRunId &&
            refreshedFinishedAt &&
            refreshedFinishedAt !== previousFinishedAt));

      if (runAdvanced) {
        error = null;
        success = `Run request timed out in UI, but matching completed (runId: ${refreshedRunId || 'n/a'}).`;
        runProgressActive = false;
        stopRunProgressWatcher();
      } else {
        error = e?.message || 'Failed to run mentorship matching.';
      }
    } finally {
      busyRun = false;
      if (!runProgressActive) {
        runProgressMessage = '';
        runProgressStartedAt = 0;
      }
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

  async function runMenteeCapDiagnostics(): Promise<void> {
    busyDiagnostics = true;
    error = null;
    success = null;
    try {
      const payload = await getMentorshipMenteeCapDiagnostics({
        driftOnly: diagnosticsDriftOnly,
        limit: diagnosticsLimit,
      });
      diagnosticsRows = Array.isArray(payload.items) ? payload.items : [];
      diagnosticsSummary =
        `Diagnostics loaded: ${payload.returned ?? diagnosticsRows.length} row(s), ` +
        `${payload.driftCount ?? 0} drifted.`;
      success = diagnosticsSummary;
    } catch (e: any) {
      error = e?.message || 'Failed to load mentee cap diagnostics.';
    } finally {
      busyDiagnostics = false;
    }
  }

  async function repairMenteeCapDiagnostics(): Promise<void> {
    busyRepair = true;
    error = null;
    success = null;
    try {
      const payload = await repairMentorshipMenteeCapDiagnostics({
        driftOnly: diagnosticsDriftOnly,
        limit: diagnosticsLimit,
      });
      const repaired = Number(payload.repairedCount || 0);
      const failed = Number(payload.failedCount || 0);
      success = `Counter repair finished: ${repaired} repaired, ${failed} failed.`;
      await runMenteeCapDiagnostics();
    } catch (e: any) {
      error = e?.message || 'Failed to repair mentee cap diagnostics.';
    } finally {
      busyRepair = false;
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
  {#if runProgressActive}
    <div class="run-progress" role="status" aria-live="polite">
      <div class="run-progress-head">
        <span class="spinner" aria-hidden="true"></span>
        <strong>Matching in progress</strong>
        <span class="run-progress-elapsed">{runProgressElapsedLabel()}</span>
      </div>
      <div class="run-progress-body">{runProgressMessage || 'Queued and running…'}</div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading mentorship operator panel…</div>
  {:else}
    <div class="cards-grid">
      <div class="card">
        <div class="card-icon">🚀</div>
        <div class="card-title">Run matching</div>
        <div class="card-content">
          <p class="hint">Manually trigger a mentorship matching batch now (always resets existing match rows first).</p>
          <div class="card-actions">
            <button class="btn-add" onclick={() => void runNow(true, true)} disabled={busyRun}>
              {busyRun ? 'Running…' : 'Run now'}
            </button>
            <button
              class="btn-delete"
              onclick={() => {
                if (confirm('Reset all mentorship match rows now? This will NOT start a run automatically.')) {
                  void runNow(true, false);
                }
              }}
              disabled={busyRun}>Reset only</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-icon">⏱️</div>
        <div class="card-title">Matching schedule</div>
        <div class="card-content form-grid">
          <div class="card-row schedule-enabled-row">
            <span class="card-label">Scheduler active</span>
            <span class="card-value">{scheduleEnabledLabel()}</span>
          </div>
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
            {#if schedule.lastTriggeredAt}
              <div class="schedule-status-subline">
                Scheduler tick observed at: {String(schedule.lastTriggeredAt)}.
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
                {latestSnapshotSummary().pairCount} pairs · {latestSnapshotSummary().mentorCount} mentors
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

      <div class="card">
        <div class="card-icon">🛠️</div>
        <div class="card-title">Mentee cap diagnostics</div>
        <div class="card-content form-grid">
          <label>
            Limit
            <input type="number" min="1" max="2000" bind:value={diagnosticsLimit} />
          </label>
          <label>
            Drift only
            <select bind:value={diagnosticsDriftOnly}>
              <option value={true}>Yes</option>
              <option value={false}>No</option>
            </select>
          </label>
          <div class="card-actions">
            <button class="btn-add" onclick={() => void runMenteeCapDiagnostics()} disabled={busyDiagnostics || busyRepair}>
              {busyDiagnostics ? 'Diagnosing…' : 'Diagnose drift'}
            </button>
            <button
              class="btn-delete"
              onclick={() => {
                if (confirm('Repair synthetic mentee counters to match actual opened rows?')) {
                  void repairMenteeCapDiagnostics();
                }
              }}
              disabled={busyDiagnostics || busyRepair}
            >
              {busyRepair ? 'Repairing…' : 'Repair drift'}
            </button>
          </div>
          {#if diagnosticsSummary}
            <div class="diagnostics-summary">{diagnosticsSummary}</div>
          {/if}
          {#if diagnosticsRows.length > 0}
            <div class="matches-table-wrap">
              <table class="matches-table diagnostics-table">
                <thead>
                  <tr>
                    <th>Mentee</th>
                    <th>Synthetic</th>
                    <th>Actual</th>
                    <th>Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {#each diagnosticsRows as row}
                    <tr>
                      <td>{String(row.menteeUserId || '—')}</td>
                      <td>{row.syntheticCount ?? '—'}</td>
                      <td>{row.actualOpenedRows ?? 0}</td>
                      <td>{row.driftDetected ? 'YES' : 'NO'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
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
          <div class="matches-toolbar">
            <input
              type="text"
              placeholder="Search mentor, mentee, status..."
              bind:value={matchSearch}
              class="matches-search"
            />
            <select bind:value={matchMentorFilter} class="matches-filter">
              <option value="ALL">All mentors</option>
              {#each uniqueMentors() as mentor}
                <option value={mentor}>{mentor}</option>
              {/each}
            </select>
            <select bind:value={matchStatusFilter} class="matches-filter">
              <option value="ALL">All statuses</option>
              {#each uniqueStatuses() as status}
                <option value={status}>{status}</option>
              {/each}
            </select>
          </div>
          <div class="matches-count">
            Showing {filteredPairs().length} of {asPairs().length} matches
          </div>
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
                {#if filteredPairs().length === 0}
                  <tr>
                    <td colspan="4">No matches found for current filters.</td>
                  </tr>
                {:else}
                  {#each filteredPairs() as p}
                    <tr>
                      <td>{String(p.mentorName || p.mentorUserId || '—')}</td>
                      <td>{String(p.menteeName || p.menteeUserId || '—')}</td>
                      <td>{String(p.status || '—')}</td>
                      <td>{String(p.updatedAt || '—')}</td>
                    </tr>
                  {/each}
                {/if}
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

  .matches-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 2fr) minmax(180px, 1fr) minmax(160px, 1fr);
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }

  .matches-search,
  .matches-filter {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--text);
    padding: 0.52rem 0.62rem;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .matches-count {
    color: var(--text-muted);
    font-size: 0.86rem;
    margin-bottom: 0.55rem;
  }

  .schedule-status {
    margin-top: 0.3rem;
    border-radius: var(--radius);
    padding: 0.5rem 0.6rem;
    border: 1px solid transparent;
  }

  .schedule-enabled-row {
    margin-bottom: 0.2rem;
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

  .diagnostics-summary {
    font-size: 0.88rem;
    color: var(--text-muted);
  }

  .diagnostics-table {
    min-width: 520px;
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
  .run-progress {
    border: 1px solid #cce5ff;
    background: #eef6ff;
    color: #124b85;
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }
  .run-progress-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .run-progress-elapsed {
    margin-left: auto;
    font-size: 0.82rem;
    color: #2f5f92;
  }
  .run-progress-body {
    font-size: 0.9rem;
    color: #2f5f92;
  }
  .spinner {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 999px;
    border: 2px solid #9fc4ef;
    border-top-color: #124b85;
    animation: spin 0.9s linear infinite;
    display: inline-block;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
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

    .matches-toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>
