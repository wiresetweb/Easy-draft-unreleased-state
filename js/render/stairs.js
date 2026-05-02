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

  const c1 = { x: seg.x - u.x * halfW + p.x * halfW, y: seg.y - u.y * halfW + p.y * halfW };
  const c2 = { x: seg.x - u.x * halfW - p.x * halfW, y: seg.y - u.y * halfW - p.y * halfW };
  const c3 = { x: seg.x + u.x * halfW - p.x * halfW, y: seg.y + u.y * halfW - p.y * halfW };
  const c4 = { x: seg.x + u.x * halfW + p.x * halfW, y: seg.y + u.y * halfW + p.y * halfW };

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

function drawStairsUpArrow(sh, color) {
  const first = sh.segments[0];
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

  // "UP" label
  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = color || SHAPE_COLOR;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("UP", tip.x + 6, tip.y);
  ctx.restore();
}

function drawStairsShape(sh, color) {
  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const seg of sh.segments) {
    if (seg.type === "flight") drawStairsFlight(seg);
    else if (seg.type === "landing") drawStairsLanding(seg);
  }
  ctx.restore();
  drawStairsUpArrow(sh, color);
}
