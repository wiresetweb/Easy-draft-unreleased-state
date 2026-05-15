'use strict';

// drawMeasureShape + dimension drawing primitives + helpers used by
// the measure tool and the SHAPES.measure registry entry.

// drawArrowhead helper (used by drawDimension). `scale` grows the arrow with
// the drawing in Plan view; it defaults to 1 (the Draft working view).
function drawArrowhead(tipX, tipY, dirX, dirY, scale) {
  const s = scale || 1;
  const len = 9 * s;
  const halfW = 3 * s;
  const baseX = tipX + dirX * len;
  const baseY = tipY + dirY * len;
  const px = -dirY, py = dirX;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * halfW, baseY + py * halfW);
  ctx.lineTo(baseX - px * halfW, baseY - py * halfW);
  ctx.closePath();
  ctx.fill();
}

// drawMeasureShape
function drawMeasureShape(sh, color) {
  const c = color || MEASURE_COLOR;
  // The stored x1/y1..x2/y2 are the centerline anchors the user placed.
  // For int / ext dimType the line is drawn between the wall faces those
  // anchors call out — see measureAdjustedEndpoints.
  const ep = measureAdjustedEndpoints(sh);
  drawDimension(
    worldToScreen(ep.x1, ep.y1),
    worldToScreen(ep.x2, ep.y2),
    measureAdjustedLength(sh),
    (sh.offset || 0) * effectiveScale(),
    c,
    1.0,
    sh.dimType || "center",
  );
}

// Length to display on the dimension label. For int-to-int / ext-to-ext, look
// for a thick wall passing through each anchor and shrink (or grow) the
// raw center-to-center distance by the wall's half-thickness, projected onto
// the measurement direction. Wall pieces parallel to the measurement
// contribute nothing — the measurement is running along them, not across.
function measureAdjustedLength(sh) {
  const lenFt = Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1);
  const dimType = sh.dimType || "center";
  if (dimType === "center" || lenFt < 1e-9) return lenFt;

  const ux = (sh.x2 - sh.x1) / lenFt;
  const uy = (sh.y2 - sh.y1) / lenFt;

  const adjA = endpointWallShift(sh.x1, sh.y1, ux, uy);
  const adjB = endpointWallShift(sh.x2, sh.y2, ux, uy);
  const total = adjA + adjB;

  if (dimType === "int") return Math.max(0, lenFt - total);
  if (dimType === "ext") return lenFt + total;
  return lenFt;
}

// Visual endpoints of the dimension line. The user places a measurement on
// wall centerlines, but the dimType says which planes they actually mean:
//   • "center" → the anchors as placed (no shift)
//   • "ext"    → each anchor pushed OUT to the wall's exterior face
//   • "int"    → each anchor pulled IN to the wall's interior face
// so the drawn line, witness lines and arrows land on the faces the label
// is calling out instead of stranding on the centerline. Falls back to the
// raw anchors when an int shift would invert the span (wall thicker than
// the measurement).
function measureAdjustedEndpoints(sh) {
  const dimType = sh.dimType || "center";
  const lenFt = Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1);
  const raw = { x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2 };
  if (dimType === "center" || lenFt < 1e-9) return raw;

  const ux = (sh.x2 - sh.x1) / lenFt;
  const uy = (sh.y2 - sh.y1) / lenFt;
  const adjA = endpointWallShift(sh.x1, sh.y1, ux, uy);
  const adjB = endpointWallShift(sh.x2, sh.y2, ux, uy);

  // ext: A retreats along -u, B advances along +u. int: the reverse.
  const sign = dimType === "ext" ? 1 : -1;
  if (dimType === "int" && adjA + adjB >= lenFt) return raw;

  return {
    x1: sh.x1 - ux * adjA * sign,
    y1: sh.y1 - uy * adjA * sign,
    x2: sh.x2 + ux * adjB * sign,
    y2: sh.y2 + uy * adjB * sign,
  };
}

// At a measurement anchor, find the thick wall whose face should set the
// "interior" / "exterior" plane and return how far that face sits from the
// centerline along the measurement direction. Returns 0 when no thick wall
// passes through the anchor (or the wall is parallel to the measurement, in
// which case there's nothing to add to / subtract from).
function endpointWallShift(x, y, ux, uy) {
  let bestDot = 0;
  let bestShift = 0;
  for (const story of state.stories) {
    if (!story.visible) continue;
    for (const sub of story.sublayers) {
      if (sub.name !== WALL_LAYER_NAME || !sub.visible) continue;
      for (const sh of sub.shapes) {
        if (sh.type !== "line" || !sh.thickness) continue;
        // Anchor must lie on the wall's centerline (within a hair).
        if (pointToSegmentDist(x, y, sh.x1, sh.y1, sh.x2, sh.y2) > 1e-3) continue;
        const wdx = sh.x2 - sh.x1, wdy = sh.y2 - sh.y1;
        const wlen = Math.hypot(wdx, wdy);
        if (wlen < 1e-9) continue;
        const wnx = -wdy / wlen, wny = wdx / wlen;
        const dot = Math.abs(wnx * ux + wny * uy);
        // Pick the wall most perpendicular to the measurement — that's the
        // one whose face the user is calling out. At a corner two walls share
        // the anchor; the parallel one would project to ~0 and lose.
        if (dot > bestDot) {
          bestDot = dot;
          bestShift = (sh.thickness / 2) / dot;
        }
      }
    }
  }
  return bestShift;
}

// Suffix shown on the dimension label so a reader can tell at a glance which
// face the dimension is calling out. ¢ is the standard typographic stand-in
// for the centerline symbol (a C with a vertical strike).
function measureTypeSuffix(dimType) {
  if (dimType === "int") return " int. to int.";
  if (dimType === "ext") return " ext. to ext.";
  if (dimType === "center") return " ¢ to ¢";
  return "";
}

// drawDimension — architectural-style dimension with witness lines, arrows, label
function drawDimension(A, B, lenFt, offsetPx, color, alpha, dimType) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;

  // In Plan view the whole drawing is rendered at the sheet's architectural
  // scale (state.zoom == planZoom). With a fixed-pixel label and arrowheads
  // the dimension looks oversized on a small-scale sheet and cramped on a
  // large one — and a small drawing has its measurement numbers swamping
  // the image. Scale every decoration with the drawing so a dimension reads
  // proportionally to what it measures. Draft view keeps the fixed
  // on-screen size — that's a working view, not a composed sheet.
  const s = state.viewMode === "plan" ? state.zoom : 1;

  const Ap = { x: A.x + nx * offsetPx, y: A.y + ny * offsetPx };
  const Bp = { x: B.x + nx * offsetPx, y: B.y + ny * offsetPx };

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";

  // Witness (extension) lines from a small gap off the measured points to a
  // small overshoot past the dimension line.
  if (Math.abs(offsetPx) > 0.5) {
    const sgn = offsetPx >= 0 ? 1 : -1;
    const gap = 2 * s;
    const overshoot = 4 * s;
    const startD = sgn * gap;
    const endD = offsetPx + sgn * overshoot;

    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(A.x + nx * startD, A.y + ny * startD);
    ctx.lineTo(A.x + nx * endD, A.y + ny * endD);
    ctx.moveTo(B.x + nx * startD, B.y + ny * startD);
    ctx.lineTo(B.x + nx * endD, B.y + ny * endD);
    ctx.stroke();
  }

  // Dimension line — leave a small gap at each end so the arrowheads aren't
  // butted into the line tip (cleaner look).
  ctx.lineWidth = 1.25 * s;
  ctx.beginPath();
  ctx.moveTo(Ap.x, Ap.y);
  ctx.lineTo(Bp.x, Bp.y);
  ctx.stroke();

  // Arrowheads pointing inward at each end of the dimension line.
  drawArrowhead(Ap.x, Ap.y, ux, uy, s);
  drawArrowhead(Bp.x, Bp.y, -ux, -uy, s);

  // Upright label rotated parallel to the dimension line.
  const text = formatFeet(lenFt) + measureTypeSuffix(dimType);
  let textAngle = Math.atan2(dy, dx);
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;

  const cx = (Ap.x + Bp.x) / 2;
  const cy = (Ap.y + Bp.y) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(textAngle);

  const fontPx = 12 * s;
  ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif`;
  const m = ctx.measureText(text);
  const padX = 6 * s;
  const w = m.width + padX * 2;
  const h = 18 * s;
  const radius = 4 * s;

  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  ctx.strokeStyle = withAlpha(color, 0.5);
  ctx.lineWidth = 1 * s;
  strokeRoundedRect(-w / 2, -h / 2, w, h, radius);

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);

  ctx.restore();
}

// World-space endpoints of the offset dimension line for a measure shape.
function measureDimEndpoints(sh) {
  const offset = sh.offset || 0;
  const dx = sh.x2 - sh.x1, dy = sh.y2 - sh.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { ax: sh.x1, ay: sh.y1, bx: sh.x2, by: sh.y2 };
  const nx = -dy / len, ny = dx / len;
  return {
    ax: sh.x1 + nx * offset,
    ay: sh.y1 + ny * offset,
    bx: sh.x2 + nx * offset,
    by: sh.y2 + ny * offset,
  };
}

// computeMeasureOffset — default offset (in feet) for a measurement preview.
// Default offset (in feet) for a measurement, sign chosen by the perpendicular
// component of the raw cursor relative to the AB axis. When the user clicks
// exactly on the snap target (perp ~ 0) we default to +grid in the +n direction.
function computeMeasureOffset(start, end, rawCursor) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const g = state.gridSize;
  if (len < 1e-6) return g;
  const nx = -dy / len, ny = dx / len;
  const perp = (rawCursor.x - start.x) * nx + (rawCursor.y - start.y) * ny;
  // Sign comes from which side the cursor is on; magnitude rounds to a whole
  // grid square, with a minimum of one square (the user's stated default).
  if (Math.abs(perp) < 1e-6) return g;
  const sign = perp >= 0 ? 1 : -1;
  return sign * Math.max(g, Math.round(Math.abs(perp) / g) * g);
}
