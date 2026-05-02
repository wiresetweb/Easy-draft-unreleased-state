'use strict';

// drawDoorShape (with subtypes: swing, double, sliding, pocket, garage) +
// drawArcSegment helper for door swing arcs.

function drawArcSegment(cx, cy, r, a1, a2) {
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const segs = 24;
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = a1 + delta * t;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawDoorShape(sh, color) {
  const { u, n } = doorAxes(sh);
  const scale = effectiveScale();
  const w = sh.width * scale;
  const H = worldToScreen(sh.x, sh.y);
  const E = { x: H.x + u.x * w, y: H.y + u.y * w };

  ctx.save();
  ctx.strokeStyle = color || SHAPE_COLOR;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (sh.subtype === "sliding") {
    const trackHalf = 0.25 * scale;
    const t1 = { x: H.x - n.x * trackHalf, y: H.y - n.y * trackHalf };
    const t2 = { x: H.x + n.x * trackHalf, y: H.y + n.y * trackHalf };
    const e1 = { x: t1.x + u.x * w, y: t1.y + u.y * w };
    const e2 = { x: t2.x + u.x * w, y: t2.y + u.y * w };

    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(t1.x, t1.y); ctx.lineTo(e1.x, e1.y);
    ctx.moveTo(t2.x, t2.y); ctx.lineTo(e2.x, e2.y);
    ctx.stroke();

    const halfW = w / 2;
    const overlap = halfW * 0.06;
    const off = trackHalf * 0.6;

    const lp1 = { x: H.x - n.x * off, y: H.y - n.y * off };
    const lp2 = { x: lp1.x + u.x * (halfW + overlap), y: lp1.y + u.y * (halfW + overlap) };
    const rp1 = {
      x: H.x + u.x * (halfW - overlap) + n.x * off,
      y: H.y + u.y * (halfW - overlap) + n.y * off,
    };
    const rp2 = { x: rp1.x + u.x * (halfW + overlap), y: rp1.y + u.y * (halfW + overlap) };

    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(lp1.x, lp1.y); ctx.lineTo(lp2.x, lp2.y);
    ctx.moveTo(rp1.x, rp1.y); ctx.lineTo(rp2.x, rp2.y);
    ctx.stroke();

  } else if (sh.subtype === "garage") {
    const tick = 4;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(H.x - n.x * tick, H.y - n.y * tick);
    ctx.lineTo(H.x + n.x * tick, H.y + n.y * tick);
    ctx.moveTo(E.x - n.x * tick, E.y - n.y * tick);
    ctx.lineTo(E.x + n.x * tick, E.y + n.y * tick);
    ctx.stroke();

    const off = 0.18 * scale;
    const p1 = { x: H.x + n.x * off, y: H.y + n.y * off };
    const p2 = { x: E.x + n.x * off, y: E.y + n.y * off };
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    const numSections = Math.max(2, Math.round(sh.width / 2));
    const tickLen = 4;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 1; i < numSections; i++) {
      const t = i / numSections;
      const cx = H.x + u.x * w * t + n.x * off;
      const cy = H.y + u.y * w * t + n.y * off;
      ctx.moveTo(cx - n.x * tickLen, cy - n.y * tickLen);
      ctx.lineTo(cx + n.x * tickLen, cy + n.y * tickLen);
    }
    ctx.stroke();

  } else if (sh.subtype === "pocket") {
    const tick = 4;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(H.x - n.x * tick, H.y - n.y * tick);
    ctx.lineTo(H.x + n.x * tick, H.y + n.y * tick);
    ctx.moveTo(E.x - n.x * tick, E.y - n.y * tick);
    ctx.lineTo(E.x + n.x * tick, E.y + n.y * tick);
    ctx.stroke();

    // Door panel — thin line offset perpendicular to wall
    const panelOff = 0.12 * scale;
    const ps = { x: H.x + n.x * panelOff, y: H.y + n.y * panelOff };
    const pe = { x: E.x + n.x * panelOff, y: E.y + n.y * panelOff };
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(pe.x, pe.y);
    ctx.stroke();

    // Chevron arrow at H end pointing into the wall (in -u direction)
    const arrowLen = 6;
    const aTip = { x: H.x - u.x * arrowLen, y: H.y - u.y * arrowLen };
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(H.x + n.x * arrowLen * 0.6, H.y + n.y * arrowLen * 0.6);
    ctx.lineTo(aTip.x, aTip.y);
    ctx.lineTo(H.x - n.x * arrowLen * 0.6, H.y - n.y * arrowLen * 0.6);
    ctx.stroke();

  } else if (sh.subtype === "double") {
    const halfW = w / 2;
    const M = { x: H.x + u.x * halfW, y: H.y + u.y * halfW };
    const Tl = { x: H.x + n.x * halfW, y: H.y + n.y * halfW };
    const Tr = { x: E.x + n.x * halfW, y: E.y + n.y * halfW };
    const tick = 4;

    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(H.x - n.x * tick, H.y - n.y * tick);
    ctx.lineTo(H.x + n.x * tick, H.y + n.y * tick);
    ctx.moveTo(E.x - n.x * tick, E.y - n.y * tick);
    ctx.lineTo(E.x + n.x * tick, E.y + n.y * tick);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(H.x, H.y); ctx.lineTo(Tl.x, Tl.y);
    ctx.moveTo(E.x, E.y); ctx.lineTo(Tr.x, Tr.y);
    ctx.stroke();

    ctx.lineWidth = 0.9;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    drawArcSegment(H.x, H.y, halfW,
      Math.atan2(M.y - H.y, M.x - H.x),
      Math.atan2(Tl.y - H.y, Tl.x - H.x));
    ctx.stroke();
    ctx.beginPath();
    drawArcSegment(E.x, E.y, halfW,
      Math.atan2(M.y - E.y, M.x - E.x),
      Math.atan2(Tr.y - E.y, Tr.x - E.x));
    ctx.stroke();
    ctx.setLineDash([]);

  } else {
    // swing (default)
    const T = { x: H.x + n.x * w, y: H.y + n.y * w };
    const tick = 4;

    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(H.x - n.x * tick, H.y - n.y * tick);
    ctx.lineTo(H.x + n.x * tick, H.y + n.y * tick);
    ctx.moveTo(E.x - n.x * tick, E.y - n.y * tick);
    ctx.lineTo(E.x + n.x * tick, E.y + n.y * tick);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(H.x, H.y); ctx.lineTo(T.x, T.y);
    ctx.stroke();

    ctx.lineWidth = 0.9;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    drawArcSegment(H.x, H.y, w,
      Math.atan2(E.y - H.y, E.x - H.x),
      Math.atan2(T.y - H.y, T.x - H.x));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}
