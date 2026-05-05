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
    // Architectural pocket door symbol:
    //   - Jamb ticks at both ends of the opening
    //   - Door panel (thin solid rectangle) inside the opening, closed
    //   - Pocket cavity drawn as a dashed rectangle extending from the
    //     pocket-side jamb back into the wall for the door's full width,
    //     showing where the panel retracts when opened
    // The cavity reads as "hidden inside the wall" thanks to the dashed
    // outline, distinguishing it from a sliding door (which sits in front
    // of the wall face) or a regular door (which has a swing arc).
    const tick = 4;
    const doorThickness = (1.75 / 12) * scale; // 1¾" door
    const halfThick = doorThickness / 2;

    // Jamb ticks
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(H.x - n.x * tick, H.y - n.y * tick);
    ctx.lineTo(H.x + n.x * tick, H.y + n.y * tick);
    ctx.moveTo(E.x - n.x * tick, E.y - n.y * tick);
    ctx.lineTo(E.x + n.x * tick, E.y + n.y * tick);
    ctx.stroke();

    // Door panel rectangle (closed position, in the opening)
    const c1 = { x: H.x - n.x * halfThick, y: H.y - n.y * halfThick };
    const c2 = { x: E.x - n.x * halfThick, y: E.y - n.y * halfThick };
    const c3 = { x: E.x + n.x * halfThick, y: E.y + n.y * halfThick };
    const c4 = { x: H.x + n.x * halfThick, y: H.y + n.y * halfThick };
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.lineTo(c3.x, c3.y);
    ctx.lineTo(c4.x, c4.y);
    ctx.closePath();
    ctx.stroke();

    // Pocket cavity — three dashed sides (back face, end cap, front face)
    // sharing the door's H-side edge. Length matches the door so the
    // cavity is just big enough to swallow the panel.
    const p1 = { x: c1.x - u.x * w, y: c1.y - u.y * w };
    const p4 = { x: c4.x - u.x * w, y: c4.y - u.y * w };
    ctx.lineWidth = 0.9;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y); ctx.lineTo(p1.x, p1.y);
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p4.x, p4.y);
    ctx.moveTo(p4.x, p4.y); ctx.lineTo(c4.x, c4.y);
    ctx.stroke();
    ctx.setLineDash([]);

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
