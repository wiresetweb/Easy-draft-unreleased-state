'use strict';

// drawGrid — 1ft and 5ft grid + origin axes.

function drawGrid() {
  const { w, h } = viewSize();
  const scale = effectiveScale();
  const g = state.gridSize * scale;
  if (g < 4) return;
  const op = state.gridOpacity;
  if (op <= 0) return;

  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);

  ctx.save();

  // Slate-tinted grid: light slate (#6B8499) for the 1ft minor grid, mid
  // slate (#4A6274) for the 5ft major grid. Brand orange marks the origin
  // crosshairs so 0,0 reads as a "you are here" anchor.
  ctx.strokeStyle = `rgba(107, 132, 153, ${0.35 * op})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startX = Math.floor(topLeft.x / state.gridSize) * state.gridSize;
  const startY = Math.floor(topLeft.y / state.gridSize) * state.gridSize;
  for (let x = startX; x <= bottomRight.x; x += state.gridSize) {
    const sx = Math.round(worldToScreen(x, 0).x) + 0.5;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
  }
  for (let y = startY; y <= bottomRight.y; y += state.gridSize) {
    const sy = Math.round(worldToScreen(0, y).y) + 0.5;
    ctx.moveTo(0, sy); ctx.lineTo(w, sy);
  }
  ctx.stroke();

  const major = state.gridSize * 5;
  const startMX = Math.floor(topLeft.x / major) * major;
  const startMY = Math.floor(topLeft.y / major) * major;
  ctx.strokeStyle = `rgba(74, 98, 116, ${0.55 * op})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startMX; x <= bottomRight.x; x += major) {
    const sx = Math.round(worldToScreen(x, 0).x) + 0.5;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
  }
  for (let y = startMY; y <= bottomRight.y; y += major) {
    const sy = Math.round(worldToScreen(0, y).y) + 0.5;
    ctx.moveTo(0, sy); ctx.lineTo(w, sy);
  }
  ctx.stroke();

  const origin = worldToScreen(0, 0);
  ctx.strokeStyle = `rgba(232, 96, 44, ${0.40 * op})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(origin.y) + 0.5);
  ctx.lineTo(w, Math.round(origin.y) + 0.5);
  ctx.moveTo(Math.round(origin.x) + 0.5, 0);
  ctx.lineTo(Math.round(origin.x) + 0.5, h);
  ctx.stroke();

  ctx.restore();
}
