'use strict';

// ==============================================================================
// Canvas view — sizing, zoom, render helpers
// ==============================================================================

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function viewSize() {
  const rect = wrap.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

function centerView() {
  const { w, h } = viewSize();
  state.pan.x = w / 2;
  state.pan.y = h / 2;
}

// ---------- Zoom ----------
function setZoom(newZoom, anchorScreen) {
  const z = Math.min(20, Math.max(0.1, newZoom));
  if (anchorScreen) {
    const before = screenToWorld(anchorScreen.x, anchorScreen.y);
    state.zoom = z;
    const after = worldToScreen(before.x, before.y);
    state.pan.x += anchorScreen.x - after.x;
    state.pan.y += anchorScreen.y - after.y;
  } else {
    const { w, h } = viewSize();
    const center = { x: w / 2, y: h / 2 };
    const before = screenToWorld(center.x, center.y);
    state.zoom = z;
    const after = worldToScreen(before.x, before.y);
    state.pan.x += center.x - after.x;
    state.pan.y += center.y - after.y;
  }
  zoomReadout.textContent = Math.round(state.zoom * 100) + "%";
  render();
}

function fillRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
function strokeRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.stroke();
}

// Build a canvas path from world-space sample points (used by arc / measure).
function pathFromSamples(pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const sp = worldToScreen(pts[i].x, pts[i].y);
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
}
