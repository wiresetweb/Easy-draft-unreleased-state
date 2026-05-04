'use strict';

// ==============================================================================
// Plan View — printable sheet layout (Phase 1: empty paper + title block).
//
// In plan mode, the canvas renders the drawing as it would appear on a
// printed sheet: paper at a real-world size (e.g., ARCH-D 24×36"), proper
// margins, title block in the right strip, and a viewport area where the
// drawing will be cropped/scaled in later phases.
//
// This file owns the sheet model, the paper-fit math, and the title-block
// renderer. render.js dispatches to renderPlanView() when state.viewMode
// is "plan".
// ==============================================================================

// Paper sizes in inches, stored as { w, h } in landscape (long side = w).
// Toggling orientation swaps them at draw time. Numbers are nominal trim
// sizes — exact ANSI / ARCH / ISO definitions to a tenth of an inch. Order
// here is also the dropdown order; Letter is first because it's the only
// size most home printers can do, and is the default for new sheets.
const PAPER_SIZES = {
  "ANSI-A": { w: 11,    h: 8.5   }, // Letter — default; what most home printers can print
  "ARCH-A": { w: 12,    h: 9     }, //  9 × 12
  "ARCH-B": { w: 18,    h: 12    }, // 12 × 18
  "ARCH-C": { w: 24,    h: 18    }, // 18 × 24
  "ARCH-D": { w: 36,    h: 24    }, // 24 × 36 — residential default
  "ARCH-E": { w: 48,    h: 36    }, // 36 × 48
  "ANSI-B": { w: 17,    h: 11    }, // Tabloid / Ledger
  "ANSI-C": { w: 22,    h: 17    },
  "ANSI-D": { w: 34,    h: 22    },
  "ANSI-E": { w: 44,    h: 34    },
  "A4":     { w: 11.69, h: 8.27  },
  "A3":     { w: 16.54, h: 11.69 },
  "A2":     { w: 23.39, h: 16.54 },
  "A1":     { w: 33.11, h: 23.39 },
  "A0":     { w: 46.81, h: 33.11 },
};

// Sheet margins in inches. Pulled in to 0.25" all around — that's the
// minimum-safe distance from the paper edge most consumer printers can
// hit cleanly, and it leaves the maximum useful drawing area inside the
// border. Architectural convention historically ran a wider left edge for
// binding, but on Letter-sized output most users never bind anything, and
// the wasted ribbon hurts readability more than it helps anyone.
const SHEET_MARGIN_IN = { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 };

// Title block dimensions in inches. A thin vertical strip on the right —
// drafters mostly want a margin of project info, not a half-page header,
// so the block stays narrow even on big paper. The sheet number is small
// (a single project frequently has only one or two pages, so a giant
// "A-101" panel was wasted space on the drawing). When the sheet has
// notes, the title block collapses to a fixed bottom band and the notes
// column takes the rest of the right strip above it.
const TITLE_BLOCK_WIDTH_IN = 1.5;
const TITLE_BLOCK_HEIGHT_WITH_NOTES_IN = 7.5;

// Padding for screen-fit so the paper isn't kissing the canvas edges.
const PAPER_FIT_PADDING_PX = 40;

// Architectural scales — paper inches per real-world foot. Values are exact
// fractions: 1/4"=1'-0" really is 0.25 paper-inches per foot.
const ARCH_SCALES = {
  '1/16" = 1\'-0"': 1 / 16,
  '1/8" = 1\'-0"':  1 / 8,
  '1/4" = 1\'-0"':  1 / 4,
  '3/8" = 1\'-0"':  3 / 8,
  '1/2" = 1\'-0"':  1 / 2,
  '3/4" = 1\'-0"':  3 / 4,
  '1" = 1\'-0"':    1,
  '1 1/2" = 1\'-0"': 1.5,
  '3" = 1\'-0"':    3,
};
// Metric architectural scales. Stored using the same units as ARCH_SCALES
// (paper-inches per real-world-foot) so paperFitPpi() and friends don't have
// to know which scale system they came from. Conversion: a "1:N" scale means
// 1 paper-mm per N real-mm; converted to paper-in / real-ft, that's
// (1/N) × 304.8 / 25.4 = 12 / N. So 1:100 → 0.12, 1:50 → 0.24, etc.
const METRIC_SCALES = {
  '1:10':  12 / 10,
  '1:20':  12 / 20,
  '1:50':  12 / 50,
  '1:100': 12 / 100,
  '1:200': 12 / 200,
  '1:500': 12 / 500,
};
const DEFAULT_PAPER_INCHES_PER_FOOT = 1 / 4; // 1/4" = 1'-0"
const DEFAULT_METRIC_SCALE_KEY = '1:100';

function activeScaleTable() {
  return state.units === "metric" ? METRIC_SCALES : ARCH_SCALES;
}

function defaultScaleKey() {
  return state.units === "metric" ? DEFAULT_METRIC_SCALE_KEY : '1/4" = 1\'-0"';
}

function paperInchesPerFoot(sheet) {
  const key = sheet?.titleBlock?.scale;
  // Look in both tables — the saved scale belongs to whichever unit system
  // the user was in when they picked it; we don't want to invalidate the
  // sheet just because the toggle moved.
  const v = (ARCH_SCALES[key] !== undefined) ? ARCH_SCALES[key]
          : (METRIC_SCALES[key] !== undefined) ? METRIC_SCALES[key]
          : undefined;
  return typeof v === "number" ? v : DEFAULT_PAPER_INCHES_PER_FOOT;
}

// Default world position for a brand-new page: the center of the user's
// current draft view, with the page centered on that point. Falls back to
// world (0, 0) on first load when the canvas hasn't been measured yet.
function defaultPageOriginForNewSheet(paperSizeKey, orientation) {
  const dimBase = PAPER_SIZES[paperSizeKey] || PAPER_SIZES["ANSI-A"];
  const dim = orientation === "portrait"
    ? { w: dimBase.h, h: dimBase.w }
    : { w: dimBase.w, h: dimBase.h };
  // Use the document's default scale (1/4" = 1') for the world conversion.
  // Sheets created at a different scale just get repositioned by the user.
  const ipf = DEFAULT_PAPER_INCHES_PER_FOOT;
  const pwFt = dim.w / ipf;
  const phFt = dim.h / ipf;
  let cx = 0, cy = 0;
  try {
    const v = viewSize();
    const c = screenToWorld(v.w / 2, v.h / 2);
    if (isFinite(c.x) && isFinite(c.y)) { cx = c.x; cy = c.y; }
  } catch (_) { /* canvas not ready yet */ }
  return { x: cx - pwFt / 2, y: cy - phFt / 2 };
}

// Title presets per sheet type — used at sheet creation, and when the user
// flips Type on a sheet whose title still matches the previous-type's
// default (so they don't have to manually rename "First Floor Plan" to
// "Door & Window Schedule" themselves).
const SHEET_TYPE_DEFAULT_TITLES = {
  drawing:  "First Floor Plan",
  schedule: "Door & Window Schedule",
  index:    "Sheet Index",
};
const ALL_DEFAULT_TITLES = new Set(Object.values(SHEET_TYPE_DEFAULT_TITLES));

function makeDefaultSheet() {
  return {
    id: makeId("SH"),
    name: "Sheet 1",
    number: "A-101",
    // "drawing" renders the cropped drawing in the viewport; "schedule"
    // renders door / window tables; "index" renders a list of every other
    // sheet. Type drives which renderer the plan view dispatches to.
    sheetType: "drawing",
    // Letter (8.5 × 11) is the only sheet most home printers handle, so
    // that's the new default. Users can bump up to ARCH / ANSI sizes when
    // they're printing on a wider plotter.
    paperSize: "ANSI-A",
    orientation: "landscape", // "landscape" | "portrait"
    // Top-left of the paper in world coords (feet). Defaults centered on
    // wherever the draft canvas is currently looking, so the page appears
    // in front of the user when they hit + Page.
    pageOrigin: defaultPageOriginForNewSheet("ANSI-A", "landscape"),
    // Page outline on the draft canvas is opt-in per page — the outline
    // would otherwise cover the drawing the user is trying to work on,
    // and most users only need to see it when they're laying out a page.
    pageOutlineVisible: false,
    // Multiplier for user-content text (title block values, notes body,
    // viewport title). Structural elements (field labels, scale-bar ticks,
    // sheet number, north arrow) stay fixed. 1.0 = baseline.
    textScale: 1,
    titleBlock: {
      project: "",
      address: "",
      title: SHEET_TYPE_DEFAULT_TITLES.drawing,
      date: new Date().toLocaleDateString(),
      drawnBy: "",
      scale: '1/4" = 1\'-0"',
    },
    notes: [],
  };
}

// Clamp + default the per-sheet text-size multiplier. Older saves predate
// this field, so missing values fall back to 1×.
function sheetTextScale(sheet) {
  const v = parseFloat(sheet && sheet.textScale);
  if (!isFinite(v) || v <= 0) return 1;
  return Math.max(0.5, Math.min(3, v));
}

function ensureSheets() {
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) {
    state.sheets = [makeDefaultSheet()];
    state.activeSheetId = state.sheets[0].id;
    return;
  }
  if (!state.activeSheetId || !state.sheets.find((s) => s.id === state.activeSheetId)) {
    state.activeSheetId = state.sheets[0].id;
  }
  ensurePageOrigins();
}

function activeSheet() {
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) return null;
  return state.sheets.find((s) => s.id === state.activeSheetId) || state.sheets[0];
}

// ==============================================================================
// Per-sheet layer overrides — each sheet can hide stories or sublayers from
// its own viewport without touching the global drawing visibility. Stored
// as sheet.layerOverrides[id] = false (missing key = use the underlying
// global visibility). Both story IDs and sublayer IDs share the keyspace.
// ==============================================================================

function isStoryVisibleForSheet(story, sheet) {
  if (!story.visible) return false;
  if (sheet && sheet.layerOverrides && sheet.layerOverrides[story.id] === false) return false;
  return true;
}

function isSubVisibleForSheet(sub, story, sheet) {
  if (!isStoryVisibleForSheet(story, sheet)) return false;
  if (!sub.visible) return false;
  if (sheet && sheet.layerOverrides && sheet.layerOverrides[sub.id] === false) return false;
  return true;
}

function forEachShapeForSheet(sheet, cb) {
  for (const story of state.stories) {
    if (!isStoryVisibleForSheet(story, sheet)) continue;
    for (const sub of story.sublayers) {
      if (!isSubVisibleForSheet(sub, story, sheet)) continue;
      for (const sh of sub.shapes) cb(sh, sub, story);
    }
  }
}

function setSheetLayerOverride(sheet, id, hidden) {
  if (!sheet) return;
  sheet.layerOverrides = sheet.layerOverrides || {};
  if (hidden) sheet.layerOverrides[id] = false;
  else delete sheet.layerOverrides[id];
}

function paperDimensionsIn(sheet) {
  const base = PAPER_SIZES[sheet.paperSize] || PAPER_SIZES["ARCH-D"];
  // Stored values are landscape — the long edge is `w`. Portrait flips them.
  if (sheet.orientation === "portrait") {
    return { w: base.h, h: base.w };
  }
  return { w: base.w, h: base.h };
}

// Auto-fit pixels-per-inch — paper exactly fills the canvas at planView.zoom
// = 1. The user's zoom multiplies on top of this; pan offsets the centered
// paper position. Splitting these means resizing the window keeps the
// "fit-to-canvas" behavior for zoom = 1 sessions.
// ==============================================================================
// Page geometry — paper / viewport rectangles in world (feet) coordinates.
// Pure functions: no canvas state mutation. Used by the draft-mode page
// overlay, the pointer hit-test, and the plan-mode viewport renderer.
// ==============================================================================

// Total paper extent in world feet at the sheet's chosen scale.
function sheetPaperWorldSize(sheet) {
  const dim = paperDimensionsIn(sheet);
  const ipf = paperInchesPerFoot(sheet);
  if (!ipf || !dim) return null;
  return { w: dim.w / ipf, h: dim.h / ipf };
}

// Viewport rect in world coords — the part of the paper that captures the
// drawing (paper minus margins, minus title-block strip on the right, minus
// the title/scale-bar reserve at the bottom). Mirrors the layout math in
// renderPlanView so what the user sees in draft mode lines up exactly with
// what plan view crops.
function sheetViewportRectWorld(sheet) {
  if (!sheet.pageOrigin) return null;
  const dim = paperDimensionsIn(sheet);
  const ipf = paperInchesPerFoot(sheet);
  if (!ipf) return null;
  const m = SHEET_MARGIN_IN;
  const borderW = dim.w - m.left - m.right;
  const borderH = dim.h - m.top - m.bottom;
  const tbW = Math.min(TITLE_BLOCK_WIDTH_IN, borderW * 0.4);
  const vpGap = 0.25;
  const vpW_in = borderW - tbW - vpGap - 0.25;
  const vpH_in = borderH - 0.25 - 0.9;
  const vpLeft_in = m.left + 0.25;
  const vpTop_in = m.top + 0.25;
  return {
    x: sheet.pageOrigin.x + vpLeft_in / ipf,
    y: sheet.pageOrigin.y + vpTop_in / ipf,
    w: vpW_in / ipf,
    h: vpH_in / ipf,
  };
}

function sheetViewportCenterWorld(sheet) {
  const r = sheetViewportRectWorld(sheet);
  if (!r) return null;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Pages are placed in draft mode; backfill pageOrigin on any older sheet
// that pre-dates this feature so plan view always has a position to crop
// from.
function ensurePageOrigins() {
  if (!Array.isArray(state.sheets)) return;
  for (const sheet of state.sheets) {
    if (!sheet.pageOrigin || typeof sheet.pageOrigin.x !== "number") {
      sheet.pageOrigin = defaultPageOriginForNewSheet(sheet.paperSize, sheet.orientation);
    }
  }
}

// Run a mutation that may resize the page (paper size / orientation / scale
// all change the world-feet footprint of the page) while keeping the page's
// center pinned. Without this, switching to a larger paper grows the page
// asymmetrically off the user's drawing instead of around it.
function preservingPageCenter(sheet, mutate) {
  const before = sheetPaperWorldSize(sheet);
  const center = sheet.pageOrigin && before
    ? { x: sheet.pageOrigin.x + before.w / 2, y: sheet.pageOrigin.y + before.h / 2 }
    : null;
  mutate();
  if (!center) return;
  const after = sheetPaperWorldSize(sheet);
  if (!after) return;
  sheet.pageOrigin = { x: center.x - after.w / 2, y: center.y - after.h / 2 };
}

// viewSize() reads the canvas bounding rect, which forces a layout flush.
// renderPlanView() calls paperFitPpi → paperFitPpiBase dozens of times
// (title block, every cell, every measurement) — all with the same view.
// Stash once at the top of the render and reuse for every downstream call.
let _planRenderViewCache = null;
function planRenderViewSize() {
  return _planRenderViewCache || viewSize();
}

function paperFitPpiBase(sheet) {
  const view = planRenderViewSize();
  const dim = paperDimensionsIn(sheet);
  const sx = (view.w - PAPER_FIT_PADDING_PX * 2) / dim.w;
  const sy = (view.h - PAPER_FIT_PADDING_PX * 2) / dim.h;
  return Math.max(8, Math.min(sx, sy));
}

function paperFitPpi(sheet) {
  // During export, paper is rendered at exact print DPI with no fit math
  // and no user-zoom multiplier — we want pixel-for-pixel output.
  if (state.printContext) return state.printContext.ppi;
  const z = (state.planView && state.planView.zoom) || 1;
  return paperFitPpiBase(sheet) * z;
}

function planPan() {
  return (state.planView && state.planView.pan) || { x: 0, y: 0 };
}

// ==============================================================================
// Rendering
// ==============================================================================

function renderPlanView() {
  ensureSheets();
  const sheet = activeSheet();
  // Read the canvas size once and stash it for every downstream
  // paperFitPpi / planRenderViewSize() call in this render pass.
  const view = viewSize();
  _planRenderViewCache = view;

  ctx.save();
  if (!state.printContext) {
    // Backdrop — dark neutral so the white paper reads cleanly. Skipped
    // during export so the rendered PNG has a transparent / paper-only
    // background instead of dark backdrop.
    ctx.fillStyle = "#2F4156";
    ctx.fillRect(0, 0, view.w, view.h);
  }

  const ppi = paperFitPpi(sheet);
  const dim = paperDimensionsIn(sheet);
  const paperW = dim.w * ppi;
  const paperH = dim.h * ppi;
  let paperX, paperY;
  if (state.printContext) {
    // Pixel-for-pixel paper: paper origin at canvas (0,0), no centering or
    // user-pan offset. The canvas is sized to exactly paperW × paperH for
    // each sheet during export.
    paperX = 0;
    paperY = 0;
  } else {
    const pan = planPan();
    paperX = Math.round((view.w - paperW) / 2 + pan.x);
    paperY = Math.round((view.h - paperH) / 2 + pan.y);
  }

  if (!state.printContext) {
    // Drop shadow under the paper — draw-mode preview only; printed sheets
    // shouldn't carry a shadow into the PDF.
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(paperX, paperY, paperW, paperH);
    ctx.restore();
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(paperX, paperY, paperW, paperH);
  }

  // Border at the margin offset.
  const m = SHEET_MARGIN_IN;
  const bx = paperX + m.left * ppi;
  const by = paperY + m.top * ppi;
  const bw = paperW - (m.left + m.right) * ppi;
  const bh = paperH - (m.top + m.bottom) * ppi;
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);

  drawTitleBlock(sheet, bx, by, bw, bh, ppi);

  // Viewport — the area inside the border, left of the title block, where
  // the drawing prints. Phase 2 fills this with the drawing at the sheet's
  // architectural scale, centered on the drawing's bounding box.
  const tbW = Math.min(TITLE_BLOCK_WIDTH_IN * ppi, bw * 0.4);
  const vpGap = 0.25 * ppi; // small breather between viewport and title block
  const vp = {
    x: bx + 0.25 * ppi,
    y: by + 0.25 * ppi,
    // Reserve enough room below the viewport for the title strip plus the
    // graphic scale bar — title (0.2") + double underline + scale text +
    // scale bar (0.25") + padding ≈ 0.85". Round up to 0.9".
    w: bw - tbW - vpGap - 0.25 * ppi,
    h: bh - 0.25 * ppi - 0.9 * ppi,
  };
  // Dispatch by sheet type. Drawing sheets show the cropped drawing; the
  // other types replace the viewport area with a generated table and skip
  // the viewport title strip / scale bar / north arrow (none of which
  // apply to a list of sheets or a tally of doors).
  const sheetType = sheet.sheetType || "drawing";
  if (sheetType === "schedule") {
    drawScheduleTable(sheet, vp, ppi);
  } else if (sheetType === "index") {
    drawIndexTable(sheet, vp, ppi);
  } else {
    drawViewport(sheet, vp, ppi);
    drawNorthArrow(sheet, vp, ppi);
    drawViewportTitle(sheet, vp, ppi);
    drawScaleBar(sheet, vp, ppi);
  }

  ctx.restore();
  _planRenderViewCache = null;
}

// ==============================================================================
// Tabular sheets — Schedule (doors + windows) and Index (other sheets).
// Both reuse the same drawTable primitive so the typography stays consistent
// across the whole document set.
// ==============================================================================

function collectScheduleData() {
  const doorGroups = new Map();
  const windowGroups = new Map();
  forEachShape((sh) => {
    if (sh.type === "door") {
      // Group identical doors by catalog name (or subtype + width as a
      // last resort for hand-edited shapes).
      const key = sh.kind || `${sh.subtype || "Swing"} ${formatFeet(sh.width)}`;
      const g = doorGroups.get(key) || { kind: key, width: sh.width || 0, count: 0 };
      g.count += 1;
      doorGroups.set(key, g);
    } else if (sh.type === "window") {
      const key = sh.kind || `Window ${formatFeet(sh.width)}`;
      const g = windowGroups.get(key) || { kind: key, width: sh.width || 0, count: 0 };
      g.count += 1;
      windowGroups.set(key, g);
    }
  });

  // Display the catalog kind in the user's current units. The grouping key
  // is still the original (English) kind, so two doors placed under different
  // unit settings collapse into one schedule row instead of two.
  const displayKind = (k) => state.units === "metric" ? metricizeLabel(k) : k;
  const doorRows = Array.from(doorGroups.values())
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((g, i) => [`D${i + 1}`, displayKind(g.kind), formatFeet(g.width), String(g.count)]);
  const windowRows = Array.from(windowGroups.values())
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((g, i) => [`W${i + 1}`, displayKind(g.kind), formatFeet(g.width), String(g.count)]);

  return [
    { title: "Doors",   columns: ["Mark", "Type", "Width", "Qty"], rows: doorRows,
      empty: "No doors placed yet." },
    { title: "Windows", columns: ["Mark", "Type", "Width", "Qty"], rows: windowRows,
      empty: "No windows placed yet." },
  ];
}

function collectIndexData(currentSheet) {
  const rows = [];
  if (Array.isArray(state.sheets)) {
    for (const s of state.sheets) {
      if (s.id === currentSheet.id) continue;
      const title = (s.titleBlock && s.titleBlock.title) || s.name || "";
      const scaleStr = (s.titleBlock && s.titleBlock.scale) || "";
      const typeLabel = (s.sheetType || "drawing").replace(/^./, (c) => c.toUpperCase());
      rows.push([s.number || "", title, scaleStr, typeLabel]);
    }
  }
  return [{
    title: "Sheets",
    columns: ["Sheet", "Title", "Scale", "Type"],
    rows,
    empty: "No other sheets in this document.",
  }];
}

function drawScheduleTable(sheet, vp, ppi) {
  drawTableContent(sheet, vp, ppi, collectScheduleData());
}

function drawIndexTable(sheet, vp, ppi) {
  drawTableContent(sheet, vp, ppi, collectIndexData(sheet));
}

// Render a stack of titled tables filling the viewport area. Lays out
// columns with weighted widths so longer text columns ("Title", "Type")
// get the most room. Truncates with ellipsis if a cell would otherwise
// run past its column.
function drawTableContent(sheet, vp, ppi, sections) {
  const scale = sheetTextScale(sheet);
  const padX = 0.30 * ppi;
  const padY = 0.25 * ppi;

  ctx.save();
  ctx.textAlign = "left";

  let cursorY = vp.y + padY;
  const tableX = vp.x + padX;
  const tableW = vp.w - padX * 2;
  const bottomY = vp.y + vp.h - padY;

  // Big title at the top — same hierarchy as the viewport title on a
  // drawing sheet so the Title-Block "Title" field still reads as the
  // sheet's headline.
  const titlePx = Math.round(0.22 * ppi * scale);
  ctx.fillStyle = "#1A2A36";
  ctx.font = `700 ${titlePx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  const titleText = (sheet.titleBlock && sheet.titleBlock.title) || "Schedule";
  ctx.fillText(titleText.toUpperCase(), tableX, cursorY);
  cursorY += titlePx;
  // Heavy underline under the title.
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableX, Math.round(cursorY) + 0.5);
  ctx.lineTo(tableX + tableW, Math.round(cursorY) + 0.5);
  ctx.stroke();
  cursorY += 0.20 * ppi;

  for (const section of sections) {
    if (cursorY > bottomY) break;

    const headerPx = Math.round(0.14 * ppi * scale);
    ctx.fillStyle = "#1A2A36";
    ctx.font = `700 ${headerPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(section.title.toUpperCase(), tableX, cursorY);
    cursorY += headerPx * 1.5;

    if (!section.rows.length) {
      const emptyPx = Math.round(0.10 * ppi * scale);
      ctx.fillStyle = "#4A6274";
      ctx.font = `italic ${emptyPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(section.empty || "—", tableX, cursorY);
      cursorY += emptyPx * 2;
      continue;
    }

    // Column widths weighted so wider columns get more room; the last
    // numeric column ("Qty") is fixed-narrow.
    const cols = section.columns;
    const weights = cols.map((c) => {
      if (/qty/i.test(c)) return 0.6;
      if (/mark|sheet/i.test(c)) return 0.7;
      if (/width|scale/i.test(c)) return 0.9;
      return 1.6;
    });
    const totalW = weights.reduce((a, b) => a + b, 0);
    const colWs = weights.map((w) => (w / totalW) * tableW);
    const colXs = [];
    let cx = tableX;
    for (const w of colWs) { colXs.push(cx); cx += w; }

    // Column header row
    const hdrCellPx = Math.round(0.085 * ppi * scale);
    ctx.fillStyle = "#4A6274";
    ctx.font = `600 ${hdrCellPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (let c = 0; c < cols.length; c++) {
      ctx.fillText(cols[c].toUpperCase(), colXs[c] + 4, cursorY);
    }
    cursorY += hdrCellPx * 1.4;
    ctx.strokeStyle = "#1A2A36";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tableX, Math.round(cursorY) + 0.5);
    ctx.lineTo(tableX + tableW, Math.round(cursorY) + 0.5);
    ctx.stroke();
    cursorY += hdrCellPx * 0.4;

    // Data rows
    const cellPx = Math.round(0.115 * ppi * scale);
    const rowH = cellPx * 1.9;
    ctx.fillStyle = "#1A2A36";
    ctx.font = `${cellPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const row of section.rows) {
      if (cursorY + rowH > bottomY) {
        // Out of room — drop a "+N more" line and stop.
        const moreCount = section.rows.length - section.rows.indexOf(row);
        ctx.fillStyle = "#4A6274";
        ctx.font = `italic ${cellPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(`+ ${moreCount} more — split onto another sheet`, tableX, cursorY + cellPx * 0.4);
        cursorY = bottomY;
        break;
      }
      for (let c = 0; c < row.length; c++) {
        const text = truncateToWidth(String(row[c]), colWs[c] - 8);
        ctx.fillText(text, colXs[c] + 4, cursorY + cellPx * 0.45);
      }
      // Row separator
      ctx.strokeStyle = "rgba(26, 42, 54, 0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tableX, Math.round(cursorY + rowH) + 0.5);
      ctx.lineTo(tableX + tableW, Math.round(cursorY + rowH) + 0.5);
      ctx.stroke();
      cursorY += rowH;
    }

    cursorY += 0.30 * ppi; // gap between sections
  }

  ctx.restore();
}

// Trim text with an ellipsis to fit `maxWidth` at the current ctx font.
function truncateToWidth(text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + "…";
}

// Render the drawing inside the viewport rect at the sheet's chosen
// architectural scale, centered on the drawing's bounding box. We borrow
// the existing render pipeline (drawAllShapes / drawSelectedShapeGlow) by
// temporarily overriding state.zoom and state.pan so worldToScreen yields
// paper-space pixels, then restore them afterwards. effectiveScale ends up
// equal to ppi × paperInchesPerFoot — i.e., screen pixels per real foot at
// the chosen scale. No grid is drawn — printed plans don't show one.
function drawViewport(sheet, vp, ppi) {
  // Subtle outline so the user can see the viewport edge while editing.
  // Suppressed during export — it's a UI cue, not part of the printed sheet.
  if (!state.printContext) {
    ctx.save();
    ctx.strokeStyle = "rgba(232, 96, 44, 0.40)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(vp.x + 0.5, vp.y + 0.5, vp.w, vp.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Per-sheet layer overrides apply here — drawAllShapes uses the
  // sheet-filtered iterator so a hidden story / sublayer has no effect
  // on the rendered pixels.

  const ipf = paperInchesPerFoot(sheet);
  const pxPerFoot = ipf * ppi;                 // screen px / world foot
  const planZoom = pxPerFoot / PX_PER_FOOT;    // effectiveScale() == pxPerFoot

  // The page's position on the draft canvas determines what the viewport
  // captures here. Older sheets without a pageOrigin fall back to the
  // visible-shape bbox center, so legacy files still render something.
  let cxWorld, cyWorld;
  const vpCenter = sheetViewportCenterWorld(sheet);
  if (vpCenter) {
    cxWorld = vpCenter.x;
    cyWorld = vpCenter.y;
  } else {
    const bbox = visibleShapesBBox(sheet);
    if (!bbox) return;
    cxWorld = (bbox.x1 + bbox.x2) / 2;
    cyWorld = (bbox.y1 + bbox.y2) / 2;
  }
  const cxScreen = vp.x + vp.w / 2;
  const cyScreen = vp.y + vp.h / 2;
  const planPan = {
    x: cxScreen - cxWorld * pxPerFoot,
    y: cyScreen - cyWorld * pxPerFoot,
  };

  // Hijack the world-transform state for the duration of the draw, then
  // put it back. Cheap and keeps the shape-renderer untouched.
  const savedZoom = state.zoom;
  const savedPan = state.pan;
  state.zoom = planZoom;
  state.pan = planPan;

  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();
  forEachShapeForSheet(sheet, (sh, sub) => {
    drawShape(sh, sub.color || DEFAULT_LAYER_COLOR_FALLBACK, sub);
  });
  ctx.restore();

  state.zoom = savedZoom;
  state.pan = savedPan;
}

// Drawing title under the viewport: bold uppercase plus an architectural
// "double underline" — thin line directly under the text, thick rule below
// it, with scale + drawing number rendered to the right of the title text.
// This is the standard layout on every plan-set viewport label.
function drawViewportTitle(sheet, vp, ppi) {
  const tb = sheet.titleBlock || {};
  const titleText = (tb.title || "Plan").toUpperCase();
  const scaleText = "SCALE: " + (tb.scale || "—");
  const titleY = vp.y + vp.h + 0.18 * ppi;
  const scale = sheetTextScale(sheet);

  ctx.save();
  ctx.fillStyle = "#1A2A36";
  const titlePx = Math.round(0.18 * ppi * scale);
  ctx.font = `700 ${titlePx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const titleW = ctx.measureText(titleText).width;
  ctx.fillText(titleText, vp.x, titleY);

  // Scale text — vertically centered to the title's cap height so the row
  // reads as a single unit even though the two strings have different
  // weights and sizes.
  ctx.fillStyle = "#4A6274";
  const scalePx = Math.round(0.11 * ppi * scale);
  ctx.font = `${scalePx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(scaleText, vp.x + titleW + 0.25 * ppi, titleY + titlePx * 0.85);

  // Double-underline under the title text only (not under the scale label).
  const ulY = titleY + titlePx + 0.04 * ppi;
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(vp.x,           ulY + 0.5);
  ctx.lineTo(vp.x + titleW,  ulY + 0.5);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(vp.x,           ulY + 3.5);
  ctx.lineTo(vp.x + titleW,  ulY + 3.5);
  ctx.stroke();

  ctx.restore();
}

// North arrow — small circle in the top-right of the viewport with an "N"
// label and an arrow pointing up. The viewport coordinate frame is paper
// space (the drawing inside is rendered separately and clipped), so the
// arrow always points to "up on the page" — exactly what the convention
// expects unless the user has rotated their drawing for a non-cardinal
// north (a rotation control comes in a later phase).
function drawNorthArrow(sheet, vp, ppi) {
  if (sheet.showNorthArrow === false) return; // future toggle; default on

  const radius = 0.42 * ppi;
  const margin = 0.30 * ppi;
  const cx = vp.x + vp.w - margin - radius;
  const cy = vp.y + margin + radius;

  ctx.save();

  // Outer circle
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Filled arrowhead pointing up (split tone — left half darker than right
  // is the standard architectural mark, distinguishes the pointing edge).
  const tipY  = cy - radius * 0.65;
  const baseY = cy + radius * 0.35;
  const baseX = radius * 0.35;
  ctx.beginPath();
  ctx.moveTo(cx,         tipY);
  ctx.lineTo(cx - baseX, baseY);
  ctx.lineTo(cx,         baseY - radius * 0.15);
  ctx.closePath();
  ctx.fillStyle = "#1A2A36";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx,         tipY);
  ctx.lineTo(cx + baseX, baseY);
  ctx.lineTo(cx,         baseY - radius * 0.15);
  ctx.closePath();
  ctx.fillStyle = "#4A6274";
  ctx.fill();

  // "N" label centered just inside the bottom of the circle.
  ctx.fillStyle = "#1A2A36";
  ctx.font = `700 ${Math.round(radius * 0.55)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx, cy + radius * 0.62);

  ctx.restore();
}

// Graphic scale bar — appears under the title strip, sized to the chosen
// architectural scale so it always shows a clean number of feet at a
// readable on-paper length. The convention is alternating black/white
// segments with tick marks at major divisions and unit labels below.
function drawScaleBar(sheet, vp, ppi) {
  if (sheet.showScaleBar === false) return; // future toggle; default on

  const ipf = paperInchesPerFoot(sheet);
  if (!ipf) return;
  // Pass the viewport's paper-width so the bar can shrink its divisions to
  // fit on small paper (Letter / ARCH-A) without clipping into the title
  // block.
  const availInches = vp.w / ppi;
  const plan = scaleBarPresetFor(sheet?.titleBlock?.scale, availInches);
  const totalFeet = plan.divs * plan.feetPerDiv;
  const barW = totalFeet * ipf * ppi;
  const barH = 0.10 * ppi;

  // Place the bar at the start of the viewport's bottom strip, below the
  // title text. The 0.5" baseline matches the reserve carved out of the
  // viewport height, leaving a small padding above and below.
  const barX = vp.x;
  const barY = vp.y + vp.h + 0.55 * ppi;

  ctx.save();
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 0.8;

  for (let i = 0; i < plan.divs; i++) {
    const segX = barX + (i * barW) / plan.divs;
    const segW = barW / plan.divs;
    if (i % 2 === 0) {
      ctx.fillStyle = "#1A2A36";
      ctx.fillRect(segX, barY, segW, barH);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(segX, barY, segW, barH);
      ctx.strokeRect(segX + 0.5, barY + 0.5, segW - 1, barH - 1);
    }
  }
  // Outline the whole bar so the white segments still read as part of it.
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

  // Tick labels under each major division, plus a unit label at the right.
  ctx.fillStyle = "#1A2A36";
  ctx.font = `${Math.max(7, Math.round(0.085 * ppi))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  for (let i = 0; i <= plan.divs; i++) {
    const tx = barX + (i * barW) / plan.divs;
    // Short tick beneath the bar at each division.
    ctx.beginPath();
    ctx.moveTo(tx + 0.5, barY + barH);
    ctx.lineTo(tx + 0.5, barY + barH + 0.05 * ppi);
    ctx.stroke();
    // Tick value, centered beneath the tick (left-aligned at the leftmost
    // and right-aligned at the rightmost so the labels don't run off the
    // ends of the bar).
    const value = i * plan.valuePerDiv;
    const label = plan.metric ? formatScaleMeters(value) : formatScaleFeet(value);
    if (i === 0) ctx.textAlign = "left";
    else if (i === plan.divs) ctx.textAlign = "right";
    else ctx.textAlign = "center";
    ctx.fillText(label, tx, barY + barH + 0.07 * ppi);
  }
  // Unit suffix to the right of the last label.
  ctx.textAlign = "left";
  ctx.fillStyle = "#4A6274";
  ctx.fillText(state.units === "metric" ? "M" : "FEET", barX + barW + 0.10 * ppi, barY + barH + 0.07 * ppi);

  ctx.restore();
}

// Per-scale "nice" feet-per-division so the bar lands on a clean number at
// a readable on-paper length. Imperial divisions are picked in feet; metric
// divisions are picked in real-world meters (then converted to feet for the
// bar geometry). Halved iteratively if the resulting bar would clip the
// available width.
function scaleBarPresetFor(scaleKey, availableInches) {
  const IMPERIAL_STANDARD = {
    '1/16" = 1\'-0"':  16,
    '1/8" = 1\'-0"':   8,
    '1/4" = 1\'-0"':   4,
    '3/8" = 1\'-0"':   4,
    '1/2" = 1\'-0"':   2,
    '3/4" = 1\'-0"':   2,
    '1" = 1\'-0"':     1,
    '1 1/2" = 1\'-0"': 0.5,
    '3" = 1\'-0"':     0.5,
  };
  // Metric divisions, in real-world METERS per division. Tuned so a 1:100
  // bar reads "0 1 2 3 4 m" at the standard 4-division layout.
  const METRIC_STANDARD_M = {
    '1:10':  0.25,
    '1:20':  0.5,
    '1:50':  1,
    '1:100': 1,
    '1:200': 2,
    '1:500': 5,
  };

  const ipf = paperInchesPerFoot({ titleBlock: { scale: scaleKey } });
  const divs = 4;
  const reservedForLabel = 0.7;
  const maxBarIn = Math.max(0.6, (availableInches || 4) - reservedForLabel);

  if (state.units === "metric" && METRIC_SCALES[scaleKey] !== undefined) {
    let metersPerDiv = METRIC_STANDARD_M[scaleKey] != null ? METRIC_STANDARD_M[scaleKey] : 1;
    // Convert m → ft for the bar-width math (paperInchesPerFoot is in ft).
    let feetPerDiv = (metersPerDiv * 1000) * MM_TO_FT;
    while (metersPerDiv > 0.05 && divs * feetPerDiv * ipf > maxBarIn) {
      metersPerDiv /= 2;
      feetPerDiv = (metersPerDiv * 1000) * MM_TO_FT;
    }
    return { divs, feetPerDiv, valuePerDiv: metersPerDiv, metric: true };
  }

  let feetPerDiv = IMPERIAL_STANDARD[scaleKey] != null ? IMPERIAL_STANDARD[scaleKey] : 4;
  while (feetPerDiv > 0.125 && divs * feetPerDiv * ipf > maxBarIn) {
    feetPerDiv = feetPerDiv / 2;
  }
  return { divs, feetPerDiv, valuePerDiv: feetPerDiv, metric: false };
}

// Compact tick label. Imperial: integer feet print as "12", half feet as a
// 6" mark. Metric: integer meters as "3", sub-meter as "0.5".
function formatScaleFeet(feet) {
  if (Math.abs(feet - Math.round(feet)) < 1e-6) return String(Math.round(feet));
  if (Math.abs(feet * 2 - Math.round(feet * 2)) < 1e-6) {
    const whole = Math.trunc(feet);
    const half  = Math.round((feet - whole) * 2);
    return whole === 0 ? "6\"" : `${whole}'-6"`;
  }
  return feet.toFixed(2);
}

function formatScaleMeters(meters) {
  if (Math.abs(meters - Math.round(meters)) < 1e-6) return String(Math.round(meters));
  return meters.toFixed(1).replace(/\.0$/, "");
}

// World-space bounding box of every shape that's visible on the given
// sheet (respecting per-sheet layer overrides, not just global visibility).
// Returns null when nothing's visible — caller treats that as "skip the
// drawing render and just show the empty viewport frame".
function visibleShapesBBox(sheet) {
  let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
  let any = false;
  forEachShapeForSheet(sheet, (sh) => {
    const b = SHAPES[sh.type]?.bbox?.(sh);
    if (!b) return;
    any = true;
    if (b.x1 < xa) xa = b.x1;
    if (b.y1 < ya) ya = b.y1;
    if (b.x2 > xb) xb = b.x2;
    if (b.y2 > yb) yb = b.y2;
  });
  return any ? { x1: xa, y1: ya, x2: xb, y2: yb } : null;
}

// Title block: vertical strip on the right side of the border box. With
// notes, it shrinks to a bottom band; without notes it's full-height.
//   1. Drafting Studio brand block (the "designer/firm" section)
//   2. Project info (project name + address)
//   3. Sheet info (title, scale, date, drawn-by)
//   4. Sheet number — large, bottom
function drawTitleBlock(sheet, bx, by, bw, bh, ppi) {
  const tbW = Math.min(TITLE_BLOCK_WIDTH_IN * ppi, bw * 0.4);
  const hasNotes = Array.isArray(sheet.notes) && sheet.notes.length > 0;
  const tbH = hasNotes ? Math.min(TITLE_BLOCK_HEIGHT_WITH_NOTES_IN * ppi, bh) : bh;
  const tbX = bx + bw - tbW;
  const tbY = by + bh - tbH;

  // Notes column fills the right strip above the title block when present.
  if (hasNotes && tbY > by + 1) {
    drawNotesColumn(sheet, tbX, by, tbW, tbY - by, ppi);
  }

  ctx.save();
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 1;

  // Outer box
  ctx.strokeRect(tbX + 0.5, tbY + 0.5, tbW, tbH);

  // Section weights reordered to give content the space and the sheet
  // number just a small footer band. Project + info dominate; the brand
  // and number bookend it.
  const sections = [
    { weight: 0.22, kind: "firm" },
    { weight: 0.28, kind: "project" },
    { weight: 0.40, kind: "info" },
    { weight: 0.10, kind: "number" },
  ];

  let y = tbY;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const sh = tbH * sec.weight;
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(tbX, Math.round(y) + 0.5);
      ctx.lineTo(tbX + tbW, Math.round(y) + 0.5);
      ctx.stroke();
    }
    drawTitleBlockSection(sec.kind, sheet, tbX, y, tbW, sh, ppi);
    y += sh;
  }

  ctx.restore();
}

function drawTitleBlockSection(kind, sheet, x, y, w, h, ppi) {
  // Tighter horizontal padding than before — the title strip is now ~1.5"
  // wide, so giving every cell another 0.04" of usable text width matters.
  const padX = 0.10 * ppi;
  const padY = 0.12 * ppi;
  const tb = sheet.titleBlock || {};

  if (kind === "firm") {
    // Brand mark: actual product logo on top, "DRAFTING STUDIO" under it,
    // tagline at the bottom. The logo image is preloaded by main.js
    // (ensureWatermarkLogo) — if it hasn't loaded yet for some reason, we
    // fall back to a small orange/slate gradient dot so the layout doesn't
    // collapse and the section still reads as branded.
    const cx = x + w / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const logo = ensureWatermarkLogo();
    const logoCenterY = y + h * 0.32;
    if (logo && logo.complete && logo.naturalWidth > 0) {
      // Constrain to ~75% of cell width and ~45% of cell height. Whichever
      // is binding wins; aspect ratio preserved either way.
      const maxW = w * 0.75;
      const maxH = h * 0.45;
      const aspect = logo.naturalWidth / logo.naturalHeight;
      let lw = maxW, lh = maxW / aspect;
      if (lh > maxH) { lh = maxH; lw = maxH * aspect; }
      ctx.drawImage(logo, cx - lw / 2, logoCenterY - lh / 2, lw, lh);
    } else {
      const dotR = Math.max(3, 0.12 * ppi);
      const grad = ctx.createLinearGradient(cx - dotR, logoCenterY - dotR, cx + dotR, logoCenterY + dotR);
      grad.addColorStop(0, "#2F4156");
      grad.addColorStop(1, "#E8602C");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, logoCenterY, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#1A2A36";
    ctx.font = `700 ${Math.round(0.11 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText("DRAFTING STUDIO", cx, y + h * 0.72);

    ctx.fillStyle = "#4A6274";
    ctx.font = `${Math.round(0.07 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText("Residential Drafting", cx, y + h * 0.90);
  } else if (kind === "project") {
    drawTBField("Project", tb.project || "—", x + padX, y + padY, w - padX * 2, h * 0.5 - padY, ppi, sheet);
    drawTBField("Address", tb.address || "—", x + padX, y + h * 0.5, w - padX * 2, h * 0.5 - padY, ppi, sheet);
  } else if (kind === "info") {
    const rowH = h / 4;
    const rows = [
      ["Title",    tb.title    || "—"],
      ["Scale",    tb.scale    || "—"],
      ["Date",     tb.date     || "—"],
      ["Drawn By", tb.drawnBy  || "—"],
    ];
    for (let i = 0; i < rows.length; i++) {
      drawTBField(rows[i][0], rows[i][1], x + padX, y + i * rowH + padY * 0.5, w - padX * 2, rowH - padY * 0.5, ppi, sheet);
    }
  } else if (kind === "number") {
    // Compact bottom band — sheet number sits inline to the right of the
    // "SHEET" label so the band stays thin even when the user picks a
    // large text scale. A single project is often one or two pages, so
    // the giant "A-101" panel was wasted real estate.
    ctx.fillStyle = "#4A6274";
    ctx.font = `600 ${Math.round(0.075 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SHEET", x + 0.12 * ppi, y + h / 2);

    ctx.fillStyle = "#1A2A36";
    ctx.font = `700 ${Math.round(0.16 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(sheet.number || "A-001", x + w - 0.12 * ppi, y + h / 2);
  }
}

// "GENERAL NOTES" column — sits in the right strip above the title block.
// Notes are auto-numbered 1, 2, 3… and word-wrapped to the column width.
// Anything that overflows the available height is silently truncated; the
// user fixes this by adding more sheets or shrinking the title block, both
// of which Phase 6+ will surface in the UI.
function drawNotesColumn(sheet, x, y, w, h, ppi) {
  ctx.save();
  ctx.strokeStyle = "#1A2A36";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);

  const padX = 0.18 * ppi;
  const padY = 0.14 * ppi;

  // Header bar — small caps, separator line below.
  ctx.fillStyle = "#1A2A36";
  ctx.font = `700 ${Math.round(0.13 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("GENERAL NOTES", x + padX, y + padY);

  const headerY = y + padY + 0.22 * ppi;
  ctx.beginPath();
  ctx.moveTo(x, Math.round(headerY) + 0.5);
  ctx.lineTo(x + w, Math.round(headerY) + 0.5);
  ctx.stroke();

  // Notes body scales with the per-sheet text-size setting; the column
  // header above stays a fixed 0.13" so the section heading hierarchy is
  // unchanged when the user picks Large or Extra Large.
  const scale = sheetTextScale(sheet);
  const fontSize = Math.max(7, Math.round(0.10 * ppi * scale));
  const lineHeight = fontSize * 1.35;
  ctx.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  const numW = ctx.measureText("99.").width + 0.06 * ppi;
  const noteX = x + padX;
  const textX = noteX + numW;
  const textMaxW = w - padX * 2 - numW;
  const bottomY = y + h - padY;

  let cursorY = headerY + 0.10 * ppi;
  for (let i = 0; i < sheet.notes.length; i++) {
    const text = String(sheet.notes[i] || "");
    if (!text.trim()) continue;
    const lines = wrapNoteText(text, textMaxW);
    if (cursorY + lineHeight > bottomY) break;

    ctx.fillStyle = "#4A6274";
    ctx.fillText((i + 1) + ".", noteX, cursorY);

    ctx.fillStyle = "#1A2A36";
    for (const line of lines) {
      if (cursorY + lineHeight > bottomY) {
        // Truncation marker so the user knows there's more.
        ctx.fillText("…", textX, cursorY);
        cursorY = bottomY;
        break;
      }
      ctx.fillText(line, textX, cursorY);
      cursorY += lineHeight;
    }
    cursorY += lineHeight * 0.35; // gap between notes
  }

  ctx.restore();
}

// Greedy word-wrap against the current ctx font. Falls back to character
// breaking when a single token is wider than maxWidth (e.g., a long URL).
function wrapNoteText(text, maxWidth) {
  const out = [];
  // Preserve user-entered line breaks — they come from textareas.
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    if (!para) { out.push(""); continue; }
    const words = para.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        if (cur) out.push(cur);
        if (ctx.measureText(w).width <= maxWidth) {
          cur = w;
        } else {
          // Hard-break a too-long token character by character.
          let chunk = "";
          for (const ch of w) {
            if (ctx.measureText(chunk + ch).width > maxWidth) {
              if (chunk) out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          cur = chunk;
        }
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

function drawTBField(label, value, x, y, w, h, ppi, sheet) {
  // Field labels stay at a fixed compact size (they're structural — small
  // by design); only the user-typed value scales with sheet.textScale.
  // The narrow title strip means values are tighter — a 0.11" base reads
  // cleanly without dwarfing the label above it.
  const scale = sheetTextScale(sheet);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.fillStyle = "#4A6274";
  ctx.font = `600 ${Math.round(0.07 * ppi)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(label.toUpperCase(), x, y);

  ctx.fillStyle = "#1A2A36";
  const valuePx = Math.round(0.11 * ppi * scale);
  ctx.font = `${valuePx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  // Truncate to fit width — long project names shouldn't crash the layout.
  const maxW = Math.max(0, w);
  let text = String(value);
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    text = text + "…";
  }
  ctx.fillText(text, x, y + 0.11 * ppi);
}

// ==============================================================================
// Mode switching
// ==============================================================================

function setViewMode(mode) {
  if (mode !== "draw" && mode !== "plan") return;
  if (state.viewMode === mode) return;
  state.viewMode = mode;

  document.body.classList.toggle("mode-plan", mode === "plan");
  document.body.classList.toggle("mode-draw", mode === "draw");

  // Clear any in-flight interactions when leaving draw mode — pending
  // line/box, marquee, transform — so we don't come back to a half-drawn
  // shape from before the switch.
  if (mode === "plan") {
    state.pending = null;
    state.placing = null;
    state.marquee = null;
    state.selectionMode = null;
    state.selectionData = null;
    state.curveDrag = null;
    state.stairsDirection = null;
    hideLayerHintModal();
    ensureSheets();
  }

  if (modeSwitchEl) {
    for (const btn of modeSwitchEl.querySelectorAll(".mode-btn")) {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  fitCanvas();
  render();
}

function bindModeSwitch() {
  if (!modeSwitchEl) return;
  modeSwitchEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    setViewMode(btn.dataset.mode);
  });
}

// ==============================================================================
// Plan-mode navigation: wheel zoom + drag pan
// ==============================================================================

const PLAN_ZOOM_MIN = 0.5;
const PLAN_ZOOM_MAX = 12;

function ensurePlanView() {
  if (!state.planView) {
    state.planView = { zoom: 1, pan: { x: 0, y: 0 }, panning: false, panStart: null, panOrigin: null };
  }
}

function resetPlanView() {
  ensurePlanView();
  state.planView.zoom = 1;
  state.planView.pan.x = 0;
  state.planView.pan.y = 0;
  state.planView.panning = false;
  state.planView.panStart = null;
  state.planView.panOrigin = null;
}

// Zoom around a cursor position so the paper point under the cursor stays
// pinned. Keeps the axis the user cares about — wherever they pointed —
// from drifting as they wheel in.
function setPlanZoom(newZoom, anchorScreen) {
  ensurePlanView();
  const sheet = activeSheet();
  if (!sheet) return;

  const z = Math.max(PLAN_ZOOM_MIN, Math.min(PLAN_ZOOM_MAX, newZoom));
  const oldZoom = state.planView.zoom;
  if (Math.abs(z - oldZoom) < 1e-4) return;

  if (anchorScreen) {
    const view = viewSize();
    const fitBase = paperFitPpiBase(sheet);
    const dim = paperDimensionsIn(sheet);
    const oldPpi = fitBase * oldZoom;
    const oldPaperW = dim.w * oldPpi;
    const oldPaperH = dim.h * oldPpi;
    const oldOriginX = (view.w - oldPaperW) / 2 + state.planView.pan.x;
    const oldOriginY = (view.h - oldPaperH) / 2 + state.planView.pan.y;
    // Cursor position expressed as a fraction of the paper's current size,
    // so we can re-anchor it at the same fraction after zooming.
    const fx = oldPaperW > 0 ? (anchorScreen.x - oldOriginX) / oldPaperW : 0.5;
    const fy = oldPaperH > 0 ? (anchorScreen.y - oldOriginY) / oldPaperH : 0.5;
    const newPpi = fitBase * z;
    const newPaperW = dim.w * newPpi;
    const newPaperH = dim.h * newPpi;
    const newOriginX = anchorScreen.x - fx * newPaperW;
    const newOriginY = anchorScreen.y - fy * newPaperH;
    state.planView.pan.x = newOriginX - (view.w - newPaperW) / 2;
    state.planView.pan.y = newOriginY - (view.h - newPaperH) / 2;
  }
  state.planView.zoom = z;
  render();
}

// Plan-mode pointer flow — separate from draw-mode pointers (events.js
// returns early in plan mode). Left-drag pans the paper around the canvas.
function planPointerDown(sp, e) {
  ensurePlanView();
  if (e.button !== 0 && e.button !== 1) return;
  const sheet = activeSheet();
  if (!sheet || !sheet.pageOrigin) return;
  // Drag in plan mode pans the *drawing* under the viewport — same as
  // dragging the page rect in draft mode, but from inside the sheet view.
  // We seed the drag with the active sheet's pageOrigin so screen-pixel
  // deltas map to drawing-feet deltas through the current scale.
  state.planView.panning = true;
  state.planView.panStart = sp;
  state.planView.panOrigin = { x: sheet.pageOrigin.x, y: sheet.pageOrigin.y };
  state.planView.panSheetId = sheet.id;
  canvas.setPointerCapture?.(e.pointerId);
  canvas.style.cursor = "grabbing";
}

function planPointerMove(sp) {
  if (!state.planView || !state.planView.panning) return;
  const sheet = state.sheets.find((s) => s.id === state.planView.panSheetId) || activeSheet();
  if (!sheet || !sheet.pageOrigin) return;
  // Convert the drag's screen-pixel delta to drawing-feet through the
  // current rendering scale: pixels → paper-inches (÷ ppi) → world-feet
  // (÷ paperInchesPerFoot). Drag right ⇒ drawing follows the cursor
  // right ⇒ pageOrigin moves left, so we subtract the delta.
  const ppi = paperFitPpi(sheet);
  const ipf = paperInchesPerFoot(sheet);
  const pxPerFoot = ipf * ppi;
  if (pxPerFoot <= 0) return;
  const dxFt = (sp.x - state.planView.panStart.x) / pxPerFoot;
  const dyFt = (sp.y - state.planView.panStart.y) / pxPerFoot;
  sheet.pageOrigin.x = state.planView.panOrigin.x - dxFt;
  sheet.pageOrigin.y = state.planView.panOrigin.y - dyFt;
  render();
}

function planPointerUp(e) {
  if (!state.planView || !state.planView.panning) return;
  state.planView.panning = false;
  state.planView.panStart = null;
  state.planView.panOrigin = null;
  state.planView.panSheetId = null;
  canvas.releasePointerCapture?.(e.pointerId);
  canvas.style.cursor = "grab";
}

// ==============================================================================
// Export — render every sheet at print DPI and hand the bitmaps back so
// file.js can stage them for window.print(). Reuses the live canvas: we
// resize it briefly to paper-pixel dimensions, render at 1:1, capture as
// a data URL, then restore. Only one place touches the canvas at a time
// so this is safe; the trade-off is the visible flash of the resized
// canvas, which we hide with visibility:hidden during the loop.
// ==============================================================================

function captureAllSheetsForPrint(dpi) {
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) return [];

  // Snapshot everything we're about to mutate so we can restore exactly.
  const saved = {
    canvasW: canvas.width,
    canvasH: canvas.height,
    canvasStyleW: canvas.style.width,
    canvasStyleH: canvas.style.height,
    canvasVisibility: canvas.style.visibility,
    transform: ctx.getTransform(),
    viewMode: state.viewMode,
    activeSheetId: state.activeSheetId,
    bodyClassDraw: document.body.classList.contains("mode-draw"),
    bodyClassPlan: document.body.classList.contains("mode-plan"),
  };

  state.viewMode = "plan";
  state.printContext = { ppi: dpi };
  // Hide the canvas while we cycle through sheet sizes — the user
  // shouldn't see the working area resize and flash through pages.
  canvas.style.visibility = "hidden";

  const pages = [];
  try {
    for (const sheet of state.sheets) {
      state.activeSheetId = sheet.id;
      const dim = paperDimensionsIn(sheet);
      const pw = Math.max(1, Math.round(dim.w * dpi));
      const ph = Math.max(1, Math.round(dim.h * dpi));
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = pw + "px";
      canvas.style.height = ph + "px";
      // Reset transform to 1:1 — fitCanvas applies a DPR scale during normal
      // rendering, but here we want raw paper pixels so the print output
      // matches the requested DPI exactly.
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      render();

      // Watermark unpaid exports — drawn after the sheet renders so the
      // diagonal "DRAFT" pattern + logo land on top of every shape and
      // title-block element. Bakes into the captured PNG so it survives
      // the trip through window.print().
      drawExportWatermark(pw, ph);

      pages.push({
        dataUrl: canvas.toDataURL("image/png"),
        widthIn: dim.w,
        heightIn: dim.h,
        pixelW: pw,
        pixelH: ph,
        label: ((sheet.number || "") + " — " + (sheet.name || "")).trim(),
      });
    }
  } finally {
    // Restore canvas + state, then re-fit so subsequent renders look right.
    state.printContext = null;
    state.viewMode = saved.viewMode;
    state.activeSheetId = saved.activeSheetId;
    canvas.width = saved.canvasW;
    canvas.height = saved.canvasH;
    canvas.style.width = saved.canvasStyleW;
    canvas.style.height = saved.canvasStyleH;
    canvas.style.visibility = saved.canvasVisibility;
    const t = saved.transform;
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    fitCanvas();
    // Refresh the Plan-mode UI in case the active sheet was cycled past.
    renderSheetList();
    renderSheetProperties();
    renderNotesEditor();
    renderSheetLayerTree();
    render();
  }
  return pages;
}

// ==============================================================================
// Export watermark — applied to PDF exports for visitors without an active
// "base" entitlement. The goal isn't DRM (the JS is right there for anyone
// who wants to bypass it); it's making sure the export can't be passed off
// as a finished drawing — a building inspector or contractor seeing the
// diagonal "DRAFT" tile would never accept it.
//
// state.paid is set by js/auth.js after a successful Supabase entitlement
// check. Anything else — file://, offline, unauthenticated, network error,
// SDK load failure — leaves state.paid === false, so the watermark applies.
// ==============================================================================

const WATERMARK_LABEL = "DRAFT — easydraftonline.com";
const WATERMARK_LOGO_SRC = "images/logo_transparent_background.png";
let watermarkLogoEl = null;

function ensureWatermarkLogo() {
  if (watermarkLogoEl) return watermarkLogoEl;
  watermarkLogoEl = new Image();
  // Same-origin asset (or local file in file:// mode) — no CORS concern.
  watermarkLogoEl.src = WATERMARK_LOGO_SRC;
  return watermarkLogoEl;
}

function drawExportWatermark(canvasW, canvasH) {
  if (state.paid) return;

  const logo = ensureWatermarkLogo();

  // Center logo first so the diagonal text overlays it — keeps the brand
  // reading clearly without burying the text. If the image hasn't loaded
  // yet (slow disk on a fresh page-load export), the text-only watermark
  // still does the job on its own.
  if (logo && logo.complete && logo.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    const target = Math.min(canvasW, canvasH) * 0.55;
    const aspect = logo.naturalWidth / logo.naturalHeight;
    let lw, lh;
    if (aspect >= 1) { lw = target; lh = target / aspect; }
    else             { lh = target; lw = target * aspect; }
    ctx.drawImage(logo, (canvasW - lw) / 2, (canvasH - lh) / 2, lw, lh);
    ctx.restore();
  }

  // Tiled diagonal "DRAFT — easydraftonline.com" stripes. Sized as a
  // fraction of the smaller paper dimension so the watermark scales with
  // the page (Letter / Tabloid / Arch D all read the same).
  ctx.save();
  const fontPx = Math.max(36, Math.round(Math.min(canvasW, canvasH) * 0.075));
  ctx.font = `900 ${fontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.fillStyle = "rgba(220, 38, 38, 0.32)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate(-Math.PI / 6);

  const lineGap = fontPx * 2.4;
  const diag = Math.hypot(canvasW, canvasH);
  const lines = Math.ceil(diag / lineGap) + 2;
  for (let i = -lines; i <= lines; i++) {
    ctx.fillText(WATERMARK_LABEL, 0, i * lineGap);
  }
  ctx.restore();
}

// ==============================================================================
// Draft-mode page overlay — renders each sheet as a paper rectangle on the
// drafting canvas with its viewport area highlighted inside. Lets the user
// place pages over their drawing visually, and provides the hit-test edge
// the select tool drags to reposition.
// ==============================================================================

const PAGE_EDGE_HIT_PX = 8;

function drawPagesOnCanvas() {
  if (state.viewMode !== "draw") return;
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) return;
  for (const sheet of state.sheets) {
    // Schedule / index sheets aren't bound to a region of the drawing —
    // they're generated content. No page rect, no drag affordance.
    if ((sheet.sheetType || "drawing") !== "drawing") continue;
    // Per-page outline visibility — toggled via the eyeball on each row
    // in the Pages list. Off by default so a fresh page doesn't paint
    // over the user's drawing.
    if (!sheet.pageOutlineVisible) continue;
    drawPageRect(sheet, sheet.id === state.activeSheetId);
  }
}

function drawPageRect(sheet, active) {
  const paperWorld = sheetPaperWorldSize(sheet);
  const viewportRect = sheetViewportRectWorld(sheet);
  if (!paperWorld || !viewportRect) return;
  if (!sheet.pageOrigin) return;

  const tl = worldToScreen(sheet.pageOrigin.x, sheet.pageOrigin.y);
  const br = worldToScreen(sheet.pageOrigin.x + paperWorld.w, sheet.pageOrigin.y + paperWorld.h);
  const view = viewSize();
  // Skip rendering when the page is fully off-screen.
  if (br.x < 0 || tl.x > view.w || br.y < 0 || tl.y > view.h) return;

  ctx.save();

  // Outer paper rectangle — light fill so the user sees what region is
  // "page" vs. open canvas, plus a dashed outline at the edge.
  ctx.fillStyle = active ? "rgba(232, 96, 44, 0.04)" : "rgba(232, 96, 44, 0.02)";
  ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.strokeStyle = active ? "rgba(232, 96, 44, 0.55)" : "rgba(232, 96, 44, 0.28)";
  ctx.setLineDash([8, 4]);
  ctx.lineWidth = active ? 1.25 : 1;
  ctx.strokeRect(
    Math.round(tl.x) + 0.5,
    Math.round(tl.y) + 0.5,
    Math.round(br.x - tl.x),
    Math.round(br.y - tl.y),
  );

  // Inner viewport rect — what plan view actually crops onto the sheet.
  // Drawn more prominently than the paper outline because that's where the
  // user actually positions their drawing.
  const vtl = worldToScreen(viewportRect.x, viewportRect.y);
  const vbr = worldToScreen(viewportRect.x + viewportRect.w, viewportRect.y + viewportRect.h);
  ctx.strokeStyle = active ? "rgba(232, 96, 44, 0.85)" : "rgba(232, 96, 44, 0.45)";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.strokeRect(
    Math.round(vtl.x) + 0.5,
    Math.round(vtl.y) + 0.5,
    Math.round(vbr.x - vtl.x),
    Math.round(vbr.y - vtl.y),
  );
  ctx.setLineDash([]);

  // Sheet number + name labeled outside the paper's top-left corner so the
  // text never collides with the drawing inside the viewport.
  const label = (((sheet.number || "") + "  " + (sheet.name || "")).trim());
  if (label) {
    ctx.fillStyle = active ? "rgba(232, 96, 44, 0.95)" : "rgba(232, 96, 44, 0.65)";
    ctx.font = `${active ? 700 : 600} 11px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, tl.x + 4, tl.y - 3);
  }

  ctx.restore();
}

// True when the screen point is on or near the paper rectangle's edge for
// any sheet — used by the select tool to start a page drag without
// snagging on shape clicks inside the viewport.
function findPageEdgeAtScreen(sx, sy) {
  if (!Array.isArray(state.sheets)) return null;
  const tol = PAGE_EDGE_HIT_PX;
  // Iterate active sheet last so it wins ties when pages overlap.
  const list = state.sheets.slice();
  list.sort((a, b) => (a.id === state.activeSheetId ? 1 : 0) - (b.id === state.activeSheetId ? 1 : 0));
  for (let i = list.length - 1; i >= 0; i--) {
    const sheet = list[i];
    if ((sheet.sheetType || "drawing") !== "drawing") continue;
    // Hidden pages aren't draggable — there'd be no visible affordance,
    // and clicking through "empty" canvas would silently drag a page the
    // user can't see.
    if (!sheet.pageOutlineVisible) continue;
    const paperWorld = sheetPaperWorldSize(sheet);
    if (!paperWorld || !sheet.pageOrigin) continue;
    const tl = worldToScreen(sheet.pageOrigin.x, sheet.pageOrigin.y);
    const br = worldToScreen(sheet.pageOrigin.x + paperWorld.w, sheet.pageOrigin.y + paperWorld.h);
    const onLeft   = Math.abs(sx - tl.x) <= tol && sy >= tl.y - tol && sy <= br.y + tol;
    const onRight  = Math.abs(sx - br.x) <= tol && sy >= tl.y - tol && sy <= br.y + tol;
    const onTop    = Math.abs(sy - tl.y) <= tol && sx >= tl.x - tol && sx <= br.x + tol;
    const onBottom = Math.abs(sy - br.y) <= tol && sx >= tl.x - tol && sx <= br.x + tol;
    if (onLeft || onRight || onTop || onBottom) return sheet;
  }
  return null;
}

// Wheel in plan mode steps the architectural scale by one preset per
// notch, with the drawing point under the cursor anchored so zooming
// always feels like it's centered where the user is pointing. We
// accumulate small deltaY events (trackpads, smooth-scroll mice) and
// only advance once we've crossed a threshold, so the user gets one
// scale step per "click" of the wheel rather than racing through every
// preset on a single scroll gesture.
const PLAN_WHEEL_STEP_THRESHOLD = 40;

function planWheel(e) {
  ensurePlanView();
  e.preventDefault();
  state.planView._wheelAcc = (state.planView._wheelAcc || 0) + e.deltaY;
  if (Math.abs(state.planView._wheelAcc) < PLAN_WHEEL_STEP_THRESHOLD) return;
  const dir = state.planView._wheelAcc < 0 ? +1 : -1; // wheel up ⇒ zoom in
  state.planView._wheelAcc = 0;

  const sheet = activeSheet();
  if (!sheet) return;
  const tbl = activeScaleTable();
  const sortedKeys = Object.keys(tbl).sort((a, b) => tbl[a] - tbl[b]);
  const currentKey = sheet.titleBlock && sheet.titleBlock.scale;
  let curIdx = sortedKeys.indexOf(currentKey);
  if (curIdx === -1) curIdx = sortedKeys.indexOf(defaultScaleKey());
  const newIdx = Math.max(0, Math.min(sortedKeys.length - 1, curIdx + dir));
  if (newIdx === curIdx) return;

  const rect = canvas.getBoundingClientRect();
  const screenSp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  // Drawing point under the cursor *before* the scale change — used to
  // re-anchor pageOrigin afterwards so that point stays fixed on screen.
  const anchorDrawing = drawingPointUnderScreen(sheet, screenSp);

  sheet.titleBlock = sheet.titleBlock || {};
  sheet.titleBlock.scale = sortedKeys[newIdx];
  preservingPageCenter(sheet, () => {});  // no-op; scale change already happened, but the call shape stays consistent

  if (anchorDrawing && sheet.pageOrigin) {
    // Re-derive what pageOrigin would put `anchorDrawing` back under the
    // cursor at the new scale.
    const newOrigin = drawingOriginThatPlacesAt(sheet, screenSp, anchorDrawing);
    if (newOrigin) {
      sheet.pageOrigin.x = newOrigin.x;
      sheet.pageOrigin.y = newOrigin.y;
    }
  }

  renderSheetProperties();
  render();
}

// Reverse the plan-view rendering pipeline at a given screen point: returns
// the drawing-feet coordinate that's currently displayed under that pixel.
// Returns null when the rendering math degenerates (zero ppi, missing
// pageOrigin).
function drawingPointUnderScreen(sheet, sp) {
  if (!sheet || !sheet.pageOrigin) return null;
  const view = viewSize();
  const ppi = paperFitPpi(sheet);
  const ipf = paperInchesPerFoot(sheet);
  if (ppi <= 0 || ipf <= 0) return null;
  const dim = paperDimensionsIn(sheet);
  const paperW = dim.w * ppi;
  const paperH = dim.h * ppi;
  const pan = planPan();
  const paperX = (view.w - paperW) / 2 + pan.x;
  const paperY = (view.h - paperH) / 2 + pan.y;
  const pInchX = (sp.x - paperX) / ppi;
  const pInchY = (sp.y - paperY) / ppi;
  return {
    x: sheet.pageOrigin.x + pInchX / ipf,
    y: sheet.pageOrigin.y + pInchY / ipf,
  };
}

// Inverse of drawingPointUnderScreen — what pageOrigin makes `drawingPt`
// land under `sp` on screen with the sheet's current scale + paper layout?
function drawingOriginThatPlacesAt(sheet, sp, drawingPt) {
  const view = viewSize();
  const ppi = paperFitPpi(sheet);
  const ipf = paperInchesPerFoot(sheet);
  if (ppi <= 0 || ipf <= 0) return null;
  const dim = paperDimensionsIn(sheet);
  const paperW = dim.w * ppi;
  const paperH = dim.h * ppi;
  const pan = planPan();
  const paperX = (view.w - paperW) / 2 + pan.x;
  const paperY = (view.h - paperH) / 2 + pan.y;
  const pInchX = (sp.x - paperX) / ppi;
  const pInchY = (sp.y - paperY) / ppi;
  return {
    x: drawingPt.x - pInchX / ipf,
    y: drawingPt.y - pInchY / ipf,
  };
}

// ==============================================================================
// Sheet CRUD + list rendering
// ==============================================================================

// "A-101" -> "A-102". If the prior number doesn't match the discipline-letter
// + numeric pattern (user renamed it freeform), fall back to A-1xx counting.
// Pads to 3 digits to match the AIA convention.
function nextSheetNumber() {
  if (!Array.isArray(state.sheets) || state.sheets.length === 0) return "A-101";
  let bestN = 100; // "A-101" is the residential cover-sheet standard start
  let prefix = "A-";
  let pad = 3;
  for (const s of state.sheets) {
    const m = /^([A-Za-z]+-?)(\d+)$/.exec((s.number || "").trim());
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (n > bestN) {
      bestN = n;
      prefix = m[1];
      pad = m[2].length;
    }
  }
  const next = bestN + 1;
  return prefix + String(next).padStart(pad, "0");
}

function addSheet() {
  const number = nextSheetNumber();
  const sheet = {
    id: makeId("SH"),
    name: "Sheet " + (state.sheets.length + 1),
    number,
    sheetType: "drawing",
    paperSize: "ANSI-A",
    orientation: "landscape",
    pageOrigin: defaultPageOriginForNewSheet("ANSI-A", "landscape"),
    pageOutlineVisible: false,
    textScale: 1,
    titleBlock: {
      project: "",
      address: "",
      title: SHEET_TYPE_DEFAULT_TITLES.drawing,
      date: new Date().toLocaleDateString(),
      drawnBy: "",
      scale: '1/4" = 1\'-0"',
    },
    notes: [],
  };
  state.sheets.push(sheet);
  state.activeSheetId = sheet.id;
  renderSheetList();
  // Draft mode renders the page rect on the canvas, so it also needs a
  // render when sheets change — not just plan mode.
  render();
  return sheet;
}

async function removeSheet(id) {
  if (!Array.isArray(state.sheets)) return;
  if (state.sheets.length <= 1) {
    await appAlert("Add another page first if you want to remove this one.", {
      title: "Can't delete the last page",
    });
    return;
  }
  const idx = state.sheets.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const target = state.sheets[idx];
  const ok = await appConfirm(`This will remove ${target.number || target.name} from the sheet set.`, {
    title: `Delete "${target.number} — ${target.name}"?`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  state.sheets.splice(idx, 1);
  if (state.activeSheetId === id) {
    state.activeSheetId = (state.sheets[idx] || state.sheets[idx - 1] || state.sheets[0]).id;
  }
  renderSheetList();
  render();
}

function togglePageOutline(id) {
  const sheet = state.sheets.find((s) => s.id === id);
  if (!sheet) return;
  sheet.pageOutlineVisible = !sheet.pageOutlineVisible;
  renderSheetList();
  render();
}

async function renameSheet(id) {
  const sheet = state.sheets.find((s) => s.id === id);
  if (!sheet) return;
  const name = await appPrompt("Page name:", sheet.name, {
    title: "Rename page",
    confirmLabel: "Rename",
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  sheet.name = trimmed;
  renderSheetList();
  render();
}

function setActiveSheet(id) {
  if (state.activeSheetId === id) return;
  if (!state.sheets.find((s) => s.id === id)) return;
  state.activeSheetId = id;
  renderSheetList();
  renderSheetProperties();
  renderNotesEditor();
  renderSheetLayerTree();
  render();
}

// ==============================================================================
// General Notes editor (sidebar)
// ==============================================================================

function addNote() {
  const sheet = activeSheet();
  if (!sheet) return;
  sheet.notes = Array.isArray(sheet.notes) ? sheet.notes : [];
  sheet.notes.push("");
  renderNotesEditor();
  if (state.viewMode === "plan") render();
  // Focus the freshly added textarea so the user can type immediately.
  if (notesListEl) {
    const last = notesListEl.querySelector(".note-row:last-child .note-text");
    if (last) last.focus();
  }
}

function removeNote(idx) {
  const sheet = activeSheet();
  if (!sheet || !Array.isArray(sheet.notes)) return;
  if (idx < 0 || idx >= sheet.notes.length) return;
  sheet.notes.splice(idx, 1);
  renderNotesEditor();
  if (state.viewMode === "plan") render();
}

function renderNotesEditor() {
  if (!notesListEl) return;
  notesListEl.innerHTML = "";
  const sheet = activeSheet();
  if (!sheet) return;
  const notes = Array.isArray(sheet.notes) ? sheet.notes : [];

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "notes-empty";
    empty.textContent = "No notes yet. Click + Note to add one.";
    notesListEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < notes.length; i++) {
    const row = document.createElement("div");
    row.className = "note-row";

    const num = document.createElement("span");
    num.className = "note-num";
    num.textContent = (i + 1) + ".";
    row.appendChild(num);

    const ta = document.createElement("textarea");
    ta.className = "note-text";
    ta.rows = 2;
    ta.spellcheck = true;
    ta.value = notes[i];
    ta.dataset.idx = String(i);
    row.appendChild(ta);

    const del = document.createElement("button");
    del.className = "icon-btn delete-btn";
    del.dataset.idx = String(i);
    del.dataset.noteAction = "delete";
    del.title = "Delete note";
    del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    row.appendChild(del);

    notesListEl.appendChild(row);
  }
}

// ==============================================================================
// Sheet Layers panel — mirror of the master layer tree, with per-sheet
// visibility checkboxes. Globally hidden layers appear faded and locked
// (they can't show on this sheet either).
// ==============================================================================

function renderSheetLayerTree() {
  if (!sheetLayerTreeEl) return;
  sheetLayerTreeEl.innerHTML = "";
  const sheet = activeSheet();
  if (!sheet) return;

  for (const story of state.stories) {
    const storyEl = document.createElement("div");
    storyEl.className = "sheet-story";
    storyEl.dataset.storyId = story.id;

    const header = document.createElement("div");
    header.className = "sheet-story-header";
    if (!story.visible) header.classList.add("global-hidden");

    const storyChk = document.createElement("input");
    storyChk.type = "checkbox";
    storyChk.dataset.role = "story-toggle";
    storyChk.dataset.storyId = story.id;
    const subStates = story.sublayers.map((sub) => isSubVisibleForSheet(sub, story, sheet));
    const allShown = subStates.every(Boolean);
    const noneShown = subStates.every((v) => !v);
    storyChk.checked = isStoryVisibleForSheet(story, sheet) && allShown;
    storyChk.indeterminate = !storyChk.checked && !noneShown;
    storyChk.disabled = !story.visible;
    storyChk.title = story.visible
      ? "Show / hide this entire story on the active sheet"
      : "Story is hidden globally — toggle it back in Draw mode";
    header.appendChild(storyChk);

    const name = document.createElement("span");
    name.className = "sheet-story-name";
    name.textContent = story.name;
    header.appendChild(name);

    storyEl.appendChild(header);

    const subList = document.createElement("div");
    subList.className = "sheet-sub-list";
    for (const sub of story.sublayers) {
      const row = document.createElement("div");
      row.className = "sheet-sub-row";
      if (!sub.visible || !story.visible) row.classList.add("global-hidden");
      row.dataset.subId = sub.id;

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.dataset.role = "sub-toggle";
      chk.dataset.subId = sub.id;
      chk.checked = isSubVisibleForSheet(sub, story, sheet);
      chk.disabled = !sub.visible || !story.visible;
      chk.title = sub.visible
        ? "Show / hide this layer on the active sheet"
        : "Layer is hidden globally — toggle it back in Draw mode";
      row.appendChild(chk);

      const bubble = document.createElement("span");
      bubble.className = "color-bubble";
      bubble.style.background = sub.color || DEFAULT_LAYER_COLOR_FALLBACK;
      row.appendChild(bubble);

      const subName = document.createElement("span");
      subName.className = "sheet-sub-name";
      subName.textContent = sub.name;
      row.appendChild(subName);

      subList.appendChild(row);
    }
    storyEl.appendChild(subList);
    sheetLayerTreeEl.appendChild(storyEl);
  }
}

function bindSheetLayerTree() {
  if (!sheetLayerTreeEl) return;
  sheetLayerTreeEl.addEventListener("change", (e) => {
    const chk = e.target;
    if (!chk || chk.type !== "checkbox") return;
    const sheet = activeSheet();
    if (!sheet) return;

    if (chk.dataset.role === "story-toggle") {
      const story = state.stories.find((s) => s.id === chk.dataset.storyId);
      if (!story) return;
      // Story-level toggle: when shown, clear both the story override and
      // every sublayer override under it so all sublayers come back. When
      // hidden, just set the story override — sublayer overrides are kept
      // verbatim so the next "show" returns the user's prior per-sub
      // selections.
      sheet.layerOverrides = sheet.layerOverrides || {};
      if (chk.checked) {
        delete sheet.layerOverrides[story.id];
        for (const sub of story.sublayers) delete sheet.layerOverrides[sub.id];
      } else {
        sheet.layerOverrides[story.id] = false;
      }
    } else if (chk.dataset.role === "sub-toggle") {
      setSheetLayerOverride(sheet, chk.dataset.subId, !chk.checked);
      // If the user re-shows a sub on a story whose story-level override
      // was hiding it, clear that override so the sub actually appears.
      if (chk.checked) {
        const story = state.stories.find((s) =>
          s.sublayers.some((l) => l.id === chk.dataset.subId)
        );
        if (story && sheet.layerOverrides && sheet.layerOverrides[story.id] === false) {
          delete sheet.layerOverrides[story.id];
          // Hide the other sublayers on this story explicitly so dropping
          // the story override doesn't suddenly reveal everything.
          for (const sub of story.sublayers) {
            if (sub.id === chk.dataset.subId) continue;
            sheet.layerOverrides[sub.id] = false;
          }
        }
      }
    }
    renderSheetLayerTree();
    if (state.viewMode === "plan") render();
  });
}

function bindNotesEditor() {
  if (notesListEl) {
    // Live updates as the user types, mirrored onto the sheet.
    notesListEl.addEventListener("input", (e) => {
      const ta = e.target;
      if (!ta.classList || !ta.classList.contains("note-text")) return;
      const sheet = activeSheet();
      if (!sheet || !Array.isArray(sheet.notes)) return;
      const idx = parseInt(ta.dataset.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= sheet.notes.length) return;
      sheet.notes[idx] = ta.value;
      if (state.viewMode === "plan") render();
    });

    notesListEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-note-action='delete']");
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (isNaN(idx)) return;
      removeNote(idx);
    });
  }
  if (addNoteBtn) {
    addNoteBtn.addEventListener("click", () => addNote());
  }
}

function renderSheetList() {
  if (!sheetListEl) return;
  sheetListEl.innerHTML = "";
  if (!Array.isArray(state.sheets)) return;
  for (const sheet of state.sheets) {
    const row = document.createElement("div");
    row.className = "sheet-row" + (sheet.id === state.activeSheetId ? " active" : "");
    row.dataset.sheetId = sheet.id;

    const num = document.createElement("span");
    num.className = "sheet-number";
    num.textContent = sheet.number || "—";
    row.appendChild(num);

    const name = document.createElement("span");
    name.className = "sheet-name";
    name.textContent = sheet.name || "Sheet";
    name.title = "Double-click to rename";
    row.appendChild(name);

    // Eye toggle for the page outline on the draft canvas. Only drawing
    // sheets have a page rect to show; schedule / index sheets don't get
    // the button at all (would be a dead control).
    const sheetLabel = ((sheet.number || "").trim() || "sheet") + " " + (sheet.name || "");
    if ((sheet.sheetType || "drawing") === "drawing") {
      const visible = !!sheet.pageOutlineVisible;
      const visBtn = document.createElement("button");
      visBtn.className = "icon-btn vis-btn" + (visible ? "" : " muted");
      visBtn.dataset.sheetAction = "toggle-visibility";
      const visLabel = visible
        ? "Hide page outline on the draft canvas"
        : "Show page outline on the draft canvas";
      visBtn.title = visLabel;
      visBtn.setAttribute("aria-label", `${visLabel} for ${sheetLabel}`);
      visBtn.setAttribute("aria-pressed", String(visible));
      visBtn.innerHTML = visible ? eyeSvg() : eyeOffSvg();
      row.appendChild(visBtn);
    }

    const renameBtn = document.createElement("button");
    renameBtn.className = "icon-btn";
    renameBtn.dataset.sheetAction = "rename";
    renameBtn.title = "Rename";
    renameBtn.setAttribute("aria-label", `Rename ${sheetLabel}`);
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    row.appendChild(renameBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn delete-btn";
    delBtn.dataset.sheetAction = "delete";
    delBtn.title = "Delete sheet";
    delBtn.setAttribute("aria-label", `Delete ${sheetLabel}`);
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    row.appendChild(delBtn);

    sheetListEl.appendChild(row);
  }
}

// ==============================================================================
// Sheet properties form (paper size, orientation, scale, title block)
// ==============================================================================

// Pretty label for each paper size, used in the dropdown. Stored values stay
// canonical ("ARCH-D"); the label format follows AIA convention with the
// long edge first, since we render landscape by default.
const PAPER_SIZE_LABELS = {
  "ANSI-A": 'Letter — 8.5 × 11"',
  "ARCH-A": 'ARCH A — 9 × 12"',
  "ARCH-B": 'ARCH B — 12 × 18"',
  "ARCH-C": 'ARCH C — 18 × 24"',
  "ARCH-D": 'ARCH D — 24 × 36"',
  "ARCH-E": 'ARCH E — 36 × 48"',
  "ANSI-B": 'Tabloid — 11 × 17"',
  "ANSI-C": 'ANSI C — 17 × 22"',
  "ANSI-D": 'ANSI D — 22 × 34"',
  "ANSI-E": 'ANSI E — 34 × 44"',
  "A4": "A4 — 210 × 297 mm",
  "A3": "A3 — 297 × 420 mm",
  "A2": "A2 — 420 × 594 mm",
  "A1": "A1 — 594 × 841 mm",
  "A0": "A0 — 841 × 1189 mm",
};

// Populate dropdowns. Paper sizes are unit-agnostic (ARCH-D is ARCH-D in any
// unit) so they're populated once. Scales are unit-specific (ARCH_SCALES vs.
// METRIC_SCALES), so populateScaleSelect() is re-callable from
// applyUnitsToUI() when the user toggles units.
function populateSheetPropertyOptions() {
  if (propPaperSizeSel && !propPaperSizeSel.options.length) {
    for (const key of Object.keys(PAPER_SIZES)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = PAPER_SIZE_LABELS[key] || key;
      propPaperSizeSel.appendChild(opt);
    }
  }
  populateScaleSelect();
}

function populateScaleSelect() {
  if (!propScaleSel) return;
  const table = activeScaleTable();
  // Replace contents — saved sheets may carry a key from the other unit
  // system; if so, we still want the active set in the dropdown.
  propScaleSel.innerHTML = "";
  for (const key of Object.keys(table)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    propScaleSel.appendChild(opt);
  }
}

// Sync inputs ← active sheet. Called after switching sheets, after Open/New,
// and after any add/rename/delete — anywhere the active-sheet identity or
// contents could have changed without going through the form.
function renderSheetProperties() {
  const sheet = activeSheet();
  if (!sheet) return;
  populateSheetPropertyOptions();

  if (propSheetTypeSel && document.activeElement !== propSheetTypeSel) {
    propSheetTypeSel.value = sheet.sheetType || "drawing";
  }
  if (propPaperSizeSel && document.activeElement !== propPaperSizeSel) {
    propPaperSizeSel.value = sheet.paperSize || "ARCH-D";
  }
  if (propScaleSel && document.activeElement !== propScaleSel) {
    const scale = sheet.titleBlock?.scale;
    const tbl = activeScaleTable();
    propScaleSel.value = (scale && (scale in tbl)) ? scale : defaultScaleKey();
  }
  if (propTextScaleSel && document.activeElement !== propTextScaleSel) {
    const ts = sheetTextScale(sheet);
    // Snap to whichever option value is closest so legacy / custom values
    // pick a sensible preset rather than showing nothing.
    let bestVal = "1";
    let bestDelta = Infinity;
    for (const opt of propTextScaleSel.options) {
      const d = Math.abs(parseFloat(opt.value) - ts);
      if (d < bestDelta) { bestDelta = d; bestVal = opt.value; }
    }
    propTextScaleSel.value = bestVal;
  }
  if (propOrientationEl) {
    const o = sheet.orientation === "portrait" ? "portrait" : "landscape";
    for (const btn of propOrientationEl.querySelectorAll("button")) {
      btn.classList.toggle("active", btn.dataset.orient === o);
    }
  }

  // Text fields — only overwrite when the user isn't actively typing in
  // them, so a sheet-list re-render mid-edit doesn't yank their cursor.
  setIfNotFocused(propNumberInput,  sheet.number || "");
  setIfNotFocused(propTitleInput,   sheet.titleBlock?.title    || "");
  setIfNotFocused(propProjectInput, sheet.titleBlock?.project  || "");
  setIfNotFocused(propAddressInput, sheet.titleBlock?.address  || "");
  setIfNotFocused(propDateInput,    sheet.titleBlock?.date     || "");
  setIfNotFocused(propDrawnByInput, sheet.titleBlock?.drawnBy  || "");
}

function setIfNotFocused(input, value) {
  if (!input) return;
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

function bindSheetProperties() {
  populateSheetPropertyOptions();

  const onSheetEdit = () => {
    if (state.viewMode === "plan") render();
    // Sheet number and name show in the rail; keep it in sync as the user
    // types so the relabel is immediate, not delayed until a sheet switch.
    renderSheetList();
  };

  if (propSheetTypeSel) {
    propSheetTypeSel.addEventListener("change", () => {
      const sheet = activeSheet();
      if (!sheet) return;
      const oldType = sheet.sheetType || "drawing";
      const newType = propSheetTypeSel.value;
      if (oldType === newType) return;
      sheet.sheetType = newType;
      // If the title still matches a known type-default, swap it for the
      // new type's default. Custom titles are left alone.
      sheet.titleBlock = sheet.titleBlock || {};
      const cur = sheet.titleBlock.title || "";
      if (!cur || ALL_DEFAULT_TITLES.has(cur)) {
        sheet.titleBlock.title = SHEET_TYPE_DEFAULT_TITLES[newType] || cur;
      }
      // A drawing sheet needs a pageOrigin; backfill if the user is
      // converting from schedule/index back to drawing.
      if (newType === "drawing" && (!sheet.pageOrigin || typeof sheet.pageOrigin.x !== "number")) {
        sheet.pageOrigin = defaultPageOriginForNewSheet(sheet.paperSize, sheet.orientation);
      }
      renderSheetProperties();
      onSheetEdit();
    });
  }

  if (propPaperSizeSel) {
    propPaperSizeSel.addEventListener("change", () => {
      const sheet = activeSheet();
      if (!sheet) return;
      preservingPageCenter(sheet, () => { sheet.paperSize = propPaperSizeSel.value; });
      onSheetEdit();
    });
  }

  if (propScaleSel) {
    propScaleSel.addEventListener("change", () => {
      const sheet = activeSheet();
      if (!sheet) return;
      preservingPageCenter(sheet, () => {
        sheet.titleBlock = sheet.titleBlock || {};
        sheet.titleBlock.scale = propScaleSel.value;
      });
      onSheetEdit();
    });
  }

  if (propTextScaleSel) {
    propTextScaleSel.addEventListener("change", () => {
      const sheet = activeSheet();
      if (!sheet) return;
      const v = parseFloat(propTextScaleSel.value);
      sheet.textScale = isFinite(v) && v > 0 ? v : 1;
      onSheetEdit();
    });
  }

  if (propOrientationEl) {
    propOrientationEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-orient]");
      if (!btn) return;
      const sheet = activeSheet();
      if (!sheet) return;
      preservingPageCenter(sheet, () => { sheet.orientation = btn.dataset.orient; });
      for (const b of propOrientationEl.querySelectorAll("button")) {
        b.classList.toggle("active", b === btn);
      }
      onSheetEdit();
    });
  }

  bindTextField(propNumberInput, (sheet, v) => { sheet.number = v; }, onSheetEdit);
  bindTextField(propTitleInput,
    (sheet, v) => { sheet.titleBlock = sheet.titleBlock || {}; sheet.titleBlock.title = v; },
    onSheetEdit);
  bindTextField(propProjectInput,
    (sheet, v) => { sheet.titleBlock = sheet.titleBlock || {}; sheet.titleBlock.project = v; },
    onSheetEdit);
  bindTextField(propAddressInput,
    (sheet, v) => { sheet.titleBlock = sheet.titleBlock || {}; sheet.titleBlock.address = v; },
    onSheetEdit);
  bindTextField(propDateInput,
    (sheet, v) => { sheet.titleBlock = sheet.titleBlock || {}; sheet.titleBlock.date = v; },
    onSheetEdit);
  bindTextField(propDrawnByInput,
    (sheet, v) => { sheet.titleBlock = sheet.titleBlock || {}; sheet.titleBlock.drawnBy = v; },
    onSheetEdit);
}

function bindTextField(input, apply, onChange) {
  if (!input) return;
  // Live-update on each keystroke so the canvas mirrors what's being typed.
  // Keyboard shortcuts (V, L, etc.) are already gated on focused inputs in
  // events.js, so plain typing is safe.
  input.addEventListener("input", () => {
    const sheet = activeSheet();
    if (!sheet) return;
    apply(sheet, input.value);
    onChange();
  });
}

function bindSheetList() {
  if (sheetListEl) {
    sheetListEl.addEventListener("click", (e) => {
      const row = e.target.closest(".sheet-row");
      if (!row) return;
      const actionBtn = e.target.closest("[data-sheet-action]");
      const id = row.dataset.sheetId;
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.sheetAction;
        if (action === "delete") removeSheet(id);
        else if (action === "rename") renameSheet(id);
        else if (action === "toggle-visibility") togglePageOutline(id);
        return;
      }
      setActiveSheet(id);
    });

    sheetListEl.addEventListener("dblclick", (e) => {
      const nameEl = e.target.closest(".sheet-name");
      if (!nameEl) return;
      const row = e.target.closest(".sheet-row");
      if (!row) return;
      renameSheet(row.dataset.sheetId);
    });
  }

  if (addSheetBtn) {
    addSheetBtn.addEventListener("click", () => addSheet());
  }
}
