'use strict';

// drawTextShape

function drawTextShape(sh, color) {
  const c = color || SHAPE_COLOR;
  // fontSize is screen pixels — the text stays the same readable size at any
  // zoom level instead of growing/shrinking with the world.
  const sizePx = Math.max(2, sh.fontSize);
  const pos = worldToScreen(sh.x, sh.y);
  const angle = sh.angle || 0;

  ctx.save();
  ctx.font = `${sizePx}px ${sh.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (angle) {
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    ctx.translate(-pos.x, -pos.y);
  }

  const m = ctx.measureText(sh.text);
  const w = m.width;
  const h = sizePx * 1.15;
  const padX = sizePx * 0.3;
  const padY = sizePx * 0.18;

  if (sh.outline === "box") {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1;
    ctx.strokeRect(pos.x - padX, pos.y - padY, w + padX * 2, h + padY * 2);
  } else if (sh.outline === "bubble") {
    ctx.strokeStyle = c;
    ctx.lineWidth = 1;
    strokeRoundedRect(pos.x - padX, pos.y - padY, w + padX * 2, h + padY * 2, sizePx * 0.45);
  }

  ctx.fillStyle = c;
  ctx.fillText(sh.text, pos.x, pos.y);
  ctx.restore();
}
