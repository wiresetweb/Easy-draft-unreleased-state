'use strict';

// drawStairsShape + per-flight / per-landing rendering + up-arrow.

function drawStairsFlight(seg) {
  const u = { x: Math.cos(seg.angle), y: Math.sin(seg.angle) };
  const p = { x: -u.y, y: u.x };
  const halfW = seg.width / 2;

  const c1 = { x: seg.x1 + p.x * halfW, y: seg.y1 + p.y * halfW };
  const c2 = { x: seg.x1 - p.x * halfW, y: seg.y1 - p.y * halfW };
  const c3 = { x: seg.x2 - p.x * halfW, y: seg.y2 - p.y * halfW };
  const c4 = { x: seg.x2 + p.x * halfW, y: seg.y2 + p.y * halfW };

  const sc1 = worldToScreen(c1.x, c1.y);
  const sc2 = worldToScreen(c2.x, c2.y);
  const sc3 = worldToScreen(c3.x, c3.y);
  const sc4 = worldToScreen(c4.x, c4.y);

  ctx.beginPath();
  ctx.moveTo(sc1.x, sc1.y); ctx.lineTo(sc4.x, sc4.y); // far rail
  ctx.moveTo(sc2.x, sc2.y); ctx.lineTo(sc3.x, sc3.y); // near rail
  ctx.moveTo(sc1.x, sc1.y); ctx.lineTo(sc2.x, sc2.y); // start cap
  ctx.moveTo(sc3.x, sc3.y); ctx.lineTo(sc4.x, sc4.y); // end cap
  ctx.stroke();

  // Step lines (riser lines) at each run interval
  ctx.beginPath();
  for (let i = 1; i < seg.steps; i++) {
    const d = i * seg.run;
    const cxw = seg.x1 + u.x * d;
    const cyw = seg.y1 + u.y * d;
    const sl = worldToScreen(cxw + p.x * halfW, cyw + p.y * halfW);
    const sr = worldToScreen(cxw - p.x * halfW, cyw - p.y * halfW);
    ctx.moveTo(sl.x, sl.y);
    ctx.lineTo(sr.x, sr.y);
  }
  ctx.stroke();
}

function drawStairsLanding(seg) {
  const u = { x: Math.cos(seg.angle), y: Math.sin(seg.angle) };
  const p = { x: -u.y, y: u.x };
  const halfW = seg.width / 2;
  // Corner landings stretch along the incoming flight (lengthU) to reach the
  // wall; older square landings (no lengthU) fall back to the width.
  const halfU = (seg.lengthU != null ? seg.lengthU : seg.width) / 2;

  const c1 = { x: seg.x - u.x * halfU + p.x * halfW, y: seg.y - u.y * halfU + p.y * halfW };
  const c2 = { x: seg.x - u.x * halfU - p.x * halfW, y: seg.y - u.y * halfU - p.y * halfW };
  const c3 = { x: seg.x + u.x * halfU - p.x * halfW, y: seg.y + u.y * halfU - p.y * halfW };
  const c4 = { x: seg.x + u.x * halfU + p.x * halfW, y: seg.y + u.y * halfU + p.y * halfW };

  const sc1 = worldToScreen(c1.x, c1.y);
  const sc2 = worldToScreen(c2.x, c2.y);
  const sc3 = worldToScreen(c3.x, c3.y);
  const sc4 = worldToScreen(c4.x, c4.y);

  ctx.beginPath();
  ctx.moveTo(sc1.x, sc1.y);
  ctx.lineTo(sc2.x, sc2.y);
  ctx.lineTo(sc3.x, sc3.y);
  ctx.lineTo(sc4.x, sc4.y);
  ctx.closePath();
  ctx.stroke();
}

function drawStairsUpArrow(sh, color, label) {
  const first = sh.segments && sh.segments[0];
  if (!first || first.type !== "flight") return;
  const u = { x: Math.cos(first.angle), y: Math.sin(first.angle) };
  const startScreen = worldToScreen(first.x1, first.y1);
  const tipWorld = { x: first.x1 + u.x * first.width * 0.55, y: first.y1 + u.y * first.width * 0.55 };
  const tip = worldToScreen(tipWorld.x, tipWorld.y);

  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(startScreen.x, startScreen.y);
  ctx.lineTo(tip.x, tip.y);
  const dx = tip.x - startScreen.x, dy = tip.y - startScreen.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.001) {
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const headLen = 8, headW = 4;
    ctx.moveTo(tip.x - ux * headLen + px * headW, tip.y - uy * headLen + py * headW);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * headLen - px * headW, tip.y - uy * headLen - py * headW);
  }
  ctx.stroke();

  // Direction label — "UP" on the floor the stairs rise from, "DN" on the floor
  // they arrive at (drawn by the cross-story reference pass).
  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = color || SHAPE_COLOR;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label || "UP", tip.x + 6, tip.y);
  ctx.restore();
}

// Spiral plan symbol: outer circle, center post, radial treads, and a
// tangential direction arrow with the up/down label.
function drawSpiralStairs(sh, color, label) {
  const scale = effectiveScale();
  const c = worldToScreen(sh.x, sh.y);
  const R = (sh.radius || (sh.diameter || DEFAULT_SPIRAL_DIAMETER_FT) / 2) * scale;
  if (R < 1) return;
  const postR = Math.max(2, R * 0.16);
  const treads = 12;
  const a0 = sh.angle || 0;

  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.fillStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Outer circle
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.stroke();

  // Radial tread lines from the post out to the rim
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < treads; i++) {
    const a = a0 + (i / treads) * Math.PI * 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    ctx.moveTo(c.x + cosA * postR, c.y + sinA * postR);
    ctx.lineTo(c.x + cosA * R, c.y + sinA * R);
  }
  ctx.stroke();

  // Center post (solid)
  ctx.beginPath();
  ctx.arc(c.x, c.y, postR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Direction arrow: a short tangential arc-arrow plus the label.
  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.fillStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.4;
  const ar = R * 0.62;
  const tipA = a0 + Math.PI * 0.5;
  const tail = worldAngleArrow(c, ar, a0 + Math.PI * 0.15, a0 + Math.PI * 0.5);
  ctx.stroke(tail);
  // Arrowhead at the tip
  const tx = c.x + Math.cos(tipA) * ar, ty = c.y + Math.sin(tipA) * ar;
  const tangent = tipA + Math.PI / 2; // direction of travel along the arc
  const hx = Math.cos(tangent), hy = Math.sin(tangent);
  const px = -hy, py = hx;
  const hl = 7, hw = 3.5;
  ctx.beginPath();
  ctx.moveTo(tx - hx * hl + px * hw, ty - hy * hl + py * hw);
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx - hx * hl - px * hw, ty - hy * hl - py * hw);
  ctx.stroke();

  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(label || "UP", c.x, c.y - R - 8);
  ctx.restore();
}

// Helper: a Path2D arc between two angles (for the spiral direction arrow).
function worldAngleArrow(center, r, aStart, aEnd) {
  const p = new Path2D();
  p.arc(center.x, center.y, r, aStart, aEnd);
  return p;
}

// Shared draw core so the live shape and its cross-story reference share one
// code path. opts: { dashed, label }.
function drawStairsCore(sh, color, opts) {
  opts = opts || {};
  if (sh.variant === "spiral") {
    ctx.save();
    if (opts.dashed) ctx.setLineDash([5, 4]);
    drawSpiralStairs(sh, color, opts.label || "UP");
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (opts.dashed) ctx.setLineDash([5, 4]);
  for (const seg of sh.segments || []) {
    if (seg.type === "flight") drawStairsFlight(seg);
    else if (seg.type === "landing") drawStairsLanding(seg);
  }
  ctx.restore();
  drawStairsUpArrow(sh, color, opts.label || "UP");
}

function drawStairsShape(sh, color) {
  drawStairsCore(sh, color, { label: "UP" });
}

// Cross-story references: a staircase belongs to one story but reaches into the
// floors above / below it. For each visible story a staircase connects to, draw
// a dashed "ghost" of its footprint with the right UP / DN label so the opening
// shows up while you work on that floor. References aren't selectable — they're
// purely a reflection of the source staircase. Traditional stairs rise one
// story (UP here, DN above); spirals span their configured up/down counts.
function drawStairsStoryLinks() {
  if (typeof ensureStoryLevels === "function") ensureStoryLevels();

  const links = []; // { sh, level, label }
  for (const story of state.stories) {
    const baseLevel = typeof story.level === "number" ? story.level : 0;
    for (const sub of story.sublayers) {
      // When the staircase is already drawn on its own (visible) story + layer,
      // skip its references so we don't double-draw / clash UP and DN labels on
      // an overlaid view. References matter when the source floor is hidden.
      const sourceShown = story.visible && sub.visible;
      for (const sh of sub.shapes) {
        if (sh.type !== "stairs" || sourceShown) continue;
        if (sh.variant === "spiral") {
          const up = sh.storiesUp || 0, down = sh.storiesDown || 0;
          for (let d = 1; d <= up; d++) links.push({ sh, level: baseLevel + d, label: "DN" });
          for (let d = 1; d <= down; d++) links.push({ sh, level: baseLevel - d, label: "UP" });
        } else {
          // Traditional run rises one story; it reads "DN" on the floor above.
          links.push({ sh, level: baseLevel + 1, label: "DN" });
        }
      }
    }
  }

  for (const link of links) {
    const target = (typeof getStoryByLevel === "function") ? getStoryByLevel(link.level) : null;
    if (!target || !target.visible) continue;
    const stairsSub = target.sublayers.find((l) => l.name === STAIRS_LAYER_NAME);
    if (stairsSub && !stairsSub.visible) continue;
    const color = (stairsSub && stairsSub.color)
      || DEFAULT_LAYER_COLORS[STAIRS_LAYER_NAME] || SHAPE_COLOR;
    drawStairsCore(link.sh, color, { dashed: true, label: link.label });
  }
}
