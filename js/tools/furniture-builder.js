'use strict';

// =============================================================================
// Furniture Builder — popup window with its own canvas for sketching custom
// furniture pieces out of lines, rectangles (with optional rounded corners),
// and circles. Saving compiles the primitives into a library entry, refreshes
// the palette, and downloads a fresh js/custom-furniture.js so the user can
// drop it back into the project for cross-refresh persistence.
// =============================================================================

// 4" grid — fine enough to sketch furniture details without losing snap. The
// builder canvas is independent of the main canvas's grid setting.
const BUILDER_GRID_FT = 1 / 3;
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

  // Pull any pieces already in the library into the palette catalog.
  syncCustomFurnitureToPalette();
}

function openFurnitureBuilder() {
  builder.open = true;
  builder.primitives = [];
  builder.selection = null;
  builder.pending = null;
  builder.drag = null;
  builderNameInput.value = "";
  setBuilderTool("select");
  builderModal.classList.remove("hidden");
  // The stage doesn't have a real size until it's visible — measure now.
  requestAnimationFrame(() => { fitBuilderCanvas(); renderBuilder(); });
}

function closeFurnitureBuilder() {
  builder.open = false;
  builderModal.classList.add("hidden");
  builder.pending = null;
  builder.drag = null;
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
  const g = BUILDER_GRID_FT;
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
    const hitIndex = hitTestPrimitive(wpRaw);
    builder.selection = hitIndex;
    if (hitIndex !== null) {
      builder.drag = {
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
    builder.pending = { type: "circle", cx: wp.x, cy: wp.y, r: 0 };
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
    const dx = wp.x - builder.drag.startWorld.x;
    const dy = wp.y - builder.drag.startWorld.y;
    movePrimitiveTo(builder.selection, builder.drag.originalShape, dx, dy);
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
    p.r = Math.hypot(wp.x - p.cx, wp.y - p.cy);
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
    return Math.abs(Math.hypot(wp.x - p.cx, wp.y - p.cy) - p.r);
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

function clonePrimitive(p) { return { ...p }; }

function primitiveHasSize(p) {
  if (p.type === "line")   return Math.hypot(p.x2 - p.x1, p.y2 - p.y1) > 1e-6;
  if (p.type === "rect")   return p.w > 1e-6 && p.h > 1e-6;
  if (p.type === "circle") return p.r > 1e-6;
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
  if (!sel || sel.type !== "rect") {
    builderProps.classList.add("hidden");
    builderProps.innerHTML = "";
    return;
  }
  const maxR = Math.min(sel.w, sel.h) / 2;
  const rPct = maxR > 0 ? Math.round((sel.r || 0) / maxR * 100) : 0;
  builderProps.classList.remove("hidden");
  builderProps.innerHTML = `
    <div class="builder-prop-title">Square</div>
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
    const r = p.r * BUILDER_PX_PER_FOOT;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Selection handles — small dots so the user can see what they grabbed.
  if (selected && !ghost) {
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#E8602C";
    ctx.lineWidth = 1.5;
    for (const pt of primitiveHandlePoints(p)) {
      const sp = builderWorldToScreen(pt.x, pt.y);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, BUILDER_HANDLE_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function primitiveHandlePoints(p) {
  if (p.type === "line") return [{ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }];
  if (p.type === "rect") {
    return [
      { x: p.x,         y: p.y },
      { x: p.x + p.w,   y: p.y },
      { x: p.x + p.w,   y: p.y + p.h },
      { x: p.x,         y: p.y + p.h },
    ];
  }
  if (p.type === "circle") return [{ x: p.cx, y: p.cy }];
  return [];
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
      return { type: "circle", cx: p.cx - cx, cy: p.cy - cy, r: p.r };
    }
    return null;
  }).filter(Boolean);

  const piece = {
    id: "cf-" + Math.random().toString(36).slice(2, 9),
    name,
    width,
    depth,
    primitives,
  };

  // 1. Add to in-memory library + palette so it shows up immediately.
  if (!Array.isArray(window.CUSTOM_FURNITURE_LIBRARY)) {
    window.CUSTOM_FURNITURE_LIBRARY = [];
  }
  window.CUSTOM_FURNITURE_LIBRARY.push(piece);
  syncCustomFurnitureToPalette();

  // 2. Trigger a download of a refreshed custom-furniture.js — the user drops
  //    that file back into js/ and the piece survives a refresh.
  downloadCustomFurnitureFile(window.CUSTOM_FURNITURE_LIBRARY);

  closeFurnitureBuilder();
  // Re-render the main canvas so a freshly-added piece shows up in the palette.
  if (typeof render === "function") render();
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
      pxs = [p.cx - p.r, p.cx + p.r]; pys = [p.cy - p.r, p.cy + p.r];
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
  if (typeof renderPalette === "function") renderPalette();
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
  const k = e.key.toLowerCase();
  if (k === "v") setBuilderTool("select");
  else if (k === "l") setBuilderTool("line");
  else if (k === "b" || k === "r") setBuilderTool("rect");
  else if (k === "c") setBuilderTool("circle");
}, true); // capture so the main app's shortcuts don't also fire
