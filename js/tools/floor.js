'use strict';

// ==============================================================================
// Floor tool — turns the Box and Line tools into floor-region creators while
// the Floor layer is active.
//
//   • Box tool  → a rectangular floor region (commitFloorRect)
//   • Line tool → a multi-point polygon floor region. Clicks place vertices;
//     clicking back near the first vertex (or pressing Enter) closes the loop,
//     right-click drops the last vertex, Esc cancels.
//
// Both produce the same "floor" shape (a points polygon + a pattern key) and
// pop the floor-type modal by selecting the new region.
// ==============================================================================

// Click-to-close radius for the polygon builder, in screen pixels.
const FLOOR_CLOSE_PX = 12;

function activeLayerIsFloor() {
  const sub = activeSublayer();
  return !!(sub && sub.name === FLOOR_LAYER_NAME);
}

// Select the freshly created floor region and drop into the Select tool so the
// floor-type modal appears right away — "after creation, a modal".
function selectNewFloor(shape) {
  state.selection.clear();
  state.selection.add(shape.id);
  if (typeof setTool === "function") setTool("select");
}

// Box tool committed on the Floor layer → a rectangular floor region.
function commitFloorRect(layer, a, b) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  if (x2 - x1 < 1e-6 || y2 - y1 < 1e-6) return;
  pushHistory("Drew floor");
  const shape = {
    id: makeId("X"),
    type: "floor",
    points: [
      { x: x1, y: y1 }, { x: x2, y: y1 },
      { x: x2, y: y2 }, { x: x1, y: y2 },
    ],
    pattern: DEFAULT_FLOOR_PATTERN,
  };
  layer.shapes.push(shape);
  renderLayerTree();
  selectNewFloor(shape);
}

// ---------- polygon builder ----------

// A click from the Line tool while the Floor layer is active. `p` is already
// grid-snapped by the caller.
function floorBuilderClick(p) {
  if (!state.floorBuilder) {
    state.floorBuilder = { points: [{ x: p.x, y: p.y }] };
    return;
  }
  const pts = state.floorBuilder.points;
  // Close the loop when the click lands back on the first vertex.
  if (pts.length >= 3) {
    const f = worldToScreen(pts[0].x, pts[0].y);
    const c = worldToScreen(p.x, p.y);
    if (Math.hypot(f.x - c.x, f.y - c.y) <= FLOOR_CLOSE_PX) {
      commitFloorPolygon();
      return;
    }
  }
  // Ignore a duplicate click on the last vertex (a stray double-fire).
  const last = pts[pts.length - 1];
  if (Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) return;
  pts.push({ x: p.x, y: p.y });
}

// Right-click while building — drop the last placed vertex (cancels outright
// once the polygon is empty).
function floorBuilderUndoPoint() {
  if (!state.floorBuilder) return;
  state.floorBuilder.points.pop();
  if (!state.floorBuilder.points.length) state.floorBuilder = null;
}

function cancelFloorBuilder() {
  state.floorBuilder = null;
}

function commitFloorPolygon() {
  const builder = state.floorBuilder;
  state.floorBuilder = null;
  if (!builder || builder.points.length < 3) return;
  const layer = activeSublayer();
  if (!layer) return;
  pushHistory("Drew floor");
  const shape = {
    id: makeId("X"),
    type: "floor",
    points: builder.points.map((p) => ({ x: p.x, y: p.y })),
    pattern: DEFAULT_FLOOR_PATTERN,
  };
  layer.shapes.push(shape);
  renderLayerTree();
  selectNewFloor(shape);
}
