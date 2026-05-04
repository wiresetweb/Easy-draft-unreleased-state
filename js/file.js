'use strict';

// ==============================================================================
// File menu — New / Open / Save / Save As / Export.
//
// Saves a JSON document of the entire drawing to the user's local filesystem.
// Where the File System Access API is available (Chrome / Edge / Opera),
// uses showSaveFilePicker / showOpenFilePicker so subsequent Saves overwrite
// the same file in place. Falls back to anchor-download + <input type=file>
// on Firefox / Safari, where Save behaves like Save As every time.
// No server, no cloud — everything stays on the user's machine.
// ==============================================================================

const FILE_FORMAT = "drafting-studio-v1";
const FILE_EXT = ".dstudio.json";
const DEFAULT_FILENAME = "Untitled" + FILE_EXT;

const hasFileSystemAccess =
  typeof window !== "undefined" &&
  typeof window.showSaveFilePicker === "function" &&
  typeof window.showOpenFilePicker === "function";

// True for the family of errors browsers throw when the user dismisses a
// FileSystemAccess picker. AbortError is the spec name; some Chromium
// versions throw NotAllowedError when a stale handle's permission prompt
// gets cancelled. Either way it's a user gesture, not something to alert.
function isFsCancelError(err) {
  if (!err) return false;
  return err.name === "AbortError" || err.name === "NotAllowedError";
}

function fileTypesFilter() {
  return [{
    description: "Drafting Studio drawing",
    accept: { "application/json": [FILE_EXT, ".json"] },
  }];
}

// Build a plain-JSON snapshot of the drawing. Reuses the same shape as the
// in-memory state for stories/sublayers/shapes — they're already structured
// cloneable. View settings (zoom/pan/grid) are saved alongside so reopening
// the file restores the user's working view.
function serializeDocument() {
  return {
    format: FILE_FORMAT,
    savedAt: new Date().toISOString(),
    stories: state.stories.map((s) => ({
      id: s.id,
      name: s.name,
      visible: s.visible,
      expanded: s.expanded,
      sublayers: s.sublayers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        color: l.color,
        shapes: l.shapes.map((sh) => cloneShape(sh)),
      })),
    })),
    activeSublayerId: state.activeSublayerId,
    units: state.units,
    view: {
      zoom: state.zoom,
      pan: { x: state.pan.x, y: state.pan.y },
      gridSize: state.gridSize,
      snap: state.snap,
      gridOpacity: state.gridOpacity,
    },
    // Plan-view sheets travel with the document — losing the title block /
    // sheet layout on a round-trip save would defeat the point.
    sheets: Array.isArray(state.sheets) ? state.sheets.map((s) => JSON.parse(JSON.stringify(s))) : [],
    activeSheetId: state.activeSheetId,
  };
}

function loadDocument(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.stories)) {
    appAlert("That file doesn't look like a Drafting Studio drawing.", { title: "Couldn't open file" });
    return false;
  }
  // Rehydrate stories with defensive defaults so older / hand-edited files
  // don't crash the renderer if a field is missing.
  state.stories = data.stories.map((s) => ({
    id: s.id || makeId("S"),
    name: s.name || "Story",
    visible: s.visible !== false,
    expanded: s.expanded !== false,
    sublayers: (s.sublayers || []).map((l) => ({
      id: l.id || makeId("L"),
      name: l.name || "Layer",
      visible: l.visible !== false,
      color: l.color || DEFAULT_LAYER_COLOR_FALLBACK,
      shapes: Array.isArray(l.shapes) ? l.shapes.map((sh) => cloneShape(sh)) : [],
    })),
  }));
  state.activeSublayerId = data.activeSublayerId || null;
  if (!activeSublayer()) {
    state.activeSublayerId = pickFallbackActiveSublayerId();
  }

  // Honor the unit system saved with the document. Older files pre-date
  // this field, so default to whatever the visitor already has set rather
  // than forcing them back to imperial.
  if (data.units === "metric" || data.units === "imperial") {
    setUnits(data.units);
  }

  if (data.view && typeof data.view === "object") {
    if (typeof data.view.zoom === "number") {
      state.zoom = data.view.zoom;
      zoomReadout.textContent = Math.round(state.zoom * 100) + "%";
    }
    if (data.view.pan && typeof data.view.pan.x === "number" && typeof data.view.pan.y === "number") {
      state.pan = { x: data.view.pan.x, y: data.view.pan.y };
    }
    if (typeof data.view.gridSize === "number") {
      state.gridSize = data.view.gridSize;
      gridSizeInput.value = data.view.gridSize;
    }
    if (typeof data.view.snap === "boolean") {
      state.snap = data.view.snap;
      snapToggle.checked = data.view.snap;
    }
    if (typeof data.view.gridOpacity === "number") {
      state.gridOpacity = data.view.gridOpacity;
      gridOpacityInput.value = Math.round(data.view.gridOpacity * 100);
    }
  }

  // Restore plan-view sheets when present; otherwise drop a fresh default
  // sheet so the file always has something to show in plan mode.
  if (Array.isArray(data.sheets) && data.sheets.length) {
    state.sheets = data.sheets.map((s) => JSON.parse(JSON.stringify(s)));
    state.activeSheetId = data.activeSheetId || state.sheets[0].id;
  } else {
    state.sheets = [];
    state.activeSheetId = null;
    ensureSheets();
  }
  // Older saves predate the page-on-canvas feature — make sure every sheet
  // has a pageOrigin so the draft view has something to render.
  ensurePageOrigins();
  // Loading a different document shouldn't preserve the prior file's
  // pan/zoom — start fresh fitted to the canvas.
  resetPlanView();

  state.history.length = 0;
  state.future.length = 0;
  state.selection.clear();
  state.selectionMode = null;
  state.selectionData = null;
  state.marquee = null;
  state.pending = null;
  state.placing = null;
  state.curveDrag = null;
  state.cabinetBuilder = null;
  state.stairsDirection = null;
  resetCrossLayerMisses();

  renderLayerTree();
  updatePaletteVisibility();
  renderSheetList();
  renderSheetProperties();
  renderNotesEditor();
  renderSheetLayerTree();
  render();
  return true;
}

// ---------- File operations ----------

async function fileNew() {
  const ok = await appConfirm("Start a new drawing?\n\nUnsaved changes will be lost.", {
    title: "New drawing",
    confirmLabel: "Start new",
    danger: true,
  });
  if (!ok) return;
  state.stories.length = 0;
  state.activeSublayerId = null;
  state.history.length = 0;
  state.future.length = 0;
  state.selection.clear();
  state.fileHandle = null;
  state.fileName = null;
  state.sheets = [];
  state.activeSheetId = null;
  addStory();
  ensureSheets();
  resetPlanView();
  renderSheetList();
  renderSheetProperties();
  renderNotesEditor();
  renderSheetLayerTree();
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };
  centerView();
  zoomReadout.textContent = "100%";
  renderLayerTree();
  updatePaletteVisibility();
  render();
  updateFileLabel();
}

async function fileOpen() {
  if (hasFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: fileTypesFilter(),
        multiple: false,
      });
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      if (loadDocument(data)) {
        state.fileHandle = handle;
        state.fileName = handle.name;
        updateFileLabel();
      }
    } catch (err) {
      // User cancelled the picker — silent. Anything else is a real error.
      if (!isFsCancelError(err)) {
        console.error(err);
        appAlert("Couldn't open the file: " + (err.message || err), { title: "Couldn't open file" });
      }
    }
    return;
  }
  // Fallback for browsers without the FS Access API: use a hidden file input.
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json," + FILE_EXT;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (loadDocument(data)) {
        state.fileHandle = null;
        state.fileName = file.name;
        updateFileLabel();
      }
    } catch (err) {
      console.error(err);
      appAlert("Couldn't open the file: " + (err.message || err), { title: "Couldn't open file" });
    }
  });
  input.click();
}

async function fileSave() {
  // No known handle yet — Save behaves like Save As. Same on browsers
  // without FS Access where every save is a fresh download.
  if (!state.fileHandle || !hasFileSystemAccess) {
    return fileSaveAs();
  }
  try {
    const writable = await state.fileHandle.createWritable();
    await writable.write(JSON.stringify(serializeDocument(), null, 2));
    await writable.close();
    state.fileName = state.fileHandle.name;
    updateFileLabel();
  } catch (err) {
    console.error(err);
    appAlert("Couldn't save: " + (err.message || err), { title: "Couldn't save" });
  }
}

async function fileSaveAs() {
  const json = JSON.stringify(serializeDocument(), null, 2);

  if (hasFileSystemAccess) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: state.fileName || DEFAULT_FILENAME,
        types: fileTypesFilter(),
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      state.fileHandle = handle;
      state.fileName = handle.name;
      updateFileLabel();
    } catch (err) {
      if (!isFsCancelError(err)) {
        console.error(err);
        appAlert("Couldn't save: " + (err.message || err), { title: "Couldn't save" });
      }
    }
    return;
  }

  // Fallback: trigger a download via blob URL.
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.fileName || DEFAULT_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Export ----------
// Print-to-PDF pipeline: each sheet is rendered at print DPI to the live
// canvas, captured as a PNG dataURL, and dropped into #print-stage as one
// page each. window.print() hands that stage to the browser, which lets
// the user pick "Save as PDF" (every modern OS) or send it to a printer.
// Multi-page PDFs come for free — page-break-after on each .print-page.
const EXPORT_DPI = 150;

async function fileExport() {
  ensureSheets();
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) {
    await appAlert("No sheets to export.\n\nSwitch to Plan mode and add a sheet first.", { title: "Nothing to export" });
    return;
  }

  // Free users get a heads-up about the watermark before each export and
  // a one-click path to upgrade. Pro users skip straight to capture.
  if (!state.paid) {
    const choice = await appChoice(
      "Free exports carry a diagonal \"DRAFT — easydraftonline.com\" watermark across every page. Upgrade to Pro for clean PDFs.",
      [
        { label: "Cancel",        value: "cancel",  cancel: true },
        { label: "Export anyway", value: "export" },
        { label: "Buy Pro",       value: "buy",     primary: true },
      ],
      { title: "Heads up — exports are watermarked" },
    );
    if (choice === "cancel") return;
    if (choice === "buy") {
      const url = (typeof CHECKOUT_URL === "string" && CHECKOUT_URL) ? CHECKOUT_URL : "#";
      window.open(url, "_blank", "noopener");
      return;
    }
    // choice === "export" → fall through to the capture pipeline below.
  }

  // Capture is synchronous but heavy on big sheets — give the dropdown a
  // tick to close before we start so the UI feels responsive.
  setTimeout(() => {
    let pages = [];
    try {
      pages = captureAllSheetsForPrint(EXPORT_DPI);
    } catch (err) {
      console.error(err);
      appAlert("Export failed: " + (err && err.message ? err.message : err), { title: "Export failed" });
      return;
    }
    if (!pages.length) return;
    showPrintStage(pages);
  }, 30);
}

function showPrintStage(pages) {
  // Wipe any leftover stage from a previous export attempt.
  const existing = document.getElementById("print-stage");
  if (existing) existing.remove();

  const stage = document.createElement("div");
  stage.id = "print-stage";
  for (const p of pages) {
    const page = document.createElement("div");
    page.className = "print-page";
    const img = document.createElement("img");
    img.src = p.dataUrl;
    img.alt = p.label || "";
    page.appendChild(img);
    stage.appendChild(page);
  }
  document.body.appendChild(stage);

  // Wait until images are laid out before opening the print dialog —
  // otherwise the browser may print empty pages on first load.
  const imgs = Array.from(stage.querySelectorAll("img"));
  let pending = imgs.length;
  const trigger = () => {
    // requestAnimationFrame twice gives the browser a frame to paint the
    // newly-inserted images before the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
      } catch (err) {
        console.error(err);
      } finally {
        scheduleStageCleanup(stage);
      }
    }));
  };
  if (pending === 0) {
    trigger();
  } else {
    for (const img of imgs) {
      if (img.complete) {
        if (--pending === 0) trigger();
      } else {
        img.addEventListener("load", () => {
          if (--pending === 0) trigger();
        });
        img.addEventListener("error", () => {
          if (--pending === 0) trigger();
        });
      }
    }
  }
}

function scheduleStageCleanup(stage) {
  const cleanup = () => {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Fallback for browsers / contexts that don't fire afterprint reliably.
  // 60s is enough time for the print dialog to come and go in any reasonable
  // workflow; if the user is still picking save settings after a minute,
  // we'll just leave the stage up — it's hidden on screen anyway.
  setTimeout(cleanup, 60000);
}

// ---------- Menu UI ----------

function bindFileMenu() {
  fileMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.fileMenuOpen) hideFileMenu();
    else showFileMenu();
  });

  fileMenuEl.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (!item) return;
    const action = item.dataset.fileAction;
    hideFileMenu();
    if (action === "new") fileNew();
    else if (action === "open") fileOpen();
    else if (action === "save") fileSave();
    else if (action === "save-as") fileSaveAs();
    else if (action === "export") fileExport();
    else if (action === "settings") {
      showSettingsModal();
    }
    else if (action === "walkthrough") {
      startTour();
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!state.fileMenuOpen) return;
    if (e.target.closest("#file-menu")) return;
    if (e.target.closest("#file-menu-btn")) return;
    hideFileMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.fileMenuOpen) hideFileMenu();
  });

  // Plan-mode sidebar Export button — same handler as the File menu entry.
  const planExportBtn = document.getElementById("plan-export-btn");
  if (planExportBtn) planExportBtn.addEventListener("click", fileExport);

  updateFileLabel();
}

function showFileMenu() {
  state.fileMenuOpen = true;
  fileMenuBtn.classList.add("active");
  fileMenuBtn.setAttribute("aria-expanded", "true");
  fileMenuEl.classList.remove("hidden");
  positionFileMenu();
}

function hideFileMenu() {
  state.fileMenuOpen = false;
  fileMenuBtn.classList.remove("active");
  fileMenuBtn.setAttribute("aria-expanded", "false");
  fileMenuEl.classList.add("hidden");
}

function positionFileMenu() {
  const rect = fileMenuBtn.getBoundingClientRect();
  fileMenuEl.style.left = rect.left + "px";
  fileMenuEl.style.top = (rect.bottom + 4) + "px";
}

function updateFileLabel() {
  if (!brandSubEl) return;
  brandSubEl.textContent = state.fileName || "Residential drawings";
}
