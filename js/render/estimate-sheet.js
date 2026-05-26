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
  drawTableContent(sheet, vp, ppi, buildEstimateSections(est));
}
