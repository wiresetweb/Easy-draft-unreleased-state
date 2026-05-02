'use strict';

// ==============================================================================
// Modals — dimension / line stroke / text / inline editor / color popup.
// ==============================================================================

// ---------- Dimension modal ----------
function bindDimModal() {
  dimWidthInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyDimWidth();
      dimWidthInput.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      const id = dimWidthInput.dataset.shapeId;
      const shape = id ? findShapeById(id) : null;
      if (shape) dimWidthInput.value = formatFeet(shape.width);
      dimWidthInput.blur();
    }
    e.stopPropagation();
  });
  dimWidthInput.addEventListener("blur", applyDimWidth);
  dimModal.addEventListener("pointerdown", (e) => e.stopPropagation());

  doorFlipRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".flip-btn");
    if (!btn) return;
    applyDoorFlip(btn.dataset.flip);
  });
}

function applyDoorFlip(type) {
  const id = dimWidthInput.dataset.shapeId;
  if (!id) return;
  const shape = findShapeById(id);
  if (!shape || shape.type !== "door") return;
  pushHistory();
  if (type === "hinge") {
    // Swap which end is the hinge: move anchor to E, reverse direction, flip
    // swing sign so the leaf stays on the same physical side.
    const u = { x: Math.cos(shape.angle), y: Math.sin(shape.angle) };
    shape.x += u.x * shape.width;
    shape.y += u.y * shape.width;
    shape.angle += Math.PI;
    shape.swing = -(shape.swing || 1);
  } else if (type === "swing") {
    shape.swing = -(shape.swing || 1);
  }
  render();
}

function applyDimWidth() {
  const id = dimWidthInput.dataset.shapeId;
  if (!id) return;
  const shape = findShapeById(id);
  if (!shape) return;
  let newWidth = parseFeet(dimWidthInput.value);
  if (newWidth === null || newWidth <= 0) {
    dimWidthInput.value = formatFeet(shape.width);
    return;
  }
  // When grid snap is on, round width to a grid multiple so both edges of the
  // opening can land on grid intersections.
  if (state.snap) {
    const g = state.gridSize;
    newWidth = Math.max(g, Math.round(newWidth / g) * g);
  }
  if (Math.abs(newWidth - shape.width) < 1e-6) {
    dimWidthInput.value = formatFeet(shape.width);
    return;
  }
  pushHistory();
  shape.width = newWidth;
  dimWidthInput.value = formatFeet(shape.width);
  render();
}

function updateDimModal() {
  if (state.tool !== "select" || state.selection.size !== 1) {
    dimModal.classList.add("hidden");
    return;
  }
  let shape = null;
  for (const id of state.selection) shape = findShapeById(id);
  if (!shape || (shape.type !== "door" && shape.type !== "window")) {
    dimModal.classList.add("hidden");
    return;
  }

  const bbox = shapeBBox(shape);
  const tl = worldToScreen(bbox.x1, bbox.y1);
  const br = worldToScreen(bbox.x2, bbox.y2);
  const cx = (tl.x + br.x) / 2;

  dimModal.classList.remove("hidden");
  const modalW = dimModal.offsetWidth || 220;
  const modalH = dimModal.offsetHeight || 60;
  const view = viewSize();
  let left = cx - modalW / 2;
  let top = tl.y - modalH - 10;
  if (top < 8) top = br.y + 10;
  left = Math.max(8, Math.min(left, view.w - modalW - 8));
  dimModal.style.left = left + "px";
  dimModal.style.top = top + "px";

  if (document.activeElement !== dimWidthInput) {
    dimWidthInput.value = formatFeet(shape.width);
    dimWidthInput.dataset.shapeId = shape.id;
  } else if (dimWidthInput.dataset.shapeId !== shape.id) {
    dimWidthInput.value = formatFeet(shape.width);
    dimWidthInput.dataset.shapeId = shape.id;
  }

  doorFlipRow.classList.toggle("hidden", shape.type !== "door");
}

// ---------- Line stroke modal ----------
// Returns the selected lines that live on a Walls layer (single or multi).
// The wall thickness picker only makes sense for these.
function getSelectedWallLines() {
  const out = [];
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME) continue;
      for (const sh of sub.shapes) {
        if (sh.type === "line" && state.selection.has(sh.id)) out.push(sh);
      }
    }
  }
  return out;
}

// True when every selected shape is a line on a Walls layer (any count ≥ 1).
// Used to surface the wall-thickness row even for box-shaped 4-line selections.
function allSelectedAreWallLines() {
  if (!state.selection.size) return false;
  const wall = getSelectedWallLines();
  return wall.length === state.selection.size;
}

function bindLineModal() {
  lineModalEl.addEventListener("click", (e) => {
    const strokeBtn = e.target.closest(".stroke-btn");
    if (strokeBtn) {
      const id = lineModalEl.dataset.shapeId;
      const shape = id ? findShapeById(id) : null;
      if (!shape) return;
      const newStroke = strokeBtn.dataset.stroke;
      const cur = shape.stroke || "solid";
      if (cur === newStroke) return;
      pushHistory();
      if (newStroke === "solid") delete shape.stroke;
      else shape.stroke = newStroke;
      render();
      return;
    }
    const wallBtn = e.target.closest(".wall-thickness-btn");
    if (wallBtn) {
      const preset = wallBtn.dataset.preset;
      const t = preset === "none" ? 0 : (WALL_THICKNESS_PRESETS[preset] || 0);
      applyWallThickness(t);
    }
  });
  lineModalEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  wallThicknessInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyWallThicknessFromInput(); wallThicknessInput.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); wallThicknessInput.blur(); }
  });
  wallThicknessInput.addEventListener("blur", applyWallThicknessFromInput);
}

function applyWallThickness(t) {
  const targets = getSelectedWallLines();
  if (!targets.length) return;
  // Skip the history push when nothing actually changes — avoids polluting the
  // undo stack when the user re-clicks the already-active preset.
  let changed = false;
  for (const sh of targets) {
    const cur = sh.thickness || 0;
    if (Math.abs(cur - t) > 1e-9) { changed = true; break; }
  }
  if (!changed) return;
  pushHistory();
  for (const sh of targets) {
    if (t > 0) sh.thickness = t;
    else delete sh.thickness;
  }
  render();
}

function applyWallThicknessFromInput() {
  const v = parseFeet(wallThicknessInput.value);
  if (v === null || v < 0) {
    // Restore display from the first selected wall's current value.
    const targets = getSelectedWallLines();
    wallThicknessInput.value = targets.length && targets[0].thickness
      ? formatFeet(targets[0].thickness)
      : "";
    return;
  }
  applyWallThickness(v);
}

function updateLineModal() {
  if (state.tool !== "select") { lineModalEl.classList.add("hidden"); return; }
  if (state.selectionMode) { lineModalEl.classList.add("hidden"); return; }

  // Single line/arc — full modal (stroke + wall thickness if on Walls layer).
  // Multi-shape, all wall lines — wall-thickness-only modal.
  let singleShape = null;
  if (state.selection.size === 1) {
    for (const id of state.selection) singleShape = findShapeById(id);
    if (singleShape && singleShape.type !== "line" && singleShape.type !== "arc") {
      singleShape = null;
    }
  }
  const isWallSelection = allSelectedAreWallLines();

  if (!singleShape && !isWallSelection) {
    lineModalEl.classList.add("hidden");
    return;
  }

  // Show stroke row only for a single line/arc; wall row appears whenever the
  // selection is wall lines (single or multiple).
  lineStrokeRow.classList.toggle("hidden", !singleShape);
  wallThicknessRow.classList.toggle("hidden", !isWallSelection);

  // Position over the bbox of either the single shape or the whole selection.
  const bbox = singleShape ? shapeBBox(singleShape) : selectionBBox();
  const tl = worldToScreen(bbox.x1, bbox.y1);
  const br = worldToScreen(bbox.x2, bbox.y2);
  const cx = (tl.x + br.x) / 2;

  lineModalEl.classList.remove("hidden");
  const modalW = lineModalEl.offsetWidth || 200;
  const modalH = lineModalEl.offsetHeight || 50;
  const view = viewSize();
  let left = cx - modalW / 2;
  let top = tl.y - modalH - 10;
  if (top < 8) top = br.y + 10;
  left = Math.max(8, Math.min(left, view.w - modalW - 8));
  lineModalEl.style.left = left + "px";
  lineModalEl.style.top = top + "px";

  if (singleShape) {
    const stroke = singleShape.stroke || "solid";
    for (const btn of lineModalEl.querySelectorAll(".stroke-btn")) {
      btn.classList.toggle("active", btn.dataset.stroke === stroke);
    }
    lineModalEl.dataset.shapeId = singleShape.id;
  } else {
    delete lineModalEl.dataset.shapeId;
  }

  if (isWallSelection) {
    // Highlight the active preset, if all selected walls share one. Mixed
    // thicknesses → no preset is "active", and the input shows blank.
    const targets = getSelectedWallLines();
    const first = targets[0].thickness || 0;
    const allSame = targets.every((sh) => Math.abs((sh.thickness || 0) - first) < 1e-9);
    let activePreset = null;
    if (allSame) {
      if (first === 0) activePreset = "none";
      else {
        for (const key in WALL_THICKNESS_PRESETS) {
          if (Math.abs(WALL_THICKNESS_PRESETS[key] - first) < 1e-6) { activePreset = key; break; }
        }
      }
    }
    for (const btn of wallThicknessRow.querySelectorAll(".wall-thickness-btn")) {
      btn.classList.toggle("active", btn.dataset.preset === activePreset);
    }
    if (document.activeElement !== wallThicknessInput) {
      wallThicknessInput.value = allSame && first > 0 ? formatFeet(first) : "";
    }
  }
}

// ---------- Island modal (tag position + elevation bar) ----------
function bindIslandModal() {
  islandTagPosSelect.addEventListener("change", () => {
    const shape = currentIslandShape();
    if (!shape) return;
    const v = islandTagPosSelect.value;
    if ((shape.tagPos || "center") === v) return;
    pushHistory();
    if (v === "center") delete shape.tagPos;
    else shape.tagPos = v;
    render();
  });

  islandBarOnSelect.addEventListener("change", () => {
    const shape = currentIslandShape();
    if (!shape) return;
    const on = islandBarOnSelect.value === "on";
    if (!!shape.bar === on) return;
    pushHistory();
    if (on) {
      shape.bar = true;
      // Default the bar to the long side of the island so it reads as a
      // raised eat-at counter rather than an end cap.
      if (!shape.barSide) {
        shape.barSide = shape.width >= shape.depth ? "n" : "w";
      }
    } else {
      delete shape.bar;
    }
    render();
  });

  islandBarSideSelect.addEventListener("change", () => {
    const shape = currentIslandShape();
    if (!shape) return;
    const v = islandBarSideSelect.value;
    if (shape.barSide === v) return;
    pushHistory();
    shape.barSide = v;
    render();
  });

  islandModalEl.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function currentIslandShape() {
  const id = islandModalEl.dataset.shapeId;
  if (!id) return null;
  const sh = findShapeById(id);
  if (!sh || sh.type !== "appliance" || sh.kind !== "island") return null;
  return sh;
}

function updateIslandModal() {
  if (state.tool !== "select" || state.selection.size !== 1) {
    islandModalEl.classList.add("hidden");
    return;
  }
  let shape = null;
  for (const id of state.selection) shape = findShapeById(id);
  if (!shape || shape.type !== "appliance" || shape.kind !== "island") {
    islandModalEl.classList.add("hidden");
    return;
  }
  if (state.selectionMode) { islandModalEl.classList.add("hidden"); return; }

  const bbox = shapeBBox(shape);
  const tl = worldToScreen(bbox.x1, bbox.y1);
  const br = worldToScreen(bbox.x2, bbox.y2);
  const cx = (tl.x + br.x) / 2;

  islandModalEl.classList.remove("hidden");
  const modalW = islandModalEl.offsetWidth || 220;
  const modalH = islandModalEl.offsetHeight || 130;
  const view = viewSize();
  let left = cx - modalW / 2;
  let top = tl.y - modalH - 10;
  if (top < 8) top = br.y + 10;
  left = Math.max(8, Math.min(left, view.w - modalW - 8));
  islandModalEl.style.left = left + "px";
  islandModalEl.style.top = top + "px";

  // Only sync from shape → inputs when the user isn't actively editing them.
  if (document.activeElement !== islandTagPosSelect) {
    islandTagPosSelect.value = shape.tagPos || "center";
  }
  if (document.activeElement !== islandBarOnSelect) {
    islandBarOnSelect.value = shape.bar ? "on" : "off";
  }
  if (document.activeElement !== islandBarSideSelect) {
    islandBarSideSelect.value = shape.barSide || "n";
  }
  islandBarSideRow.classList.toggle("hidden", !shape.bar);
  islandModalEl.dataset.shapeId = shape.id;
}

// ---------- Measure type modal ----------
function bindMeasureModal() {
  measureModalEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".measure-type-btn");
    if (!btn) return;
    const id = measureModalEl.dataset.shapeId;
    const shape = id ? findShapeById(id) : null;
    if (!shape || shape.type !== "measure") return;
    const newType = btn.dataset.type;
    const cur = shape.dimType || "center";
    if (cur === newType) return;
    pushHistory();
    shape.dimType = newType;
    render();
  });
  measureModalEl.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function updateMeasureModal() {
  if (state.tool !== "select" || state.selection.size !== 1) {
    measureModalEl.classList.add("hidden");
    return;
  }
  let shape = null;
  for (const id of state.selection) shape = findShapeById(id);
  if (!shape || shape.type !== "measure") {
    measureModalEl.classList.add("hidden");
    return;
  }
  if (state.selectionMode) { measureModalEl.classList.add("hidden"); return; }

  const bbox = shapeBBox(shape);
  const tl = worldToScreen(bbox.x1, bbox.y1);
  const br = worldToScreen(bbox.x2, bbox.y2);
  const cx = (tl.x + br.x) / 2;

  measureModalEl.classList.remove("hidden");
  const modalW = measureModalEl.offsetWidth || 260;
  const modalH = measureModalEl.offsetHeight || 50;
  const view = viewSize();
  let left = cx - modalW / 2;
  let top = tl.y - modalH - 10;
  if (top < 8) top = br.y + 10;
  left = Math.max(8, Math.min(left, view.w - modalW - 8));
  measureModalEl.style.left = left + "px";
  measureModalEl.style.top = top + "px";

  const dimType = shape.dimType || "center";
  for (const btn of measureModalEl.querySelectorAll(".measure-type-btn")) {
    btn.classList.toggle("active", btn.dataset.type === dimType);
  }
  measureModalEl.dataset.shapeId = shape.id;
}

// ---------- Text modal (edit selected text) ----------
function bindTextModal() {
  textContentInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyTextContent(); textContentInput.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); textContentInput.blur(); }
  });
  textContentInput.addEventListener("blur", applyTextContent);

  textSizeInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyTextSize(); textSizeInput.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); textSizeInput.blur(); }
  });
  textSizeInput.addEventListener("blur", applyTextSize);

  textFontSelect.addEventListener("change", () => {
    const id = textModalEl.dataset.shapeId;
    const shape = id ? findShapeById(id) : null;
    if (!shape) return;
    pushHistory();
    shape.fontFamily = textFontSelect.value;
    render();
  });

  textOutlineSelect.addEventListener("change", () => {
    const id = textModalEl.dataset.shapeId;
    const shape = id ? findShapeById(id) : null;
    if (!shape) return;
    pushHistory();
    shape.outline = textOutlineSelect.value;
    render();
  });

  textModalEl.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function applyTextContent() {
  const id = textModalEl.dataset.shapeId;
  const shape = id ? findShapeById(id) : null;
  if (!shape) return;
  const newText = textContentInput.value;
  if (newText === shape.text) return;
  pushHistory();
  shape.text = newText;
  render();
}

function applyTextSize() {
  const id = textModalEl.dataset.shapeId;
  const shape = id ? findShapeById(id) : null;
  if (!shape) return;
  // Text sizes are pixels — accept a plain number or a number with "px"
  // suffix; reject everything else and reset to current value.
  const raw = String(textSizeInput.value).trim().replace(/px$/i, "").trim();
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    textSizeInput.value = String(Math.round(shape.fontSize));
    return;
  }
  if (Math.abs(parsed - shape.fontSize) < 1e-6) return;
  pushHistory();
  shape.fontSize = parsed;
  textSizeInput.value = String(Math.round(shape.fontSize));
  render();
}

function updateTextModal() {
  if (state.tool !== "select" || state.selection.size !== 1) {
    textModalEl.classList.add("hidden");
    return;
  }
  let shape = null;
  for (const id of state.selection) shape = findShapeById(id);
  if (!shape || shape.type !== "text") {
    textModalEl.classList.add("hidden");
    return;
  }
  if (state.selectionMode) { textModalEl.classList.add("hidden"); return; }

  const bbox = shapeBBox(shape);
  const tl = worldToScreen(bbox.x1, bbox.y1);
  const br = worldToScreen(bbox.x2, bbox.y2);
  const cx = (tl.x + br.x) / 2;

  textModalEl.classList.remove("hidden");
  const modalW = textModalEl.offsetWidth || 240;
  const modalH = textModalEl.offsetHeight || 160;
  const view = viewSize();
  let left = cx - modalW / 2;
  let top = tl.y - modalH - 10;
  if (top < 8) top = br.y + 10;
  left = Math.max(8, Math.min(left, view.w - modalW - 8));
  textModalEl.style.left = left + "px";
  textModalEl.style.top = top + "px";

  if (textModalEl.dataset.shapeId !== shape.id) {
    textModalEl.dataset.shapeId = shape.id;
    if (document.activeElement !== textContentInput) textContentInput.value = shape.text;
    if (document.activeElement !== textSizeInput) textSizeInput.value = String(Math.round(shape.fontSize));
    let matched = false;
    for (const opt of textFontSelect.options) {
      if (opt.value === shape.fontFamily) { textFontSelect.value = opt.value; matched = true; break; }
    }
    if (!matched) textFontSelect.value = textFontSelect.options[0].value;
    textOutlineSelect.value = shape.outline || "none";
    // Empty text shape (just placed) — focus the content input so the user
    // can type immediately without an extra click.
    if (!shape.text) {
      setTimeout(() => textContentInput.focus(), 0);
    }
  }
}

// ---------- Color popup ----------
function bindColorPopup() {
  colorPopupEl.addEventListener("click", (e) => {
    const swatch = e.target.closest(".color-swatch");
    if (!swatch || !state.colorPopup) return;
    const newColor = swatch.dataset.color;
    const subId = state.colorPopup.subId;
    let target = null;
    for (const story of state.stories) {
      const sub = story.sublayers.find((l) => l.id === subId);
      if (sub) { target = sub; break; }
    }
    if (target && target.color !== newColor) {
      pushHistory();
      target.color = newColor;
      renderLayerTree();
      render();
    }
    hideColorPopup();
  });

  document.addEventListener("pointerdown", (e) => {
    if (!state.colorPopup) return;
    if (e.target.closest("#color-popup")) return;
    if (e.target.closest('[data-action="color-sub"]')) return;
    hideColorPopup();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.colorPopup) {
      hideColorPopup();
    }
  });
}

function toggleColorPopup(anchorEl, sub) {
  if (state.colorPopup && state.colorPopup.subId === sub.id) {
    hideColorPopup();
    return;
  }
  showColorPopup(anchorEl, sub);
}

function showColorPopup(anchorEl, sub) {
  state.colorPopup = { subId: sub.id };
  colorPopupEl.innerHTML = "";
  for (const c of LAYER_COLOR_PALETTE) {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch" + (c.toLowerCase() === (sub.color || "").toLowerCase() ? " selected" : "");
    swatch.style.background = c;
    swatch.dataset.color = c;
    swatch.title = c;
    colorPopupEl.appendChild(swatch);
  }
  colorPopupEl.classList.remove("hidden");

  const rect = anchorEl.getBoundingClientRect();
  const popupW = colorPopupEl.offsetWidth;
  const popupH = colorPopupEl.offsetHeight;
  let left = rect.right + 8;
  let top = rect.top - 4;
  if (left + popupW > window.innerWidth - 8) left = rect.left - popupW - 8;
  if (top + popupH > window.innerHeight - 8) top = window.innerHeight - popupH - 8;
  if (top < 8) top = 8;
  if (left < 8) left = 8;
  colorPopupEl.style.left = left + "px";
  colorPopupEl.style.top = top + "px";
}

function hideColorPopup() {
  state.colorPopup = null;
  colorPopupEl.classList.add("hidden");
}

// ---------- Layer hint modal ----------
// Pops up after the user has clicked / marqueed in empty space on the active
// layer multiple times near shapes that live on *other* layers — a strong
// signal that they're trying to grab something the layer-lock is filtering
// out. Lets them switch layers without leaving the canvas.
function bindLayerHintModal() {
  layerHintClose.addEventListener("click", () => hideLayerHintModal());
  layerHintModal.addEventListener("pointerdown", (e) => e.stopPropagation());
  layerHintList.addEventListener("click", (e) => {
    const btn = e.target.closest(".layer-hint-item");
    if (!btn) return;
    const subId = btn.dataset.subId;
    if (!subId) return;
    if (state.activeSublayerId !== subId) {
      state.selection.clear();
      state.activeSublayerId = subId;
      renderLayerTree();
      render();
    }
    hideLayerHintModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !layerHintModal.classList.contains("hidden")) {
      hideLayerHintModal();
    }
  });
}

function showLayerHintModal() {
  // Build a flat list of every visible sublayer that isn't already active.
  // Anything hidden by the user (visibility toggle on story or sub) is
  // intentionally off-limits, so don't tempt them with it.
  layerHintList.innerHTML = "";
  const active = activeSublayer();
  const items = [];
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (!sub.visible) continue;
      if (active && sub.id === active.id) continue;
      items.push({ story, sub });
    }
  }
  if (!items.length) return;

  for (const { story, sub } of items) {
    const btn = document.createElement("button");
    btn.className = "layer-hint-item";
    btn.dataset.subId = sub.id;
    const bubble = document.createElement("span");
    bubble.className = "color-bubble";
    bubble.style.background = sub.color || DEFAULT_LAYER_COLOR_FALLBACK;
    btn.appendChild(bubble);
    const name = document.createElement("span");
    name.textContent = sub.name;
    btn.appendChild(name);
    const storyTag = document.createElement("span");
    storyTag.className = "layer-hint-item-story";
    storyTag.textContent = story.name;
    btn.appendChild(storyTag);
    layerHintList.appendChild(btn);
  }

  layerHintModal.classList.remove("hidden");
}

function hideLayerHintModal() {
  layerHintModal.classList.add("hidden");
}
