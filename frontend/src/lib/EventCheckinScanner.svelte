<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Html5Qrcode } from "html5-qrcode";
  import { currentView } from "./stores/viewStore";
  import { eventCheckinContext } from "./stores/eventCheckinStore";
  import { selfCheckIn } from "./events-api";

  let scanner: Html5Qrcode | null = null;
  let cameraStarting = $state(true);
  let busy = $state(false);
  let statusText = $state("Opening camera...");
  let statusType = $state<"info" | "ok" | "bad">("info");
  let hasSuccess = $state(false);
  let currentEventId = $state("");
  let currentEventTitle = $state("");
  let lastDecodedText = "";
  let lastDecodedAt = 0;
  const REPEAT_SCAN_COOLDOWN_MS = 2200;

  function goBack() {
    void stopScanner();
    eventCheckinContext.set(null);
    currentView.set("events");
  }

  function setStatus(message: string, type: "info" | "ok" | "bad" = "info") {
    statusText = message;
    statusType = type;
  }

  async function stopScanner() {
    const localScanner = scanner;
    scanner = null;
    if (!localScanner) return;
    try {
      if (localScanner.isScanning) {
        await localScanner.stop();
      }
    } catch {
      // ignore camera stop errors
    }
    try {
      await localScanner.clear();
    } catch {
      // ignore cleanup errors
    }
  }

  async function handleDecoded(decodedText: string) {
    if (busy || hasSuccess) return;
    const now = Date.now();
    if (
      decodedText === lastDecodedText &&
      now - lastDecodedAt < REPEAT_SCAN_COOLDOWN_MS
    ) {
      return;
    }
    lastDecodedText = decodedText;
    lastDecodedAt = now;
    busy = true;
    setStatus("Validating RSVP and checking you in...", "info");
    try {
      const result = await selfCheckIn(decodedText, currentEventId);
      const status = (result.status || "").toUpperCase();
      if (status === "CHECKED_IN" || status === "ALREADY_CHECKED_IN") {
        hasSuccess = true;
        setStatus(result.message || "Check-in complete.", "ok");
        await stopScanner();
        return;
      }
      setStatus(result.message || "Check-in failed.", "bad");
    } catch (e: any) {
      setStatus(e?.message || "Check-in failed.", "bad");
    } finally {
      // Prevent rapid revalidation loops when camera keeps seeing the same QR.
      await new Promise((resolve) => setTimeout(resolve, 600));
      busy = false;
    }
  }

  onMount(async () => {
    const context = $eventCheckinContext;
    if (!context?.eventId) {
      setStatus("No event selected. Return to Events and tap Checkin.", "bad");
      cameraStarting = false;
      return;
    }
    currentEventId = context.eventId;
    currentEventTitle = context.eventTitle || "";

    if (context.prefilledScanText) {
      cameraStarting = false;
      setStatus("Completing check-in from QR link...", "info");
      await handleDecoded(context.prefilledScanText);
      return;
    }

    scanner = new Html5Qrcode("event-checkin-reader");
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          await handleDecoded(decodedText);
        },
        () => {
          // ignore decode misses while scanning
        }
      );
      setStatus("Scan the event QR code shown by admins.", "info");
    } catch (e: any) {
      setStatus(`Unable to open camera: ${e?.message || e}`, "bad");
    } finally {
      cameraStarting = false;
    }
  });

  onDestroy(() => {
    void stopScanner();
  });
</script>

<div class="scanner-page">
  <div class="scanner-wrap">
    <button type="button" class="back-link" onclick={goBack}>← Back to Events</button>
    <div class="card">
      <h1>Event Checkin</h1>
      {#if currentEventTitle}
        <p class="event-title">{currentEventTitle}</p>
      {/if}
      <p class="helper">Point your camera at the event QR code.</p>
      <div id="event-checkin-reader" class="reader"></div>
      <div class="status {statusType}">
        {#if cameraStarting}
          Opening camera...
        {:else}
          {statusText}
        {/if}
      </div>
      {#if hasSuccess}
        <button type="button" class="done-btn" onclick={goBack}>Done</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .scanner-page {
    min-height: 100dvh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
    padding: 1rem;
  }
  .scanner-wrap {
    max-width: 560px;
    margin: 0 auto;
  }
  .back-link {
    border: none;
    background: transparent;
    color: var(--maroon);
    font-weight: 700;
    margin-bottom: 0.75rem;
    font-size: 0.95rem;
  }
  .card {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1rem;
    box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.08));
  }
  h1 {
    margin: 0;
    color: var(--maroon);
    font-size: 1.4rem;
  }
  .event-title {
    margin: 0.35rem 0 0;
    color: var(--text);
    font-weight: 600;
  }
  .helper {
    margin: 0.35rem 0 0.85rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .reader {
    width: 100%;
    min-height: 260px;
    overflow: hidden;
    border-radius: 12px;
    background: #111;
  }
  .status {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .status.info {
    background: #eef2ff;
    color: #3730a3;
  }
  .status.ok {
    background: #eafaf1;
    color: #166534;
  }
  .status.bad {
    background: #fef2f2;
    color: #991b1b;
  }
  .done-btn {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.7rem 1rem;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    background: var(--maroon);
    color: #fff;
  }
</style>
