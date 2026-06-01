<script lang="ts">
  import LandingPage from "./lib/LandingPage.svelte";
  import ProfileForm from "./lib/ProfileForm.svelte";
  import CollaborationPage from "./lib/CollaborationPage.svelte";
  import StudentsConnect from "./lib/StudentsConnect.svelte";
  import AdminPage from "./lib/AdminPage.svelte";
  import EventsDashboard from "./lib/EventsDashboard.svelte";
  import GraduationHandover from "./lib/GraduationHandover.svelte";
  import { currentView } from "./lib/stores/viewStore";
  import { currentTheme } from "./lib/stores/themeStore";
  import { onMount } from "svelte";
  import ManageUsersPage from "./lib/ManageUsersPage.svelte";
  import { getTheme } from "./admin-api/theme";

  const VALID_VIEWS = [
    "login",
    "register",
    "profile",
    "handover",
    "forgot-password",
    "reset-password",
    "claim",
  ];
  let view = "login";
  let claimToken = "";
  let resetPasswordEmail = "";

  let accessToken = localStorage.getItem("accessToken") || "";
  let user = null;

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

  function setView(v) {
    view = v;
    if (
      typeof window !== "undefined" &&
      VALID_VIEWS.includes(v) &&
      v !== "claim"
    ) {
      window.location.hash = v;
    }
  }

  function viewFromHash() {
    if (typeof window === "undefined") return "login";
    const hash = (window.location.hash || "").replace(/^#/, "").split("?")[0];
    if (VALID_VIEWS.includes(hash)) return hash;
    return accessToken ? "profile" : "login";
  }

  onMount(async () => {
    // Fetch theme from API and update theme store
    try {
      const theme = await getTheme();
      currentTheme.set(theme);
    } catch (error) {
      console.warn('Failed to load theme, using default:', error);
      // Theme store already has default values, so we can continue
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
          const { me } = await import("./lib/api.js");
          user = await me(accessToken);
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
      if (view !== "claim" && VALID_VIEWS.includes(view)) {
        window.location.hash = view;
      }
    }
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

  function onLogin(payload) {
    accessToken = payload.accessToken;
    user = payload.user;
    localStorage.setItem("accessToken", payload.accessToken);
    if (payload.refreshToken)
      localStorage.setItem("refreshToken", payload.refreshToken);
    view = "profile";
  }

  function onRegister() {
    view = "login";
  }

  function onLogout() {
    accessToken = "";
    user = null;
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    view = "login";
  }

  function onHandoverDone(updatedUser) {
    user = updatedUser;
    view = "profile";
  }

  function onClaimSuccess() {
    claimToken = "";
    view = "login";
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname || "/");
    }
  }

  function onClaimCancel() {
    claimToken = "";
    view = "login";
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname || "/");
    }
  }
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
{:else if $currentView === "mentorship"}
  <div class="full-page-wrap">
    <CollaborationPage
      title="Mentorship"
      content="Collaborate with Team Gig 'Em"
    />
  </div>
{:else if $currentView === "case-competitions"}
  <div class="full-page-wrap">
    <CollaborationPage
      title="Case Competitions"
      content="Collaborate with Team 12th Man"
    />
  </div>
{:else if $currentView === "students-connect"}
  <div class="full-page-wrap">
    <StudentsConnect />
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
