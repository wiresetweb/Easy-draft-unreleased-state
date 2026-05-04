'use strict';

// =============================================================================
// Furniture Builder — popup window with its own canvas for sketching custom
// furniture pieces out of lines, rectangles (with optional rounded corners),
// and circles. Saving compiles the primitives into a library entry, refreshes
// the palette, and downloads a fresh js/custom-furniture.js so the user can
// drop it back into the project for cross-refresh persistence.
// =============================================================================

// Visual grid lines are drawn at 4" (BUILDER_GRID_FT) for legibility, but
// snap operates on the half-grid (2") so the user can drop a 4"-diameter
// circle (smallest a 1-square footprint allows) and place primitives at
// 2" intervals between the heavier grid lines.
const BUILDER_GRID_FT = 1 / 3;        // 4" — visual grid spacing
const BUILDER_SNAP_FT = 1 / 6;        // 2" — actual snap step
const BUILDER_PX_PER_FOOT = 60;       // base scale; user can't zoom for now
const BUILDER_HIT_PX = 8;
const BUILDER_HANDLE_PX = 5;

const builder = {
  open: false,
  tool: "select",
  primitives: [],     // [{ type: "line"|"rect"|"circle", ... }]
  selection: null,    // index into primitives, or null
  pending: null,      // in-progress draw
  drag: null,         // { startWorld, originalShape, mode }
  cursorWorld: { x: 0, y: 0 },
  cursorScreen: { x: 0, y: 0 },
};

let builderCanvas, builderCtx, builderModal, builderStage;
let builderToolbar, builderNameInput, builderReadout, builderProps;

// ---------- init / lifecycle ----------
function bindFurnitureBuilder() {
  builderCanvas  = document.getElementById("furniture-builder-canvas");
  builderCtx     = builderCanvas.getContext("2d");
  builderModal   = document.getElementById("furniture-builder-modal");
  builderStage   = builderModal.querySelector(".builder-stage");
  builderToolbar = document.getElementById("furniture-builder-toolbar");
  builderNameInput = document.getElementById("furniture-builder-name");
  builderReadout = document.getElementById("furniture-builder-readout");
  builderProps   = document.getElementById("furniture-builder-props");

  // Toolbar tool buttons
  builderToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".builder-tool");
    if (btn) { setBuilderTool(btn.dataset.tool); return; }
    if (e.target.closest("#furniture-builder-delete")) deleteSelectedPrimitive();
    if (e.target.closest("#furniture-builder-clear")) clearBuilder();
  });

  // Header buttons
  document.getElementById("furniture-builder-save").addEventListener("click", saveCustomFurniture);
  document.getElementById("furniture-builder-close").addEventListener("click", closeFurnitureBuilder);

  // Canvas pointer events
  builderCanvas.addEventListener("pointerdown", onBuilderPointerDown);
  builderCanvas.addEventListener("pointermove", onBuilderPointerMove);
  builderCanvas.addEventListener("pointerup",   onBuilderPointerUp);

  // Resize-aware canvas backing
  window.addEventListener("resize", () => {
    if (!builder.open) return;
    fitBuilderCanvas();
    renderBuilder();
  });

  // Merge any stashed pieces from a previous session, then push the
  // (possibly merged) library into the palette catalog.
  loadCustomFurnitureFromStorage();
  syncCustomFurnitureToPalette();
}

function openFurnitureBuilder(opts) {
  // opts.editId — when present, load the matching library piece into the
  // builder for editing. Save will then update the piece in place instead
  // of appending a new one. Without opts the builder opens empty.
  builder.open = true;
  builder.editId = (opts && opts.editId) || null;
  builder.primitives = [];
  builder.selection = null;
  builder.pending = null;
  builder.drag = null;
  builderNameInput.value = "";

  if (builder.editId) {
    const lib = Array.isArray(window.CUSTOM_FURNITURE_LIBRARY) ? window.CUSTOM_FURNITURE_LIBRARY : [];
    const piece = lib.find((p) => p.id === builder.editId);
    if (piece) {
      builderNameInput.value = piece.name || "";
      // Saved pieces are stored centered on (0,0); the builder's edit
      // workspace also centers there, so no translation needed.
      builder.primitives = (piece.primitives || []).map(normalizePrimitive);
    }
  }

  setBuilderTool("select");
  builderModal.classList.remove("hidden");
  // The stage doesn't have a real size until it's visible — measure now.
  requestAnimationFrame(() => { fitBuilderCanvas(); renderBuilder(); });
  trapFocusIn(builderModal);
}

function closeFurnitureBuilder() {
  builder.open = false;
  builder.editId = null;
  builderModal.classList.add("hidden");
  builder.pending = null;
  builder.drag = null;
  releaseFocusTrap();
}

function setBuilderTool(tool) {
  builder.tool = tool;
  builder.pending = null;
  if (tool !== "select") builder.selection = null;
  for (const btn of builderToolbar.querySelectorAll(".builder-tool")) {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  }
  builderStage.classList.toggle("cursor-default", tool === "select");
  updateBuilderProps();
  renderBuilder();
}

// ---------- canvas plumbing ----------
function fitBuilderCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = builderCanvas.getBoundingClientRect();
  builderCanvas.width  = Math.floor(rect.width  * dpr);
  builderCanvas.height = Math.floor(rect.height * dpr);
  builderCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function builderViewSize() {
  const rect = builderCanvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function builderScreenToWorld(sx, sy) {
  const v = builderViewSize();
  return {
    x: (sx - v.w / 2) / BUILDER_PX_PER_FOOT,
    y: (sy - v.h / 2) / BUILDER_PX_PER_FOOT,
  };
}
function builderWorldToScreen(wx, wy) {
  const v = builderViewSize();
  return {
    x: wx * BUILDER_PX_PER_FOOT + v.w / 2,
    y: wy * BUILDER_PX_PER_FOOT + v.h / 2,
  };
}
function builderSnap(p) {
  const g = BUILDER_SNAP_FT;
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}
function builderLocalPointer(e) {
  const r = builderCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ---------- pointer handling ----------
function onBuilderPointerDown(e) {
  if (e.button !== 0) return;
  const sp = builderLocalPointer(e);
  const wpRaw = builderScreenToWorld(sp.x, sp.y);
  const wp = builderSnap(wpRaw);
  builderCanvas.setPointerCapture?.(e.pointerId);

  if (builder.tool === "select") {
    // Resize grip on the currently-selected primitive takes priority over
    // hitting a different primitive's body — clicking a corner shouldn't
    // pick up a shape behind it.
    if (builder.selection !== null) {
      const sel = builder.primitives[builder.selection];
      const handleId = hitHandle(sel, wp);
      if (handleId) {
        builder.drag = {
          mode: "resize",
          handle: handleId,
          startWorld: wp,
          originalShape: clonePrimitive(sel),
        };
        renderBuilder();
        return;
      }
    }
    const hitIndex = hitTestPrimitive(wpRaw);
    builder.selection = hitIndex;
    if (hitIndex !== null) {
      builder.drag = {
        mode: "move",
        startWorld: wp,
        originalShape: clonePrimitive(builder.primitives[hitIndex]),
      };
    }
    updateBuilderProps();
    renderBuilder();
    return;
  }

  if (builder.tool === "line") {
    builder.pending = { type: "line", x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y };
  } else if (builder.tool === "rect") {
    builder.pending = { type: "rect", _startX: wp.x, _startY: wp.y, x: wp.x, y: wp.y, w: 0, h: 0, r: 0 };
  } else if (builder.tool === "circle") {
    // Stored as an ellipse from day one — rx === ry while drawing produces a
    // circle, but the data model lets the user stretch it later. Saved
    // pieces keep this rx/ry shape; legacy `{ r }` data normalizes on load.
    builder.pending = { type: "circle", cx: wp.x, cy: wp.y, rx: 0, ry: 0 };
  }
  renderBuilder();
}

function onBuilderPointerMove(e) {
  const sp = builderLocalPointer(e);
  const wpRaw = builderScreenToWorld(sp.x, sp.y);
  const wp = builderSnap(wpRaw);
  builder.cursorWorld = wp;
  builder.cursorScreen = sp;
  updateBuilderReadout(wp);

  if (builder.drag && builder.selection !== null) {
    if (builder.drag.mode === "resize") {
      resizePrimitiveByHandle(builder.selection, builder.drag.originalShape, builder.drag.handle, wp);
    } else {
      const dx = wp.x - builder.drag.startWorld.x;
      const dy = wp.y - builder.drag.startWorld.y;
      movePrimitiveTo(builder.selection, builder.drag.originalShape, dx, dy);
    }
    updateBuilderProps();
    renderBuilder();
    return;
  }

  if (!builder.pending) { renderBuilder(); return; }

  const p = builder.pending;
  if (p.type === "line") {
    p.x2 = wp.x; p.y2 = wp.y;
  } else if (p.type === "rect") {
    p.x = Math.min(p._startX, wp.x);
    p.y = Math.min(p._startY, wp.y);
    p.w = Math.abs(wp.x - p._startX);
    p.h = Math.abs(wp.y - p._startY);
  } else if (p.type === "circle") {
    // Drag-to-draw produces a perfect circle (rx === ry).
    const r = Math.hypot(wp.x - p.cx, wp.y - p.cy);
    p.rx = r;
    p.ry = r;
  }
  renderBuilder();
}

function onBuilderPointerUp(e) {
  builderCanvas.releasePointerCapture?.(e.pointerId);
  if (builder.drag) { builder.drag = null; }
  if (builder.pending) {
    const p = builder.pending;
    if (primitiveHasSize(p)) {
      // Drop the scratch fields before storing
      const stored = clonePrimitive(p);
      delete stored._startX; delete stored._startY;
      builder.primitives.push(stored);
      // Auto-select the just-drawn shape so corner-radius UI is reachable.
      builder.selection = builder.primitives.length - 1;
      // Hop back to select so the user can immediately tweak it.
      setBuilderTool("select");
    }
    builder.pending = null;
  }
  updateBuilderProps();
  renderBuilder();
}

// ---------- hit test / movement ----------
function hitTestPrimitive(wp) {
  const tol = BUILDER_HIT_PX / BUILDER_PX_PER_FOOT;
  let best = null;
  let bestDist = Infinity;
  for (let i = builder.primitives.length - 1; i >= 0; i--) {
    const p = builder.primitives[i];
    const d = primitiveDistance(p, wp);
    if (d < tol && d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function primitiveDistance(p, wp) {
  if (p.type === "line") {
    return pointToSegmentDist(wp.x, wp.y, p.x1, p.y1, p.x2, p.y2);
  }
  if (p.type === "rect") {
    // Distance to nearest edge of the rect outline.
    const x1 = p.x, y1 = p.y, x2 = p.x + p.w, y2 = p.y + p.h;
    const inside = wp.x >= x1 && wp.x <= x2 && wp.y >= y1 && wp.y <= y2;
    const dx = Math.min(Math.abs(wp.x - x1), Math.abs(wp.x - x2));
    const dy = Math.min(Math.abs(wp.y - y1), Math.abs(wp.y - y2));
    if (inside) return Math.min(dx, dy);
    // Outside — distance to nearest point on the rectangle.
    const cx = Math.max(x1, Math.min(wp.x, x2));
    const cy = Math.max(y1, Math.min(wp.y, y2));
    return Math.hypot(wp.x - cx, wp.y - cy);
  }
  if (p.type === "circle") {
    // Distance to nearest point on the ellipse outline. Approximated via
    // signed parametric distance — exact analytic solution is messy and
    // we just need it for click-tolerance hit-testing.
    const rx = p.rx || p.r || 0;
    const ry = p.ry || p.r || 0;
    if (rx <= 0 || ry <= 0) return Infinity;
    const dx = wp.x - p.cx, dy = wp.y - p.cy;
    // Scale to a unit circle, find the closest point there, scale back.
    const k = Math.hypot(dx / rx, dy / ry);
    if (k < 1e-6) return Math.min(rx, ry); // dead center
    const closest = { x: p.cx + (dx / k), y: p.cy + (dy / k) };
    return Math.hypot(wp.x - closest.x, wp.y - closest.y);
  }
  return Infinity;
}

function movePrimitiveTo(index, original, dx, dy) {
  const p = builder.primitives[index];
  if (p.type === "line") {
    p.x1 = original.x1 + dx; p.y1 = original.y1 + dy;
    p.x2 = original.x2 + dx; p.y2 = original.y2 + dy;
  } else if (p.type === "rect") {
    p.x = original.x + dx; p.y = original.y + dy;
  } else if (p.type === "circle") {
    p.cx = original.cx + dx; p.cy = original.cy + dy;
  }
}

// Apply a handle drag to the selected primitive. `wp` is the current
// snapped pointer. Each handle id maps to an axis (or pair of axes) it
// stretches; we recompute from the saved `original` snapshot so partial
// drags don't compound rounding errors.
function resizePrimitiveByHandle(index, original, handle, wp) {
  const p = builder.primitives[index];
  if (p.type === "line") {
    if (handle === "p1") { p.x1 = wp.x; p.y1 = wp.y; }
    else if (handle === "p2") { p.x2 = wp.x; p.y2 = wp.y; }
    return;
  }
  if (p.type === "rect") {
    // Anchor the OPPOSITE side / corner so the dragged corner tracks the
    // pointer exactly. Negative widths flip the rect across its anchor.
    let x1 = original.x;
    let y1 = original.y;
    let x2 = original.x + original.w;
    let y2 = original.y + original.h;
    if (handle === "nw" || handle === "w" || handle === "sw") x1 = wp.x;
    if (handle === "ne" || handle === "e" || handle === "se") x2 = wp.x;
    if (handle === "nw" || handle === "n" || handle === "ne") y1 = wp.y;
    if (handle === "sw" || handle === "s" || handle === "se") y2 = wp.y;
    p.x = Math.min(x1, x2);
    p.y = Math.min(y1, y2);
    p.w = Math.abs(x2 - x1);
    p.h = Math.abs(y2 - y1);
    // Corner radius can't exceed half the smaller side.
    const maxR = Math.min(p.w, p.h) / 2;
    if (p.r && p.r > maxR) p.r = maxR;
    return;
  }
  if (p.type === "circle") {
    const ox = original.cx, oy = original.cy;
    if (handle === "rxRight") p.rx = Math.max(BUILDER_SNAP_FT, wp.x - ox);
    else if (handle === "rxLeft") p.rx = Math.max(BUILDER_SNAP_FT, ox - wp.x);
    else if (handle === "ryBot") p.ry = Math.max(BUILDER_SNAP_FT, wp.y - oy);
    else if (handle === "ryTop") p.ry = Math.max(BUILDER_SNAP_FT, oy - wp.y);
    return;
  }
}

function clonePrimitive(p) { return { ...p }; }

// Normalize a primitive that might come from older library data. Currently
// the only divergence is "circle" with a single `r` (legacy) vs rx/ry. The
// builder always edits via rx/ry; the save flow can choose either shape.
function normalizePrimitive(p) {
  if (p && p.type === "circle" && typeof p.r === "number" && typeof p.rx !== "number") {
    return { ...p, rx: p.r, ry: p.r };
  }
  return { ...p };
}

function primitiveHasSize(p) {
  if (p.type === "line")   return Math.hypot(p.x2 - p.x1, p.y2 - p.y1) > 1e-6;
  if (p.type === "rect")   return p.w > 1e-6 && p.h > 1e-6;
  if (p.type === "circle") return (p.rx || p.r || 0) > 1e-6 && (p.ry || p.r || 0) > 1e-6;
  return false;
}

function deleteSelectedPrimitive() {
  if (builder.selection === null) return;
  builder.primitives.splice(builder.selection, 1);
  builder.selection = null;
  updateBuilderProps();
  renderBuilder();
}

function clearBuilder() {
  if (builder.primitives.length === 0) return;
  if (!confirm("Clear all primitives?")) return;
  builder.primitives = [];
  builder.selection = null;
  builder.pending = null;
  updateBuilderProps();
  renderBuilder();
}

// ---------- selection property panel ----------
function updateBuilderProps() {
  const idx = builder.selection;
  const sel = idx !== null ? builder.primitives[idx] : null;
  if (!sel) {
    builderProps.classList.add("hidden");
    builderProps.innerHTML = "";
    return;
  }
  if (sel.type === "rect") return renderRectProps(sel);
  if (sel.type === "circle") return renderCircleProps(sel);
  if (sel.type === "line") return renderLineProps(sel);
  builderProps.classList.add("hidden");
  builderProps.innerHTML = "";
}

function renderRectProps(sel) {
  const maxR = Math.min(sel.w, sel.h) / 2;
  const rPct = maxR > 0 ? Math.round((sel.r || 0) / maxR * 100) : 0;
  builderProps.classList.remove("hidden");
  builderProps.innerHTML = `
    <div class="builder-prop-title">Square &middot; ${formatFeet(sel.w)} &times; ${formatFeet(sel.h)}</div>
    <div class="dim-row">
      <label>Corner radius</label>
    </div>
    <div class="dim-row">
      <input type="range" id="builder-radius-range" min="0" max="100" value="${rPct}">
      <input type="text" id="builder-radius-text" value="${formatFeet(sel.r || 0)}">
    </div>
  `;
  const rangeEl = document.getElementById("builder-radius-range");
  const textEl  = document.getElementById("builder-radius-text");
  rangeEl.addEventListener("input", () => {
    const r = (rangeEl.value / 100) * maxR;
    sel.r = r;
    textEl.value = formatFeet(r);
    renderBuilder();
  });
  textEl.addEventListener("change", () => {
    const v = parseFeet(textEl.value);
    if (v === null || v < 0) { textEl.value = formatFeet(sel.r || 0); return; }
    sel.r = Math.max(0, Math.min(maxR, v));
    rangeEl.value = Math.round(sel.r / maxR * 100);
    textEl.value = formatFeet(sel.r);
    renderBuilder();
  });
}

function renderCircleProps(sel) {
  const rx = sel.rx || sel.r || 0;
  const ry = sel.ry || sel.r || 0;
  builderProps.classList.remove("hidden");
  builderProps.innerHTML = `
    <div class="builder-prop-title">${Math.abs(rx - ry) < 1e-6 ? "Circle" : "Ellipse"} &middot; ${formatFeet(rx * 2)} &times; ${formatFeet(ry * 2)}</div>
    <div class="dim-row">
      <label>Width</label>
      <input type="text" id="builder-rx-text" value="${formatFeet(rx * 2)}">
    </div>
    <div class="dim-row">
      <label>Height</label>
      <input type="text" id="builder-ry-text" value="${formatFeet(ry * 2)}">
    </div>
  `;
  document.getElementById("builder-rx-text").addEventListener("change", (e) => {
    const v = parseFeet(e.target.value);
    if (v === null || v <= 0) { e.target.value = formatFeet(rx * 2); return; }
    sel.rx = v / 2;
    renderBuilder();
    updateBuilderProps();
  });
  document.getElementById("builder-ry-text").addEventListener("change", (e) => {
    const v = parseFeet(e.target.value);
    if (v === null || v <= 0) { e.target.value = formatFeet(ry * 2); return; }
    sel.ry = v / 2;
    renderBuilder();
    updateBuilderProps();
  });
}

function renderLineProps(sel) {
  const len = Math.hypot(sel.x2 - sel.x1, sel.y2 - sel.y1);
  builderProps.classList.remove("hidden");
  builderProps.innerHTML = `
    <div class="builder-prop-title">Line</div>
    <div class="dim-row">
      <label>Length</label>
      <span class="builder-prop-readonly">${formatFeet(len)}</span>
    </div>
  `;
}

function updateBuilderReadout(wp) {
  builderReadout.textContent = `${formatFeet(wp.x)}, ${formatFeet(wp.y)}`;
}

// ---------- rendering ----------
function renderBuilder() {
  if (!builder.open) return;
  const v = builderViewSize();
  builderCtx.clearRect(0, 0, v.w, v.h);
  drawBuilderGrid();
  drawBuilderOriginCross();
  for (let i = 0; i < builder.primitives.length; i++) {
    drawBuilderPrimitive(builder.primitives[i], i === builder.selection);
  }
  if (builder.pending) drawBuilderPrimitive(builder.pending, false, true);
}

function drawBuilderGrid() {
  const v = builderViewSize();
  const ctx = builderCtx;
  // Backdrop
  ctx.fillStyle = "#f3f6fc";
  ctx.fillRect(0, 0, v.w, v.h);

  const stepPx = BUILDER_GRID_FT * BUILDER_PX_PER_FOOT;
  const cx = v.w / 2, cy = v.h / 2;
  const startX = cx - Math.ceil(cx / stepPx) * stepPx;
  const startY = cy - Math.ceil(cy / stepPx) * stepPx;

  ctx.lineWidth = 1;
  // Fine grid (4" lines)
  ctx.strokeStyle = "rgba(107, 143, 214, 0.18)";
  ctx.beginPath();
  for (let x = startX; x <= v.w + 1; x += stepPx) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, v.h);
  }
  for (let y = startY; y <= v.h + 1; y += stepPx) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(v.w, Math.round(y) + 0.5);
  }
  ctx.stroke();

  // Heavier line every 1 ft (every 3rd step)
  const bigStep = stepPx * 3;
  const startBigX = cx - Math.ceil(cx / bigStep) * bigStep;
  const startBigY = cy - Math.ceil(cy / bigStep) * bigStep;
  ctx.strokeStyle = "rgba(74, 115, 197, 0.35)";
  ctx.beginPath();
  for (let x = startBigX; x <= v.w + 1; x += bigStep) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, v.h);
  }
  for (let y = startBigY; y <= v.h + 1; y += bigStep) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(v.w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

function drawBuilderOriginCross() {
  const ctx = builderCtx;
  const c = builderWorldToScreen(0, 0);
  ctx.save();
  ctx.strokeStyle = "rgba(232, 96, 44, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(c.x - 8, c.y); ctx.lineTo(c.x + 8, c.y);
  ctx.moveTo(c.x, c.y - 8); ctx.lineTo(c.x, c.y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawBuilderPrimitive(p, selected, ghost) {
  const ctx = builderCtx;
  ctx.save();
  ctx.strokeStyle = ghost ? "rgba(232, 96, 44, 0.85)" : (selected ? "#E8602C" : "#1a1a1a");
  ctx.fillStyle = "transparent";
  ctx.lineWidth = ghost ? 1.4 : (selected ? 2 : 1.6);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (ghost) ctx.setLineDash([5, 4]);

  if (p.type === "line") {
    const a = builderWorldToScreen(p.x1, p.y1);
    const b = builderWorldToScreen(p.x2, p.y2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (p.type === "rect") {
    const tl = builderWorldToScreen(p.x, p.y);
    const br = builderWorldToScreen(p.x + p.w, p.y + p.h);
    const w = br.x - tl.x, h = br.y - tl.y;
    const rPx = Math.max(0, Math.min(w / 2, h / 2, (p.r || 0) * BUILDER_PX_PER_FOOT));
    ctx.beginPath();
    pathRoundedRectAbs(ctx, tl.x, tl.y, w, h, rPx);
    ctx.stroke();
  } else if (p.type === "circle") {
    const c = builderWorldToScreen(p.cx, p.cy);
    const rx = (p.rx || p.r || 0) * BUILDER_PX_PER_FOOT;
    const ry = (p.ry || p.r || 0) * BUILDER_PX_PER_FOOT;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Selection / resize grips. Drag any of these to resize that axis or
  // endpoint. Move-the-whole-shape happens by dragging the body itself.
  if (selected && !ghost) {
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#E8602C";
    ctx.lineWidth = 1.5;
    for (const h of primitiveHandles(p)) {
      const sp = builderWorldToScreen(h.x, h.y);
      ctx.beginPath();
      ctx.rect(sp.x - BUILDER_HANDLE_PX, sp.y - BUILDER_HANDLE_PX, BUILDER_HANDLE_PX * 2, BUILDER_HANDLE_PX * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Resize handles per primitive type. Each entry is { id, x, y } where id
// names the role the handle plays — the move handler reads it on
// pointermove to decide which dimension(s) to update. Order is "first
// hit wins" if two handles overlap.
function primitiveHandles(p) {
  if (p.type === "line") {
    return [
      { id: "p1", x: p.x1, y: p.y1 },
      { id: "p2", x: p.x2, y: p.y2 },
    ];
  }
  if (p.type === "rect") {
    return [
      { id: "nw", x: p.x,           y: p.y },
      { id: "ne", x: p.x + p.w,     y: p.y },
      { id: "se", x: p.x + p.w,     y: p.y + p.h },
      { id: "sw", x: p.x,           y: p.y + p.h },
      // Mid-edges so the user can stretch one dimension at a time.
      { id: "n",  x: p.x + p.w / 2, y: p.y },
      { id: "e",  x: p.x + p.w,     y: p.y + p.h / 2 },
      { id: "s",  x: p.x + p.w / 2, y: p.y + p.h },
      { id: "w",  x: p.x,           y: p.y + p.h / 2 },
    ];
  }
  if (p.type === "circle") {
    const rx = p.rx || p.r || 0;
    const ry = p.ry || p.r || 0;
    return [
      { id: "rxRight", x: p.cx + rx, y: p.cy      },
      { id: "rxLeft",  x: p.cx - rx, y: p.cy      },
      { id: "ryBot",   x: p.cx,      y: p.cy + ry },
      { id: "ryTop",   x: p.cx,      y: p.cy - ry },
    ];
  }
  return [];
}

// Returns the handle id at (wp) if the pointer landed within HANDLE_PX
// (in screen pixels) of any handle, else null.
function hitHandle(p, wp) {
  const tol = (BUILDER_HANDLE_PX + 2) / BUILDER_PX_PER_FOOT;
  for (const h of primitiveHandles(p)) {
    if (Math.abs(h.x - wp.x) < tol && Math.abs(h.y - wp.y) < tol) return h.id;
  }
  return null;
}

function pathRoundedRectAbs(ctx, x, y, w, h, r) {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ---------- save flow ----------
function saveCustomFurniture() {
  const name = (builderNameInput.value || "").trim();
  if (!name) { alert("Give the piece a name first."); builderNameInput.focus(); return; }
  if (builder.primitives.length === 0) { alert("Draw at least one shape before saving."); return; }

  // Compute bbox of all primitives, then translate them so origin = bbox center.
  const bbox = primitivesBBox(builder.primitives);
  const cx = (bbox.x1 + bbox.x2) / 2;
  const cy = (bbox.y1 + bbox.y2) / 2;
  const width = bbox.x2 - bbox.x1;
  const depth = bbox.y2 - bbox.y1;

  const primitives = builder.primitives.map((p) => {
    if (p.type === "line") {
      return { type: "line", x1: p.x1 - cx, y1: p.y1 - cy, x2: p.x2 - cx, y2: p.y2 - cy };
    }
    if (p.type === "rect") {
      return { type: "rect", x: p.x - cx, y: p.y - cy, w: p.w, h: p.h, r: p.r || 0 };
    }
    if (p.type === "circle") {
      const rx = p.rx || p.r || 0;
      const ry = p.ry || p.r || 0;
      // Save as { rx, ry } AND a backward-compat `r` matching the
      // smaller axis — older versions of the renderer / older builds
      // that read `p.r` will still render *something* sensible (a
      // perfect circle of the smaller radius) instead of NaN.
      return { type: "circle", cx: p.cx - cx, cy: p.cy - cy, rx, ry, r: Math.min(rx, ry) };
    }
    return null;
  }).filter(Boolean);

  if (!Array.isArray(window.CUSTOM_FURNITURE_LIBRARY)) {
    window.CUSTOM_FURNITURE_LIBRARY = [];
  }

  if (builder.editId) {
    // Update in place — preserve the original id so any drawings that
    // already reference it (via shape.customId) keep matching.
    const lib = window.CUSTOM_FURNITURE_LIBRARY;
    const idx = lib.findIndex((p) => p.id === builder.editId);
    const piece = { id: builder.editId, name, width, depth, primitives };
    if (idx >= 0) lib[idx] = piece;
    else lib.push(piece);
  } else {
    window.CUSTOM_FURNITURE_LIBRARY.push({
      id: "cf-" + Math.random().toString(36).slice(2, 9),
      name, width, depth, primitives,
    });
  }

  // Persist to localStorage so the new / edited piece survives a refresh
  // without forcing the user to re-download custom-furniture.js after
  // every save. The Export button in the Furniture palette downloads the
  // full library when the user is actually ready to commit it to disk.
  persistCustomFurnitureLibrary();
  syncCustomFurnitureToPalette();

  closeFurnitureBuilder();
  render();
}

const CUSTOM_FURNITURE_STORAGE_KEY = "easydraft.customFurniture";

function persistCustomFurnitureLibrary() {
  try {
    const lib = Array.isArray(window.CUSTOM_FURNITURE_LIBRARY) ? window.CUSTOM_FURNITURE_LIBRARY : [];
    localStorage.setItem(CUSTOM_FURNITURE_STORAGE_KEY, JSON.stringify(lib));
  } catch (_) { /* private mode, etc — fall through silently */ }
}

// On page load, merge any items stashed in localStorage into the
// file-loaded library. localStorage holds the latest in-browser state, so
// it wins — that way a piece edited in the builder shows up immediately
// next reload even if the user hasn't downloaded a new custom-furniture.js
// yet.
function loadCustomFurnitureFromStorage() {
  let stashed = null;
  try {
    const raw = localStorage.getItem(CUSTOM_FURNITURE_STORAGE_KEY);
    if (raw) stashed = JSON.parse(raw);
  } catch (_) { stashed = null; }
  if (!Array.isArray(stashed) || stashed.length === 0) return;
  // localStorage is the in-browser source of truth — replace whatever
  // came from the file. The file is what populates a fresh browser.
  window.CUSTOM_FURNITURE_LIBRARY = stashed;
}

function primitivesBBox(prims) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of prims) {
    let pxs, pys;
    if (p.type === "line") {
      pxs = [p.x1, p.x2]; pys = [p.y1, p.y2];
    } else if (p.type === "rect") {
      pxs = [p.x, p.x + p.w]; pys = [p.y, p.y + p.h];
    } else if (p.type === "circle") {
      const rx = p.rx || p.r || 0;
      const ry = p.ry || p.r || 0;
      pxs = [p.cx - rx, p.cx + rx]; pys = [p.cy - ry, p.cy + ry];
    } else continue;
    for (const x of pxs) { if (x < x1) x1 = x; if (x > x2) x2 = x; }
    for (const y of pys) { if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  if (!isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return { x1, y1, x2, y2 };
}

function downloadCustomFurnitureFile(library) {
  const header = `'use strict';

// ============================================================================
// Custom Furniture Library — generated by the in-app Furniture Builder.
// Replace js/custom-furniture.js with this file (overwriting the previous one)
// to make these pieces persist across reloads.
//
// Generated: ${new Date().toISOString()}
// Pieces:    ${library.length}
// ============================================================================

window.CUSTOM_FURNITURE_LIBRARY = `;
  const body = JSON.stringify(library, null, 2);
  const file = header + body + ";\n";

  const blob = new Blob([file], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "custom-furniture.js";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// ---------- palette sync ----------
// Pull library entries into PALETTE_ITEMS.furniture so the palette panel shows
// custom pieces alongside the built-ins. Idempotent — safe to re-run any time
// the library mutates.
function syncCustomFurnitureToPalette() {
  if (typeof PALETTE_ITEMS === "undefined") return;
  if (!Array.isArray(PALETTE_ITEMS.furniture)) return;
  // Strip any existing custom entries so we don't duplicate when re-syncing.
  PALETTE_ITEMS.furniture = PALETTE_ITEMS.furniture.filter((it) => it.kind !== "custom");
  const lib = Array.isArray(window.CUSTOM_FURNITURE_LIBRARY) ? window.CUSTOM_FURNITURE_LIBRARY : [];
  for (const piece of lib) {
    PALETTE_ITEMS.furniture.push({
      name: piece.name,
      kind: "custom",
      width: piece.width,
      depth: piece.depth,
      customId: piece.id,
      primitives: piece.primitives,
    });
  }
  renderPalette();
}

// ---------- key handling (modal-local) ----------
window.addEventListener("keydown", (e) => {
  if (!builder.open) return;
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "Escape") {
    if (builder.pending) { builder.pending = null; renderBuilder(); }
    else closeFurnitureBuilder();
    e.preventDefault();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelectedPrimitive();
    e.preventDefault();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "d") {
    duplicateSelectedPrimitive();
    e.preventDefault();
    return;
  }
  // Arrow-key nudge by one snap step (2"). Holding Shift bumps to one full
  // visible-grid step (4") for coarser positioning.
  if (e.key.startsWith("Arrow")) {
    if (builder.selection === null) return;
    const step = e.shiftKey ? BUILDER_GRID_FT : BUILDER_SNAP_FT;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft")  dx = -step;
    if (e.key === "ArrowRight") dx =  step;
    if (e.key === "ArrowUp")    dy = -step;
    if (e.key === "ArrowDown")  dy =  step;
    nudgeSelectedPrimitive(dx, dy);
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "v") setBuilderTool("select");
  else if (k === "l") setBuilderTool("line");
  else if (k === "b" || k === "r") setBuilderTool("rect");
  else if (k === "c") setBuilderTool("circle");
}, true); // capture so the main app's shortcuts don't also fire

function duplicateSelectedPrimitive() {
  if (builder.selection === null) return;
  const src = builder.primitives[builder.selection];
  const copy = clonePrimitive(src);
  // Offset by one visible-grid step so the copy sits beside its source
  // instead of stacking exactly on top.
  const off = BUILDER_GRID_FT;
  if (copy.type === "line") {
    copy.x1 += off; copy.y1 += off; copy.x2 += off; copy.y2 += off;
  } else if (copy.type === "rect") {
    copy.x += off; copy.y += off;
  } else if (copy.type === "circle") {
    copy.cx += off; copy.cy += off;
  }
  builder.primitives.push(copy);
  builder.selection = builder.primitives.length - 1;
  updateBuilderProps();
  renderBuilder();
}

function nudgeSelectedPrimitive(dx, dy) {
  if (builder.selection === null) return;
  const p = builder.primitives[builder.selection];
  if (p.type === "line") {
    p.x1 += dx; p.y1 += dy; p.x2 += dx; p.y2 += dy;
  } else if (p.type === "rect") {
    p.x += dx; p.y += dy;
  } else if (p.type === "circle") {
    p.cx += dx; p.cy += dy;
  }
  updateBuilderProps();
  renderBuilder();
}
