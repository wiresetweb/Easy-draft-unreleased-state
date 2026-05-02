'use strict';

// drawArcShape — quadratic bezier arc rendering.

function drawArcShape(sh, color) {
  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (sh.stroke === "dashed") ctx.setLineDash([8, 5]);
  else if (sh.stroke === "dotted") ctx.setLineDash([0.1, 5]);

  const cross = (sh.mx - sh.x1) * (sh.y2 - sh.y1) - (sh.my - sh.y1) * (sh.x2 - sh.x1);
  const a = worldToScreen(sh.x1, sh.y1);
  const b = worldToScreen(sh.x2, sh.y2);
  ctx.beginPath();
  if (Math.abs(cross) < 1e-9 || sh.mx === undefined) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else {
    const Q = bezierControl(sh);
    const q = worldToScreen(Q.x, Q.y);
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(q.x, q.y, b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}
