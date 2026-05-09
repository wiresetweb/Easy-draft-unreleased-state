'use strict';

// ==============================================================================
// Main entry — init() definition and invocation.
// Loaded LAST so all other scripts are available when init() runs.
// ==============================================================================

function init() {
  // Pull the saved unit system before anything that reads it (layer tree
  // shows formatted dimensions, palette renders names, etc.).
  loadSavedUnits();
  // Restore an in-progress drawing from localStorage if one exists, so an
  // accidental refresh doesn't lose work. addStory() seeds a fresh document
  // only when there's nothing cached to restore.
  const restored = (typeof tryRestoreCachedDocument === "function") && tryRestoreCachedDocument();
  if (!restored) addStory();
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
  bindFeedbackButton();
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
  applyUnitsToUI();
  // Initial badge paint reflects state.paid as it stands right after
  // init — almost always "Free" since auth.js's network check hasn't
  // resolved yet. The badge re-paints when the entitlement check lands.
  updatePlanBadge();
  // Kick off the watermark logo load early so the first export doesn't have
  // to wait on the image — the export pipeline tolerates a missing image
  // anyway, but this gives us the brand mark on the very first PDF.
  ensureWatermarkLogo();
  // If we restored from cache, refresh the brand label so it shows the
  // cached file name. applyUnitsToUI() above already repainted the rest.
  if (restored) updateFileLabel();
  // Start the periodic + unload-flush autosave once the rest of init has
  // settled — pushHistory hooks already cover the debounced path.
  if (typeof startCacheAutosave === "function") startCacheAutosave();
  render();

  // First-time-user walkthrough. No-op if the visitor has already seen it
  // (localStorage gate inside maybeAutoStartTour). Demo-mode skips it via
  // CSS — the embed has its own onboarding cues. Defer one frame so the
  // layer tree / palette / sheet list are painted before the tour tries
  // to anchor to them.
  requestAnimationFrame(() => maybeAutoStartTour());
}

init();
