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
