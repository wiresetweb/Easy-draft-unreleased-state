'use strict';

// ==============================================================================
// Layers — story / sublayer model + layer tree UI
// ==============================================================================

// Stories carry an integer `level` so "up" / "down" is well-defined regardless
// of array order: 0 = ground floor, positive = upper floors, -1 = basement.
// Older saved documents predate the field — assign one by array position so
// every story has a stable level before we reason about vertical neighbours.
function ensureStoryLevels() {
  state.stories.forEach((s, i) => {
    if (typeof s.level !== "number") s.level = i;
  });
}

function storyHasBasement() {
  ensureStoryLevels();
  return state.stories.some((s) => s.level < 0);
}

function storyNameForLevel(level) {
  if (level < 0) return "Basement";
  return `${ORDINALS[level] || `Story ${level + 1}`} Story`;
}

function getStoryByLevel(level) {
  ensureStoryLevels();
  return state.stories.find((s) => s.level === level) || null;
}

// kind: "basement" | "upper" | undefined. The very first story is always the
// ground floor (level 0) regardless of kind.
function addStory(kind) {
  ensureStoryLevels();
  const isFirst = state.stories.length === 0;
  let level;
  if (isFirst) {
    level = 0;
  } else if (kind === "basement") {
    level = -1;
  } else {
    const maxLevel = state.stories.reduce((m, s) => Math.max(m, s.level), -1);
    level = maxLevel + 1;
  }
  const subNames = isFirst ? DEFAULT_SUBLAYERS_FIRST : DEFAULT_SUBLAYERS_OTHER;
  const sublayers = subNames.map((n) => ({
    id: makeId("L"),
    name: n,
    visible: true,
    shapes: [],
    color: DEFAULT_LAYER_COLORS[n] || DEFAULT_LAYER_COLOR_FALLBACK,
  }));
  state.stories.push({
    id: makeId("S"),
    name: storyNameForLevel(level),
    level,
    visible: true,
    expanded: true,
    sublayers,
    // Materials Estimator fields. ceilingHeight is Class-A (never defaulted —
    // null means "not entered" and is flagged by the completeness check).
    // framing carries the shared structural-input model; joists are estimated
    // only when the user opts in by filling framing.floor.
    ceilingHeight: null,
    framing: { floor: null, roof: null },
  });
  if (!state.activeSublayerId) {
    // Prefer Walls as the default working layer — that's what users typically
    // start with. Fall back to the first sublayer if Walls is missing.
    const walls = sublayers.find((l) => l.name === WALL_LAYER_NAME);
    state.activeSublayerId = (walls || sublayers[0]).id;
  }
}

// The Stairs sub-layer for a given story, created on demand. Mirrors
// getMeasurementsLayer so documents made before the Stairs layer existed (or
// stories whose layer was deleted) still get a home for staircases.
function getStairsLayer(story) {
  if (!story) return null;
  let layer = story.sublayers.find((l) => l.name === STAIRS_LAYER_NAME);
  if (!layer) {
    layer = {
      id: makeId("L"),
      name: STAIRS_LAYER_NAME,
      visible: true,
      shapes: [],
      color: DEFAULT_LAYER_COLORS[STAIRS_LAYER_NAME] || DEFAULT_LAYER_COLOR_FALLBACK,
    };
    story.sublayers.push(layer);
  }
  return layer;
}

function addSublayer(storyId, name) {
  const story = state.stories.find((s) => s.id === storyId);
  if (!story) return;
  const sub = {
    id: makeId("L"),
    name,
    visible: true,
    shapes: [],
    color: DEFAULT_LAYER_COLORS[name] || DEFAULT_LAYER_COLOR_FALLBACK,
  };
  story.sublayers.push(sub);
  state.activeSublayerId = sub.id;
}

function activeSublayer() {
  for (const s of state.stories) {
    const sub = s.sublayers.find((l) => l.id === state.activeSublayerId);
    if (sub) return sub;
  }
  return null;
}

// Returns the active story's Measurements sub-layer, creating it if missing.
function getMeasurementsLayer() {
  const story = activeStory();
  if (!story) return null;
  let layer = story.sublayers.find((l) => l.name === MEASUREMENTS_LAYER_NAME);
  if (!layer) {
    layer = {
      id: makeId("L"),
      name: MEASUREMENTS_LAYER_NAME,
      visible: true,
      shapes: [],
      color: DEFAULT_LAYER_COLORS[MEASUREMENTS_LAYER_NAME] || DEFAULT_LAYER_COLOR_FALLBACK,
    };
    story.sublayers.push(layer);
  }
  return layer;
}

function activeStory() {
  for (const s of state.stories) {
    if (s.sublayers.find((l) => l.id === state.activeSublayerId)) return s;
  }
  return null;
}

// Pick a sane fallback active layer after a delete: prefer Walls in the first
// remaining story, otherwise the first available sublayer anywhere.
function pickFallbackActiveSublayerId() {
  for (const story of state.stories) {
    const walls = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
    if (walls) return walls.id;
  }
  for (const story of state.stories) {
    if (story.sublayers.length) return story.sublayers[0].id;
  }
  return null;
}

function deleteStory(storyId) {
  const idx = state.stories.findIndex((s) => s.id === storyId);
  if (idx === -1) return false;
  if (state.stories.length <= 1) return false;
  // Drop selection of any shape that lives on this story so transforms /
  // delete shortcuts don't reach into a now-orphan id.
  for (const sub of state.stories[idx].sublayers) {
    for (const sh of sub.shapes) state.selection.delete(sh.id);
  }
  const wasActiveHere = !!state.stories[idx].sublayers.find((l) => l.id === state.activeSublayerId);
  state.stories.splice(idx, 1);
  if (wasActiveHere) state.activeSublayerId = pickFallbackActiveSublayerId();
  return true;
}

function deleteSublayer(storyId, subId) {
  const story = state.stories.find((s) => s.id === storyId);
  if (!story) return false;
  const idx = story.sublayers.findIndex((l) => l.id === subId);
  if (idx === -1) return false;
  for (const sh of story.sublayers[idx].shapes) state.selection.delete(sh.id);
  story.sublayers.splice(idx, 1);
  if (state.activeSublayerId === subId) {
    // Prefer a remaining sibling; otherwise let the global fallback choose.
    state.activeSublayerId = (story.sublayers[idx] || story.sublayers[idx - 1] || { id: null }).id
      || pickFallbackActiveSublayerId();
  }
  return true;
}

function forEachVisibleShape(cb) {
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (!sub.visible) continue;
      for (const sh of sub.shapes) cb(sh, sub, story);
    }
  }
}

function forEachShape(cb) {
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      for (const sh of sub.shapes) cb(sh, sub, story);
    }
  }
}

function findShapeById(id) {
  let found = null;
  forEachShape((sh) => { if (sh.id === id) found = sh; });
  return found;
}

// SVG icons used by the layer tree.
function eyeSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}
function eyeOffSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 0 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}
function plusSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
}
function caretSvg() {
  return '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
}
function trashSvg() {
  return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
}


function renderLayerTree() {
  layerTreeEl.innerHTML = "";
  for (const story of state.stories) {
    const storyEl = document.createElement("div");
    storyEl.className = "story" + (story.expanded ? "" : " collapsed");
    storyEl.dataset.storyId = story.id;

    const header = document.createElement("div");
    header.className = "story-header";

    const expandBtn = document.createElement("button");
    expandBtn.className = "icon-btn expand-btn";
    expandBtn.dataset.action = "expand";
    expandBtn.title = "Toggle expand";
    expandBtn.setAttribute("aria-label", `Toggle ${story.name} expanded`);
    expandBtn.innerHTML = caretSvg();
    header.appendChild(expandBtn);

    const nameEl = document.createElement("span");
    nameEl.className = "story-name";
    nameEl.textContent = story.name;
    header.appendChild(nameEl);

    const visBtn = document.createElement("button");
    visBtn.className = "icon-btn vis-btn" + (story.visible ? "" : " muted");
    visBtn.dataset.action = "vis-story";
    const visLabel = story.visible ? `Hide ${story.name}` : `Show ${story.name}`;
    visBtn.title = visLabel;
    visBtn.setAttribute("aria-label", visLabel);
    visBtn.setAttribute("aria-pressed", String(!story.visible));
    visBtn.innerHTML = story.visible ? eyeSvg() : eyeOffSvg();
    header.appendChild(visBtn);

    const addBtn = document.createElement("button");
    addBtn.className = "icon-btn";
    addBtn.dataset.action = "add-sub";
    addBtn.title = "Add sub-layer";
    addBtn.setAttribute("aria-label", `Add sub-layer to ${story.name}`);
    addBtn.innerHTML = plusSvg();
    header.appendChild(addBtn);

    // Last remaining story stays — losing every story would leave the canvas
    // with no place to draw and no active layer.
    if (state.stories.length > 1) {
      const delStoryBtn = document.createElement("button");
      delStoryBtn.className = "icon-btn delete-btn";
      delStoryBtn.dataset.action = "delete-story";
      delStoryBtn.title = "Delete story";
      delStoryBtn.setAttribute("aria-label", `Delete ${story.name}`);
      delStoryBtn.innerHTML = trashSvg();
      header.appendChild(delStoryBtn);
    }

    storyEl.appendChild(header);

    const subList = document.createElement("div");
    subList.className = "sub-list";
    for (const sub of story.sublayers) {
      const row = document.createElement("div");
      row.className = "sub-row" + (sub.id === state.activeSublayerId ? " active" : "");
      row.dataset.subId = sub.id;

      const colorBtn = document.createElement("button");
      colorBtn.className = "color-bubble";
      colorBtn.dataset.action = "color-sub";
      colorBtn.title = "Layer color";
      colorBtn.setAttribute("aria-label", `${sub.name} color`);
      colorBtn.style.background = sub.color || DEFAULT_LAYER_COLOR_FALLBACK;
      row.appendChild(colorBtn);

      const subName = document.createElement("span");
      subName.className = "sub-name";
      subName.textContent = sub.name;
      row.appendChild(subName);

      const subVis = document.createElement("button");
      subVis.className = "icon-btn vis-btn" + (sub.visible ? "" : " muted");
      subVis.dataset.action = "vis-sub";
      const subVisLabel = sub.visible ? `Hide ${sub.name}` : `Show ${sub.name}`;
      subVis.title = subVisLabel;
      subVis.setAttribute("aria-label", subVisLabel);
      subVis.setAttribute("aria-pressed", String(!sub.visible));
      subVis.innerHTML = sub.visible ? eyeSvg() : eyeOffSvg();
      row.appendChild(subVis);

      const delSub = document.createElement("button");
      delSub.className = "icon-btn delete-btn";
      delSub.dataset.action = "delete-sub";
      delSub.title = "Delete layer";
      delSub.setAttribute("aria-label", `Delete ${sub.name}`);
      delSub.innerHTML = trashSvg();
      row.appendChild(delSub);

      subList.appendChild(row);
    }
    storyEl.appendChild(subList);
    layerTreeEl.appendChild(storyEl);
  }
  updateStatusActive();
  updatePaletteVisibility();
}

function updateStatusActive() {
  const sub = activeSublayer();
  const story = activeStory();
  statusActive.textContent = sub && story ? `${story.name} / ${sub.name}` : "—";
}
