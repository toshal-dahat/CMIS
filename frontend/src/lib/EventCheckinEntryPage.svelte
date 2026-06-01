<script lang="ts">
  import { onMount } from "svelte";
  import { authUser } from "./stores/authStore";
  import { currentView } from "./stores/viewStore";
  import { eventCheckinResult } from "./stores/eventCheckinResultStore";
  import { selfCheckIn } from "./events-api";
  import { startSignInByEmail, confirmEmailOtp, getAuthUser, waitForCognitoIdToken } from "./auth";

  let loading = $state(true);
  let loadingMessage = $state("Preparing check-in...");
  let authError = $state("");
  let authStatus = $state("");
  let email = $state("");
  let otp = $state("");
  let otpStep = $state(false);
  let pendingToken = "";
  let pendingEventId = "";

  function setFailureResult(message: string) {
    eventCheckinResult.set({
      status: "failed",
      title: "Check-in failed",
      message,
      eventId: pendingEventId || undefined,
    });
    currentView.set("event-checkin-result");
  }

  async function performCheckin() {
    loading = true;
    loadingMessage = "Completing check-in...";
    try {
      const result = await selfCheckIn(pendingToken, pendingEventId);
      const status = String(result?.status || "").toUpperCase();
      const ok = status === "CHECKED_IN" || status === "ALREADY_CHECKED_IN";
      eventCheckinResult.set({
        status: ok ? "success" : "failed",
        title: ok ? "Check-in successful" : "Check-in failed",
        message: result?.message || (ok ? "Check-in completed." : "Check-in could not be completed."),
        eventId: pendingEventId,
      });
      currentView.set("event-checkin-result");
    } catch (err) {
      const msg = (err as Error)?.message || "Unable to complete check-in.";
      setFailureResult(msg);
    }
  }

  function loadPendingFromStorage(): boolean {
    try {
      const raw = window.sessionStorage.getItem("cmis:pendingCheckin");
      if (!raw) return false;
      const pending = JSON.parse(raw) as { token?: string; eventId?: string };
      if (!pending?.token || !pending?.eventId) return false;
      pendingToken = pending.token;
      pendingEventId = pending.eventId;
      return true;
    } catch {
      return false;
    }
  }

  async function initializeFlow() {
    if (!loadPendingFromStorage()) {
      setFailureResult("Missing or invalid QR check-in data.");
      return;
    }

    loadingMessage = "Checking sign-in...";
    await waitForCognitoIdToken(2200);
    const user = await getAuthUser();
    authUser.set(user ?? null);
    if (user) {
      await performCheckin();
      return;
    }

    loading = false;
    authStatus = "Sign in to continue check-in.";
  }

  onMount(() => {
    void initializeFlow();
  });

  async function submitEmail() {
    authError = "";
    authStatus = "";
    const result = await startSignInByEmail(email);
    if (!result.ok) {
      authError = result.error;
      return;
    }
    if (result.mode === "google_redirect") {
      loading = true;
      loadingMessage = "Redirecting to Google sign-in...";
      return;
    }
    otpStep = true;
    authStatus = `OTP sent to ${email.trim()}. Enter it below.`;
  }

  async function submitOtp() {
    try {
      loading = true;
      loadingMessage = "Signing you in...";
      authError = "";
      const result = await confirmEmailOtp(otp);
      if (!result.ok) {
        loading = false;
        if (result.nextStep === "enter_login_otp") {
          otp = "";
          authStatus = result.error;
          return;
        }
        authError = result.error;
        return;
      }
      await waitForCognitoIdToken(2200);
      const user = await getAuthUser();
      authUser.set(user ?? null);
      if (!user) {
        loading = false;
        authError = "Sign-in completed, but session is unavailable. Please try again.";
        return;
      }
      await performCheckin();
    } catch (err) {
      loading = false;
      authError = (err as Error)?.message || "Sign-in failed.";
    }
  }
</script>

<div class="entry-page">
  <div class="entry-card">
    <h1>Event Check-in</h1>
    {#if loading}
      <div class="spinner" aria-hidden="true"></div>
      <p class="status">{loadingMessage}</p>
    {:else}
      <p class="status">{authStatus}</p>
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} placeholder="you@example.com" autocomplete="email" />
      <button type="button" class="btn-primary" onclick={submitEmail}>
        Continue
      </button>
      {#if otpStep}
        <label for="otp">OTP Code</label>
        <input id="otp" type="text" bind:value={otp} placeholder="Enter OTP" autocomplete="one-time-code" />
        <button type="button" class="btn-primary" onclick={submitOtp}>
          Verify OTP
        </button>
      {/if}
      {#if authError}
        <p class="error">{authError}</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .entry-page {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
  }
  .entry-card {
    width: min(480px, 100%);
    background: var(--card-bg, #fff);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.5rem 1.25rem;
    box-shadow: var(--shadow-lg, 0 10px 32px rgba(0, 0, 0, 0.08));
    display: grid;
    gap: 0.7rem;
  }
  h1 {
    margin: 0 0 0.25rem;
    color: var(--maroon);
  }
  .status {
    margin: 0;
    color: var(--text-muted, #555);
  }
  label {
    font-size: 0.9rem;
    color: #444;
    font-weight: 600;
  }
  input {
    width: 100%;
    border: 1px solid #cfcfcf;
    border-radius: 10px;
    padding: 0.7rem;
    font-size: 1rem;
  }
  .btn-primary {
    border: none;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    font-weight: 700;
    color: #fff;
    background: var(--maroon);
  }
  .error {
    color: #a91d1d;
    margin: 0.25rem 0 0;
  }
  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #e7e7e7;
    border-top-color: var(--maroon);
    border-radius: 999px;
    animation: spin 0.9s linear infinite;
    margin: 0 auto;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
