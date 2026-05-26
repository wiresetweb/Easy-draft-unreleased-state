'use strict';

// ==============================================================================
// Materials Estimate sheet (Plan mode, sheetType "estimate").
//
// Turns the pure computeEstimate(state) output into the section list that
// drawTableContent() renders, so the Estimate sheet shares typography with the
// Schedule / Index sheets. See docs/materials-estimator.md §8.
//
// Layout, top to bottom:
//   • Missing inputs (Class-A gaps) — prominent, only when gaps exist
//   • One table per category (Framing, Sheathing, …) with a Story column
//   • Estimate settings (Class-B) so the basis is auditable
//   • Conventions (Class-C)
// ==============================================================================

// Category display order; anything not listed sorts to the end alphabetically.
const ESTIMATE_CATEGORY_ORDER = [
  "Framing", "Sheathing", "Drywall", "Insulation", "Masonry",
  "Finishes", "Flooring", "Structure", "Stairs", "Cabinets",
  "Schedule — Doors", "Schedule — Windows", "Schedule — Fixtures",
];

// Flatten the Class-B settings object into [label, value] rows for printing.
function estimateSettingsRows(settings) {
  if (!settings) return [];
  const rows = [];
  const pct = (v) => `${Math.round(v * 100)}%`;
  rows.push(["Stud spacing", `${settings.studSpacingIn}" o.c.`]);
  rows.push(["Cripple spacing", `${settings.crippleSpacingIn}" o.c.`]);
  rows.push(["Plates per wall", String(settings.platesPerWall)]);
  rows.push(["Header plies", String(settings.headerPly)]);
  rows.push(["Stock lumber", settings.stockLumberFt.map((f) => `${f}'`).join(", ")]);
  rows.push(["Drywall sheet", `${settings.drywallSheetFt.w}×${settings.drywallSheetFt.h}`]);
  rows.push(["Sheathing sheet", `${settings.sheathingSheetFt.w}×${settings.sheathingSheetFt.h}`]);
  rows.push(["Backsplash height", `${Math.round(settings.backsplashHeightFt * 12)}"`]);
  if (settings.wastePct) {
    rows.push(["Waste — framing / sheathing / drywall / insul.",
      [settings.wastePct.framing, settings.wastePct.sheathing, settings.wastePct.drywall, settings.wastePct.insulation].map(pct).join(" / ")]);
  }
  if (settings.flooringWastePct) {
    rows.push(["Waste — flooring (by pattern)",
      Object.entries(settings.flooringWastePct).map(([k, v]) => `${k} ${pct(v)}`).join(", ")]);
  }
  return rows;
}

// Build the section list consumed by drawTableContent().
function buildEstimateSections(est) {
  const sections = [];

  // 1) Missing inputs — always first when present so gaps are unmissable.
  if (est.gaps && est.gaps.length) {
    sections.push({
      title: `⚠ Missing inputs — ${est.gaps.length} (excluded from the estimate)`,
      columns: ["Class-A item not set"],
      rows: est.gaps.map((g) => [g.label]),
      empty: "",
    });
  }

  // 2) One table per category, in display order, with a Story column.
  const byCat = new Map();
  for (const li of est.lineItems) {
    if (!byCat.has(li.category)) byCat.set(li.category, []);
    byCat.get(li.category).push(li);
  }
  const cats = Array.from(byCat.keys()).sort((a, b) => {
    const ia = ESTIMATE_CATEGORY_ORDER.indexOf(a);
    const ib = ESTIMATE_CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  for (const cat of cats) {
    const rows = byCat.get(cat)
      // Group by story so each story's quantities read together (subtotal-by-story).
      .sort((a, b) => (a.storyName || "").localeCompare(b.storyName || "") || a.item.localeCompare(b.item))
      .map((li) => [li.storyName || "—", li.item, String(li.qty), li.unit, li.basis]);
    sections.push({
      title: cat,
      columns: ["Story", "Item", "Qty", "Unit", "Basis / notes"],
      rows,
      empty: "—",
    });
  }

  // 3) Class-B settings, so a builder can audit the math.
  const settingsRows = estimateSettingsRows(est.settings);
  if (settingsRows.length) {
    sections.push({
      title: "Estimate settings (Class B — editable)",
      columns: ["Setting", "Value"],
      rows: settingsRows,
      empty: "",
    });
  }

  // 4) Class-C conventions.
  if (est.conventions && est.conventions.length) {
    sections.push({
      title: "Conventions (Class C)",
      columns: ["#", "Convention"],
      rows: est.conventions.map((c, i) => [String(i + 1), c]),
      empty: "",
    });
  }

  return sections;
}

function drawEstimateSheet(sheet, vp, ppi) {
  // Locked state — a non-entitled visitor opened a file that already contains
  // an estimate sheet. Show a notice instead of the takeoff rather than
  // silently leaking the paid output.
  if (!state.hasEstimatorEngineer) {
    drawTableContent(sheet, vp, ppi, [{
      title: "Materials Estimate — paid add-on",
      columns: ["Locked"],
      rows: [
        ["This sheet needs the Materials Estimator add-on."],
        ["Unlock it with the Estimator + Engineering bundle to see the takeoff."],
      ],
      empty: "",
    }]);
    return;
  }
  const est = computeEstimate(state);
  const pages = paginateEstimate(est, sheet);
  const idx = Math.min(sheet.estimatePageIndex || 0, pages.length - 1);
  drawTableContent(sheet, vp, ppi, pages[idx] || []);
}

// ---------- Auto-pagination ----------
// drawTableContent lays content out top-down with these per-block heights
// (fractions of ppi × text-scale). We mirror them in inches — ppi cancels — so
// we can split the section list into pages without touching the canvas. Row
// heights are measured (cells wrap), using the same column widths / wrap logic
// as the renderer. Keep in lock-step with drawTableContent().
const EST_REF_PPI = 100;
const EST_TITLE_IN = (s) => 0.22 * s + 0.20;   // big sheet title + underline gap
const EST_SECT_IN  = (s) => 0.14 * s * 1.5;    // section header
const EST_EMPTY_IN = (s) => 0.10 * s * 2;      // "no rows" line
const EST_COLHDR_IN = (s) => 0.085 * s * 1.8;  // column header + rule
const EST_SAFETY_IN = 0.2;                      // conservative slack vs rounding
const EST_LINE_IN = (s) => 0.115 * s * TBL_LINE_MULT;   // one wrapped line
const EST_ROWPAD_IN = (s) => 0.115 * s * TBL_ROW_PAD_MULT;

// Drawable viewport size (inches), mirroring renderPlanView's vp computation.
function estimateViewportInches(sheet) {
  const dim = paperDimensionsIn(sheet);
  const bw = dim.w - (SHEET_MARGIN_IN.left + SHEET_MARGIN_IN.right);
  const tbW = Math.min(TITLE_BLOCK_WIDTH_IN, bw * 0.4);
  const w = bw - tbW - 0.25 - 0.25;
  const h = dim.h - (SHEET_MARGIN_IN.top + SHEET_MARGIN_IN.bottom) - 0.25 - 0.9;
  return { w, h };
}

function estimateContentBudgetIn(sheet) {
  const scale = sheetTextScale(sheet);
  const vp = estimateViewportInches(sheet);
  return Math.max(1, vp.h - 0.5 - EST_TITLE_IN(scale) - EST_SAFETY_IN);
}

// Column widths (inches) for a section's columns on this sheet — same weighting
// the renderer uses.
function estimateColWidthsIn(columns, sheet) {
  const tableW = estimateViewportInches(sheet).w - 0.6; // minus 2× padX (0.30)
  const weights = columnWeights(columns);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / total) * tableW);
}

// Measured height (inches) of one data row: max wrapped line count across its
// cells, using ctx.measureText at a reference ppi (line count is ppi-invariant).
function estimateRowHeightIn(row, colWsIn, scale) {
  const cellPx = Math.round(0.115 * EST_REF_PPI * scale);
  ctx.save();
  ctx.font = `${cellPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  let lines = 1;
  for (let c = 0; c < row.length; c++) {
    const w = wrapToWidth(String(row[c]), colWsIn[c] * EST_REF_PPI - 8);
    if (w.length > lines) lines = w.length;
  }
  ctx.restore();
  return lines * EST_LINE_IN(scale) + EST_ROWPAD_IN(scale);
}

// Split sections into pages, each a section-list shaped for drawTableContent.
// A section that overflows continues on the next page with a repeated header.
function paginateEstimateSections(sections, sheet) {
  const scale = sheetTextScale(sheet);
  const budget = estimateContentBudgetIn(sheet);
  const SECT = EST_SECT_IN(scale), EMPTY = EST_EMPTY_IN(scale), COLHDR = EST_COLHDR_IN(scale);
  const pages = [];
  let cur = [], used = 0;
  const flush = () => { if (cur.length) { pages.push(cur); cur = []; used = 0; } };

  for (const sec of sections) {
    const colWsIn = estimateColWidthsIn(sec.columns, sheet);
    const firstRowH = sec.rows.length ? estimateRowHeightIn(sec.rows[0], colWsIn, scale) : 0;
    const opener = SECT + (sec.rows.length ? COLHDR + firstRowH : EMPTY);
    if (used > 0 && used + opener > budget) flush();
    let part = { title: sec.title, columns: sec.columns, rows: [], empty: sec.empty };
    cur.push(part);
    used += SECT + (sec.rows.length ? COLHDR : EMPTY);
    for (const row of sec.rows) {
      const h = estimateRowHeightIn(row, colWsIn, scale);
      // Break only once the current part holds a row, so a single tall row
      // can't loop forever.
      if (used + h > budget && part.rows.length > 0) {
        flush();
        part = { title: sec.title + " (cont.)", columns: sec.columns, rows: [], empty: sec.empty };
        cur.push(part);
        used += SECT + COLHDR;
      }
      part.rows.push(row);
      used += h;
    }
    used += TBL_SECT_GAP_IN;
  }
  flush();
  return pages.length ? pages : [[]];
}

function paginateEstimate(est, sheet) {
  return paginateEstimateSections(buildEstimateSections(est), sheet);
}

// How many pages the current estimate needs on the given (primary) sheet.
function estimatePageCount(sheet) {
  if (!state.hasEstimatorEngineer) return 1;
  return paginateEstimate(computeEstimate(state), sheet).length;
}
