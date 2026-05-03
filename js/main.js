'use strict';

// ==============================================================================
// Main entry — init() definition and invocation.
// Loaded LAST so all other scripts are available when init() runs.
// ==============================================================================

function init() {
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
  // Kick off the watermark logo load early so the first export doesn't have
  // to wait on the image — the export pipeline tolerates a missing image
  // anyway, but this gives us the brand mark on the very first PDF.
  if (typeof ensureWatermarkLogo === "function") ensureWatermarkLogo();
  render();
}

init();
