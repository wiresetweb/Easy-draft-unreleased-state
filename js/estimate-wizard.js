'use strict';

// ==============================================================================
// Materials Estimate wizard.
//
// A guided, multi-step flow that gathers exactly the inputs the estimate needs
// and resolves the clarifications it can't guess — ceiling heights, walls with
// no thickness or an unmapped custom depth, optional joists — then generates
// the Estimate sheet. The front door to the estimator (File menu + a toolbar
// button shown only to owners). See docs/materials-estimator.md.
//
// Edits the model live; the whole session collapses into one undo entry
// (wizardEnsureHistory). Pure calculation stays in js/estimate.js.
// ==============================================================================

const WIZARD_STEPS = ["intro", "ceiling", "walls", "openings", "joists", "done"];
let wizardStep = 0;
let wizardDirty = false;

// Push a single history entry the first time the wizard mutates the model, so
// one undo reverts the whole wizard session.
function wizardEnsureHistory() {
  if (!wizardDirty) { pushHistory("Estimate wizard"); wizardDirty = true; }
}

function bindEstimateWizard() {
  const back = document.getElementById("wizard-back");
  const next = document.getElementById("wizard-next");
  const close = document.getElementById("wizard-close");
  const modal = document.getElementById("estimate-wizard");
  if (back) back.addEventListener("click", wizardBack);
  if (next) next.addEventListener("click", wizardNext);
  if (close) close.addEventListener("click", closeEstimateWizard);
  if (modal) {
    modal.addEventListener("pointerdown", (e) => { if (e.target === modal) closeEstimateWizard(); });
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeEstimateWizard(); e.stopPropagation(); } });
  }
  updateEstimatorButtons();
}

// Show the toolbar Estimate button only when the add-on is owned. (Called at
// init and again from auth.js once the entitlement resolves.)
function updateEstimatorButtons() {
  const btn = document.getElementById("tool-estimate-btn");
  if (btn) btn.classList.toggle("hidden", !state.hasEstimatorEngineer);
}

function openEstimateWizard() {
  if (!state.hasEstimatorEngineer) {
    if (typeof promptEstimatorUpgrade === "function") promptEstimatorUpgrade();
    return;
  }
  wizardStep = 0;
  wizardDirty = false;
  const modal = document.getElementById("estimate-wizard");
  if (modal) modal.classList.remove("hidden");
  renderWizard();
}

function closeEstimateWizard() {
  const modal = document.getElementById("estimate-wizard");
  if (modal) modal.classList.add("hidden");
}

function wizardNext() {
  if (WIZARD_STEPS[wizardStep] === "done") { finishWizard(); return; }
  wizardStep = Math.min(WIZARD_STEPS.length - 1, wizardStep + 1);
  renderWizard();
}

function wizardBack() {
  wizardStep = Math.max(0, wizardStep - 1);
  renderWizard();
}

function renderWizard() {
  const body = document.getElementById("wizard-body");
  const info = document.getElementById("wizard-stepinfo");
  const back = document.getElementById("wizard-back");
  const next = document.getElementById("wizard-next");
  if (!body) return;
  const id = WIZARD_STEPS[wizardStep];
  if (info) info.textContent = `Step ${wizardStep + 1} of ${WIZARD_STEPS.length}`;
  if (back) back.disabled = wizardStep === 0;
  if (next) next.textContent = id === "done" ? "Generate estimate" : "Next";
  body.innerHTML = "";
  const render = WIZARD_STEP_RENDERERS[id];
  if (render) render(body);
}

// ---------- small DOM helpers ----------

function wizEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// A +/- stepper. getVal()/setVal(v) work in feet; step is in feet.
function wizStepper(getVal, setVal, stepFt) {
  const wrap = wizEl("div", "dim-stepper");
  const dec = wizEl("button", "dim-step-btn", "−");
  const out = wizEl("span", "dim-width-readout");
  const inc = wizEl("button", "dim-step-btn", "+");
  dec.type = inc.type = "button";
  const refresh = () => { out.textContent = formatFeet(getVal()); };
  const bump = (dir) => {
    const cur = getVal();
    let next = (Math.round(cur / stepFt) + dir) * stepFt;
    if (next < stepFt) next = stepFt;
    setVal(next);
    refresh();
  };
  dec.addEventListener("click", () => bump(-1));
  inc.addEventListener("click", () => bump(1));
  refresh();
  wrap.appendChild(dec); wrap.appendChild(out); wrap.appendChild(inc);
  return wrap;
}

// ---------- steps ----------

function renderWizardIntro(body) {
  body.appendChild(wizEl("p", "wizard-lead", "Let's put together a materials takeoff. We'll confirm a few things the estimate needs and that we can't safely guess:"));
  const ul = wizEl("ul", "wizard-list");
  [
    "Ceiling height for each story",
    "Any walls drawn as centerlines (no thickness) or with a custom depth we can't map to a stud size",
    "Door & window heights (already prefilled to standards — adjust if you like)",
    "Optionally, floor joists",
  ].forEach((t) => ul.appendChild(wizEl("li", null, t)));
  body.appendChild(ul);
  body.appendChild(wizEl("p", "wizard-hint", "Nothing here is guessed — anything we can't confirm is listed on the estimate as a gap rather than invented."));
}

function renderWizardCeiling(body) {
  body.appendChild(wizEl("h3", "wizard-step-title", "Ceiling height per story"));
  body.appendChild(wizEl("p", "wizard-hint", "Prefilled at 8'-0\" — adjust any that differ."));
  for (const story of state.stories) {
    // Prefill (and commit) a sensible default for stories with none set.
    if (story.ceilingHeight == null) { wizardEnsureHistory(); story.ceilingHeight = 8; }
    const row = wizEl("div", "wizard-row");
    row.appendChild(wizEl("span", "wizard-row-label", story.name));
    row.appendChild(wizStepper(
      () => story.ceilingHeight,
      (v) => { wizardEnsureHistory(); story.ceilingHeight = v; },
      2 / 12,
    ));
    body.appendChild(row);
  }
}

// Flagged walls = drawn with no thickness, or a custom depth that doesn't map
// to a stud size.
function wizardFlaggedWalls() {
  const out = [];
  for (const story of state.stories) {
    for (const w of wallShapesForStory(story)) {
      if (!resolveWallAssembly(w).resolved) out.push({ story, wall: w });
    }
  }
  return out;
}

function wizardWallDescriptor(entry) {
  const len = wallRunLength(entry.wall);
  const t = entry.wall.thickness || 0;
  const stateStr = t > 0 ? `custom ${formatFeet(t)}` : "no thickness";
  return `${entry.story.name}: ${formatFeet(len)} wall — ${stateStr}`;
}

// Apply an assembly to a wall: tag the stud size, and for a no-thickness wall
// also give it the standard depth so it draws with width.
function wizardApplyAssembly(wall, assemblyKey) {
  wall.assembly = assemblyKey;
  if (!(wall.thickness > 0)) {
    const presetKey = Object.keys(PRESET_TO_ASSEMBLY).find((k) => PRESET_TO_ASSEMBLY[k] === assemblyKey);
    if (presetKey) wall.thickness = WALL_THICKNESS_PRESETS[presetKey];
  }
}

function renderWizardWalls(body) {
  body.appendChild(wizEl("h3", "wizard-step-title", "Walls that need an assembly"));
  const flagged = wizardFlaggedWalls();
  if (!flagged.length) {
    body.appendChild(wizEl("p", "wizard-ok", "✓ Every wall has a thickness that maps to an assembly."));
    return;
  }
  body.appendChild(wizEl("p", "wizard-hint",
    "These walls are centerlines or have a custom depth. Check the ones to set, pick an assembly, and apply. (A custom depth keeps its size — we just tag the stud type.)"));

  // Assembly choice.
  const choiceWrap = wizEl("div", "wizard-choice");
  const choices = [
    { key: "2x4", label: '2×4 (4½")' },
    { key: "2x6", label: '2×6 (6½")' },
    { key: "cmu", label: 'CMU (8")' },
  ];
  let chosen = "2x4";
  const choiceBtns = [];
  for (const c of choices) {
    const b = wizEl("button", "wizard-choice-btn" + (c.key === chosen ? " active" : ""), c.label);
    b.type = "button";
    b.addEventListener("click", () => {
      chosen = c.key;
      choiceBtns.forEach((x) => x.el.classList.toggle("active", x.key === chosen));
    });
    choiceBtns.push({ key: c.key, el: b });
    choiceWrap.appendChild(b);
  }
  body.appendChild(choiceWrap);

  // Checklist.
  const list = wizEl("div", "wizard-checklist");
  const checks = [];
  for (const entry of flagged) {
    const row = wizEl("label", "wizard-check-row");
    const cb = wizEl("input");
    cb.type = "checkbox";
    cb.checked = true;
    row.appendChild(cb);
    row.appendChild(wizEl("span", null, wizardWallDescriptor(entry)));
    list.appendChild(row);
    checks.push({ cb, entry });
  }
  body.appendChild(list);

  const actions = wizEl("div", "wizard-actions");
  const selAll = wizEl("button", "btn-mini", "Select all");
  const selNone = wizEl("button", "btn-mini", "Select none");
  const apply = wizEl("button", "btn-mini btn-primary", "Apply to checked");
  selAll.type = selNone.type = apply.type = "button";
  selAll.addEventListener("click", () => checks.forEach((c) => { c.cb.checked = true; }));
  selNone.addEventListener("click", () => checks.forEach((c) => { c.cb.checked = false; }));
  apply.addEventListener("click", () => {
    const targets = checks.filter((c) => c.cb.checked);
    if (!targets.length) return;
    wizardEnsureHistory();
    for (const t of targets) wizardApplyAssembly(t.entry.wall, chosen);
    if (typeof reflowStairsForWalls === "function") reflowStairsForWalls(targets.map((t) => t.entry.wall));
    render();
    renderWizard(); // resolved walls drop off the list
  });
  actions.appendChild(selAll);
  actions.appendChild(selNone);
  actions.appendChild(apply);
  body.appendChild(actions);
}

function renderWizardOpenings(body) {
  body.appendChild(wizEl("h3", "wizard-step-title", "Door & window heights"));
  const openings = [];
  forEachShape((sh, sub, story) => {
    if (sh.type === "door" || sh.type === "window") openings.push({ sh, story });
  });
  if (!openings.length) {
    body.appendChild(wizEl("p", "wizard-ok", "No doors or windows placed."));
    return;
  }
  body.appendChild(wizEl("p", "wizard-hint",
    "Heights (floor to top of opening) are prefilled to standards. Adjust any that differ — or just continue."));
  const list = wizEl("div", "wizard-checklist wizard-scroll");
  for (const { sh, story } of openings) {
    const row = wizEl("div", "wizard-row");
    const label = (sh.kind || (sh.type === "window" ? "Window" : "Door")) + ` — ${story.name}`;
    row.appendChild(wizEl("span", "wizard-row-label", label));
    row.appendChild(wizStepper(
      () => effectiveOpeningHeightFt(sh),
      (v) => { wizardEnsureHistory(); sh.roughHeight = v; },
      2 / 12,
    ));
    list.appendChild(row);
  }
  body.appendChild(list);
}

function renderWizardJoists(body) {
  body.appendChild(wizEl("h3", "wizard-step-title", "Floor joists (optional)"));
  body.appendChild(wizEl("p", "wizard-hint",
    "Turn on per story to include a joist takeoff. Member adequacy / sizing is the Engineering Tool's job — this just counts pieces."));
  for (const story of state.stories) {
    if (!story.framing) story.framing = { floor: null, roof: null };
    const block = wizEl("div", "wizard-joist-block");
    const head = wizEl("label", "wizard-check-row");
    const cb = wizEl("input");
    cb.type = "checkbox";
    cb.checked = !!story.framing.floor;
    head.appendChild(cb);
    head.appendChild(wizEl("span", null, `Estimate joists — ${story.name}`));
    block.appendChild(head);

    const detail = wizEl("div", "wizard-joist-detail");
    const buildDetail = () => {
      detail.innerHTML = "";
      const f = story.framing.floor;
      if (!f) return;
      const sizeSel = wizEl("select", "story-est-select");
      for (const s of FRAMING_SIZES) { const o = wizEl("option", null, s); o.value = s; sizeSel.appendChild(o); }
      sizeSel.value = f.size;
      sizeSel.addEventListener("change", () => { wizardEnsureHistory(); f.size = sizeSel.value; });

      const spSel = wizEl("select", "story-est-select");
      for (const sp of FRAMING_SPACINGS_IN) { const o = wizEl("option", null, sp + '" o.c.'); o.value = String(sp); spSel.appendChild(o); }
      spSel.value = String(f.spacing);
      spSel.addEventListener("change", () => { wizardEnsureHistory(); f.spacing = parseFloat(spSel.value); });

      const dir = wizEl("input", "story-est-input story-est-dir");
      dir.type = "number"; dir.min = "0"; dir.max = "180"; dir.step = "5";
      dir.value = String(Math.round((f.direction || 0) * 180 / Math.PI));
      dir.addEventListener("change", () => {
        let d = parseFloat(dir.value);
        if (isNaN(d)) { dir.value = String(Math.round((f.direction || 0) * 180 / Math.PI)); return; }
        d = ((d % 180) + 180) % 180;
        wizardEnsureHistory(); f.direction = d * Math.PI / 180; dir.value = String(Math.round(d));
      });
      detail.appendChild(wizEl("span", "wizard-row-label", "Size"));
      detail.appendChild(sizeSel);
      detail.appendChild(spSel);
      const degWrap = wizEl("span", "story-est-deg");
      degWrap.appendChild(dir); degWrap.appendChild(wizEl("span", null, "°"));
      detail.appendChild(degWrap);
    };
    cb.addEventListener("change", () => {
      wizardEnsureHistory();
      story.framing.floor = cb.checked ? makeFramingSpec() : null;
      buildDetail();
    });
    buildDetail();
    block.appendChild(detail);
    body.appendChild(block);
  }
}

function renderWizardDone(body) {
  body.appendChild(wizEl("h3", "wizard-step-title", "Ready"));
  const gaps = (typeof computeEstimateGaps === "function") ? computeEstimateGaps(state) : [];
  if (gaps.length) {
    body.appendChild(wizEl("p", "wizard-hint",
      `${gaps.length} item${gaps.length === 1 ? "" : "s"} still can't be estimated and will show in the "Missing inputs" block:`));
    const ul = wizEl("ul", "wizard-list");
    gaps.slice(0, 8).forEach((g) => ul.appendChild(wizEl("li", null, g.label)));
    if (gaps.length > 8) ul.appendChild(wizEl("li", null, `…and ${gaps.length - 8} more`));
    body.appendChild(ul);
  } else {
    body.appendChild(wizEl("p", "wizard-ok", "✓ Everything the estimate needs is set."));
  }
  body.appendChild(wizEl("p", "wizard-hint",
    "“Generate estimate” creates (or updates) the Estimate sheet in Plan mode. You can export it to CSV from there or below."));
  const csv = wizEl("button", "btn-mini", "Download CSV now");
  csv.type = "button";
  csv.addEventListener("click", () => { if (typeof exportEstimateCsv === "function") exportEstimateCsv(); });
  body.appendChild(csv);
}

const WIZARD_STEP_RENDERERS = {
  intro: renderWizardIntro,
  ceiling: renderWizardCeiling,
  walls: renderWizardWalls,
  openings: renderWizardOpenings,
  joists: renderWizardJoists,
  done: renderWizardDone,
};

function finishWizard() {
  ensureEstimateSheet();
  if (state.viewMode !== "plan") setViewMode("plan");
  if (typeof renderSheetList === "function") renderSheetList();
  if (typeof renderSheetProperties === "function") renderSheetProperties();
  render();
  closeEstimateWizard();
}
