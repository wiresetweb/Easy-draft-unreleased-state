'use strict';

// ==============================================================================
// Cabinet builder — preview rendering, modal, build & commit.
// (Cabinet shape rendering lives in render/cabinet.js.)
// ==============================================================================

// ---------- Cabinet builder preview ----------
//
// Two visual stages, gated on how many real (committed) points the user has
// placed so far:
//
//   • 0 points — nothing to preview yet; the cursor's normal hover tint is
//     enough.
//   • 1 point  — only a dashed centerline from the placed node to the
//     snapped cursor, plus the node dot. NO body rendering: with one node
//     there's no path direction, so we can't honestly say which side the
//     cabinet runs on. Showing a body here was the source of the "cabinet
//     shot the wrong way" surprise — better to wait.
//   • 2+ points — full preview with the offset body in cb.side, including
//     the in-progress segment to the cursor (phantom point).
function drawCabinetPreview() {
  const cb = state.cabinetBuilder;
  if (!cb) return;
  if (cb.points.length === 0) return;

  const cursorOverCanvas = isCursorOverCanvas();

  if (cb.points.length >= 2) {
    // Existing behavior — add a phantom point at the snapped cursor so the
    // user sees the segment they're about to commit, then draw the full
    // cabinet body with the current side.
    const points = cb.points.slice();
    if (cursorOverCanvas) {
      const last = points[points.length - 1];
      const snapped = snapCabinetClickToWall(state.cursorWorld);
      if (Math.hypot(snapped.point.x - last.x, snapped.point.y - last.y) > 1e-6) {
        points.push({ x: snapped.point.x, y: snapped.point.y });
      }
    }
    drawCabinetPath(points, cb.depth, cb.side, MEASURE_COLOR, 0.55, cb.layerId);
  } else if (cursorOverCanvas) {
    // Exactly one committed point — rubber-band centerline to the cursor.
    const p1 = cb.points[0];
    const snapped = snapCabinetClickToWall(state.cursorWorld);
    const a = worldToScreen(p1.x, p1.y);
    const b = worldToScreen(snapped.point.x, snapped.point.y);
    ctx.save();
    ctx.strokeStyle = "rgba(232, 96, 44, 0.7)";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(a.x + 0.5, a.y + 0.5);
    ctx.lineTo(b.x + 0.5, b.y + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  // Node dots so each committed corner is visible.
  ctx.save();
  ctx.fillStyle = "rgba(232, 96, 44, 0.95)";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < cb.points.length; i++) {
    const p = worldToScreen(cb.points[i].x, cb.points[i].y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Length label on the in-progress segment — drawn for both stages so the
  // user always sees how far the next click would extend the run.
  if (cursorOverCanvas) {
    const last = cb.points[cb.points.length - 1];
    const snapped = snapCabinetClickToWall(state.cursorWorld);
    const lenFt = Math.hypot(snapped.point.x - last.x, snapped.point.y - last.y);
    if (lenFt > 1e-6) {
      const sp = worldToScreen(snapped.point.x, snapped.point.y);
      drawCursorLabel(formatFeet(lenFt), sp, "rgba(232, 96, 44, 0.95)");
    }
  }
}

// The cabinet modal sits on top of the canvas — clicks on it shouldn't add
// nodes. Detect whether the cursor is currently over the canvas region only.
function isCursorOverCanvas() {
  if (!state.cursorScreen) return false;
  const view = viewSize();
  const sp = state.cursorScreen;
  if (sp.x < 0 || sp.x > view.w || sp.y < 0 || sp.y > view.h) return false;
  if (cabinetModal.classList.contains("hidden")) return true;
  const rect = cabinetModal.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const sxAbs = sp.x + canvasRect.left;
  const syAbs = sp.y + canvasRect.top;
  if (sxAbs >= rect.left && sxAbs <= rect.right && syAbs >= rect.top && syAbs <= rect.bottom) {
    return false;
  }
  return true;
}

// ---------- Cabinet builder ----------
// ---------- Cabinet builder ----------
function bindCabinetModal() {
  cabinetCancelBtn.addEventListener("click", cancelCabinetBuilder);
  cabinetFinishBtn.addEventListener("click", finishCabinetBuilder);

  cabinetDepthInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); applyCabinetDepthInput(); cabinetDepthInput.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cabinetDepthInput.blur(); }
  });
  cabinetDepthInput.addEventListener("blur", applyCabinetDepthInput);

  if (cabinetFlipBtn) cabinetFlipBtn.addEventListener("click", flipCabinetSide);

  // Swallow pointerdowns on the modal so clicks on "Finish" / inputs never
  // also register as a cabinet-builder canvas click.
  cabinetModal.addEventListener("pointerdown", (e) => e.stopPropagation());
}

// Flip the cabinet body to the opposite side of the path. Marks userFlipped
// so the auto-detect that runs at the second-click commit doesn't immediately
// reverse the user's choice.
function flipCabinetSide() {
  const cb = state.cabinetBuilder;
  if (!cb) return;
  cb.side = -cb.side;
  cb.userFlipped = true;
  render();
}

function applyCabinetDepthInput() {
  if (!state.cabinetBuilder) return;
  const v = parseFeet(cabinetDepthInput.value);
  if (v && v > 0) {
    state.cabinetBuilder.depth = v;
    cabinetDepthInput.value = formatFeet(v);
    render();
  } else {
    cabinetDepthInput.value = formatFeet(state.cabinetBuilder.depth);
  }
}

function startCabinetBuilder() {
  const layer = activeSublayer();
  if (!layer) {
    appAlert("Select a layer to build cabinets on.", { title: "No active layer" });
    return;
  }
  const story = activeStory();
  if (!story) return;

  state.cabinetBuilder = {
    points: [],
    depth: DEFAULT_CABINET_DEPTH_FT,
    side: 1,
    layerId: layer.id,
    storyId: story.id,
    // Original world position of the first click (before wall snap), used
    // to figure out which side of the path the user clicked from once the
    // path direction is known at the second click.
    firstClickWorld: null,
    // Has the user manually pressed "Flip Side" (or F) since starting? If
    // so, the second-click auto-detect is suppressed — we trust the user's
    // explicit pick over the inferred one.
    userFlipped: false,
  };
  setTool("cabinet");
  cabinetDepthInput.value = formatFeet(DEFAULT_CABINET_DEPTH_FT);
  // Re-render the palette so the launcher button is replaced by the inline
  // builder UI (the modal element gets moved into the palette body).
  renderPalette();
  render();
}

function cancelCabinetBuilder() {
  state.cabinetBuilder = null;
  detachCabinetModalFromPalette();
  renderPalette(); // bring the launcher button back
  if (state.tool === "cabinet") setTool("select");
  render();
}

function finishCabinetBuilder() {
  if (!state.cabinetBuilder) { detachCabinetModalFromPalette(); return; }
  const cb = state.cabinetBuilder;
  if (cb.points.length >= 2) commitCabinet(cb);
  state.cabinetBuilder = null;
  detachCabinetModalFromPalette();
  renderPalette();
  if (state.tool === "cabinet") setTool("select");
  render();
}

function commitCabinet(cb) {
  let layer = null;
  for (const story of state.stories) {
    const found = story.sublayers.find((l) => l.id === cb.layerId);
    if (found) { layer = found; break; }
  }
  if (!layer) layer = activeSublayer();
  if (!layer) return;

  pushHistory();
  const shape = {
    id: makeId("X"),
    type: "cabinet",
    points: cb.points.map((p) => ({ x: p.x, y: p.y })),
    depth: cb.depth,
    side: cb.side,
  };
  layer.shapes.push(shape);
  state.selection.clear();
  state.selection.add(shape.id);
}

// Cabinet click resolution. Priority: corner-of-something snap (tight
// pixel tolerance, anything in the model) → projection onto the nearest
// thick wall (generous, lets the user click in open room space and still
// land on the wall) → grid snap fallback. Returns { point, wall } where
// wall is the thick-line shape we landed on (or null).
function snapCabinetClickToWall(wp) {
  // Tightest snap first — landing right on a corner endpoint always wins.
  const corner = findNearestEndpoint(wp);
  if (corner) return { point: corner, wall: null };
  // Near a wall: project onto the wall and slide the projection to a
  // half-grid position along the wall direction (snapAlongWall handles
  // both axis-aligned and diagonal walls). Without this, projection
  // landed at whatever fractional position the cursor was perpendicular
  // to — fine for free placement, lousy for clean dimensions.
  const wallSnap = nearestThickWallProjection(wp, 4);
  if (wallSnap) {
    return { point: snapAlongWall(wp.x, wp.y, wallSnap.wall), wall: wallSnap.wall };
  }
  // No wall in range — universal half-grid snap (snapWorld now returns
  // half-grid; see geometry.js for the rationale).
  return { point: state.snap ? snapWorld(wp) : { x: wp.x, y: wp.y }, wall: null };
}

// Closest point on any visible thick wall's centerline within `tolFt` feet
// of `wp`. Lets the cabinet builder treat a click "near" a wall as "on the
// wall" — the user can stand inside a room, point at the back wall, and
// have the cabinet land flush against it.
function nearestThickWallProjection(wp, tolFt) {
  let best = null;
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh.type !== "line" || !sh.thickness) continue;
        const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) continue;
        const t = ((wp.x - sh.x1) * dx + (wp.y - sh.y1) * dy) / len2;
        const tC = Math.max(0, Math.min(1, t));
        const px = sh.x1 + dx * tC, py = sh.y1 + dy * tC;
        // Distance from click to the wall body (centerline minus half
        // thickness — clicks that land inside the wall snap distance is 0).
        const halfT = (sh.thickness || 0) / 2;
        const raw = Math.hypot(wp.x - px, wp.y - py);
        const dist = Math.max(0, raw - halfT);
        if (dist > tolFt) continue;
        if (!best || dist < best.dist) {
          best = { dist, point: { x: px, y: py }, wall: sh };
        }
      }
    }
  }
  return best;
}

// Pop the most recent cabinet-builder point. If the path is now empty,
// also clear the first-click hint so the next click re-anchors. Used by
// the right-click handler — same affordance as Esc / Backspace in CAD
// polyline tools.
function undoLastCabinetPoint() {
  const cb = state.cabinetBuilder;
  if (!cb) return;
  if (cb.points.length === 0) return;
  cb.points.pop();
  if (cb.points.length === 0) cb.firstClickWorld = null;
  render();
}

// Place a cabinet point given the user's screen click. Handles wall snap,
// stores the original click for side resolution, and once the path has two
// points figures out which side of the path the user clicked from — that's
// the room side and the cabinet body extends in that direction.
function placeCabinetPoint(wp) {
  const cb = state.cabinetBuilder;
  if (!cb) return;
  const snapped = snapCabinetClickToWall(wp);
  if (cb.points.length === 0) {
    cb.firstClickWorld = { x: wp.x, y: wp.y };
    cb.points.push({ x: snapped.point.x, y: snapped.point.y });
    return;
  }
  cb.points.push({ x: snapped.point.x, y: snapped.point.y });
  // First time we have a path direction — auto-seed the side from where the
  // user originally clicked. Skipped if the user has manually flipped at
  // any point since the build started; their pick wins.
  if (cb.points.length === 2 && cb.firstClickWorld && !cb.userFlipped) {
    const p1 = cb.points[0], p2 = cb.points[1];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      // n is "left of path" in screen-y-down convention. Dot the original
      // click with n: positive ⇒ user was on the left, negative ⇒ right.
      // Our `side` value drives offsetPolyline in render/cabinet.js;
      // matching it to the click side puts the cabinet body on that side.
      const nx = -dy / len, ny = dx / len;
      const ox = cb.firstClickWorld.x - p1.x;
      const oy = cb.firstClickWorld.y - p1.y;
      const dot = ox * nx + oy * ny;
      cb.side = dot >= 0 ? 1 : -1;
    }
  }
}

