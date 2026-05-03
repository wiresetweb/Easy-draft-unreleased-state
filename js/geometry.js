'use strict';

// ==============================================================================
// Geometry — coordinates, snap, feet parse/format, curves, axes, distances
// ==============================================================================

// Screen↔world transforms and snap helpers
function effectiveScale() { return PX_PER_FOOT * state.zoom; }
function screenToWorld(sx, sy) {
  const s = effectiveScale();
  return { x: (sx - state.pan.x) / s, y: (sy - state.pan.y) / s };
}
function worldToScreen(wx, wy) {
  const s = effectiveScale();
  return { x: wx * s + state.pan.x, y: wy * s + state.pan.y };
}
// Universal placement snap. Every node the user drops — line endpoints,
// box corners, stair starts, cabinet builder points, text anchors, doors
// and windows — lands on a half-foot increment of the grid (or whatever
// half of the user's current gridSize is). Half-grid is the same step
// arrow-key nudges use (snapDelta), so what the user places stays on a
// position they can later nudge back to without breaking alignment.
function snapWorld(p) {
  if (!state.snap) return p;
  const g = state.gridSize / 2;
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}
// Alias kept around for self-documenting call sites that explicitly want
// the "half-grid" semantics (doors, windows, furniture, cabinet builder).
// Functionally identical to snapWorld now that the universal snap is half.
function snapWorldHalf(p) {
  return snapWorld(p);
}
function snapDelta(dx, dy) {
  if (!state.snap) return { dx, dy };
  // Half-grid steps so a piece that was dropped on a half-grid position (the
  // way doors / windows / furniture land — center of a square or on a line)
  // can be nudged in the same increments it was placed at, instead of being
  // locked to whole-square jumps.
  const g = state.gridSize / 2;
  return { dx: Math.round(dx / g) * g, dy: Math.round(dy / g) * g };
}

// Returns world-space corners of any shape that has a meaningful "footprint"
// for snapping purposes — every place a tape measure could reasonably anchor.
// `sub` is optional; some shapes (cabinets) need it to filter same-story
// appliance cuts.
function shapeSnapCorners(sh, sub) {
  return SHAPES[sh.type]?.snapCorners?.(sh, sub) ?? [];
}

// Nearest snap-worthy corner of any visible shape, with tolerance in screen
// pixels so the magnet feels consistent across zoom. Returns {x, y} in world
// units or null.
function findNearestEndpoint(worldPos) {
  const scale = effectiveScale();
  const tolPx = 12;
  const tolWorld = tolPx / scale;
  let best = null;
  forEachVisibleShape((sh, sub) => {
    for (const c of shapeSnapCorners(sh, sub)) {
      const d = Math.hypot(worldPos.x - c.x, worldPos.y - c.y);
      if (d > tolWorld) continue;
      if (!best || d < best.d) best = { d, x: c.x, y: c.y };
    }
  });
  return best ? { x: best.x, y: best.y } : null;
}

// For the measure tool: prefer endpoint snap over grid snap so users can
// measure precisely between a wall and the edge of an opening.
function snapMeasurePoint(worldPos) {
  const ep = findNearestEndpoint(worldPos);
  if (ep) return ep;
  return snapWorld(worldPos);
}

// Format / parse dimensions. Both functions dispatch on state.units so the
// rest of the codebase keeps storing values in feet (the internal world unit)
// and never has to know whether the visible UI is imperial or metric.

function formatFeet(ft) {
  if (state.units === "metric") return formatFeetMetric(ft);
  return formatFeetImperial(ft);
}

// e.g. 3.5 ft → 3'-6"
function formatFeetImperial(ft) {
  const sign = ft < 0 ? "-" : "";
  const abs = Math.abs(ft);
  const totalQuarters = Math.round(abs * 48);
  const inches = totalQuarters / 4;
  const wholeFt = Math.trunc(inches / 12);
  const remIn = inches - wholeFt * 12;
  const wholeIn = Math.trunc(remIn);
  const frac = Math.min(3, Math.max(0, Math.round((remIn - wholeIn) * 4)));
  const fractionStr = ["", "¼", "½", "¾"][frac];

  if (wholeFt === 0 && wholeIn === 0 && frac === 0) return '0"';
  let result = "";
  if (wholeFt !== 0) result += `${wholeFt}'`;
  if (wholeIn !== 0 || frac !== 0) {
    if (wholeFt !== 0) result += "-";
    if (wholeIn !== 0) result += `${wholeIn}`;
    if (frac !== 0) {
      if (wholeIn !== 0) result += " ";
      result += fractionStr;
    }
    result += '"';
  }
  return sign + result;
}

// e.g. 3.5 ft → 1067 mm; 30 ft → 9.14 m. Cutover at 1 m matches what residential
// architectural plans tend to do — small dimensions in mm, room-sized in m.
function formatFeetMetric(ft) {
  const sign = ft < 0 ? "-" : "";
  const mm = Math.abs(ft) * FT_TO_MM;
  if (mm < 1000) return sign + Math.round(mm) + " mm";
  const m = mm / 1000;
  // Round to 2 decimals; strip trailing zeros so "1.50 m" reads as "1.5 m".
  const text = m.toFixed(2).replace(/\.?0+$/, "");
  return sign + text + " m";
}

// Accepts a wide set of formats so the user can type whatever feels natural.
//
//   Imperial: 3 | 3.5 | 3' | 3 ft | 3'-6" | 3' 6" | 3'-6 1/2" | 36" | 36 in | 1/2"
//             — bare numbers are FEET (matches the input on the canvas).
//
//   Metric:   100 | 100mm | 100 mm | 0.1m | 0.1 m | 10cm | 10 cm
//             — bare numbers are MILLIMETERS (matches what shows up on a
//             metric set: dimensions on plans are in mm by convention).
//
// Both modes return a value in feet (the internal world unit).
function parseFeet(str) {
  if (state.units === "metric") return parseFeetMetric(str);
  return parseFeetImperial(str);
}

function parseFeetImperial(str) {
  if (typeof str !== "string") return null;
  let s = str.trim();
  if (!s) return null;
  s = s.replace(/[¼½¾]/g, (m) => ({ "¼": " 1/4", "½": " 1/2", "¾": " 3/4" }[m]));

  let feet = 0;
  let inches = 0;
  let foundFt = false;
  let foundIn = false;

  let m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b)/i);
  if (m) {
    feet = parseFloat(m[1]);
    foundFt = true;
    s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/^[\s\-,–]+/, "").trim();
  }

  m = s.match(/(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)\s*(?:"|in\b|inch(?:es)?\b)?/i);
  if (m) {
    inches = parseFloat(m[1]) + parseInt(m[2]) / parseInt(m[3]);
    foundIn = true;
    s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  } else {
    m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:"|in\b|inch(?:es)?\b)/i);
    if (m) {
      inches = parseFloat(m[1]);
      foundIn = true;
      s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
    } else {
      m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:"|in\b)/i);
      if (m) {
        inches = parseInt(m[1]) / parseInt(m[2]);
        foundIn = true;
        s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
      }
    }
  }

  if (!foundFt && !foundIn) {
    m = s.trim().match(/^-?\d+(?:\.\d+)?$/);
    if (m) { feet = parseFloat(m[0]); foundFt = true; }
  }

  if (!foundFt && !foundIn) return null;
  return feet + inches / 12;
}

function parseFeetMetric(str) {
  if (typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;

  // Explicit unit suffixes win. Order matters: check `mm` before `m` so we
  // don't strip the `m` from `mm` and misread the rest.
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*mm$/i))) {
    return parseFloat(m[1]) * MM_TO_FT;
  }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*cm$/i))) {
    return parseFloat(m[1]) * 10 * MM_TO_FT;
  }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*m$/i))) {
    return parseFloat(m[1]) * 1000 * MM_TO_FT;
  }

  // Bare number — millimeters by convention.
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)$/))) {
    return parseFloat(m[1]) * MM_TO_FT;
  }
  return null;
}

// Curve geometry (quadratic Bezier) + point-distance helpers
function bezierControl(sh) {
  return {
    x: 2 * sh.mx - 0.5 * (sh.x1 + sh.x2),
    y: 2 * sh.my - 0.5 * (sh.y1 + sh.y2),
  };
}

function sampleArcPoints(sh, segmentsHint) {
  const ax = sh.x1, ay = sh.y1;
  const bx = sh.x2, by = sh.y2;
  const mxv = sh.mx, myv = sh.my;

  const cross = (mxv - ax) * (by - ay) - (myv - ay) * (bx - ax);
  if (Math.abs(cross) < 1e-9) {
    return [{ x: ax, y: ay }, { x: bx, y: by }];
  }

  const Q = bezierControl(sh);
  const segs = segmentsHint || 32;
  const pts = new Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const u = 1 - t;
    pts[i] = {
      x: u * u * ax + 2 * u * t * Q.x + t * t * bx,
      y: u * u * ay + 2 * u * t * Q.y + t * t * by,
    };
  }
  return pts;
}

// Bbox extrema of a quadratic Bezier — analytic, exact.
function arcBBoxPoints(sh) {
  const ax = sh.x1, ay = sh.y1;
  const bx = sh.x2, by = sh.y2;
  const Q = bezierControl(sh);
  const xs = [ax, bx];
  const ys = [ay, by];

  const denomX = ax - 2 * Q.x + bx;
  if (Math.abs(denomX) > 1e-9) {
    const tx = (ax - Q.x) / denomX;
    if (tx > 0 && tx < 1) {
      const u = 1 - tx;
      xs.push(u * u * ax + 2 * u * tx * Q.x + tx * tx * bx);
    }
  }
  const denomY = ay - 2 * Q.y + by;
  if (Math.abs(denomY) > 1e-9) {
    const ty = (ay - Q.y) / denomY;
    if (ty > 0 && ty < 1) {
      const u = 1 - ty;
      ys.push(u * u * ay + 2 * u * ty * Q.y + ty * ty * by);
    }
  }
  return { xs, ys };
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointToArcDist(px, py, sh) {
  const samples = sampleArcPoints(sh, 32);
  let minD = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    const d = pointToSegmentDist(
      px, py,
      samples[i].x, samples[i].y,
      samples[i + 1].x, samples[i + 1].y
    );
    if (d < minD) minD = d;
  }
  return minD;
}

function pointToRectDist(px, py, x1, y1, x2, y2) {
  const cx = Math.max(x1, Math.min(px, x2));
  const cy = Math.max(y1, Math.min(py, y2));
  return Math.hypot(px - cx, py - cy);
}

// Door / window axes
function doorAxes(sh) {
  const u = { x: Math.cos(sh.angle), y: Math.sin(sh.angle) };
  const sgn = sh.swing >= 0 ? 1 : -1;
  const n = { x: -u.y * sgn, y: u.x * sgn };
  return { u, n };
}

function windowAxes(sh) {
  const u = { x: Math.cos(sh.angle), y: Math.sin(sh.angle) };
  const n = { x: -u.y, y: u.x };
  return { u, n };
}
