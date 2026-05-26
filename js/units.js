'use strict';

// ==============================================================================
// Unit system — imperial ↔ metric.
//
// Internal world coordinates are always in feet. This file owns the boundary
// where the UI shows and accepts dimensions in the user's chosen unit. The
// bulk of the conversion is in geometry.js's formatFeet / parseFeet — those
// dispatch on state.units. This file handles the rest:
//
//   • Grid input attributes (min/max/step/suffix/value) when the unit
//     changes — the input is in display units, not feet.
//   • Plan-mode scale dropdown — imperial scales (1/4" = 1'-0", …) vs.
//     metric scales (1:50, 1:100, …).
//   • Palette item display names — the catalog names embed imperial sizes
//     ("Range 30\""); a regex transformer rewrites them as mm.
//   • Persistence — localStorage so the user's choice survives reloads,
//     plus serializing the value into saved .dstudio.json files.
//
// Invariant: state.units only changes through setUnits(). Anything that
// touches the unit system through state directly will desync the UI.
// ==============================================================================

function setUnits(units) {
  if (units !== "imperial" && units !== "metric") return;
  if (state.units === units) return;
  state.units = units;
  try { localStorage.setItem(UNITS_STORAGE_KEY, units); } catch (_) { /* private mode */ }
  applyUnitsToUI();
}

function loadSavedUnits() {
  let saved = null;
  try { saved = localStorage.getItem(UNITS_STORAGE_KEY); } catch (_) { saved = null; }
  if (saved === "metric" || saved === "imperial") {
    state.units = saved;
  }
}

// Apply the current state.units to every UI surface that needs to change.
// Idempotent — safe to call on init or every time the user toggles.
function applyUnitsToUI() {
  applyUnitsToGridInput();
  applyUnitsToDimHint();
  populateScaleSelect();
  renderPalette();
  renderSheetProperties();
  updateLineModal();
  updateDimModal();
  updateMeasureModal();
  render();
}

function applyUnitsToDimHint() {
  const el = document.getElementById("dim-hint");
  if (!el) return;
  const step = state.units === "metric" ? "50 mm" : "2\"";
  el.textContent = `Each tap resizes by ${step}`;
}

function applyUnitsToGridInput() {
  if (!gridSizeInput) return;
  if (state.units === "metric") {
    gridSizeInput.min = "25";
    gridSizeInput.max = "30000";
    gridSizeInput.step = "25";
    gridSizeInput.value = String(Math.round(state.gridSize * FT_TO_MM));
    if (gridSuffixEl) gridSuffixEl.textContent = "mm / sq";
  } else {
    gridSizeInput.min = "0.25";
    gridSizeInput.max = "100";
    gridSizeInput.step = "0.25";
    // Trim trailing zeros in the step-friendly representation.
    gridSizeInput.value = String(Number((state.gridSize).toFixed(4)));
    if (gridSuffixEl) gridSuffixEl.textContent = "ft / sq";
  }
}

// ---------- Palette label transformer ----------
//
// Catalog names like 'Range 30"' or 'Single Hung 2\'-0" × 3\'-0"' are
// rewritten to mm in metric mode. Plain regex pass — finds feet-and-inches
// fragments and replaces them with their millimeter equivalent rounded to
// the nearest mm.

function metricizeLabel(name) {
  if (typeof name !== "string") return name;
  // 1) feet-inches fragments: 2'-8" or 2'-6 1/2"
  let out = name.replace(
    /(\d+(?:\.\d+)?)'[-\s]*(\d+)(?:\s+(\d+)\/(\d+))?"/g,
    (_m, ft, inches, num, den) => {
      let total = parseFloat(ft) * 12 + parseInt(inches, 10);
      if (num && den) total += parseInt(num, 10) / parseInt(den, 10);
      return Math.round(total * 25.4) + "mm";
    },
  );
  // 2) lone-feet fragments: 5'   (after the inches pattern so we don't double up)
  out = out.replace(/(\d+(?:\.\d+)?)'/g, (_m, ft) => Math.round(parseFloat(ft) * 304.8) + "mm");
  // 3) lone-inches fragments: 30" or 1/2"
  out = out.replace(/(\d+)\/(\d+)"/g, (_m, num, den) => Math.round((parseInt(num, 10) / parseInt(den, 10)) * 25.4) + "mm");
  out = out.replace(/(\d+(?:\.\d+)?)"/g, (_m, inches) => Math.round(parseFloat(inches) * 25.4) + "mm");
  return out;
}

function paletteItemDisplayName(item) {
  if (!item || typeof item.name !== "string") return "";
  if (state.units === "metric") return metricizeLabel(item.name);
  return item.name;
}

// ---------- Settings modal ----------

function showSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  // Sync the radios to the live setting before showing.
  const radios = modal.querySelectorAll('input[name="settings-units"]');
  for (const r of radios) r.checked = (r.value === state.units);
  syncEstimateSettingsUI();
  modal.classList.remove("hidden");
  // Trap Tab inside the dialog window, not the .settings-modal backdrop —
  // the backdrop's only interactive child is the window anyway, but the
  // trap walks all focusables and we don't want it cycling into the
  // backdrop's own pointerdown surface.
  trapFocusIn(modal.querySelector(".settings-window") || modal);
}

function hideSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  releaseFocusTrap();
}

// ---------- Materials Estimate (Class-B) settings editor ----------
function syncEstimateSettingsUI() {
  const s = state.estimateSettings;
  if (!s) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set("est-stud-spacing", String(s.studSpacingIn));
  set("est-cripple-spacing", String(s.crippleSpacingIn));
  set("est-plates", String(s.platesPerWall));
  set("est-header-ply", String(s.headerPly));
  set("est-waste-framing", String(Math.round((s.wastePct.framing || 0) * 100)));
  set("est-waste-drywall", String(Math.round((s.wastePct.drywall || 0) * 100)));
  set("est-waste-sheathing", String(Math.round((s.wastePct.sheathing || 0) * 100)));
  set("est-waste-insulation", String(Math.round((s.wastePct.insulation || 0) * 100)));
}

function bindEstimateSettingsInputs() {
  // Populate the spacing dropdowns once from the shared FRAMING_SPACINGS_IN list.
  for (const id of ["est-stud-spacing", "est-cripple-spacing"]) {
    const sel = document.getElementById(id);
    if (sel && !sel.options.length) {
      for (const sp of FRAMING_SPACINGS_IN) {
        const o = document.createElement("option");
        o.value = String(sp); o.textContent = sp + '" o.c.';
        sel.appendChild(o);
      }
    }
  }
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    const v = el ? parseFloat(el.value) : NaN;
    return isNaN(v) ? fallback : v;
  };
  const onChange = () => {
    const s = state.estimateSettings;
    if (!s) return;
    s.studSpacingIn = num("est-stud-spacing", s.studSpacingIn);
    s.crippleSpacingIn = num("est-cripple-spacing", s.crippleSpacingIn);
    s.platesPerWall = Math.max(1, Math.round(num("est-plates", s.platesPerWall)));
    s.headerPly = Math.max(1, Math.round(num("est-header-ply", s.headerPly)));
    s.wastePct.framing = Math.max(0, num("est-waste-framing", s.wastePct.framing * 100) / 100);
    s.wastePct.drywall = Math.max(0, num("est-waste-drywall", s.wastePct.drywall * 100) / 100);
    s.wastePct.sheathing = Math.max(0, num("est-waste-sheathing", s.wastePct.sheathing * 100) / 100);
    s.wastePct.insulation = Math.max(0, num("est-waste-insulation", s.wastePct.insulation * 100) / 100);
    if (typeof scheduleCacheSave === "function") scheduleCacheSave();
    if (state.viewMode === "plan" && typeof render === "function") render();
  };
  for (const id of ["est-stud-spacing", "est-cripple-spacing", "est-plates", "est-header-ply",
    "est-waste-framing", "est-waste-drywall", "est-waste-sheathing", "est-waste-insulation"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", onChange);
  }
}

function bindSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;

  const closeBtn = document.getElementById("settings-close");
  if (closeBtn) closeBtn.addEventListener("click", hideSettingsModal);

  // Click outside the window closes — common modal convention.
  modal.addEventListener("pointerdown", (e) => {
    if (e.target === modal) hideSettingsModal();
  });

  modal.querySelectorAll('input[name="settings-units"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) setUnits(radio.value);
    });
  });

  bindEstimateSettingsInputs();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      hideSettingsModal();
      e.stopPropagation();
    }
  }, true);
}
