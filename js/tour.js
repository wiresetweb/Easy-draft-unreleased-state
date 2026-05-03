'use strict';

// ==============================================================================
// First-time-user walkthrough.
//
// Auto-fires once per browser (gated by localStorage) and replayable at any
// time from File → Walkthrough. Each step has a copy line, a target element
// to glow, and either a manual "Next" button or an `advance()` predicate that
// polls the app's state every animation frame and advances when the user
// performs the expected action. Esc / Skip leaves at any time and marks the
// tour as completed so it stops auto-firing.
// ==============================================================================

const TOUR_STORAGE_KEY = "easydraft.tour.completed";

let tourState = null;       // { steps, stepIndex, cardEl, targetEl, rafId }
const tourSnapshot = {};    // bag for inter-step state checks; reset per tour

// ---------- Helpers ----------

function tourFindSublayerByName(name) {
  if (!Array.isArray(state.stories)) return null;
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.name === name) return sub;
    }
  }
  return null;
}

function tourCountShapesByType(type) {
  let n = 0;
  forEachShape((sh) => { if (sh.type === type) n++; });
  return n;
}

function tourCountShapesOnLayerName(name) {
  let n = 0;
  if (!Array.isArray(state.stories)) return 0;
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.name === name) n += sub.shapes.length;
    }
  }
  return n;
}

function tourSnapshotShapeMap(predicate, sigFn) {
  const m = new Map();
  forEachShape((sh) => { if (predicate(sh)) m.set(sh.id, sigFn(sh)); });
  return m;
}

function tourAnyShapeChanged(predicate, sigFn, prevMap) {
  let changed = false;
  forEachShape((sh) => {
    if (!predicate(sh)) return;
    const prev = prevMap.get(sh.id);
    if (prev === undefined) return; // shape didn't exist when we snapshotted
    if (sigFn(sh) !== prev) changed = true;
  });
  return changed;
}

// ---------- Step list ----------

function tourStepList() {
  return [
    {
      id: "welcome",
      title: "Welcome to Easy Draft",
      copy: "Quick two-minute tour. We'll draw a wall, drop a door on it, then jump to the export screen. Hit Skip or press Esc to leave any time.",
      manual: true,
      manualLabel: "Start tour",
    },
    {
      id: "draw-wall",
      title: "Draw a wall",
      copy: "Easy Draft draws walls with the Line tool — already selected for you. Click two points on the canvas to drop a wall between them. The cursor snaps to the grid so lengths land clean.",
      anchor: () => document.querySelector('.tool[data-tool="line"]'),
      enter: () => { tourSnapshot.wallCount = tourCountShapesOnLayerName("Walls"); },
      advance: () => tourCountShapesOnLayerName("Walls") > (tourSnapshot.wallCount || 0),
    },
    {
      id: "pick-select",
      title: "Switch to the Select tool",
      copy: "To edit anything you've drawn, you need the Select tool. Click 'Select' on the left toolbar (or press V).",
      anchor: () => document.querySelector('.tool[data-tool="select"]'),
      advance: () => state.tool === "select",
    },
    {
      id: "select-wall",
      title: "Click your wall",
      copy: "Now click directly on the wall you just drew. A little popup will appear right next to it — that IS the editor. Most objects in Easy Draft work this way: click to edit.",
      anchor: null,
      advance: () => {
        if (state.selection.size !== 1) return false;
        const id = [...state.selection][0];
        const sh = findShapeById(id);
        return !!(sh && sh.type === "line");
      },
    },
    {
      id: "thicken",
      title: "Make it a real wall",
      copy: "Walls have framing, not just a centerline. In the popup, click 'Ext. wood' to make this an exterior framed wall — watch it thicken on the canvas. (If the popup's gone, click your wall again first.)",
      anchor: () => {
        const row = document.getElementById("wall-thickness-row");
        if (!row || row.classList.contains("hidden")) return null;
        return row.querySelector('.wall-thickness-btn[data-preset="ext-wood"]') || row;
      },
      enter: () => {
        tourSnapshot.thicknessMap = tourSnapshotShapeMap(
          (sh) => sh.type === "line",
          (sh) => String(sh.thickness || 0),
        );
      },
      advance: () => tourAnyShapeChanged(
        (sh) => sh.type === "line",
        (sh) => String(sh.thickness || 0),
        tourSnapshot.thicknessMap,
      ),
    },
    {
      id: "switch-layer",
      title: "Switch layers",
      copy: "Layers do two things: they organize your drawing AND they swap your toolset. Click the words 'Windows & Doors' in the layer panel on the right (don't tap the eye or color dot — those just toggle visibility / color).",
      anchor: () => {
        const sub = tourFindSublayerByName("Windows & Doors");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        if (!row) return null;
        // Anchor to the layer-name span specifically — the row-wide glow
        // misled testers into clicking the eye icon, which only toggles
        // visibility. The name span is the click target that switches the
        // active layer.
        return row.querySelector(".sub-name") || row;
      },
      advance: () => {
        const sub = activeSublayer();
        return !!(sub && sub.name === "Windows & Doors");
      },
    },
    {
      id: "drop-door",
      title: "Drag a door onto your wall",
      copy: "The right panel is now a door catalog instead of the layer tree — that's what switching layers gets you. Drag any door onto your wall; Easy Draft snaps it to the centerline and splits the wall at the opening for you.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => {
        tourSnapshot.doorCount = tourCountShapesByType("door");
        // Defensive: if step 6 advanced because state.activeSublayerId was
        // already on Windows & Doors (e.g. the user replayed the tour), the
        // palette panel may not have been re-rendered. Force-sync now.
        if (typeof updatePaletteVisibility === "function") updatePaletteVisibility();
      },
      advance: () => tourCountShapesByType("door") > (tourSnapshot.doorCount || 0),
    },
    {
      id: "drop-window",
      title: "Now a window",
      copy: "Same gesture: drag a window from the catalog onto another part of your wall. Easy Draft handles the wall cut for windows the same way it does for doors.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.windowCount = tourCountShapesByType("window"); },
      advance: () => tourCountShapesByType("window") > (tourSnapshot.windowCount || 0),
    },
    {
      id: "flip-door",
      title: "Flip the door",
      copy: "Click your door to select it. Use 'Hinge' to swap the hinge side, or 'Swing' to flip in/out. Same click-to-edit pattern — every object's controls live right next to it.",
      anchor: () => {
        const row = document.getElementById("door-flip-row");
        if (!row || row.classList.contains("hidden")) return null;
        return row;
      },
      enter: () => {
        tourSnapshot.doorStateMap = tourSnapshotShapeMap(
          (sh) => sh.type === "door",
          (sh) => `${sh.x.toFixed(3)}|${sh.y.toFixed(3)}|${sh.angle.toFixed(3)}|${sh.swing}`,
        );
      },
      advance: () => tourAnyShapeChanged(
        (sh) => sh.type === "door",
        (sh) => `${sh.x.toFixed(3)}|${sh.y.toFixed(3)}|${sh.angle.toFixed(3)}|${sh.swing}`,
        tourSnapshot.doorStateMap,
      ),
    },
    {
      id: "show-page",
      title: "Show the page outline",
      copy: "Easy Draft already has a printable sheet ready. In the 'Pages' list at the top-left, click the eye on the sheet's row to overlay the page outline on your drawing — drag the dashed rectangle to position the printable area over what you want.",
      anchor: () => {
        if (!Array.isArray(state.sheets)) return null;
        const sheet = state.sheets.find((s) => (s.sheetType || "drawing") === "drawing");
        if (!sheet) return null;
        return document.querySelector(
          `.sheet-row[data-sheet-id="${sheet.id}"] [data-sheet-action="toggle-visibility"]`
        );
      },
      advance: () => Array.isArray(state.sheets) && state.sheets.some((s) => s.pageOutlineVisible),
    },
    {
      id: "plan-mode",
      title: "Switch to Plan mode",
      copy: "Two modes: Draw is where you build the drawing; Plan is where you compose it onto a real titled sheet. Same drawing, different lens. Click 'Plan' in the top bar.",
      anchor: () => document.querySelector('.mode-btn[data-mode="plan"]'),
      advance: () => state.viewMode === "plan",
    },
    {
      id: "export",
      title: "Export to PDF",
      copy: "Your drawing is now inside a real titled sheet with a scale bar and title block. Hit 'Export PDF…' on the left when you're ready — that's the tour. You've drawn a wall, fitted openings, composed a sheet, and exported. Happy drafting!",
      anchor: () => document.getElementById("plan-export-btn"),
      manual: true,
      manualLabel: "Finish",
    },
  ];
}

// ---------- Lifecycle ----------

function startTour() {
  if (tourState) endTour(false);
  for (const k of Object.keys(tourSnapshot)) delete tourSnapshot[k];
  tourState = { steps: tourStepList(), stepIndex: 0, cardEl: null, targetEl: null, rafId: 0 };
  buildTourCard();
  enterStep(0);
  startTourTick();
  document.addEventListener("keydown", onTourKeydown, true);
}

function endTour(completed) {
  if (!tourState) return;
  if (tourState.rafId) cancelAnimationFrame(tourState.rafId);
  if (tourState.cardEl && tourState.cardEl.parentNode) tourState.cardEl.parentNode.removeChild(tourState.cardEl);
  if (tourState.targetEl) tourState.targetEl.classList.remove("tour-target");
  tourState = null;
  document.removeEventListener("keydown", onTourKeydown, true);
  if (completed) {
    try { localStorage.setItem(TOUR_STORAGE_KEY, "true"); } catch (_) { /* private mode, etc */ }
  }
}

function advanceTour() {
  if (!tourState) return;
  const next = tourState.stepIndex + 1;
  if (next >= tourState.steps.length) {
    endTour(true);
    return;
  }
  enterStep(next);
}

function enterStep(idx) {
  if (!tourState) return;
  tourState.stepIndex = idx;
  const step = tourState.steps[idx];
  if (typeof step.enter === "function") {
    try { step.enter(); } catch (e) { console.warn("[tour] enter() threw:", e); }
  }
  paintTourCard(step);
  paintTourTarget(step);
}

function startTourTick() {
  const tick = () => {
    if (!tourState) return;
    const step = tourState.steps[tourState.stepIndex];
    if (typeof step.advance === "function") {
      let done = false;
      try { done = step.advance(); } catch (_) { done = false; }
      if (done) {
        advanceTour();
        if (tourState) tourState.rafId = requestAnimationFrame(tick);
        return;
      }
    }
    // Anchor target may appear / disappear as the user works (modal popups,
    // layer tree re-render). Re-resolve it every frame so the glow follows.
    repaintTourTarget();
    tourState.rafId = requestAnimationFrame(tick);
  };
  tourState.rafId = requestAnimationFrame(tick);
}

function onTourKeydown(e) {
  if (e.key === "Escape") {
    // Don't swallow Escape if the user's just dismissing a modal — let the
    // app handle it first, then close the tour on the next press if needed.
    // Cheaper heuristic: only close the tour if no modal is open right now.
    const modalOpen = document.querySelector(
      ".dim-modal:not(.hidden), .line-modal:not(.hidden), .text-modal:not(.hidden)," +
      " .measure-modal:not(.hidden), .stairs-modal:not(.hidden), .cabinet-modal:not(.hidden)," +
      " .island-modal:not(.hidden), .layer-hint-modal:not(.hidden)"
    );
    if (modalOpen) return;
    endTour(true);
  }
}

// ---------- Card + target rendering ----------

function buildTourCard() {
  const card = document.createElement("div");
  card.className = "tour-card";
  card.innerHTML = `
    <div class="tour-card-header">
      <div class="tour-card-title"></div>
      <div class="tour-card-step"></div>
    </div>
    <div class="tour-card-body"></div>
    <div class="tour-card-actions">
      <button type="button" class="tour-card-skip">Skip tour</button>
      <button type="button" class="tour-card-next">Next</button>
    </div>
  `;
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  card.querySelector(".tour-card-skip").addEventListener("click", () => endTour(true));
  card.querySelector(".tour-card-next").addEventListener("click", () => advanceTour());
  document.body.appendChild(card);
  tourState.cardEl = card;
}

function paintTourCard(step) {
  const card = tourState.cardEl;
  card.querySelector(".tour-card-title").textContent = step.title;
  card.querySelector(".tour-card-body").textContent = step.copy;
  card.querySelector(".tour-card-step").textContent =
    `Step ${tourState.stepIndex + 1} of ${tourState.steps.length}`;
  const next = card.querySelector(".tour-card-next");
  if (step.manual) {
    next.textContent = step.manualLabel || "Next";
    next.style.display = "";
  } else {
    next.style.display = "none";
  }
}

function paintTourTarget(step) {
  if (tourState.targetEl) {
    tourState.targetEl.classList.remove("tour-target");
    tourState.targetEl = null;
  }
  if (typeof step.anchor !== "function") return;
  let el = null;
  try { el = step.anchor(); } catch (_) { el = null; }
  if (!el) return;
  el.classList.add("tour-target");
  tourState.targetEl = el;
}

function repaintTourTarget() {
  if (!tourState) return;
  const step = tourState.steps[tourState.stepIndex];
  if (typeof step.anchor !== "function") return;
  let want = null;
  try { want = step.anchor(); } catch (_) { want = null; }
  if (want === tourState.targetEl) return;
  if (tourState.targetEl) tourState.targetEl.classList.remove("tour-target");
  if (want) want.classList.add("tour-target");
  tourState.targetEl = want;
}

// ---------- Entry points ----------

function maybeAutoStartTour() {
  let done = "false";
  try { done = localStorage.getItem(TOUR_STORAGE_KEY) || "false"; } catch (_) { /* no-op */ }
  if (done === "true") return;
  startTour();
}
