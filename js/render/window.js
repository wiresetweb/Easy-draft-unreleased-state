'use strict';

// drawWindowShape

function drawWindowShape(sh, color) {
  const { u, n } = windowAxes(sh);
  const scale = effectiveScale();
  const w = sh.width * scale;
  const d = (sh.depth || DEFAULT_WINDOW_DEPTH_FT) * scale;
  const H = worldToScreen(sh.x, sh.y);

  const p1 = H;
  const p2 = { x: H.x + u.x * w, y: H.y + u.y * w };
  const p3 = { x: p2.x + n.x * d, y: p2.y + n.y * d };
  const p4 = { x: H.x + n.x * d, y: H.y + n.y * d };

  const m1 = { x: H.x + n.x * d / 2, y: H.y + n.y * d / 2 };
  const m2 = { x: m1.x + u.x * w, y: m1.y + u.y * w };

  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.stroke();

  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(m1.x, m1.y);
  ctx.lineTo(m2.x, m2.y);
  ctx.stroke();

  ctx.restore();
}
