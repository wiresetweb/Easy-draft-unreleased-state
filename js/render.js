'use strict';

// ==============================================================================
// Render dispatch — drawShape via SHAPES registry, glow / selection backgrounds,
// drawAllShapes, render() entrypoint, plus selection rendering and previews.
// ==============================================================================

function drawShape(sh, color, sub) {
  SHAPES[sh.type].draw(sh, color, sub);
}

function drawShapeStrokeUnder(sh, color, lineWidth) {
  const bg = SHAPES[sh.type]?.selectionBg;
  if (bg === "bbox") {
    const b = shapeBBox(sh);
    const tl = worldToScreen(b.x1, b.y1);
    const br = worldToScreen(b.x2, b.y2);
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(tl.x - 2, tl.y - 2, br.x - tl.x + 4, br.y - tl.y + 4);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (bg === "path") {
    pathFromSamples(sampleArcPoints(sh));
  } else {
    const a = worldToScreen(sh.x1, sh.y1);
    const b = worldToScreen(sh.x2, sh.y2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelectedShapeGlow() {
  if (!state.selection.size) return;
  forEachVisibleShape((sh) => {
    if (state.selection.has(sh.id)) drawShapeStrokeUnder(sh, SELECT_GLOW, 6);
  });
}

function drawCurveHover() { /* curve tool removed; in-selection handle handles this */ }

function drawAllShapes() {
  forEachVisibleShape((sh, sub) => drawShape(sh, sub.color || DEFAULT_LAYER_COLOR_FALLBACK, sub));
}

// World-origin reference cross — same affordance the furniture builder
// has, ported over so users orient their drawings around (0, 0). Skipped
// when the origin is well off-screen so it doesn't draw needlessly.
function drawOriginCross() {
  const c = worldToScreen(0, 0);
  const view = viewSize();
  if (c.x < -20 || c.x > view.w + 20) return;
  if (c.y < -20 || c.y > view.h + 20) return;
  ctx.save();
  ctx.strokeStyle = "rgba(232, 96, 44, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(c.x - 8, c.y); ctx.lineTo(c.x + 8, c.y);
  ctx.moveTo(c.x, c.y - 8); ctx.lineTo(c.x, c.y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawPending() {
  if (!state.pending) return;
  if (state.pending.type === "box") {
    const a = worldToScreen(state.pending.start.x, state.pending.start.y);
    const snapped = snapWorld(state.cursorWorld);
    const b = worldToScreen(snapped.x, snapped.y);
    ctx.save();
    ctx.strokeStyle = "rgba(232, 96, 44, 0.85)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeRect(
      Math.min(a.x, b.x), Math.min(a.y, b.y),
      Math.abs(b.x - a.x), Math.abs(b.y - a.y),
    );
    ctx.setLineDash([]);
    ctx.fillStyle = SELECT_COLOR;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const wFt = Math.abs(snapped.x - state.pending.start.x);
    const hFt = Math.abs(snapped.y - state.pending.start.y);
    drawCursorLabel(`${formatFeet(wFt)} × ${formatFeet(hFt)}`, b, "rgba(232, 96, 44, 0.95)");
    return;
  }
  if (state.pending.type !== "line" && state.pending.type !== "measure") return;

  const start = state.pending.start;
  const end = constrainLine(start, state.cursorWorld, state.shiftDown);
  const isMeasure = state.pending.type === "measure";
  const snapped = isMeasure ? snapMeasurePoint(end) : snapWorld(end);
  const a = worldToScreen(start.x, start.y);
  const b = worldToScreen(snapped.x, snapped.y);

  if (isMeasure) {
    // Live preview of the architectural dimension at the auto-offset position.
    const offsetFt = computeMeasureOffset(start, snapped, state.cursorWorld);
    const offsetPx = offsetFt * effectiveScale();
    const lenFt = Math.hypot(snapped.x - start.x, snapped.y - start.y);
    drawDimension(a, b, lenFt, offsetPx, MEASURE_COLOR, 0.6, "center");

    // Mark the pending start so the user can see where they anchored.
    ctx.save();
    ctx.fillStyle = MEASURE_COLOR;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(232, 96, 44, 0.85)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = SELECT_COLOR;
  ctx.beginPath();
  ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
  ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const lenFt = Math.hypot(snapped.x - start.x, snapped.y - start.y);
  drawCursorLabel(formatFeet(lenFt), b, "rgba(232, 96, 44, 0.95)");
}

function drawSnapHint() {
  if (state.tool !== "line" && state.tool !== "measure" && state.selectionMode !== "curve") return;

  // For the measure tool, an endpoint snap takes priority over grid snap and
  // is shown as a red square so the user can tell the cursor is locked to a
  // shape edge rather than a grid intersection.
  if (state.tool === "measure") {
    const ep = findNearestEndpoint(state.cursorWorld);
    if (ep) {
      const s = worldToScreen(ep.x, ep.y);
      ctx.save();
      ctx.strokeStyle = MEASURE_COLOR;
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(s.x - 5, s.y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
  }

  if (!state.snap) return;
  const p = snapWorld(state.cursorWorld);
  const s = worldToScreen(p.x, p.y);
  ctx.save();
  ctx.strokeStyle = "rgba(232, 96, 44, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCursorLabel(text, screenPos, bgColor) {
  ctx.save();
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
  const m = ctx.measureText(text);
  const padX = 8;
  const w = m.width + padX * 2;
  const h = 22;
  const offX = 14, offY = 14;
  let x = screenPos.x + offX;
  let y = screenPos.y - offY - h;

  const view = viewSize();
  if (x + w > view.w - 4) x = screenPos.x - offX - w;
  if (y < 4) y = screenPos.y + offY;

  ctx.fillStyle = bgColor || "rgba(232, 96, 44, 0.95)";
  fillRoundedRect(x, y, w, h, 5);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2);
  ctx.restore();
}

// Returns the world-space curve handle for a single selected line/arc, or null.
function curveHandleShape() {
  if (state.tool !== "select") return null;
  if (state.selection.size !== 1) return null;
  let shape = null;
  for (const id of state.selection) shape = findShapeById(id);
  if (!shape) return null;
  if (shape.type !== "line" && shape.type !== "arc") return null;
  return shape;
}

function curveHandlePoint(shape) {
  if (shape.type === "arc" && shape.mx !== undefined) {
    return { x: shape.mx, y: shape.my };
  }
  return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
}

function drawCurveHandle() {
  if (state.selectionMode === "marquee") return;
  const shape = curveHandleShape();
  if (!shape) return;
  const p = curveHandlePoint(shape);
  const sp = worldToScreen(p.x, p.y);

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Tiny inner dot for affordance
  ctx.fillStyle = SELECT_COLOR;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCurvePreview() { /* unused — handle is drawn live via drawCurveHandle */ }

function drawPlacingPreview() {
  if (!state.placing) return;
  const view = viewSize();
  const sp = state.cursorScreen;
  if (!sp) return;
  if (sp.x < 0 || sp.x > view.w || sp.y < 0 || sp.y > view.h) return;

  const def = state.placing.def;
  const sectionKey = state.placing.sectionKey;

  let shape;
  let pos;
  if (sectionKey === "kitchen" || sectionKey === "furniture" || sectionKey === "bathroom") {
    const wallBack = paletteSkipsWallSnap(sectionKey, def)
      ? null
      : detectWallBackedPosition(state.cursorWorld, def.width, def.depth, applianceWallGap(def.kind));
    if (wallBack) {
      shape = {
        type: "appliance",
        x: wallBack.x, y: wallBack.y,
        width: def.width,
        depth: def.depth,
        angle: wallBack.angle,
        kind: def.kind,
        label: def.name,
      };
      pos = { x: wallBack.x, y: wallBack.y };
    } else {
      pos = snapWorldHalf(state.cursorWorld);
      shape = {
        type: "appliance",
        x: pos.x - def.width / 2,
        y: pos.y - def.depth / 2,
        width: def.width,
        depth: def.depth,
        angle: 0,
        kind: def.kind,
        label: def.name,
      };
    }
    if (def.kind === "custom" && Array.isArray(def.primitives)) {
      shape.primitives = def.primitives;
    }
  } else {
    const depthForAlign = sectionKey === "windows" ? DEFAULT_WINDOW_DEPTH_FT : 0;
    const aligned = detectAlignedPosition(state.cursorWorld, def.width, depthForAlign);
    pos = aligned || snapWorldHalf(state.cursorWorld);
    const angle = aligned ? aligned.angle : 0;

    if (sectionKey === "windows") {
      shape = {
        type: "window",
        x: pos.x, y: pos.y,
        width: def.width,
        depth: DEFAULT_WINDOW_DEPTH_FT,
        angle,
      };
    } else {
      shape = {
        type: "door",
        x: pos.x, y: pos.y,
        width: def.width,
        angle,
        swing: 1,
        subtype: def.subtype || "swing",
      };
    }
  }

  const layer = activeSublayer();
  const previewColor = layer?.color || DEFAULT_LAYER_COLOR_FALLBACK;

  ctx.save();
  ctx.globalAlpha = 0.65;
  drawShape(shape, previewColor);
  ctx.restore();

  drawCursorLabel(def.name, state.cursorScreen, "rgba(232, 96, 44, 0.95)");
}

// ---------- Selection rendering ----------
function drawSelection() {
  if (state.tool !== "select") return;
  if (!state.selection.size) return;
  const bbox = selectionBBox();
  if (!bbox) return;
  const ob = selectionOrientedBox();

  ctx.save();
  ctx.strokeStyle = SELECT_LINE_SOFT;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;

  if (ob) {
    // Lines collapse to a 1D rect (halfH = 0). Inflate in screen space so the
    // marquee is visible without distorting the geometry under it.
    const inflatePx = ob.halfH < 1e-6 ? 6 : 0;
    const scale = effectiveScale();
    const halfWPx = ob.halfW * scale;
    const halfHPx = ob.halfH * scale + inflatePx;
    const cs = worldToScreen(ob.cx, ob.cy);
    ctx.save();
    ctx.translate(cs.x, cs.y);
    ctx.rotate(ob.angle);
    ctx.strokeRect(-halfWPx, -halfHPx, halfWPx * 2, halfHPx * 2);
    ctx.restore();
    ctx.setLineDash([]);
  } else {
    const tl = worldToScreen(bbox.x1, bbox.y1);
    const br = worldToScreen(bbox.x2, bbox.y2);
    ctx.strokeRect(
      Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5,
      Math.round(br.x - tl.x), Math.round(br.y - tl.y)
    );
    ctx.setLineDash([]);
  }

  const handles = ob ? getHandlePositionsOriented(ob) : getHandlePositions(bbox);
  // Lines collapse halfH to 0 — corner / mid-edge handles all overlap with E/W
  // at the endpoints. Drop the duplicates so the user just sees two endpoint
  // squares plus the rotation rings.
  const degenerate = ob && ob.halfH < 1e-6;
  if (!hasOpeningSelected()) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1.5;
    for (const name in handles) {
      if (degenerate && name !== "e" && name !== "w") continue;
      const sp = worldToScreen(handles[name].x, handles[name].y);
      ctx.fillRect(sp.x - 4, sp.y - 4, 8, 8);
      ctx.strokeRect(sp.x - 4, sp.y - 4, 8, 8);
    }
  } else {
    // Show small corner dots so users can see where to grab for rotate
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1.25;
    for (const c of ["nw", "ne", "se", "sw"]) {
      const sp = worldToScreen(handles[c].x, handles[c].y);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMarquee() {
  if (!state.marquee) return;
  const m = state.marquee;
  const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2);
  const y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
  const tl = worldToScreen(x1, y1);
  const br = worldToScreen(x2, y2);

  ctx.save();
  ctx.fillStyle = SELECT_FILL_SOFT;
  ctx.strokeStyle = SELECT_LINE_SOFT;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.restore();
}

// ---------- Render entrypoint ----------
function render() {
  const { w, h } = viewSize();
  ctx.clearRect(0, 0, w, h);

  if (state.viewMode === "plan") {
    // Plan mode: paper layout only. The grid is intentionally absent
    // (printed sheets have no grid) and contextual draw-mode modals are
    // suppressed via body.mode-plan in CSS, so no need to call them here.
    renderPlanView();
    return;
  }

  drawGrid();
  drawOriginCross();
  drawPagesOnCanvas();
  drawSelectedShapeGlow();
  drawAllShapes();
  drawSelection();
  drawCurveHandle();
  drawMarquee();
  drawPlacingPreview();
  drawStairsGhost();
  drawCabinetPreview();
  drawSnapHint();
  drawPending();
  updateDimModal();
  updateLineModal();
  updateTextModal();
  updateMeasureModal();
  updateIslandModal();
}
