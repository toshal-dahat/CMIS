<script lang="ts">
  import { getSynthesizedFeedback } from "./competition-api";
  import { marked } from "marked";
  import { jsPDF } from "jspdf";

  export let competitionId: string;
  export let teamId: string;
  export let feedbackReleaseDate: string | null | undefined;

  let narrative = "";
  let loading = true;
  let error = "";

  // Compute release status and trigger fetch in one block
  $: {
    const released = feedbackReleaseDate
      ? new Date().getTime() >= new Date(feedbackReleaseDate).getTime()
      : false;

    if (competitionId && teamId) {
      void loadData(released);
    }
  }

  // Derived for template use
  $: isReleased = feedbackReleaseDate
    ? new Date().getTime() >= new Date(feedbackReleaseDate).getTime()
    : false;

  $: renderedNarrative = narrative ? marked.parse(narrative) : "";

  async function loadData(released: boolean) {
    if (!released) {
      loading = false;
      return;
    }
    try {
      loading = true;
      error = "";
      const synthesis = await getSynthesizedFeedback(competitionId, teamId);
      narrative = synthesis.narrative || "";
    } catch (err: any) {
      narrative = "";
      error = "Your constructive narrative is currently being prepared. Check back shortly!";
    } finally {
      loading = false;
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  async function handleDownload() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 48;
    const usableW = pageW - margin * 2;

    // Parse narrative into lines, preserving markdown headings
    const lines = narrative.split("\n");
    let y = margin;

    const addPage = () => {
      doc.addPage();
      y = margin;
    };

    const write = (text: string, size: number, bold = false, color: [number,number,number] = [30,30,30]) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor(...color);
      const wrapped = doc.splitTextToSize(text, usableW);
      wrapped.forEach((line: string) => {
        if (y > doc.internal.pageSize.getHeight() - margin) addPage();
        doc.text(line, margin, y);
        y += size * 1.5;
      });
    };

    // Header
    write("Feedback Report", 20, true, [80, 0, 0]);
    y += 12;
    doc.setDrawColor(80, 0, 0);
    doc.line(margin, y, pageW - margin, y);
    y += 20;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) { y += 8; return; }
      if (trimmed.startsWith("## "))       write(trimmed.slice(3), 15, true, [80, 0, 0]);
      else if (trimmed.startsWith("### ")) write(trimmed.slice(4), 13, true, [80, 0, 0]);
      else if (trimmed.startsWith("#### ")) write(trimmed.slice(5), 12, true, [80, 0, 0]);
      else write(trimmed.replace(/\*\*(.*?)\*\*/g, "$1"), 11);
    });

    y += 24;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
    write("This feedback reflects consolidated input from all assigned judges.", 9, false, [150, 150, 150]);

    doc.save("feedback-report.pdf");
  }

</script>

<div class="feedback-card" class:locked={!isReleased}>
  <div class="card-header no-print">
    <div class="badge">
      <span class="sparkle">✨</span> Feedback Synthesis
    </div>
  </div>

  {#if loading}
    <div class="status-box no-print">
      <div class="shimmer-line title"></div>
      <div class="shimmer-line body"></div>
      <div class="shimmer-line body"></div>
      <p>Consulting our AI Mentor...</p>
    </div>
  {:else if !isReleased}
    <div class="locked-content no-print">
      <div class="lock-visual">
        <div class="lock-circle">🔒</div>
      </div>
      <h3>Narrative Locked</h3>
      <p>We're aggregating judge perspectives to create your cohesive feedback story.</p>
      <div class="release-info">
        <span class="label">Releasing on</span>
        <span class="date">{feedbackReleaseDate ? formatDate(feedbackReleaseDate) : 'TBD'}</span>
      </div>
    </div>
  {:else if narrative}
    <div id="printable-feedback" class="unlocked-content scale-in printable-area">
      <div class="narrative-markdown">
        {@html renderedNarrative}
      </div>

      <div class="card-footer no-print">
        <span class="consolidated-label">This feedback reflects consolidated input from all assigned judges.</span>
        <button class="pdf-btn" onclick={handleDownload}>⬇ Download Feedback</button>
      </div>
    </div>
  {:else}
    <div class="error-content no-print">
      <p>{error || "No narrative found for this team yet."}</p>
    </div>
  {/if}
</div>

<style>
  .feedback-card {
    background: white;
    border-radius: 20px;
    padding: 2.5rem;
    border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 10px 40px rgba(0,0,0,0.04);
    margin-top: 2rem;
    position: relative;
    overflow: hidden;
  }

  .feedback-card.locked {
    background: linear-gradient(145deg, #ffffff 0%, #f9f9ff 100%);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-bottom: 2rem;
  }

  .badge {
    background: #500000;
    color: white;
    padding: 0.4rem 1rem;
    border-radius: 30px;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Locked State Styles */
  .locked-content {
    text-align: center;
    padding: 2rem 0;
  }

  .lock-visual {
    margin-bottom: 1.5rem;
  }

  .lock-circle {
    width: 80px;
    height: 80px;
    background: #50000010;
    border-radius: 50%;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.5rem;
    border: 1px solid #50000020;
  }

  h3 { color: #500000; margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { color: #666; font-size: 0.95rem; margin-bottom: 2rem; line-height: 1.6; }

  .release-info {
    display: inline-flex;
    flex-direction: column;
    padding: 1rem 2rem;
    background: white;
    border: 1px solid #eee;
    border-radius: 12px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.03);
  }

  .release-info .label { font-size: 0.7rem; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 0.25rem; }
  .release-info .date { color: #1a1a1a; font-weight: 600; font-size: 0.95rem; }

  /* Unlocked State Styles */
  .narrative-markdown {
    color: #333;
    font-size: 1.05rem;
    line-height: 1.8;
  }

  .narrative-markdown :global(h2), .narrative-markdown :global(h3) {
    color: #500000;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }

  .narrative-markdown :global(p) {
    margin-bottom: 1rem;
  }

  /* Markdown Table Styling */
  .narrative-markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5rem 0;
    font-size: 0.95rem;
    background: #fdf8f8;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #f0e0e0;
  }

  .narrative-markdown :global(th), .narrative-markdown :global(td) {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid #f0e0e0;
  }

  .narrative-markdown :global(th) {
    background: #500000;
    color: white;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  .narrative-markdown :global(tr:last-child td) {
    border-bottom: none;
  }

  .card-footer {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: #aaa;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }


  .pdf-btn {
    background: #500000;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.4rem 0.9rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .pdf-btn:hover { background: #3a0000; }


  /* Shimmer / Loading */
  .shimmer-line {
    background: #f0f0f0;
    background-image: linear-gradient(90deg, #f0f0f0 0%, #f8f8f8 50%, #f0f0f0 100%);
    background-repeat: no-repeat;
    background-size: 200px 100%;
    animation: shimmer 1.5s infinite linear;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  .shimmer-line.title { height: 24px; width: 60%; }
  .shimmer-line.body { height: 16px; width: 100%; }

  @keyframes shimmer {
    0% { background-position: -200px 0; }
    100% { background-position: 200px 0; }
  }

  .scale-in {
    animation: scaleIn 0.5s cubic-bezier(0.165, 0.84, 0.44, 1);
  }

  @keyframes scaleIn {
    0% { opacity: 0; transform: scale(0.98); }
    100% { opacity: 1; transform: scale(1); }
  }

  /* Print Styles */
  @media print {
    :global(body) {
      background: white !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    
    :global(nav), :global(footer), :global(.no-print) {
      display: none !important;
    }

    /* Hide everything except the printable area and its parents */
    :global(body > *:not(.printable-area)) {
       display: none !important;
    }

    /* However, Svelte structure makes the above difficult. 
       Let's use visibility logic but more carefully. */
    :global(body *) {
      visibility: hidden;
    }
    
    .printable-area, .printable-area * {
      visibility: visible !important;
    }

    .printable-area {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      padding: 0;
      margin: 0;
      border: none !important;
      box-shadow: none !important;
    }

    .narrative-markdown :global(table) {
      background: white !important;
      border: 1px solid #ccc !important;
    }
    
    .narrative-markdown :global(th) {
      background: #eee !important;
      color: black !important;
      border-bottom: 2px solid black !important;
    }
  }
</style>


