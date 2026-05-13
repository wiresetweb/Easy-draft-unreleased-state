'use strict';

// ==============================================================================
// Selection — hit-test, bbox dispatch, transforms, ops, pointer handling.
// ==============================================================================

// ---------- Selection helpers ----------
// Hit-test against shapes on the active sublayer only — layer-locked selection
// keeps a click on the Cabinets layer from grabbing the wall behind it. When
// no layer is active (rare; only at boot before addStory) we fall back to all
// visible shapes so the canvas isn't dead.
function findShapeAtScreen(sx, sy) {
  const wp = screenToWorld(sx, sy);
  const tol = SHAPE_HIT / effectiveScale();
  const active = activeSublayer();
  let best = null;
  let bestDist = Infinity;
  forEachVisibleShape((sh, sub) => {
    if (active && sub.id !== active.id) return;
    const handler = SHAPES[sh.type];
    if (!handler?.hitDistance) return;
    const d = handler.hitDistance(sh, wp);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = sh;
    }
  });
  return best;
}

// Anything on a non-active layer that's near the click — used to detect
// "you're probably trying to grab something on another layer" and surface the
// hint modal after a couple of misses.
function findOtherLayerShapeAt(wp) {
  const active = activeSublayer();
  if (!active) return null;
  // Generous radius: a few inches in world units, but at least the standard
  // hit slop converted from pixels so the magnet feels right at any zoom.
  const tolWorld = Math.max(SHAPE_HIT / effectiveScale(), 0.5);
  let best = null;
  let bestDist = Infinity;
  forEachVisibleShape((sh, sub) => {
    if (sub.id === active.id) return;
    const handler = SHAPES[sh.type];
    if (!handler?.hitDistance) return;
    const d = handler.hitDistance(sh, wp);
    if (d <= tolWorld && d < bestDist) {
      bestDist = d;
      best = { shape: sh, sub };
    }
  });
  return best;
}

function hasOtherLayerShapesInBox(x1, y1, x2, y2) {
  const active = activeSublayer();
  if (!active) return false;
  let found = false;
  forEachVisibleShape((sh, sub) => {
    if (found) return;
    if (sub.id === active.id) return;
    const b = shapeBBox(sh);
    if (b.x2 < x1 || b.x1 > x2 || b.y2 < y1 || b.y1 > y2) return;
    found = true;
  });
  return found;
}

// Bumped on any "empty" interaction that landed near a shape on a non-active
// layer; cleared on any successful select / explicit dismissal / layer
// switch. Once it crosses the threshold we open the layer-hint modal.
const CROSS_LAYER_MISS_THRESHOLD = 4;
function bumpCrossLayerMiss() {
  state.crossLayerMisses = (state.crossLayerMisses || 0) + 1;
  if (state.crossLayerMisses >= CROSS_LAYER_MISS_THRESHOLD) {
    showLayerHintModal();
    state.crossLayerMisses = 0;
  }
}
function resetCrossLayerMisses() { state.crossLayerMisses = 0; }

function shapeBBox(sh) {
  return SHAPES[sh.type].bbox(sh);
}

function getSelectedShapes() {
  const list = [];
  forEachShape((sh) => { if (state.selection.has(sh.id)) list.push(sh); });
  return list;
}

function selectionBBox() {
  const shapes = getSelectedShapes();
  if (!shapes.length) return null;
  let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
  for (const sh of shapes) {
    const b = shapeBBox(sh);
    if (b.x1 < xa) xa = b.x1;
    if (b.y1 < ya) ya = b.y1;
    if (b.x2 > xb) xb = b.x2;
    if (b.y2 > yb) yb = b.y2;
  }
  return { x1: xa, y1: ya, x2: xb, y2: yb };
}

// Returns an oriented selection rectangle { cx, cy, halfW, halfH, angle } when
// exactly one shape is selected and the shape has a meaningful orientation.
// Used by drawSelection / handle hit-test / resize so the marquee, handles,
// and resize math all rotate with the shape rather than fighting world axes.
// Returns null for multi-shape selection or shapes without a single rotation.
function selectionOrientedBox() {
  if (state.selection.size !== 1) return null;
  let sh = null;
  for (const id of state.selection) sh = findShapeById(id);
  if (!sh) return null;

  if (sh.type === "line" || sh.type === "measure") {
    const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const angle = Math.atan2(dy, dx);
    let halfH = 0;
    let cx = (sh.x1 + sh.x2) / 2;
    let cy = (sh.y1 + sh.y2) / 2;
    // Thick walls aren't 1D — let the marquee hug both faces.
    if (sh.type === "line" && sh.thickness > 0) {
      halfH = sh.thickness / 2;
    }
    // For a measurement, the offset dimension line runs parallel to the points
    // it's measuring. Stretch the oriented marquee perpendicular so it hugs
    // both the witness baseline and the dim line.
    if (sh.type === "measure") {
      const offset = sh.offset || 0;
      halfH = Math.abs(offset) / 2;
      const nx = -dy / len, ny = dx / len;
      cx += nx * offset / 2;
      cy += ny * offset / 2;
    }
    return {
      cx, cy,
      halfW: len / 2,
      halfH,
      angle,
    };
  }

  // Generic path for shapes whose bbox is computed from sh.angle: temporarily
  // de-rotate, take the local-frame bbox, then map its center back to world.
  if (["door", "window", "text"].includes(sh.type) &&
      typeof sh.angle === "number") {
    return orientedBoxFromShape(sh);
  }

  // Appliances only get an oriented box when actually rotated. At angle 0 the
  // existing axis-aligned resize path knows how to scale width/depth (islands);
  // routing it through the oriented path would lose that.
  if (sh.type === "appliance" && Math.abs(sh.angle || 0) > 1e-9) {
    return orientedBoxFromShape(sh);
  }

  return null;
}

function orientedBoxFromShape(sh) {
  const angle = sh.angle || 0;
  const tmp = { ...sh, angle: 0 };
  const localBox = SHAPES[sh.type].bbox(tmp);
  const lcx = (localBox.x1 + localBox.x2) / 2;
  const lcy = (localBox.y1 + localBox.y2) / 2;
  const halfW = (localBox.x2 - localBox.x1) / 2;
  const halfH = (localBox.y2 - localBox.y1) / 2;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const cx = sh.x + (lcx - sh.x) * cosA - (lcy - sh.y) * sinA;
  const cy = sh.y + (lcx - sh.x) * sinA + (lcy - sh.y) * cosA;
  return { cx, cy, halfW, halfH, angle };
}

// Local handle positions in oriented-rect coordinates (origin at center).
function getHandlePositionsLocal(ob) {
  return {
    nw: { x: -ob.halfW, y: -ob.halfH },
    n:  { x: 0,         y: -ob.halfH },
    ne: { x:  ob.halfW, y: -ob.halfH },
    e:  { x:  ob.halfW, y: 0         },
    se: { x:  ob.halfW, y:  ob.halfH },
    s:  { x: 0,         y:  ob.halfH },
    sw: { x: -ob.halfW, y:  ob.halfH },
    w:  { x: -ob.halfW, y: 0         },
  };
}

// World-space corner/edge handle positions for an oriented rect.
function getHandlePositionsOriented(ob) {
  const cosA = Math.cos(ob.angle), sinA = Math.sin(ob.angle);
  const local = getHandlePositionsLocal(ob);
  const out = {};
  for (const name in local) {
    const lp = local[name];
    out[name] = {
      x: ob.cx + lp.x * cosA - lp.y * sinA,
      y: ob.cy + lp.x * sinA + lp.y * cosA,
    };
  }
  return out;
}

function getHandlePositions(bbox) {
  const cx = (bbox.x1 + bbox.x2) / 2;
  const cy = (bbox.y1 + bbox.y2) / 2;
  return {
    nw: { x: bbox.x1, y: bbox.y1 },
    n:  { x: cx,      y: bbox.y1 },
    ne: { x: bbox.x2, y: bbox.y1 },
    e:  { x: bbox.x2, y: cy      },
    se: { x: bbox.x2, y: bbox.y2 },
    s:  { x: cx,      y: bbox.y2 },
    sw: { x: bbox.x1, y: bbox.y2 },
    w:  { x: bbox.x1, y: cy      },
  };
}

// True when the selection contains anything that should NOT show edge resize
// handles. Islands are the one exception among appliances — but only when
// axis-aligned (resize math doesn't preserve rotation cleanly).
function hasOpeningSelected() {
  let found = false;
  forEachShape((sh) => {
    if (!state.selection.has(sh.id)) return;
    const v = SHAPES[sh.type]?.isOpening;
    if (typeof v === "function" ? v(sh) : v) found = true;
  });
  return found;
}

// True when the only selection is a single line (or measure dimension) —
// thick or thin. For these shapes, edge / corner resize handles are wrong:
// the shape is conceptually 1-D, so dragging the NW corner of the bbox
// would snap the wall's outer face to a grid intersection, leaving the
// centerline (the part the user actually dimensions to) off-grid. We
// suppress those handles and let the user resize via E/W endpoints only,
// which sit on the centerline endpoints regardless of thickness.
function selectionIsLineLike() {
  if (state.selection.size !== 1) return false;
  let sh = null;
  for (const id of state.selection) sh = findShapeById(id);
  return !!(sh && (sh.type === "line" || sh.type === "measure"));
}

function findHandleAtScreen(sx, sy, bbox, ob) {
  const handles = ob ? getHandlePositionsOriented(ob) : getHandlePositions(bbox);
  const skipResize = hasOpeningSelected();

  if (!skipResize) {
    const lineLike = selectionIsLineLike() || (ob && ob.halfH < 1e-6);
    for (const name in handles) {
      if (lineLike && name !== "e" && name !== "w") continue;
      const sp = worldToScreen(handles[name].x, handles[name].y);
      if (Math.abs(sx - sp.x) <= HANDLE_HIT && Math.abs(sy - sp.y) <= HANDLE_HIT) return name;
    }
  }

  const corners = ["nw", "ne", "se", "sw"];
  for (const c of corners) {
    const sp = worldToScreen(handles[c].x, handles[c].y);
    const dx = sx - sp.x, dy = sy - sp.y;
    const dist = Math.hypot(dx, dy);
    if (dist < ROT_INNER || dist > ROT_OUTER) continue;
    let outside;
    if (ob) {
      // Hit-test in the oriented frame so the rotation ring sits just outside
      // the rotated rectangle, not the world bbox.
      const wp = screenToWorld(sx, sy);
      const cosA = Math.cos(-ob.angle), sinA = Math.sin(-ob.angle);
      const lx = (wp.x - ob.cx) * cosA - (wp.y - ob.cy) * sinA;
      const ly = (wp.x - ob.cx) * sinA + (wp.y - ob.cy) * cosA;
      outside = Math.abs(lx) > ob.halfW || Math.abs(ly) > ob.halfH;
    } else {
      const tl = worldToScreen(bbox.x1, bbox.y1);
      const br = worldToScreen(bbox.x2, bbox.y2);
      outside = sx < tl.x || sx > br.x || sy < tl.y || sy > br.y;
    }
    if (outside) return "rotate-" + c;
  }
  return null;
}

function oppositeAnchor(handle, bbox, ob) {
  if (ob) {
    // Anchors live at the opposite handle on the oriented rectangle, mapped
    // back to world coordinates.
    const local = getHandlePositionsLocal(ob);
    const opp = {
      nw: "se", n: "s", ne: "sw",
      e: "w",          w: "e",
      sw: "ne", s: "n", se: "nw",
    }[handle];
    const lp = local[opp] || { x: 0, y: 0 };
    const cosA = Math.cos(ob.angle), sinA = Math.sin(ob.angle);
    return {
      x: ob.cx + lp.x * cosA - lp.y * sinA,
      y: ob.cy + lp.x * sinA + lp.y * cosA,
    };
  }
  const cx = (bbox.x1 + bbox.x2) / 2;
  const cy = (bbox.y1 + bbox.y2) / 2;
  switch (handle) {
    case "nw": return { x: bbox.x2, y: bbox.y2 };
    case "n":  return { x: cx,      y: bbox.y2 };
    case "ne": return { x: bbox.x1, y: bbox.y2 };
    case "e":  return { x: bbox.x1, y: cy      };
    case "se": return { x: bbox.x1, y: bbox.y1 };
    case "s":  return { x: cx,      y: bbox.y1 };
    case "sw": return { x: bbox.x2, y: bbox.y1 };
    case "w":  return { x: bbox.x2, y: cy      };
  }
  return { x: cx, y: cy };
}

function snapshotSelected() {
  const map = new Map();
  forEachShape((sh) => {
    if (state.selection.has(sh.id)) {
      map.set(sh.id, SHAPES[sh.type].capture(sh));
    }
  });
  return map;
}

function cursorForHandle(h) {
  if (h && h.startsWith("rotate")) return "grab";
  return ({
    nw: "nwse-resize", se: "nwse-resize",
    ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize",
    e: "ew-resize", w: "ew-resize",
  })[h] || "default";
}

function updateSelectCursor(sp) {
  if (state.selectionMode) return;
  if (curveHandleHitAt(sp)) { canvas.style.cursor = "grab"; return; }
  if (state.selection.size > 0) {
    const bbox = selectionBBox();
    if (bbox) {
      const ob = selectionOrientedBox();
      const h = findHandleAtScreen(sp.x, sp.y, bbox, ob);
      if (h) { canvas.style.cursor = cursorForHandle(h); return; }
    }
  }
  // Page edge takes the same cursor as a movable shape so the user
  // recognizes it as draggable.
  if (findPageEdgeAtScreen(sp.x, sp.y)) {
    canvas.style.cursor = "move";
    return;
  }
  const hit = findShapeAtScreen(sp.x, sp.y);
  canvas.style.cursor = hit ? "move" : "default";
}


// ---------- Selection ops ----------
function deleteSelected() {
  if (!state.selection.size) return;
  pushHistory(`Deleted ${state.selection.size} shape${state.selection.size === 1 ? "" : "s"}`);
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      sub.shapes = sub.shapes.filter((sh) => !state.selection.has(sh.id));
    }
  }
  state.selection.clear();
}

function duplicateSelected() {
  if (!state.selection.size) return;
  pushHistory(`Duplicated ${state.selection.size} shape${state.selection.size === 1 ? "" : "s"}`);
  const offset = Math.max(state.gridSize, 1);
  const newIds = new Set();
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      const dups = [];
      for (const sh of sub.shapes) {
        if (state.selection.has(sh.id)) {
          const copy = { ...sh, id: makeId("X") };
          SHAPES[sh.type].duplicate(copy, sh, offset);
          dups.push(copy);
          newIds.add(copy.id);
        }
      }
      sub.shapes.push(...dups);
    }
  }
  state.selection = newIds;
}


// ---------- Select-tool transforms ----------
function startPageMove(sheet, wp) {
  state.activeSheetId = sheet.id;
  state.selection.clear();
  state.selectionMode = "page-move";
  state.selectionData = {
    sheet,
    startWorld: { x: wp.x, y: wp.y },
    origOrigin: { x: sheet.pageOrigin.x, y: sheet.pageOrigin.y },
  };
  renderSheetList();
  render();
}

function applyPageMove(wp) {
  const data = state.selectionData;
  if (!data || !data.sheet || !data.origOrigin) return;
  let dx = wp.x - data.startWorld.x;
  let dy = wp.y - data.startWorld.y;
  // Half-grid snap on the delta — same convention shape moves use, so
  // pages land on the same gridlines as everything else when snap is on.
  const sd = snapDelta(dx, dy);
  dx = sd.dx; dy = sd.dy;
  data.sheet.pageOrigin = {
    x: data.origOrigin.x + dx,
    y: data.origOrigin.y + dy,
  };
}

function startMove(wp) {
  state.selectionMode = "move";
  state.selectionData = {
    startWorld: wp,
    originalShapes: snapshotSelected(),
    historyPushed: false,
  };
}

function startResize(handle, bbox, ob) {
  state.selectionMode = "resize";
  state.selectionData = {
    handle,
    anchor: oppositeAnchor(handle, bbox, ob),
    startBBox: { ...bbox },
    orientedBox: ob ? { ...ob } : null,
    originalShapes: snapshotSelected(),
    historyPushed: false,
  };
}

function startRotate(wp, bbox, ob) {
  const cx = ob ? ob.cx : (bbox.x1 + bbox.x2) / 2;
  const cy = ob ? ob.cy : (bbox.y1 + bbox.y2) / 2;
  state.selectionMode = "rotate";
  state.selectionData = {
    pivot: { x: cx, y: cy },
    startAngle: Math.atan2(wp.y - cy, wp.x - cx),
    originalShapes: snapshotSelected(),
    historyPushed: false,
  };
}

function applyMove(wp, e) {
  let dx = wp.x - state.selectionData.startWorld.x;
  let dy = wp.y - state.selectionData.startWorld.y;
  // Axis-lock — Shift while dragging constrains motion to the dominant axis,
  // the same convention used by every other vector editor. Picked by which
  // raw delta is larger so the user "commits" to an axis with their cursor.
  if (e?.shiftKey) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const sd = snapDelta(dx, dy);
  dx = sd.dx; dy = sd.dy;
  const orig = state.selectionData.originalShapes;
  forEachShape((sh) => {
    const o = orig.get(sh.id);
    if (!o) return;
    SHAPES[sh.type].move(sh, o, dx, dy);
  });
}

// Arrow-key nudge: half-grid steps when snap is on, single screen pixel when
// it's off. Runs of presses coalesce into a single undo entry — pushHistory
// only fires on the first press of a "burst", determined by NUDGE_BATCH_MS.
const NUDGE_BATCH_MS = 600;
function nudgeSelected(dx, dy) {
  if (!state.selection.size) return;
  if (state.selectionMode) return; // mid-drag: let the cursor handle it
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - (state.lastNudgeTime || 0) > NUDGE_BATCH_MS) {
    pushHistory("Nudged selection");
  }
  state.lastNudgeTime = now;
  forEachShape((sh) => {
    if (!state.selection.has(sh.id)) return;
    const o = SHAPES[sh.type].capture(sh);
    SHAPES[sh.type].move(sh, o, dx, dy);
    // Wall stubs follow nudged openings the same way they follow a
    // pointer drag — the only difference is granularity.
    if (sh.type === "door" || sh.type === "window") {
      refitWallsForMovedOpening(sh, o.x, o.y, o.angle);
    }
  });
  render();
}

// After a move drag finishes, slide each opening's adjacent wall stubs
// so the cuts track the new H / E. Collect first, refit second — refit
// can splice from the walls layer, which is safe only when we're not
// mid-iteration of any layer.
function refitWallsForMovedOpeningsInSelection(originalShapes) {
  if (!originalShapes) return;
  const moved = [];
  forEachShape((sh) => {
    if (sh.type !== "door" && sh.type !== "window") return;
    if (!state.selection.has(sh.id)) return;
    const o = originalShapes.get(sh.id);
    if (!o) return;
    moved.push({ sh, o });
  });
  for (const { sh, o } of moved) {
    refitWallsForMovedOpening(sh, o.x, o.y, o.angle);
  }
}

function applyResize(wp, e) {
  const { handle, anchor, startBBox, orientedBox, originalShapes } = state.selectionData;
  let scaleX = 1, scaleY = 1;

  // Snap the cursor itself before deriving the scale so the dragged corner /
  // edge always lands on a grid intersection. Anchor stays put (by definition
  // it doesn't move during resize), so the moving side ends up at the snapped
  // cursor position exactly.
  const wpSnapped = state.snap ? snapWorld(wp) : wp;

  const xActive = ["nw", "ne", "sw", "se", "e", "w"].includes(handle);
  const yActive = ["nw", "ne", "sw", "se", "n", "s"].includes(handle);

  if (orientedBox) {
    // Compute scale in oriented frame. Cursor and anchor are de-rotated so the
    // X/Y scale axes track the shape, not the world.
    const cosA = Math.cos(-orientedBox.angle);
    const sinA = Math.sin(-orientedBox.angle);
    const localCursor = {
      x: (wpSnapped.x - orientedBox.cx) * cosA - (wpSnapped.y - orientedBox.cy) * sinA,
      y: (wpSnapped.x - orientedBox.cx) * sinA + (wpSnapped.y - orientedBox.cy) * cosA,
    };
    const localAnchor = {
      x: (anchor.x - orientedBox.cx) * cosA - (anchor.y - orientedBox.cy) * sinA,
      y: (anchor.x - orientedBox.cx) * sinA + (anchor.y - orientedBox.cy) * cosA,
    };
    if (xActive) {
      const refX = handle.includes("e") ? orientedBox.halfW : -orientedBox.halfW;
      const denom = refX - localAnchor.x;
      if (Math.abs(denom) > 1e-6) scaleX = (localCursor.x - localAnchor.x) / denom;
    }
    if (yActive) {
      const refY = handle.includes("s") ? orientedBox.halfH : -orientedBox.halfH;
      const denom = refY - localAnchor.y;
      if (Math.abs(denom) > 1e-6) scaleY = (localCursor.y - localAnchor.y) / denom;
    }
    const isCorner = ["nw", "ne", "sw", "se"].includes(handle);
    if (e?.shiftKey && isCorner) {
      const s = Math.max(Math.abs(scaleX), Math.abs(scaleY));
      scaleX = (scaleX < 0 ? -1 : 1) * s;
      scaleY = (scaleY < 0 ? -1 : 1) * s;
    }
    // Build a world-space transform: world -> oriented local -> scale around
    // local anchor -> back to world. Each shape's resize gets handed this as a
    // generic transform fn so it doesn't need oriented-aware math itself.
    const cosF = Math.cos(orientedBox.angle), sinF = Math.sin(orientedBox.angle);
    const transform = (x, y) => {
      const lx = (x - orientedBox.cx) * cosA - (y - orientedBox.cy) * sinA;
      const ly = (x - orientedBox.cx) * sinA + (y - orientedBox.cy) * cosA;
      const sx = localAnchor.x + (lx - localAnchor.x) * scaleX;
      const sy = localAnchor.y + (ly - localAnchor.y) * scaleY;
      return {
        x: orientedBox.cx + sx * cosF - sy * sinF,
        y: orientedBox.cy + sx * sinF + sy * cosF,
      };
    };
    forEachShape((sh) => {
      const o = originalShapes.get(sh.id);
      if (!o) return;
      // Reuse the shape's rotate plumbing — it already applies a generic
      // point-transform across endpoints / segments / polylines. dAngle = 0
      // keeps sh.angle untouched (this is a scale, not a rotation).
      SHAPES[sh.type].rotate?.(sh, o, transform, 0);
    });
    return;
  }

  if (xActive) {
    const refX = handle.includes("e") ? startBBox.x2 : startBBox.x1;
    const denom = refX - anchor.x;
    if (Math.abs(denom) > 1e-6) scaleX = (wpSnapped.x - anchor.x) / denom;
  }
  if (yActive) {
    const refY = handle.includes("s") ? startBBox.y2 : startBBox.y1;
    const denom = refY - anchor.y;
    if (Math.abs(denom) > 1e-6) scaleY = (wpSnapped.y - anchor.y) / denom;
  }

  const isCorner = ["nw", "ne", "sw", "se"].includes(handle);
  if (e?.shiftKey && isCorner) {
    const s = Math.max(Math.abs(scaleX), Math.abs(scaleY));
    scaleX = (scaleX < 0 ? -1 : 1) * s;
    scaleY = (scaleY < 0 ? -1 : 1) * s;
  }

  forEachShape((sh) => {
    const o = originalShapes.get(sh.id);
    if (!o) return;
    SHAPES[sh.type].resize?.(sh, o, anchor, scaleX, scaleY);
  });
}

function applyRotate(wp, e) {
  const { pivot, startAngle, originalShapes } = state.selectionData;
  let angle = Math.atan2(wp.y - pivot.y, wp.x - pivot.x) - startAngle;
  if (e?.shiftKey) {
    const step = Math.PI / 12; // 15° fine snap with Shift
    angle = Math.round(angle / step) * step;
  } else if (state.snap) {
    const step = Math.PI / 4;  // 45° default snap when grid snap is on
    angle = Math.round(angle / step) * step;
  }
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rot = (x, y) => ({
    x: pivot.x + (x - pivot.x) * cos - (y - pivot.y) * sin,
    y: pivot.y + (x - pivot.x) * sin + (y - pivot.y) * cos,
  });
  forEachShape((sh) => {
    const o = originalShapes.get(sh.id);
    if (!o) return;
    SHAPES[sh.type].rotate(sh, o, rot, angle);
  });
}

function ensureTransformHistory() {
  if (!state.selectionData || state.selectionData.historyPushed) return;
  if (typeof logUserAction === "function") {
    const labels = { move: "Moved selection", resize: "Resized selection", rotate: "Rotated selection", curve: "Curved shape", "page-move": "Moved page" };
    logUserAction(labels[state.selectionMode] || "Edited selection");
  }

  // Curve drag: rewrite the captured shape back to its pre-drag form
  if (state.selectionMode === "curve") {
    const orig = state.selectionData.original;
    const snap = snapshot();
    if (orig) {
      for (const story of snap.stories) {
        for (const sub of story.sublayers) {
          const idx = sub.shapes.findIndex((s) => s.id === orig.id);
          if (idx >= 0) sub.shapes[idx] = { ...orig };
        }
      }
    }
    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future.length = 0;
    state.selectionData.historyPushed = true;
    return;
  }

  const orig = state.selectionData.originalShapes;
  const snap = orig ? snapshot() : null;
  if (snap && orig) {
    for (const story of snap.stories) {
      for (const sub of story.sublayers) {
        for (const sh of sub.shapes) {
          const o = orig.get(sh.id);
          if (o) SHAPES[sh.type].restore(sh, o);
        }
      }
    }
    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future.length = 0;
  }
  state.selectionData.historyPushed = true;
}

// ---------- Select-tool pointer handling ----------
function handleSelectPointerDown(sp, e) {
  const wp = screenToWorld(sp.x, sp.y);

  // Page edge takes priority over shape selection — clicking the dashed
  // paper outline drags the whole page around the canvas. Shapes inside
  // the viewport area are still selectable normally.
  const pageHit = findPageEdgeAtScreen(sp.x, sp.y);
  if (pageHit) {
    startPageMove(pageHit, wp);
    resetCrossLayerMisses();
    return;
  }

  // Curve handle on a single selected line/arc gets first dibs
  const curveShape = curveHandleHitAt(sp);
  if (curveShape) { startCurveDrag(curveShape); return; }

  if (state.selection.size > 0) {
    const bbox = selectionBBox();
    if (bbox) {
      const ob = selectionOrientedBox();
      const h = findHandleAtScreen(sp.x, sp.y, bbox, ob);
      if (h && h.startsWith("rotate")) { startRotate(wp, bbox, ob); return; }
      if (h) { startResize(h, bbox, ob); return; }
    }
  }

  const hit = findShapeAtScreen(sp.x, sp.y);
  if (hit) {
    if (e.shiftKey) {
      if (state.selection.has(hit.id)) state.selection.delete(hit.id);
      else state.selection.add(hit.id);
    } else if (!state.selection.has(hit.id)) {
      state.selection.clear();
      state.selection.add(hit.id);
    }
    if (state.selection.size > 0) startMove(wp);
    resetCrossLayerMisses();
    render();
    return;
  }

  if (!e.shiftKey) state.selection.clear();
  state.marquee = { x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y };
  state.selectionMode = "marquee";
  state.selectionData = {
    initialSelection: new Set(state.selection),
    // Capture the click point so finishSelectionAction can decide between
    // "tiny click" (treat as a click on empty space) and "real drag".
    clickStartWorld: { x: wp.x, y: wp.y },
  };
  render();
}

function handleSelectPointerMove(wp, e) {
  if (state.selectionMode === "marquee") {
    state.marquee.x2 = wp.x;
    state.marquee.y2 = wp.y;
    render();
    return;
  }
  ensureTransformHistory();
  if (state.selectionMode === "move") applyMove(wp, e);
  else if (state.selectionMode === "page-move") applyPageMove(wp);
  else if (state.selectionMode === "resize") applyResize(wp, e);
  else if (state.selectionMode === "rotate") applyRotate(wp, e);
  else if (state.selectionMode === "curve") applyCurveDrag(wp);
  render();
}

function finishSelectionAction() {
  if (state.selectionMode === "curve") finishCurveDrag();
  if (state.selectionMode === "move" && state.selectionData) {
    refitWallsForMovedOpeningsInSelection(state.selectionData.originalShapes);
  }
  if (state.selectionMode === "marquee") {
    const m = state.marquee;
    const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2);
    const y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
    const tinyTol = 2 / effectiveScale();
    const isDrag = (x2 - x1) > tinyTol || (y2 - y1) > tinyTol;
    const initialSel = state.selectionData.initialSelection;
    const active = activeSublayer();

    if (isDrag) {
      const newSel = new Set(initialSel);
      forEachVisibleShape((sh, sub) => {
        // Layer-locked: marquee only collects shapes from the active layer.
        if (active && sub.id !== active.id) return;
        const b = shapeBBox(sh);
        if (b.x2 < x1 || b.x1 > x2 || b.y2 < y1 || b.y1 > y2) return;
        newSel.add(sh.id);
      });
      state.selection = newSel;
      const grew = newSel.size > initialSel.size;
      if (grew) {
        resetCrossLayerMisses();
      } else if (hasOtherLayerShapesInBox(x1, y1, x2, y2)) {
        bumpCrossLayerMiss();
      }
    } else {
      // Tiny marquee = a click on empty space (active layer). If the user
      // landed near something on a non-active layer, that's a likely
      // wrong-layer attempt — count it.
      const click = state.selectionData.clickStartWorld || { x: m.x1, y: m.y1 };
      if (findOtherLayerShapeAt(click)) bumpCrossLayerMiss();
    }
    state.marquee = null;
  }
  state.selectionMode = null;
  state.selectionData = null;
  render();
}

// ---------- Contextual curve drag ----------
function curveHandleHitAt(sp) {
  const shape = curveHandleShape();
  if (!shape) return null;
  const p = curveHandlePoint(shape);
  const sScreen = worldToScreen(p.x, p.y);
  if (Math.hypot(sp.x - sScreen.x, sp.y - sScreen.y) <= HANDLE_HIT) return shape;
  return null;
}

function startCurveDrag(shape) {
  state.selectionMode = "curve";
  state.selectionData = {
    shapeId: shape.id,
    original: { ...shape },
    historyPushed: false,
  };
}

function applyCurveDrag(wp) {
  const data = state.selectionData;
  const shape = findShapeById(data.shapeId);
  if (!shape) return;
  const p = snapWorld(wp);
  if (shape.type === "line") shape.type = "arc";
  shape.mx = p.x;
  shape.my = p.y;
}

function finishCurveDrag() {
  const data = state.selectionData;
  const shape = data ? findShapeById(data.shapeId) : null;
  if (shape && shape.type === "arc") {
    const cross =
      (shape.mx - shape.x1) * (shape.y2 - shape.y1) -
      (shape.my - shape.y1) * (shape.x2 - shape.x1);
    if (Math.abs(cross) < 1e-6) {
      shape.type = "line";
      delete shape.mx;
      delete shape.my;
    }
  }
}

// ---------- Clipboard (cut / copy / paste) ----------
// Paste places shapes on the active layer regardless of which layers the
// originals came from. Round-trip across files is fine since shapes are
// plain JSON.
function copySelected() {
  const out = [];
  forEachShape((sh) => {
    if (state.selection.has(sh.id)) out.push(cloneShape(sh));
  });
  if (out.length) state.clipboard = out;
}

function cutSelected() {
  if (!state.selection.size) return;
  copySelected();
  deleteSelected();
}

// Paste cloned shapes anchored at `worldPos` — the centroid of the
// clipboard's bounding boxes lands on the cursor click. New shape ids,
// new selection. Falls back to a small offset from the originals' centroid
// when no anchor is provided (keyboard paste).
function pasteAt(worldPos) {
  if (!state.clipboard || !state.clipboard.length) return;
  const layer = activeSublayer();
  if (!layer) return;

  let cx = 0, cy = 0, n = 0;
  for (const sh of state.clipboard) {
    const b = SHAPES[sh.type]?.bbox?.(sh);
    if (!b) continue;
    cx += (b.x1 + b.x2) / 2;
    cy += (b.y1 + b.y2) / 2;
    n++;
  }
  if (n === 0) return;
  cx /= n; cy /= n;

  const anchor = worldPos || { x: cx + Math.max(state.gridSize, 1), y: cy + Math.max(state.gridSize, 1) };
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;

  pushHistory(`Pasted ${state.clipboard.length} shape${state.clipboard.length === 1 ? "" : "s"}`);
  state.selection.clear();
  for (const proto of state.clipboard) {
    const copy = cloneShape(proto);
    copy.id = makeId("X");
    SHAPES[copy.type].move?.(copy, proto, dx, dy);
    layer.shapes.push(copy);
    state.selection.add(copy.id);
  }
  render();
}

function selectAllOnActiveLayer() {
  const active = activeSublayer();
  if (!active) return;
  state.selection.clear();
  for (const sh of active.shapes) state.selection.add(sh.id);
}

// ---------- Context menu ----------
function showContextMenu(e) {
  if (!ctxMenuEl) return;
  const hasSelection = state.selection.size > 0;
  const hasClipboard = Array.isArray(state.clipboard) && state.clipboard.length > 0;
  const enabled = {
    cut: hasSelection,
    copy: hasSelection,
    paste: hasClipboard,
    duplicate: hasSelection,
    delete: hasSelection,
    "select-all": !!activeSublayer(),
    deselect: hasSelection,
  };
  for (const item of ctxMenuEl.querySelectorAll(".ctx-item")) {
    item.disabled = !enabled[item.dataset.ctxAction];
  }

  // Anchor for Paste lands wherever the user right-clicked.
  const rect = canvas.getBoundingClientRect();
  state.contextMenuAnchor = screenToWorld(
    e.clientX - rect.left,
    e.clientY - rect.top,
  );

  // Position at the cursor; clamp to viewport so the menu doesn't open
  // off-screen at the right / bottom edge.
  ctxMenuEl.classList.remove("hidden");
  const menuW = ctxMenuEl.offsetWidth || 200;
  const menuH = ctxMenuEl.offsetHeight || 200;
  let left = e.clientX;
  let top = e.clientY;
  if (left + menuW > window.innerWidth - 4)  left = window.innerWidth - menuW - 4;
  if (top  + menuH > window.innerHeight - 4) top  = window.innerHeight - menuH - 4;
  ctxMenuEl.style.left = left + "px";
  ctxMenuEl.style.top  = top  + "px";
}

function hideContextMenu() {
  if (ctxMenuEl) ctxMenuEl.classList.add("hidden");
}

function bindContextMenu() {
  if (!ctxMenuEl) return;
  ctxMenuEl.addEventListener("click", (e) => {
    const item = e.target.closest(".ctx-item");
    if (!item || item.disabled) return;
    const action = item.dataset.ctxAction;
    handleContextAction(action);
    hideContextMenu();
  });
  // Swallow pointerdown on the menu itself so the document-level dismiss
  // listener below doesn't close it before the click lands.
  ctxMenuEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  document.addEventListener("pointerdown", (e) => {
    if (ctxMenuEl.classList.contains("hidden")) return;
    if (e.target.closest("#ctx-menu")) return;
    hideContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ctxMenuEl.classList.contains("hidden")) {
      hideContextMenu();
    }
  });
}

function handleContextAction(action) {
  switch (action) {
    case "cut":         cutSelected(); render(); break;
    case "copy":        copySelected(); break;
    case "paste":       pasteAt(state.contextMenuAnchor); break;
    case "duplicate":   duplicateSelected(); render(); break;
    case "delete":      deleteSelected(); render(); break;
    case "select-all":  selectAllOnActiveLayer(); render(); break;
    case "deselect":    state.selection.clear(); render(); break;
  }
}
