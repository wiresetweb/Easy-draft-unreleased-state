'use strict';

// drawLineShape

function drawLineShape(sh, color) {
  if (sh.thickness && sh.thickness > 0) {
    drawWallLineShape(sh, color);
    return;
  }
  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  // For dotted, lineCap MUST be "butt" — round caps fill the 0.1-unit dash
  // with a half-circle on each side, restoring the visual line and erasing
  // the gap. Dashed stays "round" because its 8px dashes are big enough
  // that the rounded ends just look like soft edges.
  ctx.lineCap = sh.stroke === "dotted" ? "butt" : "round";
  ctx.lineJoin = "round";
  if (sh.stroke === "dashed") ctx.setLineDash([8, 5]);
  else if (sh.stroke === "dotted") ctx.setLineDash([0.1, 5]);

  // Endpoints that landed on a thick wall's centerline (typical when the
  // user snapped to a wall corner or mid-span) get pulled back to that
  // wall's near face so the stroke — especially dashed / dotted — doesn't
  // visually plough through the wall body.
  const t1 = trimThinEndpointAtWall(sh.x1, sh.y1, sh.x2, sh.y2);
  const t2 = trimThinEndpointAtWall(sh.x2, sh.y2, sh.x1, sh.y1);
  const p1 = t1 || { x: sh.x1, y: sh.y1 };
  const p2 = t2 || { x: sh.x2, y: sh.y2 };

  const a = worldToScreen(p1.x, p1.y);
  const b = worldToScreen(p2.x, p2.y);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

// If (px, py) sits on the centerline of one or more thick walls, slide it
// along (px, py) → (qx, qy) until it has cleared every wall body it was
// inside. Returns the trimmed point, or null when no trim applies (no
// wall under the endpoint, line parallel to wall, or trim would consume
// the whole segment).
function trimThinEndpointAtWall(px, py, qx, qy) {
  const tol = 1e-3;
  const dDx = qx - px, dDy = qy - py;
  const dLen2 = dDx * dDx + dDy * dDy;
  if (dLen2 < 1e-12) return null;
  let bestS = 0;
  let hit = false;
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const W of sub.shapes) {
        if (W.type !== "line" || !W.thickness) continue;
        const wdx = W.x2 - W.x1, wdy = W.y2 - W.y1;
        const wLen2 = wdx * wdx + wdy * wdy;
        if (wLen2 < 1e-12) continue;
        // (px, py) on the wall's centerline iff it projects inside [0, 1]
        // and the perpendicular distance is within tol.
        const t = ((px - W.x1) * wdx + (py - W.y1) * wdy) / wLen2;
        if (t < -tol || t > 1 + tol) continue;
        const cpx = W.x1 + wdx * t, cpy = W.y1 + wdy * t;
        if (Math.hypot(px - cpx, py - cpy) > tol) continue;

        const wLen = Math.sqrt(wLen2);
        const nx = -wdy / wLen, ny = wdx / wLen;
        const half = W.thickness / 2;
        const dDotN = dDx * nx + dDy * ny;
        if (Math.abs(dDotN) < 1e-9) continue; // line parallel to wall
        // Move toward (qx, qy) until we've crossed by ±half along n —
        // sign chosen so we end up on the same side as (qx, qy).
        const sign = dDotN > 0 ? 1 : -1;
        const s = (sign * half) / dDotN;
        if (s <= 0 || s >= 1) continue;
        if (s > bestS) { bestS = s; hit = true; }
      }
    }
  }
  if (!hit) return null;
  return { x: px + dDx * bestS, y: py + dDy * bestS };
}

// A wall — drawn as two parallel face lines offset perpendicular to the
// centerline by ±thickness/2. When another thick wall shares an endpoint we
// miter both faces against the neighbor's faces; when another wall T-junctions
// into our side, we break our near-face line where the joining wall covers it
// so the two walls visually merge into one continuous shape.
function drawWallLineShape(sh, color) {
  const corners = computeWallCorners(sh);
  if (!corners) return;

  const a1 = worldToScreen(corners.p1Left.x,  corners.p1Left.y);
  const a2 = worldToScreen(corners.p2Left.x,  corners.p2Left.y);
  const b1 = worldToScreen(corners.p1Right.x, corners.p1Right.y);
  const b2 = worldToScreen(corners.p2Right.x, corners.p2Right.y);

  // T-junctions where another wall ends mid-span on our body, plus
  // mid-span × mid-span crossings where another wall passes straight
  // through. Both produce face breaks; the only difference is whether
  // they hit one side of us (T) or both (cross).
  const breaks = findTConnectionsTo(sh).concat(findCrossingBreaksTo(sh));
  const leftBreaks  = computeFaceBreaks(breaks, +1, corners.p1Left,  corners.p2Left);
  const rightBreaks = computeFaceBreaks(breaks, -1, corners.p1Right, corners.p2Right);

  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  if (sh.stroke === "dashed") ctx.setLineDash([8, 5]);
  else if (sh.stroke === "dotted") ctx.setLineDash([0.1, 5]);
  ctx.beginPath();
  drawFaceWithBreaks(a1, a2, leftBreaks);
  drawFaceWithBreaks(b1, b2, rightBreaks);
  // Only cap the ends that aren't joining another wall — at mitered joints
  // the neighbor's face lines meet ours at the same world point, so we'd be
  // drawing redundant lines through the shared corner.
  if (corners.p1Capped) { ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); }
  if (corners.p2Capped) { ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); }
  ctx.stroke();
  ctx.restore();
}

// Project each side-matching break's world endpoints onto the screen-space
// face line (s1 → s2), clamp to [0, 1] in face-line t, and return [{tMin, tMax}].
function computeFaceBreaks(tConnections, side, faceP1World, faceP2World) {
  const out = [];
  if (!tConnections.length) return out;
  const dx = faceP2World.x - faceP1World.x;
  const dy = faceP2World.y - faceP1World.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return out;
  for (const c of tConnections) {
    if (c.side !== side) continue;
    const t1 = ((c.p1.x - faceP1World.x) * dx + (c.p1.y - faceP1World.y) * dy) / len2;
    const t2 = ((c.p2.x - faceP1World.x) * dx + (c.p2.y - faceP1World.y) * dy) / len2;
    const tMin = Math.max(0, Math.min(1, Math.min(t1, t2)));
    const tMax = Math.max(0, Math.min(1, Math.max(t1, t2)));
    if (tMax - tMin > 1e-6) out.push({ tMin, tMax });
  }
  return out;
}

function drawFaceWithBreaks(s1, s2, breaks) {
  if (!breaks.length) {
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    return;
  }
  // Sort + merge overlapping breaks
  const sorted = breaks.slice().sort((a, b) => a.tMin - b.tMin);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const tail = merged[merged.length - 1];
    if (sorted[i].tMin <= tail.tMax) tail.tMax = Math.max(tail.tMax, sorted[i].tMax);
    else merged.push({ ...sorted[i] });
  }
  let cursor = 0;
  for (const b of merged) {
    if (b.tMin > cursor + 1e-6) {
      const ax = s1.x + (s2.x - s1.x) * cursor;
      const ay = s1.y + (s2.y - s1.y) * cursor;
      const bx = s1.x + (s2.x - s1.x) * b.tMin;
      const by = s1.y + (s2.y - s1.y) * b.tMin;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    cursor = Math.max(cursor, b.tMax);
  }
  if (cursor < 1 - 1e-6) {
    const ax = s1.x + (s2.x - s1.x) * cursor;
    const ay = s1.y + (s2.y - s1.y) * cursor;
    ctx.moveTo(ax, ay);
    ctx.lineTo(s2.x, s2.y);
  }
}

// Resolve the four world-space corners of a thick wall, accounting for any
// adjacent thick walls that share an endpoint (so face lines miter into the
// neighbor instead of capping perpendicular). Returns null for zero-length
// walls.
function computeWallCorners(sh) {
  const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const half = sh.thickness / 2;

  const out = {
    p1Left:  { x: sh.x1 + nx * half, y: sh.y1 + ny * half },
    p1Right: { x: sh.x1 - nx * half, y: sh.y1 - ny * half },
    p2Left:  { x: sh.x2 + nx * half, y: sh.y2 + ny * half },
    p2Right: { x: sh.x2 - nx * half, y: sh.y2 - ny * half },
    p1Capped: true,
    p2Capped: true,
  };

  const adj1 = findAdjacentThickWall(sh, sh.x1, sh.y1);
  if (adj1) {
    const m = miterAtJoint(sh, "p1", adj1);
    if (m) {
      out.p1Left = m.left;
      out.p1Right = m.right;
      out.p1Capped = false;
    } else if (adj1.colinear && Math.abs(adj1.wall.thickness - sh.thickness) < 1e-6) {
      // Two same-thickness colinear walls sharing this endpoint read as one
      // continuous wall — suppress the perpendicular cap so the joint doesn't
      // show a stray tick mark mid-run. (Different thicknesses keep the cap;
      // that step is a real architectural feature.)
      out.p1Capped = false;
    }
  } else {
    // Not an L-joint — maybe a T-junction with our endpoint sitting on
    // another wall's body. If so, extend our faces to that wall's near face.
    const through1 = findThroughWallAt(sh, sh.x1, sh.y1);
    if (through1) {
      const m = miterTJunction(sh, "p1", through1);
      if (m) {
        out.p1Left = m.left;
        out.p1Right = m.right;
        out.p1Capped = false;
      }
    }
  }
  const adj2 = findAdjacentThickWall(sh, sh.x2, sh.y2);
  if (adj2) {
    const m = miterAtJoint(sh, "p2", adj2);
    if (m) {
      out.p2Left = m.left;
      out.p2Right = m.right;
      out.p2Capped = false;
    } else if (adj2.colinear && Math.abs(adj2.wall.thickness - sh.thickness) < 1e-6) {
      out.p2Capped = false;
    }
  } else {
    const through2 = findThroughWallAt(sh, sh.x2, sh.y2);
    if (through2) {
      const m = miterTJunction(sh, "p2", through2);
      if (m) {
        out.p2Left = m.left;
        out.p2Right = m.right;
        out.p2Capped = false;
      }
    }
  }
  return out;
}

// Find a thick wall whose centerline passes through (jx, jy) STRICTLY between
// its endpoints (i.e., (jx, jy) is mid-span on that wall, not at a corner).
// Returns { wall, t } where t ∈ (0, 1) along the through wall, or null.
function findThroughWallAt(self, jx, jy) {
  const tol = 1e-3;
  const epsT = 1e-3;
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh === self) continue;
        if (sh.type !== "line" || !sh.thickness) continue;
        const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) continue;
        const t = ((jx - sh.x1) * dx + (jy - sh.y1) * dy) / len2;
        if (t < epsT || t > 1 - epsT) continue;
        const px = sh.x1 + dx * t, py = sh.y1 + dy * t;
        if (Math.hypot(jx - px, jy - py) > tol) continue;
        return { wall: sh, t };
      }
    }
  }
  return null;
}

// Wall A ending at a T-junction on through-wall B: extend A's two face lines
// until they meet B's near-side face. Returns { left, right } in A's natural
// (p1→p2) frame, or null when the geometry degenerates.
function miterTJunction(wall, end, through) {
  const wEnd = end === "p1" ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
  const wFar = end === "p1" ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };

  const wdx = wFar.x - wEnd.x, wdy = wFar.y - wEnd.y;
  const wlen = Math.hypot(wdx, wdy);
  if (wlen < 1e-9) return null;
  const ux = wdx / wlen, uy = wdy / wlen;
  const nx = -uy, ny = ux;
  const wHalf = wall.thickness / 2;

  const B = through.wall;
  const bdx = B.x2 - B.x1, bdy = B.y2 - B.y1;
  const blen = Math.hypot(bdx, bdy);
  if (blen < 1e-9) return null;
  const bux = bdx / blen, buy = bdy / blen;
  const bnx = -buy, bny = bux;
  const bHalf = B.thickness / 2;

  // Which side of B is A's body on? Sign of d_A projected onto n_B.
  const dot = ux * bnx + uy * bny;
  if (Math.abs(dot) < 1e-6) return null; // running along B — degenerate
  const sideSign = dot > 0 ? 1 : -1;

  // B's near face is on the same side as A's body. Anchor it on B's centerline
  // at the joint, then run line-line intersection with each of A's face lines.
  const nearFaceP = { x: wEnd.x + bnx * sideSign * bHalf, y: wEnd.y + bny * sideSign * bHalf };
  const aLeftP  = { x: wEnd.x + nx * wHalf, y: wEnd.y + ny * wHalf };
  const aRightP = { x: wEnd.x - nx * wHalf, y: wEnd.y - ny * wHalf };

  const leftCorner  = lineLineIntersect(aLeftP,  ux, uy, nearFaceP, bux, buy);
  const rightCorner = lineLineIntersect(aRightP, ux, uy, nearFaceP, bux, buy);
  if (!leftCorner || !rightCorner) return null;

  // Joint-frame "left" matches natural left at p1 and is flipped at p2 (same
  // p1↔p2 normal flip the L-miter case has to handle).
  return end === "p1"
    ? { left: leftCorner, right: rightCorner }
    : { left: rightCorner, right: leftCorner };
}

// All T-junctions where some other wall's endpoint lands mid-span on `B`.
// Returns the world-space endpoints of the break each one carves out of B's
// near face, plus which natural side (+1 = left / -1 = right) is affected.
function findTConnectionsTo(B) {
  const out = [];
  if (!B.thickness) return out;
  const bdx = B.x2 - B.x1, bdy = B.y2 - B.y1;
  const blen2 = bdx * bdx + bdy * bdy;
  if (blen2 < 1e-12) return out;
  const blen = Math.sqrt(blen2);
  const bux = bdx / blen, buy = bdy / blen;
  const bnx = -buy, bny = bux;
  const bHalf = B.thickness / 2;

  const tol = 1e-3;
  const epsT = 1e-3;

  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const W of sub.shapes) {
        if (W === B) continue;
        if (W.type !== "line" || !W.thickness) continue;
        for (const end of ["p1", "p2"]) {
          const jx = end === "p1" ? W.x1 : W.x2;
          const jy = end === "p1" ? W.y1 : W.y2;
          const fx = end === "p1" ? W.x2 : W.x1;
          const fy = end === "p1" ? W.y2 : W.y1;
          // Skip exact-endpoint hits — those are L-joints, handled elsewhere.
          if ((Math.abs(B.x1 - jx) < tol && Math.abs(B.y1 - jy) < tol) ||
              (Math.abs(B.x2 - jx) < tol && Math.abs(B.y2 - jy) < tol)) continue;
          const t = ((jx - B.x1) * bdx + (jy - B.y1) * bdy) / blen2;
          if (t < epsT || t > 1 - epsT) continue;
          const px = B.x1 + bdx * t, py = B.y1 + bdy * t;
          if (Math.hypot(jx - px, jy - py) > tol) continue;

          const wdx = fx - jx, wdy = fy - jy;
          const wlen = Math.hypot(wdx, wdy);
          if (wlen < 1e-9) continue;
          const wux = wdx / wlen, wuy = wdy / wlen;
          const dot = wux * bnx + wuy * bny;
          if (Math.abs(dot) < 1e-6) continue;
          const sideSign = dot > 0 ? 1 : -1;

          const wHalf = W.thickness / 2;
          const wnx = -wuy, wny = wux;
          const aL = { x: jx + wnx * wHalf, y: jy + wny * wHalf };
          const aR = { x: jx - wnx * wHalf, y: jy - wny * wHalf };
          const nearFaceP = { x: jx + bnx * sideSign * bHalf, y: jy + bny * sideSign * bHalf };

          const breakL = lineLineIntersect(aL, wux, wuy, nearFaceP, bux, buy);
          const breakR = lineLineIntersect(aR, wux, wuy, nearFaceP, bux, buy);
          if (!breakL || !breakR) continue;

          out.push({ side: sideSign, p1: breakL, p2: breakR });
        }
      }
    }
  }
  return out;
}

// Walls whose centerlines cross B's midspan (and B crosses their midspan
// too) — i.e., two walls plowing through each other rather than meeting
// at a corner. Each crossing carves a break on BOTH of B's faces, since
// the crossing wall covers B's body on both sides of the crossing point.
function findCrossingBreaksTo(B) {
  const out = [];
  if (!B.thickness) return out;
  const bdx = B.x2 - B.x1, bdy = B.y2 - B.y1;
  const blen2 = bdx * bdx + bdy * bdy;
  if (blen2 < 1e-12) return out;
  const blen = Math.sqrt(blen2);
  const bux = bdx / blen, buy = bdy / blen;
  const bnx = -buy, bny = bux;
  const bHalf = B.thickness / 2;

  // Treat anything within an epsilon of either endpoint as L-joint /
  // T-junction territory — those are handled elsewhere and we don't want
  // to double-cover the same break here.
  const epsT = 1e-3;

  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const W of sub.shapes) {
        if (W === B) continue;
        if (W.type !== "line" || !W.thickness) continue;
        if (sharesEndpoint(W, B)) continue;

        // Solve for centerline parameters at the intersection of the two
        // segments. Crossings need both t and s strictly inside (0, 1).
        const wdx = W.x2 - W.x1, wdy = W.y2 - W.y1;
        const wlen2 = wdx * wdx + wdy * wdy;
        if (wlen2 < 1e-12) continue;
        const denom = wdx * bdy - wdy * bdx;
        if (Math.abs(denom) < 1e-9) continue; // parallel — no crossing
        const dx0 = B.x1 - W.x1, dy0 = B.y1 - W.y1;
        const t = (dx0 * bdy - dy0 * bdx) / denom;
        const s = (dx0 * wdy - dy0 * wdx) / denom;
        if (t < epsT || t > 1 - epsT) continue;
        if (s < epsT || s > 1 - epsT) continue;

        const jx = W.x1 + wdx * t;
        const jy = W.y1 + wdy * t;
        const wlen = Math.sqrt(wlen2);
        const wux = wdx / wlen, wuy = wdy / wlen;
        const wnx = -wuy, wny = wux;
        const wHalf = W.thickness / 2;

        // For each side of B, intersect W's two body edges with B's near
        // face line. Those two intersections bound the break range that
        // B's face should skip so W reads through.
        for (const sideSign of [1, -1]) {
          const aL = { x: jx + wnx * wHalf, y: jy + wny * wHalf };
          const aR = { x: jx - wnx * wHalf, y: jy - wny * wHalf };
          const nearFaceP = {
            x: jx + bnx * sideSign * bHalf,
            y: jy + bny * sideSign * bHalf,
          };
          const breakL = lineLineIntersect(aL, wux, wuy, nearFaceP, bux, buy);
          const breakR = lineLineIntersect(aR, wux, wuy, nearFaceP, bux, buy);
          if (!breakL || !breakR) continue;
          out.push({ side: sideSign, p1: breakL, p2: breakR });
        }
      }
    }
  }
  return out;
}

// True when W and B share a concrete endpoint — used to skip the crossing
// detector for walls that are actually L-joining at a corner.
function sharesEndpoint(W, B) {
  const tol = 1e-3;
  const ends = [
    [W.x1, W.y1, B.x1, B.y1],
    [W.x1, W.y1, B.x2, B.y2],
    [W.x2, W.y2, B.x1, B.y1],
    [W.x2, W.y2, B.x2, B.y2],
  ];
  for (const [ax, ay, bx, by] of ends) {
    if (Math.abs(ax - bx) < tol && Math.abs(ay - by) < tol) return true;
  }
  return false;
}

// Walk visible thick walls and return one whose endpoint coincides with
// (jx, jy) — picked deterministically so both walls at a joint agree on
// who they're mitering against.
//
// Prefers a NON-COLINEAR neighbor, falling back to a colinear one only if no
// perpendicular wall is at this joint. The preference matters at 3-way
// joints — say two horizontal segments meeting a vertical wall at the same
// point. Without it, this function might return the colinear neighbor first;
// `miterAtJoint` then bails (parallel cross product = 0), the perpendicular
// cap stays drawn, and the corner shows a stray tick mark.
function findAdjacentThickWall(self, jx, jy) {
  const tol = 1e-4;
  const sdx = self.x2 - self.x1, sdy = self.y2 - self.y1;
  const slen = Math.hypot(sdx, sdy);
  if (slen < 1e-9) return null;
  const sux = sdx / slen, suy = sdy / slen;

  let colinearMatch = null;
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh === self) continue;
        if (sh.type !== "line" || !sh.thickness) continue;
        let end = null;
        if (Math.abs(sh.x1 - jx) < tol && Math.abs(sh.y1 - jy) < tol) end = "p1";
        else if (Math.abs(sh.x2 - jx) < tol && Math.abs(sh.y2 - jy) < tol) end = "p2";
        if (!end) continue;
        const ndx = sh.x2 - sh.x1, ndy = sh.y2 - sh.y1;
        const nlen = Math.hypot(ndx, ndy);
        if (nlen < 1e-9) continue;
        const nux = ndx / nlen, nuy = ndy / nlen;
        const cross = sux * nuy - suy * nux;
        if (Math.abs(cross) < 1e-6) {
          // Colinear with self — keep as a fallback in case nothing else is at
          // this joint, but keep looking for a real corner partner.
          if (!colinearMatch) colinearMatch = { wall: sh, end, colinear: true };
          continue;
        }
        return { wall: sh, end };
      }
    }
  }
  return colinearMatch;
}

// Compute mitered corners for `wall` at the joint where `wall`'s `end`
// (`"p1"` or `"p2"`) meets `adj.wall`'s `adj.end`. Returns { left, right }
// with `left` on the +n side of `wall` and `right` on the −n side, or null
// when the two walls are parallel (no valid intersection).
function miterAtJoint(wall, end, adj) {
  const wEnd  = end === "p1" ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
  const wFar  = end === "p1" ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
  const aEnd  = adj.end === "p1" ? { x: adj.wall.x1, y: adj.wall.y1 } : { x: adj.wall.x2, y: adj.wall.y2 };
  const aFar  = adj.end === "p1" ? { x: adj.wall.x2, y: adj.wall.y2 } : { x: adj.wall.x1, y: adj.wall.y1 };

  // Direction from joint into each wall's body. If the two are colinear the
  // miter is undefined — fall back to the perpendicular default.
  const wdx = wFar.x - wEnd.x, wdy = wFar.y - wEnd.y;
  const wlen = Math.hypot(wdx, wdy);
  if (wlen < 1e-9) return null;
  const ux = wdx / wlen, uy = wdy / wlen;
  const nx = -uy, ny = ux;
  const wHalf = wall.thickness / 2;

  const adx = aFar.x - aEnd.x, ady = aFar.y - aEnd.y;
  const alen = Math.hypot(adx, ady);
  if (alen < 1e-9) return null;
  const aux = adx / alen, auy = ady / alen;
  const anx = -auy, any = aux;
  const aHalf = adj.wall.thickness / 2;

  // Sign of the cross product picks the "interior" face of each wall: the
  // face that opens toward the room defined by the corner. For two walls
  // turning CCW the interior is on +n_self; turning CW it flips.
  const cross = ux * auy - uy * aux;
  if (Math.abs(cross) < 1e-6) return null;
  const wSign = cross > 0 ? 1 : -1;
  const aSign = cross > 0 ? -1 : 1;

  const wIntP = { x: wEnd.x + nx * wHalf * wSign, y: wEnd.y + ny * wHalf * wSign };
  const wExtP = { x: wEnd.x - nx * wHalf * wSign, y: wEnd.y - ny * wHalf * wSign };
  const aIntP = { x: aEnd.x + anx * aHalf * aSign, y: aEnd.y + any * aHalf * aSign };
  const aExtP = { x: aEnd.x - anx * aHalf * aSign, y: aEnd.y - any * aHalf * aSign };

  const interior = lineLineIntersect(wIntP, ux, uy, aIntP, aux, auy);
  const exterior = lineLineIntersect(wExtP, ux, uy, aExtP, aux, auy);
  if (!interior || !exterior) return null;

  // The joint-frame normal points the same way as the wall's natural
  // (p1→p2) normal at end="p1", and the opposite way at end="p2" — flip the
  // interior sign for p2 so left/right line up with what drawWallLineShape
  // uses for p1Left/p2Left/etc. Without this every p2 corner came out
  // swapped, which is what skewed the box rendering.
  const localSign = end === "p1" ? wSign : -wSign;
  return localSign === 1
    ? { left: interior, right: exterior }
    : { left: exterior, right: interior };
}

function lineLineIntersect(P, ux, uy, Q, vx, vy) {
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((Q.x - P.x) * vy - (Q.y - P.y) * vx) / cross;
  return { x: P.x + ux * t, y: P.y + uy * t };
}
