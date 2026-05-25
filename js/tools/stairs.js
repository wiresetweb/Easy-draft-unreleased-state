'use strict';

// ==============================================================================
// Stairs builder — geometry, ghost preview, modal, build & place.
// (Per-flight / per-landing rendering lives in render/stairs.js.)
// ==============================================================================

// ---------- Geometry helpers ----------
// ---------- Stairs ----------
// Ray from (ox, oy) in direction (dx, dy), length maxT, intersected with line segment [(ax,ay) - (bx,by)].
// Returns t (distance along ray) or null.
function raySegmentIntersection(ox, oy, dx, dy, maxT, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const cross = dx * sy - dy * sx;
  if (Math.abs(cross) < 1e-9) return null;
  const px = ax - ox;
  const py = ay - oy;
  const t = (px * sy - py * sx) / cross;
  const u = (px * dy - py * dx) / cross;
  if (t < 0 || t > maxT) return null;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  return t;
}

function findWallHit(ox, oy, dx, dy, maxT) {
  const story = activeStory();
  if (!story) return null;
  const wallsLayer = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
  if (!wallsLayer || !wallsLayer.visible) return null;
  let closest = null;
  for (const wall of wallsLayer.shapes) {
    if (wall.type !== "line") continue;
    const t = raySegmentIntersection(ox, oy, dx, dy, maxT, wall.x1, wall.y1, wall.x2, wall.y2);
    if (t !== null && t > 0.01 && (closest === null || t < closest.t)) {
      closest = { t, wall };
    }
  }
  return closest;
}

// If one side of the proposed stairs is within ~7" of a parallel wall, shift the
// start perpendicular so that side lands flush against the wall's near *face*
// (accounting for the wall's framing thickness, not just its centerline).
// Returns { start, hugWallId, hugSideSign }: hugWallId/hugSideSign let the
// stairs re-hug later if that wall's thickness changes (see reflowStairsForWalls).
function snapStairsStartToWall(start, angle, width, hug) {
  const none = { start, hugWallId: null, hugSideSign: 0 };
  if (hug === false) return none;
  const story = activeStory();
  if (!story) return none;
  const wallsLayer = story.sublayers.find((l) => l.name === WALL_LAYER_NAME);
  if (!wallsLayer || !wallsLayer.visible) return none;

  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const n = { x: -u.y, y: u.x };
  const halfW = width / 2;
  const snapTol = 0.6; // ft (~7")
  const parallelTol = 0.97; // |cosθ| threshold for "parallel"

  let bestShift = 0;
  let bestAbs = snapTol;
  let bestWallId = null;
  let bestSign = 0;

  for (const wall of wallsLayer.shapes) {
    if (wall.type !== "line") continue;
    const wdx = wall.x2 - wall.x1;
    const wdy = wall.y2 - wall.y1;
    const wlen = Math.hypot(wdx, wdy);
    if (wlen < 1e-6) continue;
    const wux = wdx / wlen, wuy = wdy / wlen;
    const dot = Math.abs(wux * u.x + wuy * u.y);
    if (dot < parallelTol) continue;

    // Perpendicular offset from start to the wall centerline (signed along n)
    const offN = (start.x - wall.x1) * n.x + (start.y - wall.y1) * n.y;
    const halfT = (wall.thickness || 0) / 2; // wall half-thickness → face plane

    // Shift so the stairs' near side sits flush on the wall's near face.
    //   shiftS1: stairs end up on the -n side (near side +n at -halfT face)
    //   shiftS2: stairs end up on the +n side (near side -n at +halfT face)
    const shiftS1 = -offN - halfW - halfT;
    const shiftS2 = halfW - offN + halfT;

    const pick = Math.abs(shiftS1) < Math.abs(shiftS2)
      ? { shift: shiftS1, sign: -1 }
      : { shift: shiftS2, sign: 1 };
    if (Math.abs(pick.shift) < bestAbs) {
      bestAbs = Math.abs(pick.shift);
      bestShift = pick.shift;
      bestWallId = wall.id;
      bestSign = pick.sign;
    }
  }

  if (bestAbs >= snapTol || !bestWallId) return none;
  return {
    start: { x: start.x + n.x * bestShift, y: start.y + n.y * bestShift },
    hugWallId: bestWallId,
    hugSideSign: bestSign,
  };
}

// Re-hug stairs to a wall whose thickness just changed. Called from the wall
// thickness picker so that drawing a thin line, dropping stairs against it, then
// turning the line into a thick wall slides the stairs out to stay flush with
// the new face instead of overlapping it. `walls` is the set of just-changed
// wall lines. Translates each affected staircase as a rigid body.
function reflowStairsForWalls(walls) {
  if (!Array.isArray(walls) || !walls.length) return;
  const changed = new Map(walls.map((w) => [w.id, w]));
  forEachShape((sh) => {
    if (sh.type !== "stairs" || !sh.hugWallId || !sh.hugSideSign) return;
    const wall = changed.get(sh.hugWallId);
    if (!wall) return;
    const u = { x: Math.cos(sh.angle || 0), y: Math.sin(sh.angle || 0) };
    const n = { x: -u.y, y: u.x };
    const halfW = (sh.width || 0) / 2;
    const halfT = (wall.thickness || 0) / 2;
    const currentOffN = (sh.x - wall.x1) * n.x + (sh.y - wall.y1) * n.y;
    const desiredOffN = sh.hugSideSign * (halfW + halfT);
    const delta = desiredOffN - currentOffN;
    if (Math.abs(delta) < 1e-6) return;
    translateStairsShape(sh, n.x * delta, n.y * delta);
  });
}

// Move a staircase rigidly by (dx, dy) — anchor plus every flight / landing
// vertex. Spiral stairs only carry a single center point.
function translateStairsShape(sh, dx, dy) {
  sh.x += dx;
  sh.y += dy;
  if (!Array.isArray(sh.segments)) return;
  for (const seg of sh.segments) {
    if (seg.type === "flight") {
      seg.x1 += dx; seg.y1 += dy;
      seg.x2 += dx; seg.y2 += dy;
    } else if (seg.type === "landing") {
      seg.x += dx; seg.y += dy;
    }
  }
}

async function buildStairsSegments(start, angle, params) {
  const { width, rise, run, ceilingHeight } = params;
  const numSteps = Math.max(1, Math.ceil(ceilingHeight / rise));
  const totalRun = numSteps * run;

  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const hit = findWallHit(start.x, start.y, u.x, u.y, totalRun + width);

  if (!hit || hit.t >= totalRun) {
    // Fits straight
    return {
      success: true,
      numSteps,
      segments: [{
        type: "flight",
        x1: start.x, y1: start.y,
        x2: start.x + u.x * totalRun, y2: start.y + u.y * totalRun,
        angle, width, run, steps: numSteps, stepStart: 1,
      }],
    };
  }

  // Wall ahead — fit landing before it
  const landingSize = width;
  const buffer = 0.25;
  const stopBeforeWall = hit.t - landingSize - buffer;
  if (stopBeforeWall < run) {
    return { success: false, message: "Not enough space — wall is too close in this direction." };
  }

  const stepsFlight1 = Math.floor(stopBeforeWall / run);
  if (stepsFlight1 < 1) {
    return { success: false, message: "Not enough space for even one step before the wall." };
  }

  const flight1Length = stepsFlight1 * run;
  const flight1End = { x: start.x + u.x * flight1Length, y: start.y + u.y * flight1Length };
  const remainingSteps = numSteps - stepsFlight1;

  if (remainingSteps <= 0) {
    return {
      success: true,
      numSteps,
      segments: [{
        type: "flight",
        x1: start.x, y1: start.y,
        x2: flight1End.x, y2: flight1End.y,
        angle, width, run, steps: stepsFlight1, stepStart: 1,
      }],
    };
  }

  // Pick a turn direction by checking sides at the landing center
  const landingCenter = {
    x: flight1End.x + u.x * landingSize / 2,
    y: flight1End.y + u.y * landingSize / 2,
  };
  const leftPerp = { x: -u.y, y: u.x };
  const rightPerp = { x: u.y, y: -u.x };
  const sideCheckDist = width * 1.5;
  const leftHit = findWallHit(landingCenter.x, landingCenter.y, leftPerp.x, leftPerp.y, sideCheckDist);
  const rightHit = findWallHit(landingCenter.x, landingCenter.y, rightPerp.x, rightPerp.y, sideCheckDist);

  let turnDir;
  if (leftHit && rightHit) {
    return { success: false, message: "Not enough space — walls block both sides at the landing." };
  } else if (leftHit) {
    turnDir = "right";
  } else if (rightHit) {
    turnDir = "left";
  } else {
    // Both sides open at the landing — let the user pick. The dialog's
    // "primary" button is treated as Right and "cancel" (which is the
    // visual left button here) as Left, with Esc treated the same as
    // Left to keep the choice undestructive.
    const goRight = await appConfirm("Both sides are open at the landing — which way should the stairs turn?", {
      title: "Stair turn direction",
      cancelLabel: "Turn left",
      confirmLabel: "Turn right",
    });
    turnDir = goRight ? "right" : "left";
  }

  const newU = turnDir === "left" ? leftPerp : rightPerp;
  const newAngle = Math.atan2(newU.y, newU.x);
  const flight2Start = {
    x: landingCenter.x + newU.x * landingSize / 2,
    y: landingCenter.y + newU.y * landingSize / 2,
  };
  const flight2Length = remainingSteps * run;
  const flight2Hit = findWallHit(flight2Start.x, flight2Start.y, newU.x, newU.y, flight2Length);
  if (flight2Hit && flight2Hit.t < flight2Length) {
    return {
      success: false,
      message: `Not enough space for the second flight (need ${formatFeet(flight2Length)}, only ${formatFeet(flight2Hit.t)} clear).`,
    };
  }
  const flight2End = {
    x: flight2Start.x + newU.x * flight2Length,
    y: flight2Start.y + newU.y * flight2Length,
  };

  return {
    success: true,
    turnDir,
    numSteps,
    segments: [
      { type: "flight", x1: start.x, y1: start.y, x2: flight1End.x, y2: flight1End.y, angle, width, run, steps: stepsFlight1, stepStart: 1 },
      { type: "landing", x: landingCenter.x, y: landingCenter.y, angle, width },
      { type: "flight", x1: flight2Start.x, y1: flight2Start.y, x2: flight2End.x, y2: flight2End.y, angle: newAngle, width, run, steps: remainingSteps, stepStart: stepsFlight1 + 1 },
    ],
  };
}

// ---------- Ghost arrow (in-progress placement preview) ----------
function getStairsArrowEnd() {
  const start = state.stairsDirection.start;
  const cursor = state.cursorWorld;
  if (!state.snap && !state.shiftDown) return cursor;
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return cursor;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snappedAngle = Math.round(angle / step) * step;
  let snappedLen = len;
  if (state.snap) {
    snappedLen = Math.max(state.gridSize, Math.round(len / state.gridSize) * state.gridSize);
  }
  return {
    x: start.x + Math.cos(snappedAngle) * snappedLen,
    y: start.y + Math.sin(snappedAngle) * snappedLen,
  };
}

function drawStairsGhost() {
  if (!state.stairsDirection) return;
  const start = state.stairsDirection.start;
  let endWorld;
  if (state.stairsDirection.angle != null) {
    // Direction has been committed (modal is open) — render a frozen arrow
    const len = state.stairsDirection.length || (state.gridSize * 3);
    endWorld = {
      x: start.x + Math.cos(state.stairsDirection.angle) * len,
      y: start.y + Math.sin(state.stairsDirection.angle) * len,
    };
  } else {
    endWorld = getStairsArrowEnd();
  }
  const a = worldToScreen(start.x, start.y);
  const b = worldToScreen(endWorld.x, endWorld.y);

  ctx.save();
  ctx.strokeStyle = "rgba(232, 96, 44, 0.85)";
  ctx.fillStyle = "rgba(232, 96, 44, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > 6) {
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const headLen = 14, headW = 7;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * headLen + px * headW, b.y - uy * headLen + py * headW);
    ctx.lineTo(b.x - ux * headLen - px * headW, b.y - uy * headLen - py * headW);
    ctx.closePath();
    ctx.fill();
  }

  // Origin dot
  ctx.beginPath();
  ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(232, 96, 44, 0.95)";
  ctx.fill();

  ctx.restore();
}

// ---------- Stairs modal ----------
let stairsActiveTab = "traditional";

function setStairsTab(tab) {
  stairsActiveTab = (tab === "spiral") ? "spiral" : "traditional";
  for (const btn of stairsModal.querySelectorAll(".stairs-tab")) {
    const on = btn.dataset.stairsTab === stairsActiveTab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  }
  for (const panel of stairsModal.querySelectorAll(".stairs-tab-panel")) {
    panel.classList.toggle("hidden", panel.dataset.stairsPanel !== stairsActiveTab);
  }
}

// Clamp a stepper input to a whole number in [0, SPIRAL_MAX_STORIES].
function clampSpiralValue(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(SPIRAL_MAX_STORIES, n);
}

function adjustSpiralStepper(input, delta) {
  if (!input) return;
  input.value = String(clampSpiralValue((parseInt(input.value, 10) || 0) + delta));
}

function bindStairsModal() {
  stairsCancelBtn.addEventListener("click", cancelStairs);
  stairsBuildBtn.addEventListener("click", buildAndPlaceStairs);
  for (const inp of [stairsCeilingInput, stairsRiseInput, stairsRunInput, stairsWidthInput]) {
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); buildAndPlaceStairs(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelStairs(); }
    });
  }

  for (const btn of stairsModal.querySelectorAll(".stairs-tab")) {
    btn.addEventListener("click", () => setStairsTab(btn.dataset.stairsTab));
  }

  // Spiral steppers — arrow buttons nudge the value, manual edits get sanitized.
  for (const stepper of stairsModal.querySelectorAll(".num-stepper")) {
    const input = stepper.querySelector(".num-stepper-input");
    for (const arrow of stepper.querySelectorAll(".num-stepper-btn")) {
      arrow.addEventListener("click", () => {
        adjustSpiralStepper(input, arrow.dataset.step === "up" ? 1 : -1);
      });
    }
    if (input) {
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowUp") { e.preventDefault(); adjustSpiralStepper(input, 1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); adjustSpiralStepper(input, -1); }
        else if (e.key === "Enter") { e.preventDefault(); buildAndPlaceStairs(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelStairs(); }
      });
      input.addEventListener("blur", () => { input.value = String(clampSpiralValue(input.value)); });
    }
  }

  stairsModal.addEventListener("pointerdown", (e) => e.stopPropagation());
}

function showStairsModal() {
  setStairsTab("traditional");
  stairsCeilingInput.value = formatFeet(DEFAULT_STAIRS_CEILING_FT);
  stairsRiseInput.value = formatFeet(DEFAULT_STAIRS_RISE_FT);
  stairsRunInput.value = formatFeet(DEFAULT_STAIRS_RUN_FT);
  stairsWidthInput.value = formatFeet(DEFAULT_STAIRS_WIDTH_FT);
  if (stairsHugWallInput) stairsHugWallInput.checked = true;
  if (stairsSpiralUpInput) stairsSpiralUpInput.value = String(DEFAULT_SPIRAL_STORIES_UP);
  if (stairsSpiralDownInput) stairsSpiralDownInput.value = String(DEFAULT_SPIRAL_STORIES_DOWN);
  stairsModal.classList.remove("hidden");
  setTimeout(() => stairsCeilingInput.focus(), 0);
  trapFocusIn(stairsModal);
}

function hideStairsModal() {
  stairsModal.classList.add("hidden");
  releaseFocusTrap();
}

function cancelStairs() {
  state.stairsDirection = null;
  hideStairsModal();
  render();
}

// Place a finished staircase on the active story's Stairs layer (created on
// demand) and select it.
function placeStairsShape(shape) {
  const story = activeStory();
  const layer = getStairsLayer(story);
  if (!layer) {
    appAlert("Add a story before placing stairs.", { title: "No active story" });
    return false;
  }
  pushHistory();
  layer.shapes.push(shape);
  state.selection.clear();
  state.selection.add(shape.id);
  state.stairsDirection = null;
  hideStairsModal();
  // The Stairs layer may have just been created on demand (older documents) —
  // refresh the panels so it appears.
  if (typeof renderLayerTree === "function") renderLayerTree();
  if (typeof renderSheetLayerTree === "function") renderSheetLayerTree();
  render();
  return true;
}

async function buildAndPlaceStairs() {
  if (!state.stairsDirection) { hideStairsModal(); return; }
  if (stairsActiveTab === "spiral") { await buildAndPlaceSpiral(); return; }

  const ceiling = parseFeet(stairsCeilingInput.value);
  const rise = parseFeet(stairsRiseInput.value);
  const run = parseFeet(stairsRunInput.value);
  const width = parseFeet(stairsWidthInput.value);

  if (!ceiling || !rise || !run || !width || ceiling <= 0 || rise <= 0 || run <= 0 || width <= 0) {
    await appAlert("Provide valid feet/inch values for ceiling, rise, run, and width.", { title: "Invalid stair dimensions" });
    return;
  }

  const hug = !stairsHugWallInput || stairsHugWallInput.checked;
  const { start: rawStart, angle } = state.stairsDirection;
  const { start, hugWallId, hugSideSign } = snapStairsStartToWall(rawStart, angle, width, hug);
  const result = await buildStairsSegments(start, angle, { width, rise, run, ceilingHeight: ceiling });

  if (!result.success) {
    await appAlert(result.message, { title: "Couldn't build stairs" });
    return;
  }

  placeStairsShape({
    id: makeId("X"),
    type: "stairs",
    variant: "traditional",
    x: start.x,
    y: start.y,
    angle,
    width,
    rise,
    run,
    ceilingHeight: ceiling,
    segments: result.segments,
    turnDir: result.turnDir || null,
    stepCount: result.numSteps,
    hugWallId,
    hugSideSign,
  });
}

// Spiral staircase — placed centered on the drag-start point. Only asks how
// many stories it climbs / descends; everything else uses sensible defaults.
async function buildAndPlaceSpiral() {
  const up = clampSpiralValue(stairsSpiralUpInput ? stairsSpiralUpInput.value : DEFAULT_SPIRAL_STORIES_UP);
  const down = clampSpiralValue(stairsSpiralDownInput ? stairsSpiralDownInput.value : DEFAULT_SPIRAL_STORIES_DOWN);
  if (up + down < 1) {
    await appAlert("A spiral staircase has to go up and/or down at least one story.", { title: "Set the stories" });
    return;
  }
  const center = state.stairsDirection.start;
  const diameter = DEFAULT_SPIRAL_DIAMETER_FT;
  placeStairsShape({
    id: makeId("X"),
    type: "stairs",
    variant: "spiral",
    x: center.x,
    y: center.y,
    angle: state.stairsDirection.angle || 0,
    diameter,
    radius: diameter / 2,
    storiesUp: up,
    storiesDown: down,
  });
}
