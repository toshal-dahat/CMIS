<script lang="ts">
  import { onMount } from "svelte";
  import { getSurveyForm, submitSurveyResponse, type SurveyQuestion, type SurveyFormData } from "./events-api";

  let loading = $state(true);
  let submitting = $state(false);
  let submitted = $state(false);
  let alreadyDone = $state(false);
  let error = $state("");

  let formData = $state<SurveyFormData | null>(null);
  let ratings = $state<Record<string, number>>({});
  let pendingEventId = $state("");
  let pendingUserId = $state("");
  let pendingUserEmail = $state("");

  onMount(async () => {
    try {
      const raw = window.sessionStorage.getItem("cmis:pendingSurvey");
      if (!raw) {
        error = "No survey to complete. Please use the link from your email.";
        loading = false;
        return;
      }
      const pending = JSON.parse(raw) as { eventId: string; userId: string; userEmail?: string };
      pendingEventId = pending.eventId;
      pendingUserId = pending.userId;
      pendingUserEmail = pending.userEmail || "";

      formData = await getSurveyForm(pendingEventId, pendingUserId);
      ratings = Object.fromEntries(formData.template.questions.map(q => [q.id, 0]));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("already")) {
        alreadyDone = true;
      } else {
        error = msg || "Failed to load survey.";
      }
    } finally {
      loading = false;
    }
  });

  function setRating(questionId: string, value: number) {
    ratings = { ...ratings, [questionId]: value };
  }

  async function handleSubmit() {
    if (!formData) return;
    const unanswered = formData.template.questions.filter(q => !ratings[q.id]);
    if (unanswered.length > 0) {
      error = `Please answer all questions before submitting.`;
      return;
    }
    submitting = true;
    error = "";
    try {
      await submitSurveyResponse(pendingEventId, pendingUserId, pendingUserEmail, ratings);
      window.sessionStorage.removeItem("cmis:pendingSurvey");
      submitted = true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("already")) {
        alreadyDone = true;
      } else {
        error = msg || "Failed to submit survey.";
      }
    } finally {
      submitting = false;
    }
  }

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
    } catch {
      return dateStr;
    }
  }
</script>

<div class="survey-page">
  <div class="survey-card">
    {#if loading}
      <p class="muted">Loading survey...</p>

    {:else if alreadyDone}
      <div class="done-state">
        <div class="done-icon">✓</div>
        <h2>Already submitted</h2>
        <p>You've already shared your feedback for this event. Thank you!</p>
      </div>

    {:else if submitted}
      <div class="done-state">
        <div class="done-icon">🎉</div>
        <h2>Thank you!</h2>
        <p>Your feedback has been recorded. We appreciate you taking the time.</p>
      </div>

    {:else if error && !formData}
      <div class="err-state">
        <h2>Oops</h2>
        <p class="error">{error}</p>
      </div>

    {:else if formData}
      <div class="event-header">
        <h1>{formData.event.title}</h1>
        <p class="event-date">{formatDate(formData.event.date)}</p>
      </div>
      <p class="intro">How did the event go? Your feedback helps us improve.</p>

      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        {#each formData.template.questions as q (q.id)}
          <div class="question">
            <label class="q-label">{q.text}</label>
            <div class="star-row">
              {#each [1, 2, 3, 4, 5] as n (n)}
                <button
                  type="button"
                  class="star-btn"
                  class:active={ratings[q.id] >= n}
                  onclick={() => setRating(q.id, n)}
                  aria-label="Rate {n}"
                >
                  ★
                </button>
              {/each}
              {#if ratings[q.id]}
                <span class="rating-num">{ratings[q.id]} / 5</span>
              {/if}
            </div>
          </div>
        {/each}

        {#if error}
          <p class="error">{error}</p>
        {/if}

        <button type="submit" class="btn-submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Feedback"}
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .survey-page {
    width: 100%;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 3rem 1rem 4rem;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-warm) 100%);
  }
  .survey-card {
    width: min(520px, 100%);
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 2rem 1.75rem;
  }

  .event-header { margin-bottom: 0.5rem; }
  h1 {
    margin: 0 0 0.25rem;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: clamp(1.4rem, 4vw, 1.9rem);
    line-height: 1.2;
  }
  h2 {
    margin: 0.5rem 0;
    font-family: var(--font-heading);
    color: var(--maroon);
    font-size: 1.5rem;
  }
  .event-date { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1rem; }
  .intro { color: var(--text-muted); margin: 0 0 1.5rem; }

  .question { margin-bottom: 1.5rem; }
  .q-label {
    display: block;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.6rem;
    font-size: 0.95rem;
  }
  .star-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .star-btn {
    font-size: 2rem;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--border);
    padding: 0;
    line-height: 1;
    transition: color 0.1s, transform 0.1s;
  }
  .star-btn:hover, .star-btn.active {
    color: var(--maroon);
  }
  .star-btn:hover { transform: scale(1.15); }
  .rating-num {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-left: 0.35rem;
  }

  .btn-submit {
    width: 100%;
    padding: 0.75rem;
    background: var(--maroon);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    margin-top: 0.5rem;
  }
  .btn-submit:disabled { opacity: 0.65; cursor: not-allowed; }

  .done-state, .err-state {
    text-align: center;
    padding: 1rem 0;
  }
  .done-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }
  .done-state p, .err-state p { color: var(--text-muted); margin-top: 0.5rem; }

  .muted { color: var(--text-muted); }
  .error { color: #b3261e; margin: 0.5rem 0; }
</style>
