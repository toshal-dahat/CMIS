<script lang="ts">
  import LandingPage from "./lib/LandingPage.svelte";
  import ProfileForm from "./lib/ProfileForm.svelte";
import MentorshipPage from "./lib/MentorshipPage.svelte";
  import StudentsConnect from "./lib/StudentsConnect.svelte";
  import AdminPage from "./lib/AdminPage.svelte";
  import EventsDashboard from "./lib/EventsDashboard.svelte";
  import EventCheckinScanner from "./lib/EventCheckinScanner.svelte";
  import EventCheckinEntryPage from "./lib/EventCheckinEntryPage.svelte";
  import EventCheckinResultPage from "./lib/EventCheckinResultPage.svelte";
  import GraduationHandover from "./lib/GraduationHandover.svelte";
  import { currentView } from "./lib/stores/viewStore";
  import { currentTheme } from "./lib/stores/themeStore";
  import { onMount } from "svelte";
  import ManageUsersPage from "./lib/ManageUsersPage.svelte";
  import JudgeDashboard from "./lib/JudgeDashboard.svelte";
  import StudentEngagementAnalyticsPage from "./lib/StudentEngagementAnalyticsPage.svelte";
  import TeamSubmissionPage from "./lib/TeamSubmissionPage.svelte";
  import { getTheme } from "./admin-api/theme";

  const VALID_VIEWS = [
    "login",
    "register",
    "profile",
    "handover",
    "forgot-password",
    "reset-password",
    "claim",
  ] as const;
  let view: string = "login";
  let claimToken = "";

  let accessToken = localStorage.getItem("accessToken") || "";

  // Apply theme to CSS variables whenever theme changes
  $: if (typeof document !== 'undefined' && $currentTheme) {
    applyTheme($currentTheme);
  }

  function applyTheme(theme: typeof $currentTheme) {
    const root = document.documentElement;
    
    // Apply primary color (maroon)
    root.style.setProperty('--maroon', theme.primaryColor);
    
    // Derive darker and lighter variants of primary color
    const primaryDark = adjustColor(theme.primaryColor, -20);
    const primaryLight = adjustColor(theme.primaryColor, 20);
    const primaryMuted = `${theme.primaryColor}14`; // 8% opacity in hex
    
    root.style.setProperty('--maroon-dark', primaryDark);
    root.style.setProperty('--maroon-light', primaryLight);
    root.style.setProperty('--maroon-muted', primaryMuted);
    
    // Apply secondary color (background)
    root.style.setProperty('--bg', theme.secondaryColor);
    
    // Derive warm background variant
    const bgWarm = adjustColor(theme.secondaryColor, -3);
    root.style.setProperty('--bg-warm', bgWarm);
  }

  // Helper function to adjust color brightness
  function adjustColor(color: string, amount: number): string {
    // Remove # if present
    const hex = color.replace('#', '');
    
    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Adjust brightness
    const newR = Math.max(0, Math.min(255, r + amount));
    const newG = Math.max(0, Math.min(255, g + amount));
    const newB = Math.max(0, Math.min(255, b + amount));
    
    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  function viewFromHash(): string {
    if (typeof window === "undefined") return "login";
    const hash = ((window.location.hash || "").replace(/^#/, "").split("?")[0] ?? "") as string;
    if ((VALID_VIEWS as readonly string[]).includes(hash)) return hash;
    return accessToken ? "profile" : "login";
  }

  onMount(() => {
    void (async () => {
      const pendingCheckinToken = new URLSearchParams(window.location.search || "").get("checkinToken");
      const pendingCheckinEventId = new URLSearchParams(window.location.search || "").get("eventId");
      try {
        const hasPendingInSession = !!window.sessionStorage.getItem("cmis:pendingCheckin");
        if (pendingCheckinToken && pendingCheckinEventId) {
          window.sessionStorage.setItem(
            "cmis:pendingCheckin",
            JSON.stringify({
              token: pendingCheckinToken,
              eventId: pendingCheckinEventId,
            }),
          );
          const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
          window.history.replaceState({}, "", cleanUrl);
          currentView.set("event-checkin-entry");
          return;
        }
        if (hasPendingInSession) {
          currentView.set("event-checkin-entry");
          return;
        }
      } catch {
        // ignore storage errors
      }

      try {
        const theme = await getTheme();
        currentTheme.set(theme);
      } catch (error) {
        console.warn('Failed to load theme, using default:', error);
      }

      const hash = window.location.hash || "" || "";
      const search = window.location.search || "" || "";
      const params = new URLSearchParams(
        hash.slice(1).split("?")[1] || search.slice(1),
      );
      const token = params.get("token");
      if (token && (hash.includes("claim") || search.includes("token="))) {
        claimToken = token;
        view = "claim";
      } else {
        if (accessToken) {
          try {
            const { fetchUserProfile } = await import("./lib/api.js");
            await fetchUserProfile();
          } catch (_) {
            accessToken = "";
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
          }
        }
        const fromHash = viewFromHash();
        if (fromHash === "profile" || fromHash === "handover") {
          view = accessToken ? fromHash : "login";
        } else {
          view = fromHash;
        }
        if (view !== "claim" && (VALID_VIEWS as readonly string[]).includes(view)) {
          window.location.hash = view;
        }
      }

    })();

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  });

  function handleHashChange() {
    if (claimToken) return;
    const fromHash = viewFromHash();
    if (fromHash === "profile" || fromHash === "handover") {
      view = accessToken ? fromHash : "login";
    } else {
      view = fromHash;
    }
  }

  /** Legacy hash-routing hooks (kept for parity with older templates). */
  function _onLogin(payload: { accessToken: string; refreshToken?: string }) {
    accessToken = payload.accessToken;
    localStorage.setItem("accessToken", payload.accessToken);
    if (payload.refreshToken) localStorage.setItem("refreshToken", payload.refreshToken);
    view = "profile";
  }
  void _onLogin;

  function _onRegister() {
    view = "login";
  }
  void _onRegister;

  function _onLogout() {
    accessToken = "";
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    view = "login";
  }
  void _onLogout;

  function _onHandoverDone(_updatedUser: unknown) {
    view = "profile";
  }
  void _onHandoverDone;

  function _onClaimSuccess() {
    claimToken = "";
    view = "login";
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname || "/");
    }
  }
  void _onClaimSuccess;

  function _onClaimCancel() {
    claimToken = "";
    view = "login";
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname || "/");
    }
  }
  void _onClaimCancel;
</script>

{#if $currentView === "admins"}
  <AdminPage />
{:else if $currentView === "manage-users"}
  <div class="full-page-wrap">
    <ManageUsersPage />
  </div>
{:else if $currentView === "profile-form"}
  <ProfileForm />
{:else if $currentView === "graduation-handover"}
  <GraduationHandover />
{:else if $currentView === "events"}
  <div class="full-page-wrap">
    <EventsDashboard />
  </div>
{:else if $currentView === "event-checkin-scanner"}
  <div class="full-page-wrap">
    <EventCheckinScanner />
  </div>
{:else if $currentView === "event-checkin-entry"}
  <div class="full-page-wrap">
    <EventCheckinEntryPage />
  </div>
{:else if $currentView === "event-checkin-result"}
  <div class="full-page-wrap">
    <EventCheckinResultPage />
  </div>
{:else if $currentView === "mentorship"}
  <div class="full-page-wrap">
    <MentorshipPage />
  </div>
{:else if $currentView === "case-competitions"}
  <div class="full-page-wrap">
    <TeamSubmissionPage />
  </div>
{:else if $currentView === "students-connect"}
  <div class="full-page-wrap">
    <StudentsConnect />
  </div>
{:else if $currentView === "judge-dashboard"}
  <div class="full-page-wrap">
    <JudgeDashboard />
  </div>
{:else if $currentView === "student-engagement-analytics"}
  <div class="full-page-wrap">
    <StudentEngagementAnalyticsPage />
  </div>
{:else}
  <div class="landing-page">
    <LandingPage />
  </div>
{/if}

<style>
  .full-page-wrap {
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
  }
</style>
