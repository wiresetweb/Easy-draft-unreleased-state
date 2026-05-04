'use strict';

// applianceCorners + drawApplianceShape (kitchen appliance plan symbols).

// Returns the four world-space corners of an axis-aligned-then-rotated appliance
// (anchor at sh.x, sh.y, width along u, depth along n).
function applianceCorners(sh) {
  const u = { x: Math.cos(sh.angle || 0), y: Math.sin(sh.angle || 0) };
  const n = { x: -u.y, y: u.x };
  const w = sh.width, d = sh.depth;
  return [
    { x: sh.x,                         y: sh.y                         }, // p1: anchor
    { x: sh.x + u.x * w,               y: sh.y + u.y * w               }, // p2: along u
    { x: sh.x + u.x * w + n.x * d,     y: sh.y + u.y * w + n.y * d     }, // p3
    { x: sh.x + n.x * d,               y: sh.y + n.y * d               }, // p4: along n
  ];
}

// Kinds whose silhouette isn't a rectangle (or who paint their own outline).
// They opt out of the default rect and render their full shape inside the
// kind-specific branch below.
const SUPPRESS_OUTLINE_KINDS = new Set([
  "armchair", "dining-chair", "stool", "floor-lamp", "sectional", "custom",
  // Bathroom fixtures whose silhouette is not a rectangle. Toilets and bidets
  // paint a tank + bowl; pedestal sinks and freestanding tubs are oval; corner
  // pieces are quarter-disc; urinals are D-shaped. Letting the default rect
  // run would box them in and ruin the recognizable plan symbol.
  "toilet", "toilet-round", "toilet-wall", "bidet", "urinal", "lav-pedestal",
  "tub-freestand", "tub-corner", "shower-corner",
]);

function drawApplianceShape(sh, color) {
  const c = color || SHAPE_COLOR;
  const corners = applianceCorners(sh).map((p) => worldToScreen(p.x, p.y));
  const scale = effectiveScale();

  ctx.save();
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.5;

  const cx = (corners[0].x + corners[2].x) / 2;
  const cy = (corners[0].y + corners[2].y) / 2;
  const wPx = sh.width * scale;
  const dPx = sh.depth * scale;

  ctx.translate(cx, cy);
  ctx.rotate(sh.angle || 0);

  // Default rectangular outline — skipped for kinds whose silhouette isn't
  // a rect (a stool's circle, a sectional's L, etc.) so they don't end up
  // boxed in.
  if (!SUPPRESS_OUTLINE_KINDS.has(sh.kind)) {
    ctx.beginPath();
    ctx.rect(-wPx / 2, -dPx / 2, wPx, dPx);
    ctx.stroke();
  }

  if (sh.kind === "range" || sh.kind === "cooktop") {
    const r = Math.min(wPx, dPx) * 0.13;
    const offX = wPx * 0.22, offY = dPx * 0.22;
    ctx.lineWidth = 1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * offX, sy * offY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (sh.kind === "oven") {
    ctx.lineWidth = 1;
    ctx.strokeRect(-wPx * 0.35, -dPx * 0.3, wPx * 0.7, dPx * 0.6);
    ctx.beginPath();
    ctx.moveTo(-wPx * 0.35, -dPx * 0.4);
    ctx.lineTo(wPx * 0.35, -dPx * 0.4);
    ctx.stroke();
  } else if (sh.kind === "fridge") {
    // Door swing line at front (along +u from anchor side, but visualized as a
    // perpendicular line representing the door split).
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-wPx / 2, dPx * 0.35);
    ctx.lineTo(wPx / 2, dPx * 0.35);
    ctx.stroke();
  } else if (sh.kind === "dishwasher") {
    ctx.lineWidth = 1;
    ctx.strokeRect(-wPx * 0.42, -dPx * 0.38, wPx * 0.84, dPx * 0.76);
    ctx.font = `${Math.min(wPx, dPx) * 0.28}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c;
    ctx.fillText("DW", 0, 0);
  } else if (sh.kind === "sink") {
    ctx.lineWidth = 1;
    const bw = wPx * 0.78, bd = dPx * 0.7;
    strokeRoundedRect(-bw / 2, -bd / 2, bw, bd, Math.min(bw, bd) * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(bw, bd) * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  } else if (sh.kind === "sink-double") {
    ctx.lineWidth = 1;
    const bw = wPx * 0.42, bd = dPx * 0.7;
    const gap = wPx * 0.04;
    strokeRoundedRect(-bw - gap / 2, -bd / 2, bw, bd, bw * 0.1);
    strokeRoundedRect(gap / 2, -bd / 2, bw, bd, bw * 0.1);
  } else if (sh.kind === "microwave") {
    ctx.lineWidth = 1;
    ctx.strokeRect(-wPx * 0.4, -dPx * 0.35, wPx * 0.65, dPx * 0.7);
    ctx.beginPath();
    ctx.moveTo(wPx * 0.3, -dPx * 0.35);
    ctx.lineTo(wPx * 0.3, dPx * 0.35);
    ctx.stroke();
  } else if (sh.kind === "cabinet") {
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-wPx / 2, -dPx / 2);
    ctx.lineTo(wPx / 2, dPx / 2);
    ctx.moveTo(wPx / 2, -dPx / 2);
    ctx.lineTo(-wPx / 2, dPx / 2);
    ctx.stroke();
  } else if (sh.kind === "island") {
    drawIslandInterior(sh, c, wPx, dPx);
  } else if (sh.kind === "armchair") {
    // Rounded rectangle IS the chair silhouette — no outer rect needed.
    ctx.lineWidth = 1.2;
    strokeRoundedRect(-wPx / 2, -dPx / 2, wPx, dPx, Math.min(wPx, dPx) * 0.18);
    // Seat-back line: where the back cushion meets the seat.
    ctx.beginPath();
    ctx.moveTo(-wPx / 2, -dPx / 4);
    ctx.lineTo( wPx / 2, -dPx / 4);
    ctx.stroke();
  } else if (sh.kind === "dining-chair") {
    ctx.lineWidth = 1.2;
    strokeRoundedRect(-wPx / 2, -dPx / 2, wPx, dPx, Math.min(wPx, dPx) * 0.14);
    ctx.beginPath();
    ctx.moveTo(-wPx / 2, -dPx / 4);
    ctx.lineTo( wPx / 2, -dPx / 4);
    ctx.stroke();
  } else if (sh.kind === "stool") {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(wPx, dPx) / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (sh.kind === "loveseat" || sh.kind === "sofa") {
    drawSofaInterior(c, wPx, dPx, sh.kind === "loveseat" ? 2 : 3);
  } else if (sh.kind === "sectional") {
    drawSectionalInterior(c, wPx, dPx);
  } else if (sh.kind === "media-console" || sh.kind === "dresser" || sh.kind === "wardrobe") {
    drawCaseGoodsInterior(c, wPx, dPx, sh.kind);
  } else if (sh.kind === "tv-stand" || sh.kind === "tv-wall") {
    // Thin rectangle with a screen line; "tv-wall" implied by very shallow depth.
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-wPx * 0.42, 0);
    ctx.lineTo( wPx * 0.42, 0);
    ctx.stroke();
  } else if (sh.kind === "floor-lamp") {
    // Concentric circles: shade rim (outer, full footprint) + pole (inner).
    const r = Math.min(wPx, dPx) / 2;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  } else if (sh.kind === "toilet" || sh.kind === "toilet-round" || sh.kind === "toilet-wall") {
    drawToiletInterior(c, wPx, dPx, sh.kind);
  } else if (sh.kind === "bidet") {
    drawBidetInterior(c, wPx, dPx);
  } else if (sh.kind === "urinal") {
    drawUrinalInterior(c, wPx, dPx);
  } else if (sh.kind === "lav-pedestal") {
    drawPedestalSinkInterior(c, wPx, dPx);
  } else if (sh.kind === "vanity" || sh.kind === "vanity-double") {
    drawVanityInterior(c, wPx, dPx, sh.kind);
  } else if (sh.kind === "tub-alcove" || sh.kind === "tub-shower") {
    drawAlcoveTubInterior(c, wPx, dPx, sh.kind);
  } else if (sh.kind === "tub-soaker") {
    drawSoakerTubInterior(c, wPx, dPx);
  } else if (sh.kind === "tub-freestand") {
    drawFreestandTubInterior(c, wPx, dPx);
  } else if (sh.kind === "tub-corner") {
    drawCornerTubInterior(c, wPx, dPx);
  } else if (sh.kind === "shower") {
    drawShowerInterior(c, wPx, dPx);
  } else if (sh.kind === "shower-corner") {
    drawCornerShowerInterior(c, wPx, dPx);
  } else if (sh.kind === "washer" || sh.kind === "dryer") {
    drawWasherDryerInterior(c, wPx, dPx, sh.kind);
  } else if (sh.kind === "custom") {
    drawCustomFurnitureInterior(sh, c, scale);
  }

  ctx.restore();
}

// Island label (centered or pushed to a corner) plus an optional elevation
// bar — a counter at raised height marked by a single line parallel to one
// edge of the island.
function drawIslandInterior(sh, c, wPx, dPx) {
  const tagPos = sh.tagPos || "center";
  const minDim = Math.min(wPx, dPx);
  const padPx = minDim * 0.12;

  if (sh.bar) {
    const barInset = minDim * 0.32;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (sh.barSide === "n") {
      ctx.moveTo(-wPx / 2, -dPx / 2 + barInset);
      ctx.lineTo( wPx / 2, -dPx / 2 + barInset);
    } else if (sh.barSide === "s") {
      ctx.moveTo(-wPx / 2,  dPx / 2 - barInset);
      ctx.lineTo( wPx / 2,  dPx / 2 - barInset);
    } else if (sh.barSide === "w") {
      ctx.moveTo(-wPx / 2 + barInset, -dPx / 2);
      ctx.lineTo(-wPx / 2 + barInset,  dPx / 2);
    } else if (sh.barSide === "e") {
      ctx.moveTo( wPx / 2 - barInset, -dPx / 2);
      ctx.lineTo( wPx / 2 - barInset,  dPx / 2);
    }
    ctx.stroke();
  }

  ctx.font = `${minDim * 0.18}px sans-serif`;
  ctx.fillStyle = c;
  let tx = 0, ty = 0, tAlign = "center", tBase = "middle";
  if (tagPos === "nw") { tx = -wPx / 2 + padPx; ty = -dPx / 2 + padPx; tAlign = "left"; tBase = "top"; }
  else if (tagPos === "ne") { tx = wPx / 2 - padPx; ty = -dPx / 2 + padPx; tAlign = "right"; tBase = "top"; }
  else if (tagPos === "sw") { tx = -wPx / 2 + padPx; ty = dPx / 2 - padPx; tAlign = "left"; tBase = "bottom"; }
  else if (tagPos === "se") { tx = wPx / 2 - padPx; ty = dPx / 2 - padPx; tAlign = "right"; tBase = "bottom"; }
  ctx.textAlign = tAlign;
  ctx.textBaseline = tBase;
  ctx.fillText("Island", tx, ty);
}

// Plan-view sofa — back rail, cushion seams, rounded arms. Cushions count
// drives the seam pattern (2 = loveseat, 3 = standard 3-seater sofa).
function drawSofaInterior(c, wPx, dPx, cushions) {
  const back = -dPx * 0.32;        // back rail line
  const armW = Math.min(wPx, dPx) * 0.18;
  ctx.lineWidth = 1;

  // Back rail
  ctx.beginPath();
  ctx.moveTo(-wPx * 0.5 + armW, back);
  ctx.lineTo( wPx * 0.5 - armW, back);
  ctx.stroke();

  // Arm rests (rounded inward)
  ctx.beginPath();
  ctx.moveTo(-wPx * 0.5,         dPx * 0.5);
  ctx.lineTo(-wPx * 0.5,         back);
  ctx.lineTo(-wPx * 0.5 + armW,  back);
  ctx.moveTo( wPx * 0.5,         dPx * 0.5);
  ctx.lineTo( wPx * 0.5,         back);
  ctx.lineTo( wPx * 0.5 - armW,  back);
  ctx.stroke();

  // Cushion seams
  const seatW = wPx - armW * 2;
  ctx.beginPath();
  for (let i = 1; i < cushions; i++) {
    const x = -wPx * 0.5 + armW + (seatW * i) / cushions;
    ctx.moveTo(x, back);
    ctx.lineTo(x, dPx * 0.5);
  }
  ctx.stroke();
}

// L-shape sectional — sofa runs along the back (top) for the full width at
// half depth, chaise extends forward at the right for one-third of the width
// at full depth. The "bite" is the bottom-left rectangle (~2/3 × 1/2 of the
// bbox), which is empty space the user can read as an open corner.
function drawSectionalInterior(c, wPx, dPx) {
  const chaiseLeft = wPx / 6;   // x of the chaise's inner edge (= 2/3 from left)
  const sofaFrontY = 0;          // y of the sofa's front edge (= half depth)

  // Outline (replaces the default rect — sectional is in SUPPRESS_OUTLINE_KINDS).
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-wPx / 2, -dPx / 2);
  ctx.lineTo( wPx / 2, -dPx / 2);
  ctx.lineTo( wPx / 2,  dPx / 2);
  ctx.lineTo(chaiseLeft, dPx / 2);
  ctx.lineTo(chaiseLeft, sofaFrontY);
  ctx.lineTo(-wPx / 2, sofaFrontY);
  ctx.closePath();
  ctx.stroke();

  // Cushion seams — three cushions along the sofa run, plus one seam at the
  // L-fold so the chaise reads as a separate piece.
  ctx.lineWidth = 1;
  ctx.beginPath();
  const sofaWidth = chaiseLeft - (-wPx / 2);
  for (let i = 1; i < 3; i++) {
    const x = -wPx / 2 + (sofaWidth * i) / 3;
    ctx.moveTo(x, -dPx / 2);
    ctx.lineTo(x, sofaFrontY);
  }
  // Chaise back-line (where the back rail wraps onto the chaise side)
  ctx.moveTo(chaiseLeft, sofaFrontY);
  ctx.lineTo( wPx / 2,    sofaFrontY);
  ctx.stroke();
}

// Custom (builder-made) furniture. Coordinates on each primitive are in feet,
// origin at the bbox center. We're already translated + rotated to that center
// in the caller, so just scale to pixels and stroke the primitives.
function drawCustomFurnitureInterior(sh, c, scale) {
  const prims = Array.isArray(sh.primitives) ? sh.primitives : [];
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = c;
  for (const p of prims) {
    ctx.beginPath();
    if (p.type === "line") {
      ctx.moveTo(p.x1 * scale, p.y1 * scale);
      ctx.lineTo(p.x2 * scale, p.y2 * scale);
    } else if (p.type === "rect") {
      const x = p.x * scale, y = p.y * scale;
      const w = p.w * scale, h = p.h * scale;
      const r = Math.max(0, Math.min(w / 2, h / 2, (p.r || 0) * scale));
      if (r > 0) {
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y,     x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x,     y + h, r);
        ctx.arcTo(x,     y + h, x,     y,     r);
        ctx.arcTo(x,     y,     x + w, y,     r);
        ctx.closePath();
      } else {
        ctx.rect(x, y, w, h);
      }
    } else if (p.type === "circle") {
      const rx = (p.rx || p.r || 0) * scale;
      const ry = (p.ry || p.r || 0) * scale;
      ctx.ellipse(p.cx * scale, p.cy * scale, rx, ry, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
}

// Generic case-goods (dresser, media console, wardrobe). Front = bottom of the
// shape (positive depth direction). We draw an interior compartment + door /
// drawer split lines to read appropriately for each kind.
function drawCaseGoodsInterior(c, wPx, dPx, kind) {
  ctx.lineWidth = 1;
  const inset = Math.min(wPx, dPx) * 0.08;
  ctx.strokeRect(-wPx * 0.5 + inset, -dPx * 0.5 + inset, wPx - inset * 2, dPx - inset * 2);

  ctx.beginPath();
  if (kind === "wardrobe") {
    // Two doors meeting at a center seam.
    ctx.moveTo(0, -dPx * 0.5 + inset);
    ctx.lineTo(0,  dPx * 0.5 - inset);
  } else if (kind === "dresser") {
    // Two rows of three drawers.
    for (let i = 1; i < 3; i++) {
      const x = -wPx * 0.5 + (wPx * i) / 3;
      ctx.moveTo(x, -dPx * 0.5 + inset);
      ctx.lineTo(x,  dPx * 0.5 - inset);
    }
    ctx.moveTo(-wPx * 0.5 + inset, 0);
    ctx.lineTo( wPx * 0.5 - inset, 0);
  } else {
    // media-console: open shelf in the middle, drawers / doors flanking.
    const colX = wPx * 0.18;
    ctx.moveTo(-colX, -dPx * 0.5 + inset);
    ctx.lineTo(-colX,  dPx * 0.5 - inset);
    ctx.moveTo( colX, -dPx * 0.5 + inset);
    ctx.lineTo( colX,  dPx * 0.5 - inset);
  }
  ctx.stroke();
}

// ============================ Bathroom fixtures ===========================
// Plan-view symbols. Convention matches the rest of appliance.js: "back" of
// the fixture is at -dPx/2 (top of the bbox in centered coords), "front" at
// +dPx/2, width spans left ↔ right. Dimensions come from the catalog
// (PALETTE_ITEMS.bathroom in state.js) which mirrors residential spec sheets,
// so the on-canvas drawing IS the manufacturer footprint at scale.

// Toilet: tank at the back, elliptical bowl in front, with a seat ring whose
// front opening reads as a U for elongated bowls and a smaller gap for round.
// Wall-hung omits the tank.
function drawToiletInterior(c, wPx, dPx, kind) {
  const isRound = kind === "toilet-round";
  const isWallHung = kind === "toilet-wall";

  let tankD = 0;
  if (!isWallHung) {
    const tankW = wPx * 0.92;
    tankD = dPx * 0.30;
    const tx = -tankW / 2;
    const ty = -dPx / 2;
    ctx.lineWidth = 1.4;
    strokeRoundedRect(tx, ty, tankW, tankD, Math.min(tankW, tankD) * 0.10);

    // Tank lid seam — the line where the lid meets the tank body.
    ctx.lineWidth = 0.7;
    const seamY = ty + tankD - dPx * 0.025;
    ctx.beginPath();
    ctx.moveTo(tx + tankW * 0.06, seamY);
    ctx.lineTo(tx + tankW * 0.94, seamY);
    ctx.stroke();

    // Flush handle — small rectangle on the front-left of the tank.
    ctx.beginPath();
    ctx.rect(tx + tankW * 0.06, ty + tankD * 0.20, tankW * 0.10, tankD * 0.22);
    ctx.stroke();
  }

  // Bowl: ellipse extending forward from the tank. Slight overlap into the
  // tank footprint matches the way real bowls bolt to the tank.
  const overlap = isWallHung ? 0 : dPx * 0.04;
  const bowlBackY = -dPx / 2 + tankD - overlap;
  const bowlFrontY = dPx / 2;
  const bowlD = bowlFrontY - bowlBackY;
  const bowlW = wPx * (isRound ? 0.84 : 0.88);
  const cx = 0;
  const cy = (bowlBackY + bowlFrontY) / 2;
  const rx = bowlW / 2;
  const ry = bowlD / 2;

  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Seat ring — inset, with a small U-opening at the front (canvas y grows
  // downward, so "front" is at angle +π/2).
  ctx.lineWidth = 0.8;
  const seatRx = rx * 0.84;
  const seatRy = ry * 0.84;
  const gap = isRound ? 0.22 : 0.18;
  ctx.beginPath();
  ctx.ellipse(cx, cy, seatRx, seatRy, 0,
              Math.PI / 2 + gap,
              Math.PI / 2 - gap + Math.PI * 2);
  ctx.stroke();
}

// Bidet — same family as a wall-hung toilet, slightly smaller, with a tap
// fitting at the back instead of a tank.
function drawBidetInterior(c, wPx, dPx) {
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, wPx * 0.46, dPx * 0.46, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, dPx * 0.02, wPx * 0.36, dPx * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Tap fitting (rim spray) at the back
  ctx.beginPath();
  ctx.arc(0, -dPx * 0.34, Math.min(wPx, dPx) * 0.045, 0, Math.PI * 2);
  ctx.stroke();
  // Drain at center
  ctx.beginPath();
  ctx.arc(0, dPx * 0.04, Math.min(wPx, dPx) * 0.04, 0, Math.PI * 2);
  ctx.stroke();
}

// Wall-mounted urinal — D-shape with the flat back against the wall.
function drawUrinalInterior(c, wPx, dPx) {
  const rx = wPx * 0.46;
  const ry = dPx * 0.84;
  const backY = -dPx * 0.42;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-rx, backY);
  ctx.lineTo( rx, backY);
  ctx.ellipse(0, backY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.stroke();
  // Drain
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, -dPx * 0.05, Math.min(wPx, dPx) * 0.06, 0, Math.PI * 2);
  ctx.stroke();
}

// Pedestal sink — basin oval centered, with a small back-mounted tap.
function drawPedestalSinkInterior(c, wPx, dPx) {
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, dPx * 0.04, wPx * 0.48, dPx * 0.46, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Inner bowl
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, dPx * 0.06, wPx * 0.34, dPx * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Drain
  ctx.beginPath();
  ctx.arc(0, dPx * 0.06, Math.min(wPx, dPx) * 0.04, 0, Math.PI * 2);
  ctx.stroke();
  // Tap riser at the back of the basin
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -dPx * 0.42);
  ctx.lineTo(0, -dPx * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -dPx * 0.42, Math.min(wPx, dPx) * 0.05, 0, Math.PI * 2);
  ctx.stroke();
}

// Vanity (single or double): outer cabinet rectangle (drawn by the default
// branch), plus countertop edge + drop-in basin(s) + tap on the back wall.
function drawVanityInterior(c, wPx, dPx, kind) {
  const isDouble = kind === "vanity-double";

  // Counter front lip — a thin line just inside the front edge to hint at
  // the countertop overhang.
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-wPx * 0.5, dPx * 0.42);
  ctx.lineTo( wPx * 0.5, dPx * 0.42);
  ctx.stroke();

  const basins = isDouble ? 2 : 1;
  for (let i = 0; i < basins; i++) {
    const segCx = isDouble ? -wPx * 0.25 + i * wPx * 0.5 : 0;
    // Real drop-in basin: ~17"×14" oval. Cap the drawn basin so it never
    // gets wider than the cabinet allows.
    const segW = isDouble ? wPx * 0.42 : Math.min(wPx * 0.62, dPx * 1.6);
    const segD = dPx * 0.62;
    const r = Math.min(segW, segD) * 0.18;
    ctx.lineWidth = 1;
    strokeRoundedRect(segCx - segW / 2, -segD / 2 + dPx * 0.04, segW, segD, r);
    // Drain
    ctx.beginPath();
    ctx.arc(segCx, dPx * 0.05, Math.min(segW, segD) * 0.04, 0, Math.PI * 2);
    ctx.stroke();
    // Faucet riser on the back wall, with a small dot for the spout.
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(segCx, -segD / 2 + dPx * 0.04);
    ctx.lineTo(segCx, -dPx * 0.40);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(segCx, -dPx * 0.40, Math.min(segW, segD) * 0.04, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isDouble) {
    // Center seam between the two cabinet boxes.
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -dPx * 0.5);
    ctx.lineTo(0,  dPx * 0.5);
    ctx.stroke();
  }
}

// Alcove tub — inset basin (offset toward the foot end), drain + faucet at
// the head end. The tub-shower variant adds a shower head and curtain track.
function drawAlcoveTubInterior(c, wPx, dPx, kind) {
  const isShower = kind === "tub-shower";
  const inset = Math.min(wPx, dPx) * 0.08;

  // Inner basin: rounded rectangle inset, shifted slightly to the right so
  // the head end (left) shows the apron / faucet wall.
  const bx = -wPx / 2 + inset * 1.6;
  const by = -dPx / 2 + inset;
  const bw = wPx - inset * 2.6;
  const bd = dPx - inset * 2;
  const br = Math.min(bw, bd) * 0.20;
  ctx.lineWidth = 1.1;
  strokeRoundedRect(bx, by, bw, bd, br);

  // Drain at the head end (left), centered in width.
  const drainCx = bx + br * 0.6;
  drawDrain(drainCx, 0, Math.min(wPx, dPx) * 0.045);

  // Faucet handles + spout on the back wall at the head end.
  const fx = -wPx / 2 + inset * 0.7;
  ctx.lineWidth = 0.9;
  for (const sy of [-dPx * 0.32, dPx * 0.32]) {
    ctx.beginPath();
    ctx.arc(fx, sy, Math.min(wPx, dPx) * 0.04, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(fx, 0, Math.min(wPx, dPx) * 0.03, 0, Math.PI * 2);
  ctx.stroke();

  if (isShower) {
    // Shower head + spray pattern + dashed curtain track along the front edge.
    const headCx = fx;
    const headCy = -dPx * 0.46;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(headCx, headCy, Math.min(wPx, dPx) * 0.06, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.5;
    const r0 = Math.min(wPx, dPx) * 0.07;
    const r1 = Math.min(wPx, dPx) * 0.16;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 6 + (i / 4) * (Math.PI / 3);
      ctx.moveTo(headCx + Math.cos(a) * r0, headCy + Math.sin(a) * r0);
      ctx.lineTo(headCx + Math.cos(a) * r1, headCy + Math.sin(a) * r1);
    }
    ctx.stroke();
    // Curtain rod along the front, dashed.
    ctx.lineWidth = 0.7;
    ctx.setLineDash([Math.min(wPx, dPx) * 0.05, Math.min(wPx, dPx) * 0.04]);
    ctx.beginPath();
    ctx.moveTo(-wPx / 2 + inset * 0.4, dPx / 2 - inset * 0.4);
    ctx.lineTo( wPx / 2 - inset * 0.4, dPx / 2 - inset * 0.4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Soaking tub — generous outer rectangle (deck) with a deeply-rounded basin.
function drawSoakerTubInterior(c, wPx, dPx) {
  const inset = Math.min(wPx, dPx) * 0.10;
  ctx.lineWidth = 1.1;
  strokeRoundedRect(-wPx / 2 + inset, -dPx / 2 + inset,
                    wPx - inset * 2, dPx - inset * 2,
                    Math.min(wPx, dPx) * 0.30);
  drawDrain(0, 0, Math.min(wPx, dPx) * 0.05);
}

// Freestanding tub — oval silhouette (no outer rect), drain at center.
function drawFreestandTubInterior(c, wPx, dPx) {
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, wPx / 2, dPx / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, (wPx / 2) * 0.84, (dPx / 2) * 0.78, 0, 0, Math.PI * 2);
  ctx.stroke();
  drawDrain(0, 0, Math.min(wPx, dPx) * 0.05);
}

// Corner tub — right angle at top-left (room corner), curved edge facing
// the room. Inner basin echoes the outer wedge.
function drawCornerTubInterior(c, wPx, dPx) {
  const r = Math.min(wPx, dPx);
  const ax = -wPx / 2;
  const ay = -dPx / 2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + r, ay);
  ctx.arc(ax, ay, r, 0, Math.PI / 2, false);
  ctx.lineTo(ax, ay);
  ctx.closePath();
  ctx.stroke();

  // Inner basin: smaller wedge offset diagonally.
  const ir = r * 0.74;
  const ibX = ax + r * 0.14;
  const ibY = ay + r * 0.14;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ibX, ibY);
  ctx.lineTo(ibX + ir, ibY);
  ctx.arc(ibX, ibY, ir, 0, Math.PI / 2, false);
  ctx.lineTo(ibX, ibY);
  ctx.closePath();
  ctx.stroke();

  drawDrain(ax + r * 0.34, ay + r * 0.34, r * 0.05);
}

// Rectangular shower — outer rect (default branch) plus a light X across the
// pan, a center drain, and a hinged-door swing arc on the front edge.
function drawShowerInterior(c, wPx, dPx) {
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-wPx / 2, -dPx / 2);
  ctx.lineTo( wPx / 2,  dPx / 2);
  ctx.moveTo( wPx / 2, -dPx / 2);
  ctx.lineTo(-wPx / 2,  dPx / 2);
  ctx.stroke();

  drawDrain(0, 0, Math.min(wPx, dPx) * 0.06);

  // Door swing on the front edge — a quarter arc representing the open door.
  const doorW = Math.min(wPx * 0.6, dPx * 0.85);
  const doorEdgeY = dPx / 2;
  const hingeX = -doorW / 2;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([Math.min(wPx, dPx) * 0.05, Math.min(wPx, dPx) * 0.04]);
  ctx.beginPath();
  ctx.arc(hingeX, doorEdgeY, doorW, -Math.PI / 2, 0, false);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hingeX, doorEdgeY);
  ctx.lineTo(hingeX + doorW, doorEdgeY);
  ctx.stroke();
  // Shower head circle on the back wall, opposite the door hinge.
  ctx.lineWidth = 1;
  const headCx = wPx * 0.30;
  const headCy = -dPx * 0.42;
  ctx.beginPath();
  ctx.arc(headCx, headCy, Math.min(wPx, dPx) * 0.05, 0, Math.PI * 2);
  ctx.stroke();
}

// Corner shower — quarter-disc footprint with a sliding-door arc track.
function drawCornerShowerInterior(c, wPx, dPx) {
  const r = Math.min(wPx, dPx);
  const ax = -wPx / 2;
  const ay = -dPx / 2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + r, ay);
  ctx.arc(ax, ay, r, 0, Math.PI / 2, false);
  ctx.lineTo(ax, ay);
  ctx.closePath();
  ctx.stroke();

  // Sliding-door track (the curved glass), set inside the outline.
  ctx.lineWidth = 0.7;
  ctx.setLineDash([r * 0.05, r * 0.04]);
  ctx.beginPath();
  ctx.arc(ax, ay, r * 0.92, 0, Math.PI / 2, false);
  ctx.stroke();
  ctx.setLineDash([]);

  // Drain near the room corner where the floor slopes to.
  drawDrain(ax + r * 0.40, ay + r * 0.40, r * 0.05);
}

// Washer / dryer — outer rectangle (default branch) plus a control panel
// band at the back, a drum circle, and a W/D label.
function drawWasherDryerInterior(c, wPx, dPx, kind) {
  // Control panel band along the back.
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-wPx * 0.5, -dPx * 0.30);
  ctx.lineTo( wPx * 0.5, -dPx * 0.30);
  ctx.stroke();

  // Drum circle (the door opening).
  const drumR = Math.min(wPx, dPx) * 0.34;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, dPx * 0.06, drumR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(0, dPx * 0.06, drumR * 0.70, 0, Math.PI * 2);
  ctx.stroke();

  // W or D label in the control-panel band.
  ctx.fillStyle = c;
  ctx.font = `${Math.min(wPx, dPx) * 0.18}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "washer" ? "W" : "D", 0, -dPx * 0.40);
}

// Drain symbol used by tub / shower interiors: small circle with crosshairs.
function drawDrain(cx, cy, r) {
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}
