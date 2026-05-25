'use strict';

// ==============================================================================
// History — snapshot, clone, undo, redo
// ==============================================================================

function cloneShape(sh) {
  const c = { ...sh };
  SHAPES[sh.type]?.cloneExtra?.(c, sh);
  return c;
}

function snapshot() {
  return {
    stories: state.stories.map((s) => ({
      id: s.id, name: s.name, level: s.level, visible: s.visible, expanded: s.expanded,
      sublayers: s.sublayers.map((l) => ({
        id: l.id, name: l.name, visible: l.visible, color: l.color,
        shapes: l.shapes.map(cloneShape),
      })),
    })),
    activeSublayerId: state.activeSublayerId,
  };
}

function pushHistory(label) {
  state.history.push(snapshot());
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.future.length = 0;
  if (typeof scheduleCacheSave === "function") scheduleCacheSave();
  if (typeof logUserAction === "function") logUserAction(label || "Edit");
}

function restore(snap) {
  state.stories = snap.stories.map((s) => ({
    id: s.id, name: s.name, level: s.level, visible: s.visible, expanded: s.expanded,
    sublayers: s.sublayers.map((l) => ({
      id: l.id, name: l.name, visible: l.visible, color: l.color,
      shapes: l.shapes.map(cloneShape),
    })),
  }));
  state.activeSublayerId = snap.activeSublayerId;
  if (!activeSublayer()) {
    const firstStory = state.stories[0];
    const walls = firstStory?.sublayers.find((l) => l.name === WALL_LAYER_NAME);
    state.activeSublayerId = (walls || firstStory?.sublayers[0])?.id ?? null;
  }
  pruneSelection();
  state.curveDrag = null;
  state.placing = null;
  state.stairsDirection = null;
  state.cabinetBuilder = null;
  if (stairsModal && !stairsModal.classList.contains("hidden")) hideStairsModal();
  if (cabinetModal) detachCabinetModalFromPalette();
  renderLayerTree();
  renderSheetLayerTree();
}

function pruneSelection() {
  const existing = new Set();
  forEachShape((sh) => existing.add(sh.id));
  for (const id of [...state.selection]) {
    if (!existing.has(id)) state.selection.delete(id);
  }
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  render();
  if (typeof scheduleCacheSave === "function") scheduleCacheSave();
  if (typeof logUserAction === "function") logUserAction("Undo");
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
  render();
  if (typeof scheduleCacheSave === "function") scheduleCacheSave();
  if (typeof logUserAction === "function") logUserAction("Redo");
}
