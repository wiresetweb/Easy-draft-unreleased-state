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
  render();
}

init();
