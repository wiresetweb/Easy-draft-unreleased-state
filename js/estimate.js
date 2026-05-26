'use strict';

// ==============================================================================
// Materials Estimator — pure calculation layer.
//
// Everything here is a pure function of `state` (read-only) that returns a
// plain data structure. The Estimate sheet renderer, the CSV exporter, and a
// future pricing layer all consume the same output, so the math lives in one
// place. See docs/materials-estimator.md.
//
// This file currently provides the wall-assembly resolver and the Class-A
// completeness check (M1). The per-category takeoff engine (M2) builds on top
// of these.
// ==============================================================================

// Resolve a wall shape to its construction assembly for the takeoff.
//   • A thickness matching a known preset auto-maps (4½"→2×4, 6½"→2×6, 8"→CMU).
//   • thickness 0 (centerline) or a custom thickness needs an explicit
//     `sh.assembly` tag; otherwise it's unresolved (a Class-A gap).
// Returns { key, label, category, studSize, resolved, fromPreset }.
function resolveWallAssembly(sh) {
  const t = sh.thickness || 0;
  for (const presetKey in WALL_THICKNESS_PRESETS) {
    if (Math.abs(WALL_THICKNESS_PRESETS[presetKey] - t) < 1e-6) {
      const aKey = PRESET_TO_ASSEMBLY[presetKey];
      const a = WALL_ASSEMBLIES[aKey] || {};
      return { key: aKey, label: a.label, category: a.category, studSize: a.studSize, resolved: true, fromPreset: true };
    }
  }
  if (sh.assembly && WALL_ASSEMBLIES[sh.assembly]) {
    const a = WALL_ASSEMBLIES[sh.assembly];
    return { key: sh.assembly, label: a.label, category: a.category, studSize: a.studSize, resolved: true, fromPreset: false };
  }
  return { key: null, label: null, category: null, studSize: null, resolved: false, fromPreset: false };
}

// All wall-type shapes (straight or curved lines on a Walls sub-layer) for a
// given story.
function wallShapesForStory(story) {
  const out = [];
  for (const sub of story.sublayers) {
    if (sub.name !== WALL_LAYER_NAME) continue;
    for (const sh of sub.shapes) {
      if (sh.type === "line" || sh.type === "arc") out.push(sh);
    }
  }
  return out;
}

// Short human label for an opening, used in gap messages.
function openingLabel(sh) {
  if (sh.kind) return sh.kind;
  const noun = sh.type === "window" ? "Window" : "Door";
  return `${noun} ${formatFeet(sh.width || 0)}`;
}

// Class-A completeness check. Returns an array of gap objects:
//   { type, storyId?, shapeId?, label }
// where `type` is one of: "ceilingHeight", "wallAssembly", "roughHeight",
// "framing". Complete items still estimate; these are listed prominently on
// the sheet and never silently guessed.
function computeEstimateGaps(st) {
  const gaps = [];

  for (const story of st.stories) {
    const walls = wallShapesForStory(story);

    // Ceiling height is required for any story that has walls to frame.
    if (walls.length && story.ceilingHeight == null) {
      gaps.push({
        type: "ceilingHeight",
        storyId: story.id,
        label: `${story.name}: ceiling height not set`,
      });
    }

    // Walls with an unresolved assembly (centerline / custom thickness, untagged).
    for (const sh of walls) {
      if (!resolveWallAssembly(sh).resolved) {
        gaps.push({
          type: "wallAssembly",
          storyId: story.id,
          shapeId: sh.id,
          label: `${story.name}: a wall's assembly isn't set (centerline or custom thickness)`,
        });
      }
    }

    // Joist framing is opt-in; once enabled it must be complete.
    const floor = story.framing && story.framing.floor;
    if (floor && (!FRAMING_SIZES.includes(floor.size) || !(floor.spacing > 0))) {
      gaps.push({
        type: "framing",
        storyId: story.id,
        label: `${story.name}: joist size / spacing incomplete`,
      });
    }
  }

  // Every door / window needs a rough-opening height to estimate.
  forEachShape((sh, sub, story) => {
    if ((sh.type === "door" || sh.type === "window") && sh.roughHeight == null) {
      gaps.push({
        type: "roughHeight",
        storyId: story ? story.id : null,
        shapeId: sh.id,
        label: `${openingLabel(sh)}: rough-opening height not set`,
      });
    }
  });

  return gaps;
}

// ==============================================================================
// M2 — per-category takeoff engine.
//
// computeEstimate(state) -> {
//   generatedAt, units, settings, conventions[], gaps[],
//   lineItems[ { category, storyId, storyName, item, qty, unit, basis } ]
// }
//
// Pure: reads state, mutates nothing. The sheet renderer and CSV exporter both
// consume the returned object; a future pricing layer multiplies qty.
// Conventions: feet internally; sheets are 4×8 (32 sf); member SIZING (header
// depth, joist adequacy) is intentionally NOT computed — that's the
// Engineering Tool's job. Incomplete (Class-A gap) items are excluded here and
// surfaced via gaps[]; nothing is guessed.
// ==============================================================================

const ESTIMATE_HEADER_BEARING_FT = 7 / 12;   // ~7" total bearing added to header length
const SHEET_SF = 32;                          // 4×8 sheet face area

// Run length of a wall shape (straight hypotenuse or summed arc samples).
function wallRunLength(sh) {
  if (sh.type === "arc") {
    const pts = sampleArcPoints(sh, 32);
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return len;
  }
  return Math.hypot((sh.x2 - sh.x1), (sh.y2 - sh.y1));
}

// Length of an open polyline (cabinet run): sum of consecutive segments.
function polylineLength(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

// Cluster wall endpoints into junctions (≥2 ends within tolerance). Returns
// clusters with their end count, used for corner stud adders and corner bead.
function analyzeJunctions(walls) {
  const tol = 0.25; // 3"
  const ends = [];
  for (const w of walls) {
    if (w.type === "line") {
      ends.push({ x: w.x1, y: w.y1 });
      ends.push({ x: w.x2, y: w.y2 });
    } else if (w.type === "arc") {
      const pts = sampleArcPoints(w, 8);
      if (pts.length) {
        ends.push({ x: pts[0].x, y: pts[0].y });
        ends.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
      }
    }
  }
  const clusters = [];
  for (const e of ends) {
    let c = clusters.find((cl) => Math.hypot(cl.x - e.x, cl.y - e.y) <= tol);
    if (!c) { c = { x: e.x, y: e.y, count: 0 }; clusters.push(c); }
    c.count += 1;
  }
  return clusters.filter((c) => c.count >= 2);
}

// Openings (doors + windows) anywhere in a story.
function openingsForStory(story) {
  const out = [];
  for (const sub of story.sublayers) {
    for (const sh of sub.shapes) {
      if (sh.type === "door" || sh.type === "window") out.push(sh);
    }
  }
  return out;
}

// True when an opening sits on a (straight) wall — within 6" of the centerline
// and roughly parallel. Used to subtract opening area from wall faces.
function openingOnWall(op, wall) {
  if (wall.type !== "line") return false;
  if (pointToSegmentDist(op.x, op.y, wall.x1, wall.y1, wall.x2, wall.y2) > 0.5) return false;
  const wallAng = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
  let da = Math.abs((op.angle - wallAng) % Math.PI);
  if (da > Math.PI / 2) da = Math.PI - da;
  return da < 0.2; // ~11°
}

function pushItem(items, category, story, item, qty, unit, basis) {
  items.push({
    category,
    storyId: story ? story.id : null,
    storyName: story ? story.name : "",
    item,
    qty,
    unit,
    basis: basis || "",
  });
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---- Per-story: framed + CMU walls, openings, finishes, flooring, structure ----
function estimateStory(story, st, items) {
  const cfg = st.estimateSettings || ESTIMATE_DEFAULTS;
  const spacing = cfg.studSpacingIn || 16;
  const H = story.ceilingHeight;
  const walls = wallShapesForStory(story);

  // Junctions → corner stud adders (3-stud corner = +2; T = +1) and corner bead.
  const junctions = analyzeJunctions(walls);
  let cornerStudAdder = 0;
  let cornerCount = 0;
  for (const j of junctions) {
    if (j.count === 2) { cornerStudAdder += 2; cornerCount += 1; }
    else if (j.count === 3) { cornerStudAdder += 1; }
  }

  // Accumulators per stud size for framed walls.
  const studsBySize = {};            // size -> stud count
  const plateLFBySize = {};          // size -> linear feet of plate (3 courses)
  let ptBottomPlateLF = 0;           // pressure-treated bottom plate (exterior)
  let sheathingArea = 0;             // exterior sheathing sf
  let insulationArea = 0;            // exterior insulation sf
  const drywallArea = { total: 0 };  // sf (both faces interior, one face exterior)
  let cmuFaceArea = 0;               // CMU wall face area sf

  // Only frame walls when ceiling height is known (else Class-A gap → excluded).
  if (H != null) {
    for (const w of walls) {
      const a = resolveWallAssembly(w);
      if (!a.resolved) continue; // unresolved assembly → gap, excluded
      const L = wallRunLength(w);
      if (L < 1e-6) continue;
      const faceArea = L * H;
      // Subtract openings sitting on this wall (only those with a known height).
      let openArea = 0;
      for (const op of openingsForStory(story)) {
        if (op.roughHeight != null && openingOnWall(op, w)) {
          openArea += op.width * op.roughHeight;
        }
      }
      const netFace = Math.max(0, faceArea - openArea);

      if (a.category === "framed") {
        const size = a.studSize || "2x4";
        studsBySize[size] = (studsBySize[size] || 0) + Math.ceil((L * 12) / spacing) + 1;
        plateLFBySize[size] = (plateLFBySize[size] || 0) + (cfg.platesPerWall || 3) * L;
        // 2×6 ≈ exterior wood-framed (sheathing + insulation + single-face
        // drywall + PT bottom plate); 2×4 ≈ interior partition (drywall both
        // faces). Documented convention.
        const exterior = size === "2x6";
        if (exterior) {
          sheathingArea += netFace;
          insulationArea += netFace;
          drywallArea.total += netFace;
          ptBottomPlateLF += L;
        } else {
          drywallArea.total += 2 * netFace;
        }
      } else if (a.category === "cmu") {
        cmuFaceArea += netFace;
      }
    }
  }

  // Distribute corner stud adders onto the dominant stud size (or 2×4).
  if (cornerStudAdder > 0) {
    const size = Object.keys(studsBySize)[0] || "2x4";
    studsBySize[size] = (studsBySize[size] || 0) + cornerStudAdder;
  }

  // --- Opening framing (king/jack/header/cripples/sill/casing) ---
  let kingStuds = 0, jackStuds = 0, crippleStuds = 0, headerCount = 0;
  let headerLF = 0, sillLF = 0, casingLF = 0;
  for (const op of openingsForStory(story)) {
    // Height-independent pieces compute even if roughHeight is missing
    // (those are flagged separately as gaps; nothing is guessed here).
    kingStuds += 2;
    jackStuds += 2;
    headerCount += 1;
    headerLF += op.width + ESTIMATE_HEADER_BEARING_FT;
    const cripPerSide = Math.ceil(op.width / (cfg.crippleSpacingIn / 12));
    crippleStuds += cripPerSide + (op.type === "window" ? cripPerSide : 0);
    if (op.type === "window") sillLF += op.width;
    // Casing needs the rough height; skip when unknown (opening already in gaps).
    if (op.roughHeight != null) {
      casingLF += op.type === "window"
        ? 2 * (op.width + op.roughHeight)            // 4 sides
        : op.width + 2 * op.roughHeight;             // 3 sides (head + 2 legs)
    }
  }

  // --- Emit framing line items ---
  for (const size in studsBySize) {
    pushItem(items, "Framing", story, `Studs (${size})`, studsBySize[size], "ea",
      `${spacing}" o.c. + end studs + corners/openings`);
  }
  for (const size in plateLFBySize) {
    const lf = plateLFBySize[size];
    const waste = cfg.wastePct.framing || 0;
    const stock = Math.max(...cfg.stockLumberFt);
    const pcs = Math.ceil((lf * (1 + waste)) / stock);
    pushItem(items, "Framing", story, `Plates (${size})`, round2(lf), "LF",
      `${cfg.platesPerWall}× wall length; ${pcs} pcs @ ${stock}'`);
  }
  if (ptBottomPlateLF > 0) {
    pushItem(items, "Framing", story, "Bottom plate — pressure-treated", round2(ptBottomPlateLF), "LF",
      "exterior / on-slab bottom plate");
  }
  if (kingStuds) pushItem(items, "Framing", story, "King studs", kingStuds, "ea", "2 per opening");
  if (jackStuds) pushItem(items, "Framing", story, "Jack (trimmer) studs", jackStuds, "ea", "2 per opening");
  if (crippleStuds) pushItem(items, "Framing", story, "Cripple studs", crippleStuds, "ea",
    `1 per ${cfg.crippleSpacingIn}" across opening (both above & below for windows)`);
  if (headerCount) pushItem(items, "Framing", story, `Headers (${cfg.headerPly}-ply)`, round2(headerLF), "LF",
    `width + ${Math.round(ESTIMATE_HEADER_BEARING_FT * 12)}" bearing; ${headerCount} openings — depth sized by Engineering Tool`);
  if (sillLF) pushItem(items, "Framing", story, "Rough sills", round2(sillLF), "LF", "window width");

  // --- Sheathing / drywall / insulation ---
  if (sheathingArea > 0) {
    const sheets = Math.ceil((sheathingArea * (1 + (cfg.wastePct.sheathing || 0))) / SHEET_SF);
    pushItem(items, "Sheathing", story, "Wall sheathing (4×8)", sheets, "sheets",
      `${round2(sheathingArea)} sf ÷ ${SHEET_SF} + ${Math.round((cfg.wastePct.sheathing || 0) * 100)}% waste`);
  }
  if (drywallArea.total > 0) {
    const sheetArea = (cfg.drywallSheetFt.w * cfg.drywallSheetFt.h) || SHEET_SF;
    const sheets = Math.ceil((drywallArea.total * (1 + (cfg.wastePct.drywall || 0))) / sheetArea);
    pushItem(items, "Drywall", story, `Drywall (${cfg.drywallSheetFt.w}×${cfg.drywallSheetFt.h})`, sheets, "sheets",
      `${round2(drywallArea.total)} sf (int. both faces, ext. one face) ÷ ${sheetArea} + waste`);
  }
  if (insulationArea > 0) {
    const sf = round2(insulationArea * (1 + (cfg.wastePct.insulation || 0)));
    pushItem(items, "Insulation", story, "Exterior wall insulation", sf, "sf",
      `R-values per assembly (${cfg.insulationRByAssembly["ext-wood"]} ext. wood)`);
  }

  // --- CMU ---
  if (cmuFaceArea > 0) {
    const blocks = Math.ceil(cmuFaceArea * 1.125);
    pushItem(items, "Masonry", story, "CMU blocks (8\")", blocks, "ea", `≈1.125 × ${round2(cmuFaceArea)} sf face`);
    pushItem(items, "Masonry", story, "Mortar", Math.ceil(blocks / 70), "bags", "≈70 blocks per bag");
    // Rebar + grouted cells depend on the structural design → deferred, not guessed.
  }

  // --- Corners (finishes) ---
  if (junctions.length) {
    pushItem(items, "Finishes", story, "Wall junctions", junctions.length, "ea", "exact count");
    if (H != null && cornerCount > 0) {
      pushItem(items, "Finishes", story, "Corner bead", round2(cornerCount * H), "LF",
        "outside corners × ceiling height (best-effort classification)");
    }
  }
  if (casingLF > 0) pushItem(items, "Finishes", story, "Casing / trim", round2(casingLF), "LF",
    "3 sides doors / 4 sides windows");

  // --- Flooring + baseboard + subfloor ---
  let floorAreaTotal = 0;
  const floors = [];
  for (const sub of story.sublayers) {
    for (const sh of sub.shapes) if (sh.type === "floor") floors.push(sh);
  }
  // Total door width in the story, subtracted from baseboard runs.
  let doorWidthTotal = 0;
  for (const op of openingsForStory(story)) if (op.type === "door") doorWidthTotal += op.width;

  let baseboardLF = 0;
  const byPattern = {};
  for (const fl of floors) {
    const area = polygonArea(fl.points);
    floorAreaTotal += area;
    const pattern = fl.pattern || "hardwood";
    byPattern[pattern] = (byPattern[pattern] || 0) + area;
    baseboardLF += polygonPerimeter(fl.points);
  }
  for (const pattern in byPattern) {
    const waste = (cfg.flooringWastePct && cfg.flooringWastePct[pattern] != null)
      ? cfg.flooringWastePct[pattern] : 0.10;
    const sf = round2(byPattern[pattern] * (1 + waste));
    const note = pattern === "carpet"
      ? `incl. ${Math.round(waste * 100)}% waste — sold by 12' roll`
      : `incl. ${Math.round(waste * 100)}% waste`;
    pushItem(items, "Flooring", story, `Flooring — ${pattern}`, sf, "sf", note);
    if (pattern.startsWith("tile")) {
      pushItem(items, "Flooring", story, `Thinset (${pattern})`, Math.ceil(byPattern[pattern] / 95), "bags", "≈95 sf per bag");
      pushItem(items, "Flooring", story, `Grout (${pattern})`, Math.ceil(byPattern[pattern] / 150), "bags", "≈150 sf per bag");
    }
  }
  if (baseboardLF > 0) {
    pushItem(items, "Finishes", story, "Baseboard", round2(Math.max(0, baseboardLF - doorWidthTotal)), "LF",
      "floor perimeter − door openings");
  }
  if (floorAreaTotal > 0) {
    const sheets = Math.ceil((floorAreaTotal * (1 + (cfg.wastePct.sheathing || 0))) / SHEET_SF);
    pushItem(items, "Structure", story, "Subfloor sheathing (4×8)", sheets, "sheets",
      `${round2(floorAreaTotal)} sf ÷ ${SHEET_SF} + waste`);
  }

  // --- Joists (only when opted in via framing.floor) ---
  const ff = story.framing && story.framing.floor;
  if (ff && FRAMING_SIZES.includes(ff.size) && ff.spacing > 0 && floors.length) {
    // Project floor points onto the joist axis (u) and perpendicular (n).
    const u = { x: Math.cos(ff.direction || 0), y: Math.sin(ff.direction || 0) };
    const n = { x: -u.y, y: u.x };
    let minU = Infinity, maxU = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const fl of floors) {
      for (const p of fl.points) {
        const pu = p.x * u.x + p.y * u.y;
        const pn = p.x * n.x + p.y * n.y;
        minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
        minN = Math.min(minN, pn); maxN = Math.max(maxN, pn);
      }
    }
    const along = maxU - minU;        // joist length
    const across = maxN - minN;       // span perpendicular to joists
    const count = Math.ceil((across * 12) / ff.spacing) + 1;
    pushItem(items, "Structure", story, `Floor joists (${ff.size})`, count, "ea",
      `${ff.spacing}" o.c. across ${round2(across)}' (rectangular-bay approx.) — adequacy by Engineering Tool`);
    pushItem(items, "Structure", story, `Joist linear feet (${ff.size})`, round2(count * along), "LF",
      `${count} × ${round2(along)}'`);
  }

  // --- Stairs ---
  for (const sub of story.sublayers) {
    for (const sh of sub.shapes) {
      if (sh.type !== "stairs") continue;
      if (sh.variant === "spiral") {
        const served = (sh.storiesUp || 0) + (sh.storiesDown || 0);
        pushItem(items, "Stairs", story, "Spiral stair kit", 1, "ea",
          `prefab kit${served ? ` — serves ${served} ${served === 1 ? "floor" : "floors"}` : ""}`);
        continue;
      }
      const treads = sh.stepCount || 0;
      if (!treads) continue;
      const width = sh.width || 0;
      const run = sh.run || 0;
      const rise = sh.rise || 0;
      const totalRun = treads * run;
      const totalRise = treads * rise;
      const slope = Math.hypot(totalRun, totalRise);
      const stringerCount = width > 3 ? 3 : 2;
      pushItem(items, "Stairs", story, "Treads", treads, "ea", "step count");
      pushItem(items, "Stairs", story, "Risers", treads + 1, "ea", "treads + 1");
      pushItem(items, "Stairs", story, "Stringers", stringerCount, "ea",
        `${stringerCount} (3 if width > 36"); ${round2(slope)}' each`);
      pushItem(items, "Stairs", story, "Stringer linear feet", round2(stringerCount * slope), "LF",
        `hypot(total run ${round2(totalRun)}', total rise ${round2(totalRise)}')`);
      pushItem(items, "Stairs", story, "Handrail", round2(totalRun), "LF", "run length");
      pushItem(items, "Stairs", story, "Balusters", treads, "ea", "≈1 per tread");
      pushItem(items, "Stairs", story, "Newel posts", 2, "ea", "top & bottom");
    }
  }

  // --- Cabinets ---
  for (const sub of story.sublayers) {
    for (const sh of sub.shapes) {
      if (sh.type !== "cabinet") continue;
      const lf = polylineLength(sh.points);
      if (lf < 1e-6) continue;
      const depth = sh.depth || DEFAULT_CABINET_DEPTH_FT;
      pushItem(items, "Cabinets", story, "Cabinet run", round2(lf), "LF", "traced path length");
      pushItem(items, "Cabinets", story, "Countertop", round2(lf * depth), "sf", `run × ${round2(depth)}' depth`);
      pushItem(items, "Cabinets", story, "Backsplash", round2(lf * cfg.backsplashHeightFt), "sf",
        `run × ${Math.round(cfg.backsplashHeightFt * 12)}" height`);
    }
  }

  // --- Appliance / fixture schedule (grouped by display label) ---
  const fixtures = new Map();
  for (const sub of story.sublayers) {
    for (const sh of sub.shapes) {
      if (sh.type !== "appliance") continue;
      const key = sh.label || sh.kind || "Fixture";
      fixtures.set(key, (fixtures.get(key) || 0) + 1);
    }
  }
  for (const [label, count] of fixtures) {
    pushItem(items, "Schedule — Fixtures", story, label, count, "ea", "count");
  }
}

// Document-level door / window schedule (grouped by kind across the project).
function estimateSchedules(st, items) {
  const doors = new Map();
  const windows = new Map();
  forEachShape((sh) => {
    if (sh.type === "door") {
      const k = sh.kind || `Door ${formatFeet(sh.width || 0)}`;
      doors.set(k, (doors.get(k) || 0) + 1);
    } else if (sh.type === "window") {
      const k = sh.kind || `Window ${formatFeet(sh.width || 0)}`;
      windows.set(k, (windows.get(k) || 0) + 1);
    }
  });
  for (const [k, n] of doors) pushItem(items, "Schedule — Doors", null, k, n, "ea", "count");
  for (const [k, n] of windows) pushItem(items, "Schedule — Windows", null, k, n, "ea", "count");
}

// Class-C construction conventions, printed on the sheet so the math is auditable.
function estimateConventions(st) {
  const cfg = st.estimateSettings || ESTIMATE_DEFAULTS;
  return [
    `Studs: 1 per ${cfg.studSpacingIn}" o.c. + 1 end stud; corners add a 3-stud (+2) cluster, T-intersections +1.`,
    `Each opening adds 2 king + 2 jack studs and a ${cfg.headerPly}-ply header (depth sized by the Engineering Tool).`,
    `Cripples: 1 per ${cfg.crippleSpacingIn}" across the opening width (both above and below for windows).`,
    `Plates: ${cfg.platesPerWall} courses per wall length; exterior / on-slab bottom plate is pressure-treated.`,
    `2×6 walls are treated as exterior (sheathing + insulation + single-face drywall); 2×4 as interior partitions (drywall both faces).`,
    `Sheets (drywall / sheathing / subfloor) are ${cfg.drywallSheetFt.w}×${cfg.drywallSheetFt.h} = ${SHEET_SF} sf.`,
    `Stairs: risers = treads + 1; stringers = 2 (3 if width > 36"). Spiral stairs are counted as a single prefab kit.`,
    `Corner inside/outside classification is best-effort and user-correctable; the junction count is exact.`,
    `Quantities only — no pricing, no MEP, no member sizing. CMU rebar / grouted cells depend on the structural design and are not quantified.`,
  ];
}

function computeEstimate(st) {
  const items = [];
  for (const story of st.stories) {
    estimateStory(story, st, items);
  }
  estimateSchedules(st, items);
  return {
    generatedAt: new Date().toISOString(),
    units: st.units,
    settings: st.estimateSettings ? JSON.parse(JSON.stringify(st.estimateSettings)) : null,
    conventions: estimateConventions(st),
    gaps: computeEstimateGaps(st),
    lineItems: items,
  };
}

