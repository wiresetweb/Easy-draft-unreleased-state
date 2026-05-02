'use strict';

// Cabinet rendering — drawCabinetShape + the polyline / appliance-cut helpers
// used by the cabinet builder preview as well.

// ---------- Cabinet rendering ----------
// Compute the offset polyline for a cabinet path. Each interior node uses the
// intersection of adjacent offset lines so corners miter cleanly.
function offsetPolyline(points, depth, side) {
  const n = points.length;
  if (n < 2) return [];
  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    segs.push({ ux, uy, nx: -uy * side, ny: ux * side });
  }
  if (segs.length === 0) return [];

  const out = [];
  out.push({
    x: points[0].x + segs[0].nx * depth,
    y: points[0].y + segs[0].ny * depth,
  });
  for (let i = 1; i < n - 1; i++) {
    const s1 = segs[i - 1] || segs[0];
    const s2 = segs[i] || segs[segs.length - 1];
    const a1 = { x: points[i].x + s1.nx * depth, y: points[i].y + s1.ny * depth };
    const a2 = { x: points[i].x + s2.nx * depth, y: points[i].y + s2.ny * depth };
    const cross = s1.ux * s2.uy - s1.uy * s2.ux;
    if (Math.abs(cross) < 1e-9) {
      out.push(a1);
    } else {
      const t = ((a2.x - a1.x) * s2.uy - (a2.y - a1.y) * s2.ux) / cross;
      out.push({ x: a1.x + t * s1.ux, y: a1.y + t * s1.uy });
    }
  }
  const last = segs[segs.length - 1];
  out.push({
    x: points[n - 1].x + last.nx * depth,
    y: points[n - 1].y + last.ny * depth,
  });
  return out;
}

// Each cabinet segment is potentially split by overlapping appliances. This
// returns the visible parametric sub-ranges along [0, 1] for one segment.
function cabinetSegmentVisibleRanges(p1, p2, depth, side, applianceCuts) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const ux = dx / len, uy = dy / len;
  const nx = -uy * side, ny = ux * side;

  const cuts = []; // [{t1, t2}] in [0,1]
  for (const corners of applianceCuts) {
    // Project each appliance corner onto the segment axes (along u and along n).
    let tMin = Infinity, tMax = -Infinity;
    let nMin = Infinity, nMax = -Infinity;
    for (const c of corners) {
      const lx = c.x - p1.x, ly = c.y - p1.y;
      const tProj = (lx * ux + ly * uy) / len; // parametric along segment
      const nProj = lx * nx + ly * ny;          // perpendicular (positive = depth side)
      if (tProj < tMin) tMin = tProj;
      if (tProj > tMax) tMax = tProj;
      if (nProj < nMin) nMin = nProj;
      if (nProj > nMax) nMax = nProj;
    }
    // Appliance must overlap the cabinet's depth band [0, depth] and the segment range.
    if (nMax < 0.05 || nMin > depth - 0.05) continue;
    const t1 = Math.max(0, Math.min(1, tMin));
    const t2 = Math.max(0, Math.min(1, tMax));
    if (t2 - t1 > 1e-6) cuts.push({ t1, t2 });
  }

  if (cuts.length === 0) return [{ t1: 0, t2: 1 }];

  // Merge overlapping cut ranges
  cuts.sort((a, b) => a.t1 - b.t1);
  const merged = [cuts[0]];
  for (let i = 1; i < cuts.length; i++) {
    const tail = merged[merged.length - 1];
    if (cuts[i].t1 <= tail.t2 + 1e-6) tail.t2 = Math.max(tail.t2, cuts[i].t2);
    else merged.push(cuts[i]);
  }

  // Invert: visible = [0,1] minus merged cuts
  const visible = [];
  let cursor = 0;
  for (const c of merged) {
    if (c.t1 > cursor + 1e-6) visible.push({ t1: cursor, t2: c.t1 });
    cursor = Math.max(cursor, c.t2);
  }
  if (cursor < 1 - 1e-6) visible.push({ t1: cursor, t2: 1 });
  return visible;
}

// Appliances that sit ON the counter (drop-in from above) or UNDER it (with
// the counter flowing over the top), rather than physically interrupting the
// cabinet run. Sinks drop in, microwaves sit on the surface, dishwashers tuck
// under — none of them break the cabinet line. Only ranges, cooktops, ovens,
// and refrigerators (and freestanding pieces like islands) actually carve a
// gap through the run, so everything not in this list still cuts.
const CABINET_NON_CUTTING_KINDS = new Set([
  "sink", "sink-double", "dishwasher", "microwave",
]);

// Collect appliance corner sets (in world coords) that may overlap a cabinet
// shape — looks up appliances on the same story. Used both for live preview
// (where shape is the in-progress builder) and for committed cabinet shapes.
function applianceCornersOnSameStory(layerId) {
  const out = [];
  for (const story of state.stories) {
    if (!story.visible) continue;
    const owns = story.sublayers.some((l) => l.id === layerId);
    if (!owns) continue;
    for (const sub of story.sublayers) {
      if (!sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh.type !== "appliance") continue;
        if (CABINET_NON_CUTTING_KINDS.has(sh.kind)) continue;
        out.push(applianceCorners(sh));
      }
    }
    break;
  }
  return out;
}

function drawCabinetShape(sh, color, sub) {
  drawCabinetPath(sh.points, sh.depth, sh.side, color, 1.0, sub && sub.id);
}

// All thick walls on the same story as `layerId` — used to slide cabinet path
// points off centerlines and onto the room-side face when the cabinet is
// running along a wall.
function wallsOnSameStory(layerId) {
  const out = [];
  for (const story of state.stories) {
    if (!story.visible) continue;
    const owns = story.sublayers.some((l) => l.id === layerId);
    if (!owns) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh.type === "line" && sh.thickness > 0) out.push(sh);
      }
    }
    break;
  }
  return out;
}

function findThickWallsAtPoint(walls, x, y) {
  const tol = 1e-3;
  const out = [];
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    const t = ((x - w.x1) * dx + (y - w.y1) * dy) / len2;
    if (t < -1e-3 || t > 1 + 1e-3) continue;
    const px = w.x1 + dx * t, py = w.y1 + dy * t;
    if (Math.hypot(x - px, y - py) > tol) continue;
    out.push(w);
  }
  return out;
}

// Push a cabinet path point onto the room-side face of any thick wall passing
// through it. With one wall, project perpendicular by thickness/2; with two
// walls (L-corner), intersect their inner-face lines so the cabinet wraps the
// inner corner of the room cleanly.
function adjustPathPointForWalls(walls, p, sideDirX, sideDirY) {
  const found = findThickWallsAtPoint(walls, p.x, p.y);
  if (found.length === 0) return { x: p.x, y: p.y };

  const wallFace = (w) => {
    const wdx = w.x2 - w.x1, wdy = w.y2 - w.y1;
    const wlen = Math.hypot(wdx, wdy);
    if (wlen < 1e-9) return null;
    const ux = wdx / wlen, uy = wdy / wlen;
    const nx = -uy, ny = ux;
    // Sign points from centerline toward the cabinet's side.
    const dot = nx * sideDirX + ny * sideDirY;
    const sign = dot >= 0 ? 1 : -1;
    return {
      facePx: p.x + nx * sign * (w.thickness / 2),
      facePy: p.y + ny * sign * (w.thickness / 2),
      ux, uy,
    };
  };

  if (found.length === 1) {
    const f = wallFace(found[0]);
    return f ? { x: f.facePx, y: f.facePy } : { x: p.x, y: p.y };
  }

  // Two-or-more walls: intersect the inner-face lines of the first two so the
  // path point lands at the inner corner of the room.
  const fA = wallFace(found[0]);
  const fB = wallFace(found[1]);
  if (!fA || !fB) return { x: p.x, y: p.y };
  const cross = fA.ux * fB.uy - fA.uy * fB.ux;
  if (Math.abs(cross) < 1e-9) {
    // Walls are parallel (rare for an "L" — fall back to one face).
    return { x: fA.facePx, y: fA.facePy };
  }
  const t = ((fB.facePx - fA.facePx) * fB.uy - (fB.facePy - fA.facePy) * fB.ux) / cross;
  return {
    x: fA.facePx + fA.ux * t,
    y: fA.facePy + fA.uy * t,
  };
}

// Walk a cabinet path and slide each point onto the inner face of any wall it
// sits on. The cabinet's `side` decides which side of the path the body
// extends; we offset perpendicular to that side so the back of the cabinet
// ends up flush with the wall instead of half-buried in it.
function wallAdjustedCabinetPath(points, side, layerId) {
  if (!Array.isArray(points) || points.length < 1) return points;
  const walls = wallsOnSameStory(layerId);
  if (walls.length === 0) return points.map((p) => ({ x: p.x, y: p.y }));

  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Average unit-vectors of the prev and next segments so corner points get
    // a bisector-style perpendicular.
    let dx = 0, dy = 0;
    if (i > 0) {
      const ddx = p.x - points[i - 1].x;
      const ddy = p.y - points[i - 1].y;
      const len = Math.hypot(ddx, ddy);
      if (len > 1e-9) { dx += ddx / len; dy += ddy / len; }
    }
    if (i < points.length - 1) {
      const ddx = points[i + 1].x - p.x;
      const ddy = points[i + 1].y - p.y;
      const len = Math.hypot(ddx, ddy);
      if (len > 1e-9) { dx += ddx / len; dy += ddy / len; }
    }
    const dlen = Math.hypot(dx, dy);
    if (dlen < 1e-9) { out.push({ x: p.x, y: p.y }); continue; }
    const sideDirX = (-dy / dlen) * side;
    const sideDirY = ( dx / dlen) * side;
    out.push(adjustPathPointForWalls(walls, p, sideDirX, sideDirY));
  }
  return out;
}

// Draws a cabinet path (committed or in-progress). Splits the run around
// appliance footprints so the counter visually wraps around them.
function drawCabinetPath(points, depth, side, color, alpha, layerIdHint) {
  if (points.length < 2) return;
  const c = color || SHAPE_COLOR;
  const layerId = layerIdHint || (activeSublayer() && activeSublayer().id);
  const cuts = applianceCornersOnSameStory(layerId);
  // Slide path points off wall centerlines onto room-side faces so the
  // cabinet sits flush with the wall instead of half-buried in it.
  const drawPoints = wallAdjustedCabinetPath(points, side, layerId);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const offsetPts = offsetPolyline(drawPoints, depth, side);

  for (let i = 0; i < drawPoints.length - 1; i++) {
    const a = drawPoints[i], b = drawPoints[i + 1];
    const aOff = offsetPts[i] || a;
    const bOff = offsetPts[i + 1] || b;
    const visible = cabinetSegmentVisibleRanges(a, b, depth, side, cuts);

    // Perpendicular offset for this segment — used at appliance cuts so the
    // cut edges meet the cabinet at 90°. Mitered offsets are only valid at the
    // segment's true endpoints; using them at intermediate t values angles the
    // cut along the corner bisector instead.
    const segDx = b.x - a.x, segDy = b.y - a.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    const nx = (-segDy / segLen) * side;
    const ny = ( segDx / segLen) * side;

    for (const { t1, t2 } of visible) {
      const ax = a.x + (b.x - a.x) * t1;
      const ay = a.y + (b.y - a.y) * t1;
      const bx = a.x + (b.x - a.x) * t2;
      const by = a.y + (b.y - a.y) * t2;

      const startAtSegStart = t1 < 1e-6;
      const endAtSegEnd = t2 > 1 - 1e-6;
      const aoX = startAtSegStart ? aOff.x : (ax + nx * depth);
      const aoY = startAtSegStart ? aOff.y : (ay + ny * depth);
      const boX = endAtSegEnd ? bOff.x : (bx + nx * depth);
      const boY = endAtSegEnd ? bOff.y : (by + ny * depth);

      const A  = worldToScreen(ax, ay);
      const B  = worldToScreen(bx, by);
      const Ao = worldToScreen(aoX, aoY);
      const Bo = worldToScreen(boX, boY);

      // Closed polygon for this visible chunk
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(Bo.x, Bo.y);
      ctx.lineTo(Ao.x, Ao.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.restore();
}
