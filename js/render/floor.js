'use strict';

// ==============================================================================
// Floor regions — a filled polygon on the Floor layer that displays a material
// pattern (hardwood, LVP, tile, …). The region has no drawn border; only the
// pattern fill reads. Patterns are drawn procedurally in world units so they
// stay crisp at any zoom, clipped to the polygon, and kept at a low opacity so
// they sit quietly behind the rest of the drawing.
//
// The Floor layer is the first sublayer of a story, so floor regions paint
// beneath walls / furniture / fixtures automatically (render order = sublayer
// order). Furniture, cabinets and fixtures paint an opaque backing over the
// pattern — see render/appliance.js and render/cabinet.js.
// ==============================================================================

// Overall opacity of a floor region — pattern lines included. Low on purpose:
// the floor is context, not the subject.
const FLOOR_PATTERN_ALPHA = 0.45;

// Per-pattern colours: a pale base wash + the line colour for seams / grout.
const FLOOR_PATTERN_SPEC = {
  hardwood:      { base: "#e7d8bf", line: "#b48f5e" },
  lvp:           { base: "#e3e2de", line: "#9a948a" },
  "tile-square": { base: "#e9ebee", line: "#93a0ab" },
  "tile-hex":    { base: "#e9ebee", line: "#93a0ab" },
  carpet:        { base: "#e7e3e9", line: "#a99fb2" },
};

// ---------- draw entry ----------

function drawFloorShape(sh) {
  const pts = sh.points;
  if (!Array.isArray(pts) || pts.length < 3) return;

  const spec = FLOOR_PATTERN_SPEC[sh.pattern] || FLOOR_PATTERN_SPEC.hardwood;

  // World bbox of the region.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const scr = pts.map((p) => worldToScreen(p.x, p.y));

  ctx.save();
  // Clip to the polygon so the pattern stops exactly at the region edge.
  ctx.beginPath();
  ctx.moveTo(scr[0].x, scr[0].y);
  for (let i = 1; i < scr.length; i++) ctx.lineTo(scr[i].x, scr[i].y);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = FLOOR_PATTERN_ALPHA;

  // Base wash across the whole region.
  const tl = worldToScreen(minX, minY);
  const br = worldToScreen(maxX, maxY);
  ctx.fillStyle = spec.base;
  ctx.fillRect(
    Math.min(tl.x, br.x), Math.min(tl.y, br.y),
    Math.abs(br.x - tl.x), Math.abs(br.y - tl.y),
  );

  // Pattern features are laid out only across the visible viewport ∩ region —
  // a huge floor zoomed in shouldn't stroke thousands of off-screen tiles.
  const vis = floorVisibleWorldRect();
  const px0 = Math.max(minX, vis.x0);
  const py0 = Math.max(minY, vis.y0);
  const px1 = Math.min(maxX, vis.x1);
  const py1 = Math.min(maxY, vis.y1);
  if (px1 > px0 && py1 > py0) {
    ctx.strokeStyle = spec.line;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    if (sh.pattern === "tile-square") drawFloorTileSquare(px0, py0, px1, py1);
    else if (sh.pattern === "tile-hex") drawFloorTileHex(px0, py0, px1, py1);
    else if (sh.pattern === "carpet") drawFloorCarpet(px0, py0, px1, py1);
    else if (sh.pattern === "lvp") drawFloorPlanks(px0, py0, px1, py1, 0.75, 5);
    else drawFloorPlanks(px0, py0, px1, py1, 0.5, 4); // hardwood (default)
  }

  ctx.restore();
}

// World rectangle currently visible on the canvas, used to bound how much
// pattern geometry gets generated.
function floorVisibleWorldRect() {
  const view = viewSize();
  const a = screenToWorld(0, 0);
  const b = screenToWorld(view.w, view.h);
  return {
    x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
  };
}

// Add one world-space segment to the current path (no begin/stroke).
function floorPathSeg(wx1, wy1, wx2, wy2) {
  const a = worldToScreen(wx1, wy1);
  const b = worldToScreen(wx2, wy2);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

// ---------- pattern routines ----------
// Each strokes its whole geometry in a single batched path.

// Hardwood / LVP — horizontal planks with staggered butt joints.
function drawFloorPlanks(x0, y0, x1, y1, plankH, boardL) {
  ctx.beginPath();
  let row = 0;
  const startY = Math.floor(y0 / plankH) * plankH;
  for (let y = startY; y <= y1 + plankH; y += plankH) {
    floorPathSeg(x0, y, x1, y); // plank seam
    const off = (row & 1) * (boardL / 2);
    const startX = Math.floor((x0 - off) / boardL) * boardL + off;
    for (let x = startX; x <= x1 + boardL; x += boardL) {
      floorPathSeg(x, y, x, y + plankH); // butt joint
    }
    row++;
  }
  ctx.stroke();
}

// Square tile — a 1-ft grout grid.
function drawFloorTileSquare(x0, y0, x1, y1) {
  const g = 1;
  ctx.beginPath();
  for (let x = Math.floor(x0 / g) * g; x <= x1 + g; x += g) floorPathSeg(x, y0, x, y1);
  for (let y = Math.floor(y0 / g) * g; y <= y1 + g; y += g) floorPathSeg(x0, y, x1, y);
  ctx.stroke();
}

// Small hexagonal tile — flat-top hex grid. Each hex strokes only its three
// upper edges so every shared edge is drawn exactly once.
function drawFloorTileHex(x0, y0, x1, y1) {
  const s = 0.55;                       // hex radius (centre → vertex)
  const colStep = 1.5 * s;
  const rowStep = Math.sqrt(3) * s;
  ctx.beginPath();
  const colStart = Math.floor((x0 - s) / colStep);
  const colEnd = Math.ceil((x1 + s) / colStep);
  for (let col = colStart; col <= colEnd; col++) {
    const cx = col * colStep;
    const yOff = (col & 1) ? rowStep / 2 : 0;
    const rowStart = Math.floor((y0 - s - yOff) / rowStep);
    const rowEnd = Math.ceil((y1 + s - yOff) / rowStep);
    for (let row = rowStart; row <= rowEnd; row++) {
      const cy = row * rowStep + yOff;
      const vx = (k) => cx + s * Math.cos((Math.PI / 3) * k);
      const vy = (k) => cy + s * Math.sin((Math.PI / 3) * k);
      // v180 → v240 → v300 → v0: the top-left, top and top-right edges.
      const p3 = worldToScreen(vx(3), vy(3));
      const p4 = worldToScreen(vx(4), vy(4));
      const p5 = worldToScreen(vx(5), vy(5));
      const p0 = worldToScreen(vx(0), vy(0));
      ctx.moveTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.lineTo(p5.x, p5.y);
      ctx.lineTo(p0.x, p0.y);
    }
  }
  ctx.stroke();
}

// Carpet — a fine single-direction diagonal hatch reads as a soft texture.
function drawFloorCarpet(x0, y0, x1, y1) {
  const g = 0.4;
  ctx.beginPath();
  const cMin = y0 - x1, cMax = y1 - x0;
  for (let c = Math.floor(cMin / g) * g; c <= cMax; c += g) {
    floorPathSeg(x0, x0 + c, x1, x1 + c); // line y = x + c
  }
  ctx.stroke();
}

// ---------- in-progress polygon preview ----------

// Draws the floor-polygon being built with the Line tool on the Floor layer:
// committed edges, a rubber-band to the cursor, a dashed hint of the closing
// edge, and a dot on each placed vertex.
function drawFloorBuilderPreview() {
  const b = state.floorBuilder;
  if (!b || !b.points.length) return;
  const pts = b.points;
  const accent = (typeof SELECT_COLOR === "string" && SELECT_COLOR) ? SELECT_COLOR : "#e8602c";

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const s0 = worldToScreen(pts[0].x, pts[0].y);
  ctx.beginPath();
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < pts.length; i++) {
    const s = worldToScreen(pts[i].x, pts[i].y);
    ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  // Rubber-band edge from the last placed point to the cursor, plus a dashed
  // hint of the edge that would close the loop.
  if (state.cursorWorld) {
    const cur = state.snap ? snapWorld(state.cursorWorld) : state.cursorWorld;
    const sc = worldToScreen(cur.x, cur.y);
    const last = worldToScreen(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(sc.x, sc.y);
    if (pts.length >= 2) ctx.lineTo(s0.x, s0.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const p of pts) {
    const s = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
