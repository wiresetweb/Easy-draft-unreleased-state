'use strict';

// ===========================================================================
// Shape registry
// ===========================================================================
// One entry per shape type. Adding a new shape type means adding one entry
// here (and a draw helper above). Dispatch sites — drawShape, shapeBBox,
// findShapeAtScreen, snapshotSelected, applyMove, applyRotate, applyResize,
// duplicateSelected, ensureTransformHistory, etc. — all route through this
// table instead of long if/else chains on sh.type.
//
// API per entry:
//   draw(sh, color, sub?)         render shape
//   bbox(sh)                      → { x1, y1, x2, y2 } in world units
//   hitDistance(sh, wp)           → world distance from wp; smaller = closer
//   snapCorners(sh)               → Array<{x,y}>; [] if none
//   capture(sh)                   → snapshot for transform start
//   restore(sh, o)                undo: copy snapshot back into sh
//   move(sh, o, dx, dy)           apply move using captured snapshot
//   rotate(sh, o, rot, dAngle)    apply rotate; rot(x,y)→{x,y}
//   resize(sh, o, anchor, sx, sy) apply scale (omit method = fixed-size)
//   duplicate(copy, sh, offset)   write offset positions into copy
//   cloneExtra(c, sh)?            extra deep-clone for composite types
//   selectionBg                   "bbox" | "path" | "line"
//   isOpening                     boolean | (sh)=>boolean — locks resize
// ===========================================================================

// Shared helpers — endpoint shapes (line, measure; arc extends them).
function endpointBBox(sh) {
  return {
    x1: Math.min(sh.x1, sh.x2),
    y1: Math.min(sh.y1, sh.y2),
    x2: Math.max(sh.x1, sh.x2),
    y2: Math.max(sh.y1, sh.y2),
  };
}
function endpointCapture(sh) {
  return { x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2 };
}
function endpointRestore(sh, o) {
  sh.x1 = o.x1; sh.y1 = o.y1; sh.x2 = o.x2; sh.y2 = o.y2;
}
function endpointMove(sh, o, dx, dy) {
  sh.x1 = o.x1 + dx; sh.y1 = o.y1 + dy;
  sh.x2 = o.x2 + dx; sh.y2 = o.y2 + dy;
}
function endpointRotate(sh, o, rot) {
  const p1 = rot(o.x1, o.y1), p2 = rot(o.x2, o.y2);
  sh.x1 = p1.x; sh.y1 = p1.y;
  sh.x2 = p2.x; sh.y2 = p2.y;
}
function endpointResize(sh, o, anchor, sx, sy) {
  sh.x1 = anchor.x + (o.x1 - anchor.x) * sx;
  sh.y1 = anchor.y + (o.y1 - anchor.y) * sy;
  sh.x2 = anchor.x + (o.x2 - anchor.x) * sx;
  sh.y2 = anchor.y + (o.y2 - anchor.y) * sy;
}
function endpointDuplicate(copy, sh, offset) {
  copy.x1 = sh.x1 + offset; copy.y1 = sh.y1 + offset;
  copy.x2 = sh.x2 + offset; copy.y2 = sh.y2 + offset;
}
function endpointEndpoints(sh) {
  return [{ x: sh.x1, y: sh.y1 }, { x: sh.x2, y: sh.y2 }];
}

// Shared helpers — anchor shapes (door, window, text, appliance).
function anchorCapture(sh) {
  return { x: sh.x, y: sh.y, angle: sh.angle || 0 };
}
function anchorRestore(sh, o) {
  sh.x = o.x; sh.y = o.y; sh.angle = o.angle;
}
function anchorMove(sh, o, dx, dy) {
  sh.x = o.x + dx; sh.y = o.y + dy;
}
function anchorRotate(sh, o, rot, dAngle) {
  const p = rot(o.x, o.y);
  sh.x = p.x; sh.y = p.y;
  sh.angle = (o.angle || 0) + dAngle;
}
function anchorDuplicate(copy, sh, offset) {
  copy.x = sh.x + offset; copy.y = sh.y + offset;
}

function bboxFromXsYs(xs, ys) {
  return {
    x1: Math.min(...xs), y1: Math.min(...ys),
    x2: Math.max(...xs), y2: Math.max(...ys),
  };
}
function bboxFromPoints(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return bboxFromXsYs(xs, ys);
}
function bboxFromShape(sh) {
  return SHAPES[sh.type].bbox(sh);
}
function hitDistanceFromBBox(sh, wp) {
  const b = bboxFromShape(sh);
  return pointToRectDist(wp.x, wp.y, b.x1, b.y1, b.x2, b.y2);
}

// Kinds that are spec'd from the catalog (a "30-inch range" really is 30"
// wide). Resizing them mid-drawing is more often a slip than an intent, so we
// keep them fixed and force the user to swap the catalog item.
const FIXED_APPLIANCE_KINDS = new Set([
  "range", "cooktop", "oven", "fridge", "dishwasher",
  "sink", "sink-double", "microwave", "cabinet",
  // Bathroom fixtures — sized to manufacturer spec sheets, so users swap the
  // catalog item rather than resizing in-place.
  "toilet", "toilet-round", "toilet-wall", "bidet", "urinal",
  "lav-pedestal", "vanity", "vanity-double",
  "tub-alcove", "tub-shower", "tub-soaker", "tub-freestand", "tub-corner",
  "shower", "shower-corner",
  "washer", "dryer",
]);
function applianceResizable(sh) {
  return !FIXED_APPLIANCE_KINDS.has(sh.kind);
}

// Per-shape helpers that are too large to inline in the registry literal.
function bboxDoor(sh) {
  const { u, n } = doorAxes(sh);
  const w = sh.width;
  const Hx = sh.x, Hy = sh.y;
  const Ex = Hx + u.x * w, Ey = Hy + u.y * w;
  const xs = [], ys = [];
  if (sh.subtype === "double") {
    const halfW = w / 2;
    xs.push(Hx, Ex, Hx + n.x * halfW, Ex + n.x * halfW);
    ys.push(Hy, Ey, Hy + n.y * halfW, Ey + n.y * halfW);
  } else if (sh.subtype === "sliding") {
    const half = 0.3;
    xs.push(Hx + n.x * half, Hx - n.x * half, Ex + n.x * half, Ex - n.x * half);
    ys.push(Hy + n.y * half, Hy - n.y * half, Ey + n.y * half, Ey - n.y * half);
  } else if (sh.subtype === "pocket") {
    const off = 0.25;
    const arr = 0.3;
    xs.push(Hx, Ex, Hx + n.x * off, Ex + n.x * off, Hx - u.x * arr);
    ys.push(Hy, Ey, Hy + n.y * off, Ey + n.y * off, Hy - u.y * arr);
  } else if (sh.subtype === "garage") {
    const off = 0.35;
    xs.push(Hx, Ex, Hx + n.x * off, Ex + n.x * off);
    ys.push(Hy, Ey, Hy + n.y * off, Ey + n.y * off);
  } else {
    const Tx = Hx + n.x * w, Ty = Hy + n.y * w;
    xs.push(Hx, Ex, Tx); ys.push(Hy, Ey, Ty);
  }
  return bboxFromXsYs(xs, ys);
}
function bboxWindow(sh) {
  const { u, n } = windowAxes(sh);
  const w = sh.width;
  const d = sh.depth || DEFAULT_WINDOW_DEPTH_FT;
  const Hx = sh.x, Hy = sh.y;
  const p2x = Hx + u.x * w, p2y = Hy + u.y * w;
  const p3x = p2x + n.x * d, p3y = p2y + n.y * d;
  const p4x = Hx + n.x * d, p4y = Hy + n.y * d;
  return bboxFromXsYs([Hx, p2x, p3x, p4x], [Hy, p2y, p3y, p4y]);
}
function bboxText(sh) {
  // fontSize is in screen pixels; convert measurements back to world units so
  // bbox + hit-test stay correct as the user zooms.
  const sizePx = Math.max(2, sh.fontSize);
  ctx.save();
  ctx.font = `${sizePx}px ${sh.fontFamily}`;
  const m = ctx.measureText(sh.text || "");
  ctx.restore();
  const scale = effectiveScale();
  const widthFt  = Math.max(m.width, sizePx * 0.6) / scale;
  const heightFt = sizePx * 1.15 / scale;
  const padFt    = sizePx * 0.3 / scale;
  const padFtY   = sizePx * 0.18 / scale;
  const angle = sh.angle || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    { x: -padFt, y: -padFtY },
    { x: widthFt + padFt, y: -padFtY },
    { x: widthFt + padFt, y: heightFt + padFtY },
    { x: -padFt, y: heightFt + padFtY },
  ];
  const xs = [], ys = [];
  for (const c of corners) {
    xs.push(sh.x + cos * c.x - sin * c.y);
    ys.push(sh.y + sin * c.x + cos * c.y);
  }
  return bboxFromXsYs(xs, ys);
}
function bboxStairs(sh) {
  const xs = [], ys = [];
  for (const seg of sh.segments) {
    const u = { x: Math.cos(seg.angle), y: Math.sin(seg.angle) };
    const p = { x: -u.y, y: u.x };
    const halfW = seg.width / 2;
    if (seg.type === "flight") {
      xs.push(seg.x1 + p.x * halfW, seg.x1 - p.x * halfW, seg.x2 + p.x * halfW, seg.x2 - p.x * halfW);
      ys.push(seg.y1 + p.y * halfW, seg.y1 - p.y * halfW, seg.y2 + p.y * halfW, seg.y2 - p.y * halfW);
    } else if (seg.type === "landing") {
      xs.push(
        seg.x - u.x * halfW + p.x * halfW,
        seg.x - u.x * halfW - p.x * halfW,
        seg.x + u.x * halfW - p.x * halfW,
        seg.x + u.x * halfW + p.x * halfW,
      );
      ys.push(
        seg.y - u.y * halfW + p.y * halfW,
        seg.y - u.y * halfW - p.y * halfW,
        seg.y + u.y * halfW - p.y * halfW,
        seg.y + u.y * halfW + p.y * halfW,
      );
    }
  }
  return bboxFromXsYs(xs, ys);
}
function stairsSnapCorners(sh) {
  const out = [];
  for (const seg of sh.segments) {
    const u = { x: Math.cos(seg.angle), y: Math.sin(seg.angle) };
    const p = { x: -u.y, y: u.x };
    if (seg.type === "flight") {
      const halfW = seg.width / 2;
      out.push({ x: seg.x1 + p.x * halfW, y: seg.y1 + p.y * halfW });
      out.push({ x: seg.x1 - p.x * halfW, y: seg.y1 - p.y * halfW });
      out.push({ x: seg.x2 + p.x * halfW, y: seg.y2 + p.y * halfW });
      out.push({ x: seg.x2 - p.x * halfW, y: seg.y2 - p.y * halfW });
    } else if (seg.type === "landing") {
      const half = seg.width / 2;
      out.push({ x: seg.x - u.x * half + p.x * half, y: seg.y - u.y * half + p.y * half });
      out.push({ x: seg.x - u.x * half - p.x * half, y: seg.y - u.y * half - p.y * half });
      out.push({ x: seg.x + u.x * half - p.x * half, y: seg.y + u.y * half - p.y * half });
      out.push({ x: seg.x + u.x * half + p.x * half, y: seg.y + u.y * half + p.y * half });
    }
  }
  return out;
}
function stairsCapture(sh) {
  return {
    x: sh.x, y: sh.y, angle: sh.angle || 0,
    segments: sh.segments.map((s) => ({ ...s })),
  };
}
function stairsRestore(sh, o) {
  sh.x = o.x; sh.y = o.y; sh.angle = o.angle;
  sh.segments = o.segments.map((s) => ({ ...s }));
}
function stairsMove(sh, o, dx, dy) {
  sh.x = o.x + dx; sh.y = o.y + dy;
  for (let i = 0; i < sh.segments.length; i++) {
    const seg = sh.segments[i];
    const oseg = o.segments[i];
    if (seg.type === "flight") {
      seg.x1 = oseg.x1 + dx; seg.y1 = oseg.y1 + dy;
      seg.x2 = oseg.x2 + dx; seg.y2 = oseg.y2 + dy;
    } else if (seg.type === "landing") {
      seg.x = oseg.x + dx; seg.y = oseg.y + dy;
    }
  }
}
function stairsRotate(sh, o, rot, dAngle) {
  const p = rot(o.x, o.y);
  sh.x = p.x; sh.y = p.y;
  sh.angle = (o.angle || 0) + dAngle;
  for (let i = 0; i < sh.segments.length; i++) {
    const seg = sh.segments[i];
    const oseg = o.segments[i];
    if (seg.type === "flight") {
      const p1 = rot(oseg.x1, oseg.y1);
      const p2 = rot(oseg.x2, oseg.y2);
      seg.x1 = p1.x; seg.y1 = p1.y;
      seg.x2 = p2.x; seg.y2 = p2.y;
      seg.angle = oseg.angle + dAngle;
    } else if (seg.type === "landing") {
      const pl = rot(oseg.x, oseg.y);
      seg.x = pl.x; seg.y = pl.y;
      seg.angle = oseg.angle + dAngle;
    }
  }
}
function stairsDuplicate(copy, sh, offset) {
  copy.x = sh.x + offset; copy.y = sh.y + offset;
  copy.segments = sh.segments.map((seg) => {
    const out = { ...seg };
    if (seg.type === "flight") {
      out.x1 = seg.x1 + offset; out.y1 = seg.y1 + offset;
      out.x2 = seg.x2 + offset; out.y2 = seg.y2 + offset;
    } else if (seg.type === "landing") {
      out.x = seg.x + offset; out.y = seg.y + offset;
    }
    return out;
  });
}
function stairsCloneExtra(c, sh) {
  if (Array.isArray(sh.segments)) {
    c.segments = sh.segments.map((s) => ({ ...s }));
  }
}

// Cabinet path with wall-thickness adjustment applied — the visual centerline
// the user actually sees. snapCorners / bbox / hit-test all key off this so
// they match what's drawn.
function cabinetVisualPoints(sh, layerIdHint) {
  const layerId = layerIdHint || findLayerIdOfShape(sh);
  return wallAdjustedCabinetPath(sh.points, sh.side, layerId);
}

// Walk all sublayers to find which one owns this shape. Used by cabinet
// helpers that need the layerId but only get a raw shape reference.
function findLayerIdOfShape(sh) {
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.shapes.indexOf(sh) !== -1) return sub.id;
    }
  }
  return null;
}

function cabinetCapture(sh) {
  return { points: sh.points.map((p) => ({ x: p.x, y: p.y })) };
}
function cabinetRestore(sh, o) {
  if (o.points) sh.points = o.points.map((p) => ({ x: p.x, y: p.y }));
}
function cabinetMove(sh, o, dx, dy) {
  for (let i = 0; i < sh.points.length; i++) {
    sh.points[i].x = o.points[i].x + dx;
    sh.points[i].y = o.points[i].y + dy;
  }
}
function cabinetRotate(sh, o, rot) {
  for (let i = 0; i < sh.points.length; i++) {
    const p = rot(o.points[i].x, o.points[i].y);
    sh.points[i].x = p.x; sh.points[i].y = p.y;
  }
}
function cabinetDuplicate(copy, sh, offset) {
  copy.points = sh.points.map((p) => ({ x: p.x + offset, y: p.y + offset }));
}
function cabinetCloneExtra(c, sh) {
  if (Array.isArray(sh.points)) {
    c.points = sh.points.map((p) => ({ x: p.x, y: p.y }));
  }
}

// Floor region — a polygon (sh.points) with a material pattern key. Transform
// helpers operate on the points array; bbox / hit-test key off it too.
function bboxFloor(sh) {
  const pts = sh.points || [];
  if (!pts.length) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return bboxFromXsYs(pts.map((p) => p.x), pts.map((p) => p.y));
}
function hitDistanceFloor(sh, wp) {
  const pts = sh.points || [];
  if (pts.length < 3) return Infinity;
  // A click anywhere inside the region selects it.
  if (pointInPolygon(wp.x, wp.y, pts)) return 0;
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    d = Math.min(d, pointToSegmentDist(wp.x, wp.y, a.x, a.y, b.x, b.y));
  }
  return d;
}
function floorCapture(sh) {
  return { points: sh.points.map((p) => ({ x: p.x, y: p.y })) };
}
function floorRestore(sh, o) {
  if (o.points) sh.points = o.points.map((p) => ({ x: p.x, y: p.y }));
}
function floorMove(sh, o, dx, dy) {
  for (let i = 0; i < sh.points.length; i++) {
    sh.points[i].x = o.points[i].x + dx;
    sh.points[i].y = o.points[i].y + dy;
  }
}
function floorRotate(sh, o, rot) {
  for (let i = 0; i < sh.points.length; i++) {
    const p = rot(o.points[i].x, o.points[i].y);
    sh.points[i].x = p.x;
    sh.points[i].y = p.y;
  }
}
function floorDuplicate(copy, sh, offset) {
  copy.points = sh.points.map((p) => ({ x: p.x + offset, y: p.y + offset }));
}
function floorCloneExtra(c, sh) {
  if (Array.isArray(sh.points)) {
    c.points = sh.points.map((p) => ({ x: p.x, y: p.y }));
  }
}

const SHAPES = {
  line: {
    draw: drawLineShape,
    bbox: (sh) => {
      const b = endpointBBox(sh);
      // Walls extend perpendicular to the centerline. Inflate the bbox so
      // selection / hit-test feels right when clicking on the wall faces.
      if (sh.thickness && sh.thickness > 0) {
        const half = sh.thickness / 2;
        return { x1: b.x1 - half, y1: b.y1 - half, x2: b.x2 + half, y2: b.y2 + half };
      }
      return b;
    },
    hitDistance: (sh, wp) => {
      const d = pointToSegmentDist(wp.x, wp.y, sh.x1, sh.y1, sh.x2, sh.y2);
      // Allow grabbing the wall by its body, not just its centerline.
      if (sh.thickness && sh.thickness > 0) return Math.max(0, d - sh.thickness / 2);
      return d;
    },
    snapCorners: endpointEndpoints,
    capture: endpointCapture,
    restore: endpointRestore,
    move: endpointMove,
    rotate: endpointRotate,
    resize: endpointResize,
    duplicate: endpointDuplicate,
    selectionBg: "line",
    isOpening: false,
  },
  measure: {
    draw: drawMeasureShape,
    bbox: (sh) => {
      const e = measureDimEndpoints(sh);
      return bboxFromXsYs(
        [sh.x1, sh.x2, e.ax, e.bx],
        [sh.y1, sh.y2, e.ay, e.by],
      );
    },
    hitDistance: (sh, wp) => {
      const ends = measureDimEndpoints(sh);
      return Math.min(
        pointToSegmentDist(wp.x, wp.y, sh.x1, sh.y1, sh.x2, sh.y2),
        pointToSegmentDist(wp.x, wp.y, ends.ax, ends.ay, ends.bx, ends.by),
      );
    },
    snapCorners: endpointEndpoints,
    capture: endpointCapture,
    restore: endpointRestore,
    move: endpointMove,
    rotate: endpointRotate,
    resize: endpointResize,
    duplicate: endpointDuplicate,
    selectionBg: "line",
    isOpening: false,
  },
  arc: {
    draw: drawArcShape,
    bbox: (sh) => {
      if (sh.mx === undefined) return endpointBBox(sh);
      const ext = arcBBoxPoints(sh);
      return bboxFromXsYs(ext.xs, ext.ys);
    },
    hitDistance: (sh, wp) => pointToArcDist(wp.x, wp.y, sh),
    snapCorners: endpointEndpoints,
    capture: (sh) => {
      const o = endpointCapture(sh);
      if (sh.mx !== undefined) { o.mx = sh.mx; o.my = sh.my; }
      return o;
    },
    restore: (sh, o) => {
      endpointRestore(sh, o);
      if (o.mx !== undefined) { sh.mx = o.mx; sh.my = o.my; }
    },
    move: (sh, o, dx, dy) => {
      endpointMove(sh, o, dx, dy);
      if (o.mx !== undefined) {
        sh.mx = o.mx + dx; sh.my = o.my + dy;
      }
    },
    rotate: (sh, o, rot) => {
      endpointRotate(sh, o, rot);
      if (o.mx !== undefined) {
        const pm = rot(o.mx, o.my);
        sh.mx = pm.x; sh.my = pm.y;
      }
    },
    resize: (sh, o, anchor, sx, sy) => {
      endpointResize(sh, o, anchor, sx, sy);
      if (o.mx !== undefined) {
        sh.mx = anchor.x + (o.mx - anchor.x) * sx;
        sh.my = anchor.y + (o.my - anchor.y) * sy;
      }
    },
    duplicate: (copy, sh, offset) => {
      endpointDuplicate(copy, sh, offset);
      if (sh.mx !== undefined) {
        copy.mx = sh.mx + offset; copy.my = sh.my + offset;
      }
    },
    selectionBg: "path",
    isOpening: false,
  },
  door: {
    draw: drawDoorShape,
    bbox: bboxDoor,
    hitDistance: hitDistanceFromBBox,
    snapCorners: (sh) => {
      const u = { x: Math.cos(sh.angle), y: Math.sin(sh.angle) };
      return [
        { x: sh.x, y: sh.y },
        { x: sh.x + u.x * sh.width, y: sh.y + u.y * sh.width },
      ];
    },
    capture: anchorCapture,
    restore: anchorRestore,
    move: anchorMove,
    rotate: anchorRotate,
    duplicate: anchorDuplicate,
    // resize omitted: doors are sized via the dimension modal.
    selectionBg: "bbox",
    isOpening: true,
  },
  window: {
    draw: drawWindowShape,
    bbox: bboxWindow,
    hitDistance: hitDistanceFromBBox,
    snapCorners: (sh) => {
      // All four corners — windows have real depth and users measure to the
      // inside (room-side) edge as often as to the wall edge.
      const u = { x: Math.cos(sh.angle), y: Math.sin(sh.angle) };
      const n = { x: -u.y, y: u.x };
      const w = sh.width, d = sh.depth || DEFAULT_WINDOW_DEPTH_FT;
      return [
        { x: sh.x,                       y: sh.y                       },
        { x: sh.x + u.x * w,             y: sh.y + u.y * w             },
        { x: sh.x + u.x * w + n.x * d,   y: sh.y + u.y * w + n.y * d   },
        { x: sh.x + n.x * d,             y: sh.y + n.y * d             },
      ];
    },
    capture: anchorCapture,
    restore: anchorRestore,
    move: anchorMove,
    rotate: anchorRotate,
    duplicate: anchorDuplicate,
    selectionBg: "bbox",
    isOpening: true,
  },
  text: {
    draw: drawTextShape,
    bbox: bboxText,
    hitDistance: hitDistanceFromBBox,
    snapCorners: (sh) => [{ x: sh.x, y: sh.y }],
    capture: anchorCapture,
    restore: anchorRestore,
    move: anchorMove,
    rotate: anchorRotate,
    duplicate: anchorDuplicate,
    selectionBg: "bbox",
    isOpening: true,
  },
  appliance: {
    draw: drawApplianceShape,
    bbox: (sh) => bboxFromPoints(applianceCorners(sh)),
    hitDistance: hitDistanceFromBBox,
    snapCorners: (sh) => applianceCorners(sh),
    capture: (sh) => ({
      x: sh.x, y: sh.y, angle: sh.angle || 0,
      width: sh.width, depth: sh.depth,
    }),
    restore: (sh, o) => {
      sh.x = o.x; sh.y = o.y; sh.angle = o.angle;
      if (o.width !== undefined) sh.width = o.width;
      if (o.depth !== undefined) sh.depth = o.depth;
    },
    move: anchorMove,
    rotate: anchorRotate,
    resize: (sh, o, anchor, sx, sy) => {
      // Resize math only preserves rotation cleanly for axis-aligned pieces.
      // Catalog-sized kitchen appliances stay fixed; islands + furniture are
      // free-form and accept the scale.
      if (Math.abs(o.angle || 0) > 1e-6) return;
      if (!applianceResizable(sh)) return;
      const newX1 = anchor.x + (o.x - anchor.x) * sx;
      const newY1 = anchor.y + (o.y - anchor.y) * sy;
      const newX2 = anchor.x + (o.x + o.width - anchor.x) * sx;
      const newY2 = anchor.y + (o.y + o.depth - anchor.y) * sy;
      sh.x = Math.min(newX1, newX2);
      sh.y = Math.min(newY1, newY2);
      sh.width = Math.max(0.5, Math.abs(newX2 - newX1));
      sh.depth = Math.max(0.5, Math.abs(newY2 - newY1));
    },
    duplicate: anchorDuplicate,
    cloneExtra: (c, sh) => {
      // Custom pieces carry their own primitive list; deep-clone it so
      // history snapshots and duplicates don't share mutable state with the
      // live shape.
      if (Array.isArray(sh.primitives)) {
        c.primitives = sh.primitives.map((p) => ({ ...p }));
      }
    },
    selectionBg: "bbox",
    // Anything we won't resize counts as an "opening" — keeps the resize
    // handles hidden in mixed selections.
    isOpening: (sh) => !applianceResizable(sh) || Math.abs(sh.angle || 0) > 1e-6,
  },
  stairs: {
    draw: drawStairsShape,
    bbox: bboxStairs,
    hitDistance: hitDistanceFromBBox,
    snapCorners: stairsSnapCorners,
    capture: stairsCapture,
    restore: stairsRestore,
    move: stairsMove,
    rotate: stairsRotate,
    duplicate: stairsDuplicate,
    cloneExtra: stairsCloneExtra,
    selectionBg: "bbox",
    isOpening: true,
  },
  cabinet: {
    draw: drawCabinetShape,
    bbox: (sh) => {
      const adjusted = cabinetVisualPoints(sh);
      const outer = offsetPolyline(adjusted, sh.depth, sh.side);
      return bboxFromPoints([...adjusted, ...outer]);
    },
    hitDistance: (sh, wp) => {
      // Hit-test the back-edge polyline AND the depth-offset polyline, both
      // taken from the wall-adjusted (visual) points.
      const adjusted = cabinetVisualPoints(sh);
      let d = Infinity;
      const offsetPts = offsetPolyline(adjusted, sh.depth, sh.side);
      for (let i = 0; i < adjusted.length - 1; i++) {
        const a = adjusted[i], b = adjusted[i + 1];
        const ao = offsetPts[i] || a, bo = offsetPts[i + 1] || b;
        d = Math.min(d, pointToSegmentDist(wp.x, wp.y, a.x, a.y, b.x, b.y));
        d = Math.min(d, pointToSegmentDist(wp.x, wp.y, ao.x, ao.y, bo.x, bo.y));
      }
      return d;
    },
    // Visible-chunk corners on both the back and front edges. When an
    // appliance cuts the cabinet, each visible run between cuts contributes
    // four snap targets — that's what the ruler needs to anchor cleanly to
    // the actual end of the counter.
    snapCorners: (sh, sub) => {
      if (!Array.isArray(sh.points) || sh.points.length < 2) return [];
      const layerId = (sub && sub.id) || findLayerIdOfShape(sh);
      const adjusted = cabinetVisualPoints(sh, layerId);
      const offsetPts = offsetPolyline(adjusted, sh.depth, sh.side);
      const cuts = applianceCornersOnSameStory(layerId);
      const out = [];
      for (let i = 0; i < adjusted.length - 1; i++) {
        const a = adjusted[i], b = adjusted[i + 1];
        const aOff = offsetPts[i] || a;
        const bOff = offsetPts[i + 1] || b;
        const segDx = b.x - a.x, segDy = b.y - a.y;
        const segLen = Math.hypot(segDx, segDy) || 1;
        const nx = (-segDy / segLen) * sh.side;
        const ny = ( segDx / segLen) * sh.side;
        const visible = cabinetSegmentVisibleRanges(a, b, sh.depth, sh.side, cuts);
        for (const { t1, t2 } of visible) {
          const ax = a.x + (b.x - a.x) * t1;
          const ay = a.y + (b.y - a.y) * t1;
          const bx = a.x + (b.x - a.x) * t2;
          const by = a.y + (b.y - a.y) * t2;
          const startAtSegStart = t1 < 1e-6;
          const endAtSegEnd = t2 > 1 - 1e-6;
          const aoX = startAtSegStart ? aOff.x : (ax + nx * sh.depth);
          const aoY = startAtSegStart ? aOff.y : (ay + ny * sh.depth);
          const boX = endAtSegEnd ? bOff.x : (bx + nx * sh.depth);
          const boY = endAtSegEnd ? bOff.y : (by + ny * sh.depth);
          out.push({ x: ax,  y: ay  });
          out.push({ x: bx,  y: by  });
          out.push({ x: aoX, y: aoY });
          out.push({ x: boX, y: boY });
        }
      }
      return out;
    },
    capture: cabinetCapture,
    restore: cabinetRestore,
    move: cabinetMove,
    rotate: cabinetRotate,
    duplicate: cabinetDuplicate,
    cloneExtra: cabinetCloneExtra,
    selectionBg: "bbox",
    isOpening: true,
  },
  floor: {
    draw: drawFloorShape,
    bbox: bboxFloor,
    hitDistance: hitDistanceFloor,
    snapCorners: (sh) =>
      Array.isArray(sh.points) ? sh.points.map((p) => ({ x: p.x, y: p.y })) : [],
    capture: floorCapture,
    restore: floorRestore,
    move: floorMove,
    rotate: floorRotate,
    duplicate: floorDuplicate,
    cloneExtra: floorCloneExtra,
    // resize omitted — a floor region is redrawn rather than handle-resized.
    selectionBg: "bbox",
    isOpening: true,
  },
};
