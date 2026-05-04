'use strict';

// =============================================================================
// Built-in piece → editable primitives.
//
// Each built-in palette item (toilets, vanities, tubs, etc.) is rendered by
// procedural code in js/render/appliance.js. This file lets the user "fork"
// any of those into the Furniture Builder for tweaking: it temporarily swaps
// every ctx draw method (plus strokeRoundedRect and drawDrain) with a
// recorder, calls the same kind-specific drawing functions the renderer
// uses, and converts the recorded calls into builder-format primitives
// (line / rect / circle).
//
// The conversion is lossy where it has to be:
//   • Partial ellipses / arcs become polylines (~24 line segments per turn).
//   • quadraticCurveTo / bezierCurveTo paths become polylines.
//   • Text labels are dropped — the builder doesn't have text primitives.
// For everything else (rectangles, full circles/ellipses, line chains,
// rounded rectangles via strokeRoundedRect) the recorder emits clean
// primitives the user can grab and resize directly.
// =============================================================================

const APPLIANCE_RECORDER_ARC_STEPS = 24; // segments per full revolution

// Method-by-method shadow of the patched ctx so the original methods can be
// restored cleanly even if the recorded function throws.
let _ctxRecorderState = null;

function _activeRecorder() { return _ctxRecorderState ? _ctxRecorderState.rec : null; }

// ---------- Recorder ----------

function _newRecorder() {
  const rec = {
    primitives: [],
    transform: [{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }], // identity, stack
    path: [],     // accumulated path subpaths since last beginPath
    cur: null,    // current pen position (in untransformed units)
  };
  return rec;
}

function _topT(rec) { return rec.transform[rec.transform.length - 1]; }

function _applyT(rec, x, y) {
  const t = _topT(rec);
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}

// Multiply current top-of-stack by [a,b,c,d,e,f].
function _multT(rec, a, b, c, d, e, f) {
  const t = _topT(rec);
  rec.transform[rec.transform.length - 1] = {
    a: t.a * a + t.c * b,
    b: t.b * a + t.d * b,
    c: t.a * c + t.c * d,
    d: t.b * c + t.d * d,
    e: t.a * e + t.c * f + t.e,
    f: t.b * e + t.d * f + t.f,
  };
}

function _emitLine(rec, x1, y1, x2, y2) {
  const a = _applyT(rec, x1, y1);
  const b = _applyT(rec, x2, y2);
  // Ignore zero-length edges (often produced when sampling a closed path).
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return;
  rec.primitives.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
}

function _emitRect(rec, x, y, w, h, r) {
  // Apply the current transform's translation; rotation/scale are passed as
  // identity in every appliance drawer we care about. If a future drawer
  // rotates a rect we'll fall back to its 4-corner polyline form.
  const t = _topT(rec);
  if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9 || Math.abs(t.a - t.d) > 1e-9) {
    // Rotated/skewed — emit as four lines.
    const corners = [
      _applyT(rec, x,     y),
      _applyT(rec, x + w, y),
      _applyT(rec, x + w, y + h),
      _applyT(rec, x,     y + h),
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      rec.primitives.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return;
  }
  const a = _applyT(rec, x,     y);
  const c = _applyT(rec, x + w, y + h);
  rec.primitives.push({
    type: "rect",
    x: Math.min(a.x, c.x), y: Math.min(a.y, c.y),
    w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y),
    r: r || 0,
  });
}

function _emitEllipseFull(rec, cx, cy, rx, ry) {
  const c = _applyT(rec, cx, cy);
  rec.primitives.push({ type: "circle", cx: c.x, cy: c.y, rx, ry });
}

function _samplePartialArc(rec, cx, cy, rx, ry, a0, a1, ccw, steps) {
  // Walk along the elliptical arc emitting line segments. Honors ccw: when
  // true the angle decreases; when false it increases. Canvas's full-arc
  // case is handled separately so we can emit a clean ellipse primitive.
  let span;
  if (ccw) {
    span = a0 - a1;
    while (span < 0) span += Math.PI * 2;
  } else {
    span = a1 - a0;
    while (span < 0) span += Math.PI * 2;
  }
  const n = Math.max(2, Math.ceil(steps * span / (Math.PI * 2)));
  const dir = ccw ? -1 : 1;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + dir * span * t;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    if (prev) _emitLine(rec, prev.x, prev.y, x, y);
    prev = { x, y };
  }
  return prev;
}

function _isFullCircle(a0, a1, ccw) {
  const span = ccw ? a0 - a1 : a1 - a0;
  return Math.abs(Math.abs(span) - Math.PI * 2) < 1e-6 || Math.abs(span) > Math.PI * 2 - 1e-3;
}

// Patched ctx methods. Each uses _activeRecorder() so they can also be
// installed as bound methods on the ctx object.
const recCtx = {
  // --- Properties: just absorb assignments. ---
  // Implemented via Object.defineProperty in installRecorder (canvas
  // properties aren't methods).

  // --- Transforms ---
  save() { const r = _activeRecorder(); r.transform.push({ ..._topT(r) }); },
  restore() { const r = _activeRecorder(); if (r.transform.length > 1) r.transform.pop(); },
  translate(x, y) { _multT(_activeRecorder(), 1, 0, 0, 1, x, y); },
  scale(sx, sy) { _multT(_activeRecorder(), sx, 0, 0, sy, 0, 0); },
  rotate(angle) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    _multT(_activeRecorder(), cs, sn, -sn, cs, 0, 0);
  },
  setTransform(a, b, c, d, e, f) {
    const r = _activeRecorder();
    r.transform[r.transform.length - 1] = { a, b, c, d, e, f };
  },
  resetTransform() {
    const r = _activeRecorder();
    r.transform[r.transform.length - 1] = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  },
  getTransform() {
    const r = _activeRecorder();
    return { ..._topT(r) };
  },

  // --- Path building ---
  beginPath() { const r = _activeRecorder(); r.path = []; r.cur = null; },
  moveTo(x, y) { const r = _activeRecorder(); r.cur = { x, y }; r.path.push({ kind: "move", x, y }); },
  lineTo(x, y) {
    const r = _activeRecorder();
    if (!r.cur) { r.cur = { x, y }; return; }
    r.path.push({ kind: "line", from: { ...r.cur }, to: { x, y } });
    r.cur = { x, y };
  },
  rect(x, y, w, h) {
    const r = _activeRecorder();
    r.path.push({ kind: "rect", x, y, w, h });
    r.cur = { x, y };
  },
  arc(cx, cy, radius, a0, a1, ccw) {
    const r = _activeRecorder();
    r.path.push({ kind: "ellipse", cx, cy, rx: radius, ry: radius, a0, a1, ccw: !!ccw });
    r.cur = { x: cx + radius * Math.cos(a1 || 0), y: cy + radius * Math.sin(a1 || 0) };
  },
  ellipse(cx, cy, rx, ry, rotation, a0, a1, ccw) {
    const r = _activeRecorder();
    // We don't track rotation on ellipses — none of the appliance drawers
    // pass a non-zero one. Note in the path entry so a future caller can
    // sample if needed.
    r.path.push({ kind: "ellipse", cx, cy, rx, ry, a0, a1, ccw: !!ccw, rotation: rotation || 0 });
    r.cur = { x: cx + rx * Math.cos(a1 || 0), y: cy + ry * Math.sin(a1 || 0) };
  },
  arcTo(x1, y1, x2, y2, radius) {
    // Approximate as two line segments (cur → x1 → x2). The corner-rounding
    // detail is lost; close enough for the kinds we're capturing.
    const r = _activeRecorder();
    if (r.cur) r.path.push({ kind: "line", from: { ...r.cur }, to: { x: x1, y: y1 } });
    r.path.push({ kind: "line", from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });
    r.cur = { x: x2, y: y2 };
  },
  quadraticCurveTo(cpx, cpy, x, y) {
    const r = _activeRecorder();
    if (!r.cur) { r.cur = { x, y }; return; }
    // Sample to a small polyline.
    const start = r.cur;
    const steps = 6;
    let prev = start;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const px = u * u * start.x + 2 * u * t * cpx + t * t * x;
      const py = u * u * start.y + 2 * u * t * cpy + t * t * y;
      r.path.push({ kind: "line", from: prev, to: { x: px, y: py } });
      prev = { x: px, y: py };
    }
    r.cur = { x, y };
  },
  bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    const r = _activeRecorder();
    if (!r.cur) { r.cur = { x, y }; return; }
    const start = r.cur;
    const steps = 8;
    let prev = start;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const px = u*u*u * start.x + 3*u*u*t * cp1x + 3*u*t*t * cp2x + t*t*t * x;
      const py = u*u*u * start.y + 3*u*u*t * cp1y + 3*u*t*t * cp2y + t*t*t * y;
      r.path.push({ kind: "line", from: prev, to: { x: px, y: py } });
      prev = { x: px, y: py };
    }
    r.cur = { x, y };
  },
  closePath() {
    const r = _activeRecorder();
    // Find the last move (start of current subpath) and emit a close line.
    let i;
    for (i = r.path.length - 1; i >= 0; i--) {
      if (r.path[i].kind === "move") break;
    }
    if (i >= 0 && r.cur) {
      const start = r.path[i];
      if (Math.hypot(start.x - r.cur.x, start.y - r.cur.y) > 1e-6) {
        r.path.push({ kind: "line", from: { ...r.cur }, to: { x: start.x, y: start.y } });
      }
    }
  },

  // --- Path emit ---
  stroke() { _emitPathToPrimitives(_activeRecorder()); },
  fill() { _emitPathToPrimitives(_activeRecorder()); },
  strokeRect(x, y, w, h) { _emitRect(_activeRecorder(), x, y, w, h, 0); },
  fillRect(x, y, w, h) { _emitRect(_activeRecorder(), x, y, w, h, 0); },
  clip() { /* no-op */ },

  // --- Text (skipped) ---
  fillText() { /* no-op */ },
  strokeText() { /* no-op */ },
  measureText() { return { width: 0 }; },

  // --- Style sinks (called on the proxy so don't need to no-op explicitly,
  // but listed here for clarity in installRecorder). ---
  setLineDash() { /* style only */ },
};

function _emitPathToPrimitives(rec) {
  // Walk the path's entries. Bunch consecutive lines into a polyline; emit
  // ellipse / rect entries directly. The recorder collapses nothing for
  // performance — every line entry becomes a primitive line.
  for (const seg of rec.path) {
    if (seg.kind === "line") {
      _emitLine(rec, seg.from.x, seg.from.y, seg.to.x, seg.to.y);
    } else if (seg.kind === "rect") {
      _emitRect(rec, seg.x, seg.y, seg.w, seg.h, 0);
    } else if (seg.kind === "ellipse") {
      if (_isFullCircle(seg.a0, seg.a1, seg.ccw)) {
        _emitEllipseFull(rec, seg.cx, seg.cy, seg.rx, seg.ry);
      } else {
        _samplePartialArc(rec, seg.cx, seg.cy, seg.rx, seg.ry, seg.a0, seg.a1, seg.ccw, APPLIANCE_RECORDER_ARC_STEPS);
      }
    }
  }
  rec.path = [];
  rec.cur = null;
}

// ---------- Install / uninstall ----------

const RECORDED_METHODS = [
  "save", "restore", "translate", "rotate", "scale", "setTransform", "resetTransform", "getTransform",
  "beginPath", "moveTo", "lineTo", "rect", "arc", "ellipse", "arcTo", "closePath",
  "quadraticCurveTo", "bezierCurveTo",
  "stroke", "fill", "strokeRect", "fillRect", "clip",
  "fillText", "strokeText", "measureText",
  "setLineDash",
];

function _installRecorder(rec) {
  const orig = {};
  for (const m of RECORDED_METHODS) {
    orig[m] = ctx[m];
    if (typeof recCtx[m] === "function") {
      ctx[m] = recCtx[m];
    } else {
      ctx[m] = () => {};
    }
  }
  // strokeRoundedRect and drawDrain are top-level functions defined in
  // canvas-view.js / appliance.js. Hijacking them gives us cleaner output
  // (a rect primitive with corner radius, and the drain's circle + cross)
  // than letting them play out as raw quadraticCurveTo / arc calls.
  const origStrokeRoundedRect = strokeRoundedRect;
  // eslint-disable-next-line no-global-assign
  strokeRoundedRect = function(x, y, w, h, r) { _emitRect(rec, x, y, w, h, r); };
  let origDrawDrain = null;
  if (typeof drawDrain === "function") {
    origDrawDrain = drawDrain;
    // eslint-disable-next-line no-global-assign
    drawDrain = function(cx, cy, r) {
      _emitEllipseFull(rec, cx, cy, r, r);
      _emitLine(rec, cx - r, cy, cx + r, cy);
      _emitLine(rec, cx, cy - r, cx, cy + r);
    };
  }
  _ctxRecorderState = { rec, orig, origStrokeRoundedRect, origDrawDrain };
}

function _uninstallRecorder() {
  if (!_ctxRecorderState) return;
  const { orig, origStrokeRoundedRect, origDrawDrain } = _ctxRecorderState;
  for (const m of RECORDED_METHODS) ctx[m] = orig[m];
  // eslint-disable-next-line no-global-assign
  strokeRoundedRect = origStrokeRoundedRect;
  if (origDrawDrain) {
    // eslint-disable-next-line no-global-assign
    drawDrain = origDrawDrain;
  }
  _ctxRecorderState = null;
}

// ---------- Public entry point ----------

// Capture the procedural drawing for a built-in `kind` at (width, depth) feet
// and return an array of primitives in the builder's format (origin = piece
// center, units = feet). Returns null when something the recorder can't
// represent throws — caller falls back to "open empty builder."
function captureBuiltinAsPrimitives(kind, width, depth) {
  if (typeof drawApplianceShape !== "function") return null;
  const rec = _newRecorder();
  try {
    _installRecorder(rec);

    // Mirror the dispatch in drawApplianceShape, but operating directly in
    // feet: wPx = width, dPx = depth, no world-to-screen translate.
    if (typeof SUPPRESS_OUTLINE_KINDS !== "undefined" && !SUPPRESS_OUTLINE_KINDS.has(kind)) {
      ctx.beginPath();
      ctx.rect(-width / 2, -depth / 2, width, depth);
      ctx.stroke();
    }

    const c = "#000";
    const wPx = width, dPx = depth;
    if (kind === "range" || kind === "cooktop") {
      const r = Math.min(wPx, dPx) * 0.13;
      const offX = wPx * 0.22, offY = dPx * 0.22;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.beginPath(); ctx.arc(sx * offX, sy * offY, r, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (kind === "oven") {
      ctx.strokeRect(-wPx * 0.35, -dPx * 0.3, wPx * 0.7, dPx * 0.6);
      ctx.beginPath(); ctx.moveTo(-wPx * 0.35, -dPx * 0.4); ctx.lineTo(wPx * 0.35, -dPx * 0.4); ctx.stroke();
    } else if (kind === "fridge") {
      ctx.beginPath(); ctx.moveTo(-wPx / 2, dPx * 0.35); ctx.lineTo(wPx / 2, dPx * 0.35); ctx.stroke();
    } else if (kind === "dishwasher") {
      ctx.strokeRect(-wPx * 0.42, -dPx * 0.38, wPx * 0.84, dPx * 0.76);
    } else if (kind === "sink") {
      ctx.strokeRect(-wPx * 0.42, -dPx * 0.38, wPx * 0.84, dPx * 0.76);
      ctx.beginPath(); ctx.arc(0, 0, Math.min(wPx, dPx) * 0.06, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === "sink-double") {
      ctx.strokeRect(-wPx * 0.46, -dPx * 0.38, wPx * 0.42, dPx * 0.76);
      ctx.strokeRect( wPx * 0.04, -dPx * 0.38, wPx * 0.42, dPx * 0.76);
    } else if (kind === "microwave") {
      ctx.strokeRect(-wPx * 0.35, -dPx * 0.3, wPx * 0.5, dPx * 0.6);
    } else if (kind === "armchair") {
      drawApplianceForCapture_callOriginal(kind, wPx, dPx, c);
    } else {
      // For everything else, call the matching interior drawer directly.
      // Look up the function by kind. Drawers are top-level in appliance.js
      // and visible in this lexical environment.
      const map = {
        "island":         () => typeof drawIslandInterior === "function" && drawIslandInterior({}, null, wPx, dPx),
        "loveseat":       () => typeof drawSofaInterior === "function" && drawSofaInterior(null, wPx, dPx, 2),
        "sofa":           () => typeof drawSofaInterior === "function" && drawSofaInterior(null, wPx, dPx, 3),
        "sectional":      () => typeof drawSectionalInterior === "function" && drawSectionalInterior(null, wPx, dPx),
        "media-console":  () => typeof drawCaseGoodsInterior === "function" && drawCaseGoodsInterior(null, wPx, dPx, "media-console"),
        "dresser":        () => typeof drawCaseGoodsInterior === "function" && drawCaseGoodsInterior(null, wPx, dPx, "dresser"),
        "wardrobe":       () => typeof drawCaseGoodsInterior === "function" && drawCaseGoodsInterior(null, wPx, dPx, "wardrobe"),
        "toilet":         () => drawToiletInterior(c, wPx, dPx, "toilet"),
        "toilet-round":   () => drawToiletInterior(c, wPx, dPx, "toilet-round"),
        "toilet-wall":    () => drawToiletInterior(c, wPx, dPx, "toilet-wall"),
        "bidet":          () => drawBidetInterior(c, wPx, dPx),
        "urinal":         () => drawUrinalInterior(c, wPx, dPx),
        "lav-pedestal":   () => drawPedestalSinkInterior(c, wPx, dPx),
        "vanity":         () => drawVanityInterior(c, wPx, dPx, "vanity"),
        "vanity-double":  () => drawVanityInterior(c, wPx, dPx, "vanity-double"),
        "tub-alcove":     () => drawAlcoveTubInterior(c, wPx, dPx, "tub-alcove"),
        "tub-shower":     () => drawAlcoveTubInterior(c, wPx, dPx, "tub-shower"),
        "tub-soaker":     () => drawSoakerTubInterior(c, wPx, dPx),
        "tub-freestand":  () => drawFreestandTubInterior(c, wPx, dPx),
        "tub-corner":     () => drawCornerTubInterior(c, wPx, dPx),
        "shower":         () => drawShowerInterior(c, wPx, dPx),
        "shower-corner":  () => drawCornerShowerInterior(c, wPx, dPx),
        "washer":         () => drawWasherDryerInterior(c, wPx, dPx, "washer"),
        "dryer":          () => drawWasherDryerInterior(c, wPx, dPx, "dryer"),
      };
      const fn = map[kind];
      if (fn) fn();
    }
  } catch (err) {
    console.warn("[builtin-edit] capture failed for", kind, err);
    _uninstallRecorder();
    return null;
  }
  _uninstallRecorder();
  return rec.primitives;
}

// Catch-all path: for kinds that don't have a clean entry in the table
// above, run the actual drawApplianceShape with a fake state. Currently
// unused — the table above covers every kind in PALETTE_ITEMS. Left here
// as a documented fallback if a future kind shows up.
function drawApplianceForCapture_callOriginal(kind, wPx, dPx, c) { /* placeholder */ }
