'use strict';

// ==============================================================================
// Wall cuts — door / window dropped on a wall splits the wall line.
// Also used by stairs placement (snap landing to wall).
// ==============================================================================

function projectParam(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return ((px - ax) * dx + (py - ay) * dy) / len2;
}

function findWallsForOpening(opening) {
  const story = activeStory();
  if (!story) return { wallsLayer: null, walls: [] };
  const wallsLayer = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
  if (!wallsLayer) return { wallsLayer: null, walls: [] };

  const u = { x: Math.cos(opening.angle), y: Math.sin(opening.angle) };
  const Hx = opening.x, Hy = opening.y;
  const Ex = opening.x + u.x * opening.width;
  const Ey = opening.y + u.y * opening.width;

  const walls = [];
  for (const line of wallsLayer.shapes) {
    if (line.type !== "line") continue;
    const dH = pointToSegmentDist(Hx, Hy, line.x1, line.y1, line.x2, line.y2);
    const dE = pointToSegmentDist(Ex, Ey, line.x1, line.y1, line.x2, line.y2);
    if (dH > WALL_CUT_TOL_FT || dE > WALL_CUT_TOL_FT) continue;
    const tH = projectParam(Hx, Hy, line.x1, line.y1, line.x2, line.y2);
    const tE = projectParam(Ex, Ey, line.x1, line.y1, line.x2, line.y2);
    if (tH < -1e-6 || tH > 1 + 1e-6) continue;
    if (tE < -1e-6 || tE > 1 + 1e-6) continue;
    walls.push(line);
  }
  return { wallsLayer, walls };
}

// Find the nearest wall to a cursor position and return a placement {x, y, angle}
// for an opening of the given width that is centered on the projection onto that
// wall. Returns null if no wall is within ALIGN_TOL_FT.
// Snap a world point to the half-grid, then project the snapped point back
// onto the given wall so the result still lies on the wall line. For
// axis-aligned walls this is exact grid placement; for diagonal walls it's
// the foot-of-perpendicular from the nearest grid intersection. Falls back
// to the original point when grid snap is off.
function snapAlongWall(px, py, wall) {
  if (!state.snap) return { x: px, y: py };
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: px, y: py };
  const snapped = snapWorld({ x: px, y: py });
  let t = ((snapped.x - wall.x1) * dx + (snapped.y - wall.y1) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return { x: wall.x1 + dx * t, y: wall.y1 + dy * t };
}

// `depth` (optional) is the opening's perpendicular dimension. When supplied,
// the returned anchor is shifted back by half the depth so the *center* of the
// opening's footprint sits on the wall's centerline — i.e., the opening
// straddles the wall instead of resting against one face. Doors pass 0 (no
// depth) and keep the historical anchor-on-centerline behavior.
function detectAlignedPosition(worldPos, width, depth = 0) {
  const story = activeStory();
  if (!story) return null;
  const wallsLayer = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
  if (!wallsLayer || !wallsLayer.visible) return null;

  const tol = 1.0; // ft — only auto-align if cursor is within 1' of a wall
  let best = null;
  for (const wall of wallsLayer.shapes) {
    if (wall.type !== "line") continue;
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const t = projectParam(worldPos.x, worldPos.y, wall.x1, wall.y1, wall.x2, wall.y2);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const px = wall.x1 + dx * t;
    const py = wall.y1 + dy * t;
    const dist = Math.hypot(worldPos.x - px, worldPos.y - py);
    if (dist > tol) continue;
    if (!best || dist < best.dist) {
      const ux = dx / len, uy = dy / len;
      best = { dist, px, py, ux, uy, wall, len, angle: Math.atan2(dy, dx) };
    }
  }
  if (!best) return null;

  // Snap the projection along the wall to the grid so the opening's center
  // lands at clean dimensions, but otherwise leave the position along the
  // wall alone — users place windows wherever they want along the run.
  const center = snapAlongWall(best.px, best.py, best.wall);
  // Wall normal — the opening's depth axis. Shift the anchor by -n * (depth/2)
  // so the depth band is symmetric around the wall centerline.
  const halfW = width / 2;
  const halfD = depth / 2;
  const nx = -best.uy, ny = best.ux;
  return {
    x: center.x - best.ux * halfW - nx * halfD,
    y: center.y - best.uy * halfW - ny * halfD,
    angle: best.angle,
  };
}

// Per-kind air gap (in feet) between the back of an appliance and the wall.
// Built-ins sit flush; freestanding appliances get a small ventilation gap.
const APPLIANCE_WALL_GAP = {
  fridge: 1 / 12,  // 1"
  range:  1 / 12,  // 1"
};
function applianceWallGap(kind) {
  return APPLIANCE_WALL_GAP[kind] || 0;
}

// Detect a wall-back placement for an appliance: rotates the appliance so its
// width spans along the wall and its back edge sits on (or just off, per
// air-gap) the wall, with depth extending into the room on the cursor's side.
// Returns { x, y, angle } anchor for the appliance's back-left corner, or null.
function detectWallBackedPosition(worldPos, width, depth, airGap) {
  const story = activeStory();
  if (!story) return null;
  const wallsLayer = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
  if (!wallsLayer || !wallsLayer.visible) return null;

  const tol = Math.max(1.0, depth * 0.6); // ft — auto-snap range scales with appliance depth
  let best = null;
  for (const wall of wallsLayer.shapes) {
    if (wall.type !== "line") continue;
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const t = projectParam(worldPos.x, worldPos.y, wall.x1, wall.y1, wall.x2, wall.y2);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const px = wall.x1 + dx * t;
    const py = wall.y1 + dy * t;
    const dist = Math.hypot(worldPos.x - px, worldPos.y - py);
    if (dist > tol) continue;
    if (!best || dist < best.dist) {
      best = { dist, px, py, ux: dx / len, uy: dy / len, wall };
    }
  }
  if (!best) return null;

  // Choose orientation so the appliance depth extends toward the cursor.
  let ux = best.ux, uy = best.uy;
  let nx = -uy, ny = ux;
  const proj = (worldPos.x - best.px) * nx + (worldPos.y - best.py) * ny;
  if (proj < 0) {
    ux = -ux; uy = -uy;
    nx = -nx; ny = -ny;
  }

  // Snap the projection along the wall so the back edge lands on grid
  // measurements rather than at the cursor's pixel position.
  const snappedOnWall = snapAlongWall(best.px, best.py, best.wall);

  const halfW = width / 2;
  // Push the back of the piece out from the wall's centerline to its room-side
  // face. Without this, thick walls swallow half the piece. The air gap is
  // applied on top of that for kinds (fridge / range) that need ventilation.
  const wallHalfThickness = (best.wall.thickness || 0) / 2;
  const backOffset = wallHalfThickness + airGap;
  return {
    x: snappedOnWall.x - ux * halfW + nx * backOffset,
    y: snappedOnWall.y - uy * halfW + ny * backOffset,
    angle: Math.atan2(uy, ux),
  };
}

function cutWallForOpening(layer, wall, opening) {
  const u = { x: Math.cos(opening.angle), y: Math.sin(opening.angle) };
  const Hx = opening.x, Hy = opening.y;
  const Ex = opening.x + u.x * opening.width;
  const Ey = opening.y + u.y * opening.width;

  const tH = projectParam(Hx, Hy, wall.x1, wall.y1, wall.x2, wall.y2);
  const tE = projectParam(Ex, Ey, wall.x1, wall.y1, wall.x2, wall.y2);
  const tMin = Math.max(0, Math.min(tH, tE));
  const tMax = Math.min(1, Math.max(tH, tE));

  const wdx = wall.x2 - wall.x1;
  const wdy = wall.y2 - wall.y1;
  const cutMin = { x: wall.x1 + wdx * tMin, y: wall.y1 + wdy * tMin };
  const cutMax = { x: wall.x1 + wdx * tMax, y: wall.y1 + wdy * tMax };

  const idx = layer.shapes.indexOf(wall);
  if (idx === -1) return;
  layer.shapes.splice(idx, 1);

  if (tMin > 0.001) {
    layer.shapes.push({
      ...wall,
      id: makeId("X"),
      x1: wall.x1, y1: wall.y1,
      x2: cutMin.x, y2: cutMin.y,
    });
  }
  if (tMax < 0.999) {
    layer.shapes.push({
      ...wall,
      id: makeId("X"),
      x1: cutMax.x, y1: cutMax.y,
      x2: wall.x2, y2: wall.y2,
    });
  }
}
