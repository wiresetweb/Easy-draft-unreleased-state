'use strict';

// ==============================================================================
// Box tool: collinear-overlap merge — newly drawn rect edges that fall on
// existing wall lines extend / merge instead of stacking.
// ==============================================================================

// ---------- Box tool: collinear-overlap merge ----------
// Two segments are considered collinear when both endpoints of B lie on the
// infinite line through A (perpendicular distance under tolPerp).
function segmentsCollinear(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  const dx = a2x - a1x, dy = a2y - a1y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const tolPerp = 1e-3; // ft (~1/80 inch)
  const c1 = ((b1x - a1x) * dy - (b1y - a1y) * dx) / len;
  const c2 = ((b2x - a1x) * dy - (b2y - a1y) * dx) / len;
  return Math.abs(c1) < tolPerp && Math.abs(c2) < tolPerp;
}

// Merge a candidate line into existing collinear+overlapping/touching lines on
// a given layer. Mutates layer (removes the absorbed segments) and returns the
// grown line geometry that should be pushed.
function mergeCollinearOverlap(layer, x1, y1, x2, y2) {
  let cur = { x1, y1, x2, y2 };
  let changed = true;
  const tolEnd = 1e-3;
  while (changed) {
    changed = false;
    for (let i = layer.shapes.length - 1; i >= 0; i--) {
      const sh = layer.shapes[i];
      if (sh.type !== "line") continue;
      if (!segmentsCollinear(cur.x1, cur.y1, cur.x2, cur.y2, sh.x1, sh.y1, sh.x2, sh.y2)) continue;

      const dx = cur.x2 - cur.x1, dy = cur.y2 - cur.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const ux = dx / len, uy = dy / len;
      const tA1 = 0;
      const tA2 = len;
      const tB1 = (sh.x1 - cur.x1) * ux + (sh.y1 - cur.y1) * uy;
      const tB2 = (sh.x2 - cur.x1) * ux + (sh.y2 - cur.y1) * uy;
      const tBmin = Math.min(tB1, tB2);
      const tBmax = Math.max(tB1, tB2);
      if (tBmax < tA1 - tolEnd) continue;
      if (tBmin > tA2 + tolEnd) continue;

      const tMin = Math.min(tA1, tBmin);
      const tMax = Math.max(tA2, tBmax);
      cur = {
        x1: cur.x1 + ux * tMin, y1: cur.y1 + uy * tMin,
        x2: cur.x1 + ux * tMax, y2: cur.y1 + uy * tMax,
      };
      layer.shapes.splice(i, 1);
      changed = true;
    }
  }
  return cur;
}

function commitBox(layer, a, b) {
  pushHistory();
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const sides = [
    [x1, y1, x2, y1], // top
    [x2, y1, x2, y2], // right
    [x2, y2, x1, y2], // bottom
    [x1, y2, x1, y1], // left
  ];
  state.selection.clear();
  for (const [sx1, sy1, sx2, sy2] of sides) {
    const merged = mergeCollinearOverlap(layer, sx1, sy1, sx2, sy2);
    const id = makeId("X");
    layer.shapes.push({
      id,
      type: "line",
      x1: merged.x1, y1: merged.y1,
      x2: merged.x2, y2: merged.y2,
    });
    state.selection.add(id);
  }
  renderLayerTree();
}
