'use strict';

// ==============================================================================
// Main entry — init() definition and invocation.
// Loaded LAST so all other scripts are available when init() runs.
// ==============================================================================

function init() {
  // Pull the saved unit system before anything that reads it (layer tree
  // shows formatted dimensions, palette renders names, etc.).
  if (typeof loadSavedUnits === "function") loadSavedUnits();
  addStory();
  bindEvents();
  fitCanvas();
  centerView();
  renderLayerTree();
  renderPalette();
  bindPalettePanel();
  bindLayersPanel();
  bindDimModal();
  bindLineModal();
  bindMeasureModal();
  bindIslandModal();
  bindTextModal();
  bindStairsModal();
  bindCabinetModal();
  bindFurnitureBuilder();
  bindColorPopup();
  bindLayerHintModal();
  bindContextMenu();
  bindFileMenu();
  bindSettingsModal();
  bindModeSwitch();
  bindSheetList();
  bindSheetProperties();
  bindNotesEditor();
  bindSheetLayerTree();
  ensureSheets();
  renderSheetList();
  renderSheetProperties();
  renderNotesEditor();
  renderSheetLayerTree();
  document.body.classList.add("mode-draw");
  updatePaletteVisibility();
  // Sync the unit-dependent UI (grid input attrs, scale dropdown, palette
  // labels) with whatever we loaded from localStorage above.
  if (typeof applyUnitsToUI === "function") applyUnitsToUI();
  // Initial badge paint reflects state.paid as it stands right after
  // init — almost always "Free" since auth.js's network check hasn't
  // resolved yet. The badge re-paints when the entitlement check lands.
  if (typeof updatePlanBadge === "function") updatePlanBadge();
  // Kick off the watermark logo load early so the first export doesn't have
  // to wait on the image — the export pipeline tolerates a missing image
  // anyway, but this gives us the brand mark on the very first PDF.
  if (typeof ensureWatermarkLogo === "function") ensureWatermarkLogo();
  render();

  // First-time-user walkthrough. No-op if the visitor has already seen it
  // (localStorage gate inside maybeAutoStartTour). Demo-mode skips it via
  // CSS — the embed has its own onboarding cues.
  if (typeof maybeAutoStartTour === "function") {
    // Defer one frame so the layer tree / palette / sheet list are painted
    // before the tour tries to anchor to them.
    requestAnimationFrame(() => maybeAutoStartTour());
  }
}

init();
