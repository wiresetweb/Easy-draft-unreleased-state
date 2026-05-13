'use strict';

// ==============================================================================
// Beta-tester feedback — modal that takes a free-form description plus an
// auto-collected diagnostic report (current screen, active tool / layer,
// last 10 user actions). Posts to a Supabase edge function which forwards
// the payload to the team's inbox.
//
// The action log is a ring buffer fed by:
//   • pushHistory()   — every undoable edit
//   • undo / redo
//   • logUserAction() — sprinkled at key non-history events (mode swap,
//                       tool change, layer switch, file ops)
//
// If FEEDBACK_FUNCTION_URL is empty (e.g. running locally without the
// function deployed), submit falls back to a mailto link with the same
// payload pre-filled.
// ==============================================================================

const FEEDBACK_RECIPIENT_FALLBACK = "hello@easydraftonline.com";

function logUserAction(label) {
  if (!label || typeof label !== "string") return;
  if (!state.actionLog) state.actionLog = [];
  // Coalesce identical consecutive entries — a flurry of nudges or a
  // multi-frame drag would otherwise drown the log in duplicates.
  const last = state.actionLog[state.actionLog.length - 1];
  if (last && last.label === label && (Date.now() - last.ts) < 1500) {
    last.ts = Date.now();
    return;
  }
  state.actionLog.push({ ts: Date.now(), label });
  if (state.actionLog.length > ACTION_LOG_MAX) state.actionLog.shift();
}

function bindFeedbackButton() {
  const btn = document.getElementById("feedback-btn");
  if (!btn) return;
  btn.addEventListener("click", openFeedbackModal);

  const modal = document.getElementById("feedback-modal");
  if (!modal) return;
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) hideFeedbackModal();
  });
  document.getElementById("feedback-cancel")?.addEventListener("click", hideFeedbackModal);
  document.getElementById("feedback-submit")?.addEventListener("click", submitFeedback);
  document.getElementById("feedback-toggle-report")?.addEventListener("click", () => {
    const pre = document.getElementById("feedback-report");
    if (!pre) return;
    pre.classList.toggle("hidden");
    const btnEl = document.getElementById("feedback-toggle-report");
    if (btnEl) btnEl.textContent = pre.classList.contains("hidden")
      ? "Show what we're sending"
      : "Hide details";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      hideFeedbackModal();
      e.stopPropagation();
    }
  }, true);
}

function openFeedbackModal() {
  const modal = document.getElementById("feedback-modal");
  if (!modal) return;
  const textarea = document.getElementById("feedback-description");
  if (textarea) textarea.value = "";
  setFeedbackStatus("");
  // Build (and cache) the diagnostic payload once at open-time so the
  // user sees exactly what'll get sent — no surprises from background
  // changes between "view details" and Submit.
  const report = buildFeedbackReport();
  modal._report = report;
  const pre = document.getElementById("feedback-report");
  if (pre) {
    pre.textContent = formatReportForDisplay(report);
    pre.classList.add("hidden");
  }
  const toggleBtn = document.getElementById("feedback-toggle-report");
  if (toggleBtn) toggleBtn.textContent = "Show what we're sending";
  modal.classList.remove("hidden");
  trapFocusIn(modal.querySelector(".feedback-window") || modal);
  setTimeout(() => textarea && textarea.focus(), 0);
  logUserAction("Opened feedback");
}

function hideFeedbackModal() {
  const modal = document.getElementById("feedback-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  releaseFocusTrap();
}

function setFeedbackStatus(text, kind) {
  const el = document.getElementById("feedback-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("error", "success");
  if (kind) el.classList.add(kind);
}

// ---------- Diagnostic report ----------

function buildFeedbackReport() {
  const sub = (typeof activeSublayer === "function") ? activeSublayer() : null;
  const story = (typeof activeStory === "function") ? activeStory() : null;
  let activeSheet = null;
  if (Array.isArray(state.sheets) && state.activeSheetId) {
    activeSheet = state.sheets.find((s) => s.id === state.activeSheetId) || null;
  }

  let shapeCount = 0;
  let storyCount = Array.isArray(state.stories) ? state.stories.length : 0;
  let sublayerCount = 0;
  if (Array.isArray(state.stories)) {
    for (const st of state.stories) {
      sublayerCount += (st.sublayers?.length || 0);
      for (const sl of (st.sublayers || [])) shapeCount += (sl.shapes?.length || 0);
    }
  }

  const recent = (state.actionLog || []).slice(-10).map((a) => ({
    label: a.label,
    ago: formatAgo(Date.now() - a.ts),
  }));

  return {
    submittedAt: new Date().toISOString(),
    screen: state.viewMode === "plan" ? "Plan" : "Draw",
    tool: state.tool || null,
    activeLayer: sub ? `${story?.name || ""} / ${sub.name}` : null,
    activeSheet: activeSheet ? `${activeSheet.number || ""} ${activeSheet.title || ""}`.trim() || activeSheet.id : null,
    fileName: state.fileName || null,
    units: state.units || null,
    paid: !!state.paid,
    counts: { stories: storyCount, sublayers: sublayerCount, shapes: shapeCount },
    selection: state.selection ? state.selection.size : 0,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      zoom: state.zoom || 1,
    },
    userAgent: navigator.userAgent,
    appVersion: typeof APP_VERSION === "string" ? APP_VERSION : null,
    recentActions: recent,
  };
}

function formatAgo(ms) {
  if (!isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function formatReportForDisplay(report) {
  const lines = [];
  lines.push(`Screen: ${report.screen}`);
  if (report.tool) lines.push(`Tool: ${report.tool}`);
  if (report.activeLayer) lines.push(`Active layer: ${report.activeLayer}`);
  if (report.activeSheet) lines.push(`Active sheet: ${report.activeSheet}`);
  if (report.fileName) lines.push(`File: ${report.fileName}`);
  lines.push(`Units: ${report.units}    Pro: ${report.paid ? "yes" : "no"}`);
  lines.push(`Stories: ${report.counts.stories}, sublayers: ${report.counts.sublayers}, shapes: ${report.counts.shapes}, selected: ${report.selection}`);
  lines.push(`Viewport: ${report.viewport.w}×${report.viewport.h} @ ${Math.round(report.viewport.zoom * 100)}%`);
  lines.push("");
  lines.push("Recent actions (newest last):");
  if (!report.recentActions.length) {
    lines.push("  (none recorded yet)");
  } else {
    for (const a of report.recentActions) {
      lines.push(`  • ${a.label}${a.ago ? ` — ${a.ago}` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------- Submit ----------

async function submitFeedback() {
  const modal = document.getElementById("feedback-modal");
  const textarea = document.getElementById("feedback-description");
  if (!modal || !textarea) return;
  const description = textarea.value.trim();
  if (!description) {
    setFeedbackStatus("Please write a quick note about what you're seeing.", "error");
    textarea.focus();
    return;
  }
  const report = modal._report || buildFeedbackReport();
  const submitBtn = document.getElementById("feedback-submit");
  if (submitBtn) submitBtn.disabled = true;
  setFeedbackStatus("Sending…");

  const endpoint = (typeof FEEDBACK_FUNCTION_URL === "string") ? FEEDBACK_FUNCTION_URL.trim() : "";
  let ok = false;
  let errMsg = "";
  if (endpoint) {
    try {
      const headers = { "Content-Type": "application/json" };
      // Supabase's gateway needs the project's publishable key on the
      // request even when the function itself has verify_jwt = false.
      // Fall back to no-auth for non-Supabase deployments.
      if (typeof SUPABASE_PUBLISHABLE_KEY === "string" && SUPABASE_PUBLISHABLE_KEY) {
        headers["apikey"] = SUPABASE_PUBLISHABLE_KEY;
        headers["Authorization"] = `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ description, report }),
      });
      if (res.ok) {
        ok = true;
      } else {
        errMsg = `Server returned ${res.status}`;
      }
    } catch (err) {
      errMsg = (err && err.message) || String(err);
    }
  } else {
    // No endpoint configured — fall back to a mailto link so the report
    // still reaches us (one extra step for the user, but never silently
    // dropped).
    openMailtoFallback(description, report);
    ok = true;
  }

  if (submitBtn) submitBtn.disabled = false;
  if (ok) {
    setFeedbackStatus("Thanks! Your feedback was sent.", "success");
    logUserAction("Sent feedback");
    setTimeout(hideFeedbackModal, 1200);
  } else {
    // Submission failed but we don't want the user to lose their note —
    // keep the modal open and offer the mailto fallback as a recovery.
    setFeedbackStatus(`Couldn't reach the server (${errMsg}). Opening your email instead…`, "error");
    setTimeout(() => openMailtoFallback(description, report), 600);
  }
}

function openMailtoFallback(description, report) {
  const recipient = FEEDBACK_RECIPIENT_FALLBACK;
  const subject = "Easy Draft feedback";
  const body =
    description + "\n\n" +
    "--- Diagnostic report ---\n" +
    formatReportForDisplay(report) + "\n";
  const url = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}
