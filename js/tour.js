'use strict';

// ==============================================================================
// First-time-user walkthrough.
//
// Auto-fires once per browser (gated by localStorage) and replayable at any
// time from File → Walkthrough. Each step has a copy line, a target element
// to glow, and either a manual "Next" button or an `advance()` predicate that
// polls the app's state every animation frame and advances when the user
// performs the expected action. Esc / Skip leaves at any time and marks the
// tour as completed so it stops auto-firing.
// ==============================================================================

// Key version is bumped whenever the tour grows new steps or fixes a bug that
// caused testers to "complete" the tour without actually finishing it (e.g.
// the v1 backdrop swallowed clicks on non-spotlight steps, forcing an Esc
// out that wrote completed=true). Bumping invalidates stale completions so
// the next page load shows the corrected tour. Old keys are left in place —
// localStorage cleanup isn't worth the bytes.
const TOUR_STORAGE_KEY = "easydraft.tour.completed.v2";

let tourState = null;       // { steps, stepIndex, cardEl, targetEl, rafId }
const tourSnapshot = {};    // bag for inter-step state checks; reset per tour

// ---------- Helpers ----------

function tourFindSublayerByName(name) {
  if (!Array.isArray(state.stories)) return null;
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.name === name) return sub;
    }
  }
  return null;
}

function tourCountShapesByType(type) {
  let n = 0;
  forEachShape((sh) => { if (sh.type === type) n++; });
  return n;
}

function tourCountShapesOnLayerName(name) {
  let n = 0;
  if (!Array.isArray(state.stories)) return 0;
  for (const story of state.stories) {
    for (const sub of story.sublayers) {
      if (sub.name === name) n += sub.shapes.length;
    }
  }
  return n;
}

// Count placed appliances of a given kind (e.g. "range" = stove, "fridge").
function tourCountApplianceKind(kind) {
  let n = 0;
  forEachShape((sh) => { if (sh.type === "appliance" && sh.kind === kind) n++; });
  return n;
}

// The second floor the tour has the user add (the first upper story, level 1)
// and the shape count on its Furniture layer — lets us tell "furniture placed
// upstairs" apart from the pieces already sitting on the ground floor.
function tourUpperStory() {
  // Prefer the story the user just added during the tour (so replays on a
  // multi-story document still target the right floor); fall back to level 1.
  const pre = tourSnapshot.preStoryIds;
  if (pre && Array.isArray(state.stories)) {
    const added = state.stories.find((s) => !pre.has(s.id));
    if (added) return added;
  }
  if (typeof getStoryByLevel === "function") return getStoryByLevel(1);
  return Array.isArray(state.stories) ? state.stories.find((s) => s.level === 1) || null : null;
}
function tourUpperFurnitureCount() {
  const story = tourUpperStory();
  if (!story) return 0;
  const sub = story.sublayers.find((l) => l.name === FURNITURE_LAYER_NAME);
  return sub ? sub.shapes.length : 0;
}

function tourSnapshotShapeMap(predicate, sigFn) {
  const m = new Map();
  forEachShape((sh) => { if (predicate(sh)) m.set(sh.id, sigFn(sh)); });
  return m;
}

function tourAnyShapeChanged(predicate, sigFn, prevMap) {
  let changed = false;
  forEachShape((sh) => {
    if (!predicate(sh)) return;
    const prev = prevMap.get(sh.id);
    if (prev === undefined) return; // shape didn't exist when we snapshotted
    if (sigFn(sh) !== prev) changed = true;
  });
  return changed;
}

// Force the active sublayer to the named layer (if it exists) and re-sync the
// dependent UI — palette panel, tool button enabled-state, layer tree
// highlight. Used by steps whose copy promises a specific layer is active
// ("Line tool — already selected for you" only holds on a non-palette layer).
// No-op if the layer can't be found or is already active.
function tourEnsureLayerByName(name) {
  const sub = tourFindSublayerByName(name);
  if (!sub) return;
  if (state.activeSublayerId !== sub.id) {
    state.activeSublayerId = sub.id;
    state.selection.clear();
    if (typeof resetCrossLayerMisses === "function") resetCrossLayerMisses();
    if (typeof hideLayerHintModal === "function") hideLayerHintModal();
    if (typeof renderLayerTree === "function") renderLayerTree();
  }
  // Always refresh palette + tool-button disabled state — even if the layer
  // didn't change, the user might have landed here from a state where the
  // sidebar UI was out of sync (e.g. a replayed tour after a cache restore).
  if (typeof updatePaletteVisibility === "function") updatePaletteVisibility();
}

// ---------- Step list ----------

function tourStepList() {
  return [
    {
      id: "welcome",
      title: "Welcome to Easy Draft!",
      copy: "Easy Draft is a simple way to draw floor plans for your home. " +
            "We'll spend the next two minutes walking through it together — drawing a wall, " +
            "dropping a door on it, and exporting a finished sheet. " +
            "You can press Skip or hit the Esc key to leave the tour at any time.",
      manual: true,
      manualLabel: "Let's go",
      spotlight: true,
    },
    {
      id: "draw-wall",
      title: "Draw a wall",
      copy: "Easy Draft draws walls with the Line tool — already selected for you. Click two points on the canvas to drop a wall between them. The cursor snaps to the grid so lengths land clean.",
      anchor: () => document.querySelector('.tool[data-tool="line"]'),
      enter: () => {
        // The copy promises the Line tool is selected and ready. Enforce it
        // here rather than crossing fingers on init defaults — a cached
        // document, a replayed tour, or a stray click before the tour
        // started could leave the active layer on a palette layer (which
        // silently coerces setTool("line") back to "select") or the tool on
        // something else. Switch to Walls first so the line tool isn't
        // blocked, then call setTool.
        tourEnsureLayerByName("Walls");
        if (typeof setTool === "function") setTool("line");
        tourSnapshot.wallCount = tourCountShapesOnLayerName("Walls");
      },
      advance: () => tourCountShapesOnLayerName("Walls") > (tourSnapshot.wallCount || 0),
    },
    {
      id: "grid-controls",
      title: "Tune the grid",
      copy: "Notice how your wall locked onto the grid? That's the 'Snap' toggle up here — leave it on for clean, dimensioned plans, or uncheck it any time you want freeform placement. The 'Opacity' slider beside it makes the grid lines more or less visible without changing the snap behavior — handy when you want to see the drawing without the graph paper behind it.",
      // Highlight the whole grid control group so both Snap and Opacity sit
      // inside the glow. Falling back to the snap toggle alone is fine if a
      // future markup change drops the [title] attribute on the group.
      anchor: () => document.querySelector('.control-group[title="Grid scale"]')
        || document.getElementById("snap-toggle"),
      manual: true,
      manualLabel: "Got it",
    },
    {
      id: "pick-select",
      title: "Switch to the Select tool",
      copy: "To edit anything you've drawn, you need the Select tool. Click 'Select' on the left toolbar (or press V).",
      anchor: () => document.querySelector('.tool[data-tool="select"]'),
      advance: () => state.tool === "select",
    },
    {
      id: "select-wall",
      title: "Click your wall",
      copy: "Now click directly on the wall you just drew. A little popup will appear right next to it — that IS the editor. Most objects in Easy Draft work this way: click to edit.",
      anchor: null,
      advance: () => {
        if (state.selection.size !== 1) return false;
        const id = [...state.selection][0];
        const sh = findShapeById(id);
        return !!(sh && sh.type === "line");
      },
    },
    {
      id: "thicken",
      title: "Make it a real wall",
      copy: "Walls have framing, not just a centerline. In the popup, click 'Ext. wood' to make this an exterior framed wall — watch it thicken on the canvas. (If the popup's gone, click your wall again first.)",
      anchor: () => {
        const row = document.getElementById("wall-thickness-row");
        if (!row || row.classList.contains("hidden")) return null;
        return row.querySelector('.wall-thickness-btn[data-preset="ext-wood"]') || row;
      },
      enter: () => {
        tourSnapshot.thicknessMap = tourSnapshotShapeMap(
          (sh) => sh.type === "line",
          (sh) => String(sh.thickness || 0),
        );
      },
      advance: () => tourAnyShapeChanged(
        (sh) => sh.type === "line",
        (sh) => String(sh.thickness || 0),
        tourSnapshot.thicknessMap,
      ),
    },
    {
      id: "pick-measure",
      title: "Measure your work",
      copy: "Easy Draft can dimension your plan too. Click the Measure tool on the left toolbar (or press M).",
      anchor: () => document.querySelector('.tool[data-tool="measure"]'),
      advance: () => state.tool === "measure",
    },
    {
      id: "draw-measurement",
      title: "Take a measurement",
      copy: "Click two points to dimension the distance between them — try measuring along the wall you just drew. The cursor snaps to corners and the grid, and every measurement lands on its own 'Measurements' layer.",
      anchor: null,
      enter: () => { tourSnapshot.measureCount = tourCountShapesByType("measure"); },
      advance: () => tourCountShapesByType("measure") > (tourSnapshot.measureCount || 0),
    },
    {
      id: "measure-type",
      title: "Choose what it measures",
      copy: "Click your measurement to select it. The popup switches how it reads — center-to-center, interior face, or exterior face. Try the Interior or Exterior button and watch the dimension update.",
      anchor: () => {
        const el = document.getElementById("measure-modal");
        if (!el || el.classList.contains("hidden")) return null;
        return el;
      },
      enter: () => {
        // The measurement lives on the Measurements layer. Make that the
        // active layer and switch to the Select tool so a click on the
        // measurement edits it instead of starting a fresh measure.
        if (typeof setTool === "function") setTool("select");
        tourEnsureLayerByName("Measurements");
      },
      advance: () => {
        if (state.selection.size !== 1) return false;
        const id = [...state.selection][0];
        const sh = findShapeById(id);
        return !!(sh && sh.type === "measure" && (sh.dimType || "center") !== "center");
      },
    },
    {
      id: "hide-measurements-layer",
      title: "Hide a layer to clear the view",
      copy: "Dimensions can crowd the canvas while you draw. In the layer panel on the right, click the eye icon on the 'Measurements' row to hide it — click the eye again any time to bring it back.",
      anchor: () => {
        const sub = tourFindSublayerByName("Measurements");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        if (!row) return null;
        // Anchor the eye button specifically — a row-wide glow would invite
        // a click on the name (which just switches the active layer).
        return row.querySelector('[data-action="vis-sub"]') || row;
      },
      advance: () => {
        const sub = tourFindSublayerByName("Measurements");
        return !!(sub && sub.visible === false);
      },
    },
    {
      id: "switch-layer",
      title: "Switch layers",
      copy: "Layers do two things: they organize your drawing AND they swap your toolset. Click the words 'Windows & Doors' in the layer panel on the right (don't tap the eye or color dot — those just toggle visibility / color).",
      anchor: () => {
        const sub = tourFindSublayerByName("Windows & Doors");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        if (!row) return null;
        // Anchor to the layer-name span specifically — the row-wide glow
        // misled testers into clicking the eye icon, which only toggles
        // visibility. The name span is the click target that switches the
        // active layer.
        return row.querySelector(".sub-name") || row;
      },
      advance: () => {
        const sub = activeSublayer();
        return !!(sub && sub.name === "Windows & Doors");
      },
    },
    {
      id: "drop-door",
      title: "Drag a door onto your wall",
      copy: "The right panel is now a door catalog instead of the layer tree — that's what switching layers gets you. Drag any door onto your wall; Easy Draft snaps it to the centerline and splits the wall at the opening for you.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => {
        tourSnapshot.doorCount = tourCountShapesByType("door");
        // Defensive: if step 6 advanced because state.activeSublayerId was
        // already on Windows & Doors (e.g. the user replayed the tour), the
        // palette panel may not have been re-rendered. Force-sync now.
        updatePaletteVisibility();
      },
      advance: () => tourCountShapesByType("door") > (tourSnapshot.doorCount || 0),
    },
    {
      id: "drop-window",
      title: "Now a window",
      copy: "Same gesture: drag a window from the catalog onto another part of your wall. Easy Draft handles the wall cut for windows the same way it does for doors.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.windowCount = tourCountShapesByType("window"); },
      advance: () => tourCountShapesByType("window") > (tourSnapshot.windowCount || 0),
    },
    {
      id: "flip-door",
      title: "Flip the door",
      copy: "Click your door to select it. Use 'Hinge' to swap the hinge side, or 'Swing' to flip in/out. Same click-to-edit pattern — every object's controls live right next to it.",
      anchor: () => {
        const row = document.getElementById("door-flip-row");
        if (!row || row.classList.contains("hidden")) return null;
        return row;
      },
      enter: () => {
        // "Click your door to select it" only works on the Select tool. The
        // user might still be holding a drag-drop pending state from the
        // previous palette steps; force-clear it.
        if (typeof setTool === "function") setTool("select");
        tourSnapshot.doorStateMap = tourSnapshotShapeMap(
          (sh) => sh.type === "door",
          (sh) => `${sh.x.toFixed(3)}|${sh.y.toFixed(3)}|${sh.angle.toFixed(3)}|${sh.swing}`,
        );
      },
      advance: () => tourAnyShapeChanged(
        (sh) => sh.type === "door",
        (sh) => `${sh.x.toFixed(3)}|${sh.y.toFixed(3)}|${sh.angle.toFixed(3)}|${sh.swing}`,
        tourSnapshot.doorStateMap,
      ),
    },
    {
      id: "show-page",
      title: "Show the page outline",
      copy: "Easy Draft already has a printable sheet ready. In the 'Pages' list at the top-left, click the eye on the sheet's row to overlay the page outline on your drawing — drag the dashed rectangle to position the printable area over what you want.",
      anchor: () => {
        if (!Array.isArray(state.sheets)) return null;
        const sheet = state.sheets.find((s) => (s.sheetType || "drawing") === "drawing");
        if (!sheet) return null;
        return document.querySelector(
          `.sheet-row[data-sheet-id="${sheet.id}"] [data-sheet-action="toggle-visibility"]`
        );
      },
      advance: () => Array.isArray(state.sheets) && state.sheets.some((s) => s.pageOutlineVisible),
    },
    {
      id: "plan-mode",
      title: "Switch to Plan mode",
      copy: "Two modes: Draw is where you build the drawing; Plan is where you compose it onto a real titled sheet. Same drawing, different lens. Click 'Plan' in the top bar.",
      anchor: () => document.querySelector('.mode-btn[data-mode="plan"]'),
      advance: () => state.viewMode === "plan",
    },
    {
      id: "export",
      title: "Export to PDF",
      copy: "Your drawing is now inside a real titled sheet with a scale bar and title block. " +
            "Scroll down the left sidebar (we just scrolled it for you) and hit 'Export PDF…' to save your sheet. " +
            "You've drawn a wall, fitted openings, composed a sheet, and exported.",
      anchor: () => document.getElementById("plan-export-btn"),
      manual: true,
      manualLabel: "One last thing",
    },
    {
      id: "feedback",
      title: "Help us make Easy Draft better",
      copy: "You're a beta tester — that means your feedback shapes what gets built next. " +
            "If anything felt confusing, broken, or just plain missing, click 'Give Feedback' " +
            "in the top-right corner and tell us. Thanks for trying Easy Draft!",
      anchor: () => document.getElementById("feedback-btn"),
      manual: true,
      manualLabel: "Finish tour",
    },
  ];
}

// ---------- Sample-cabin step list ----------
//
// The in-depth alternative to the quick walkthrough. Instead of a whirlwind
// feature tour, this hand-holds the user through drawing their first complete
// plan: a four-wall cabin with a door, a window, a piece of furniture, a
// dimension, and a finished export. Reuses the same step engine + helpers as
// the quick tour — only the copy and the sequencing differ.
function cabinTourStepList() {
  // A wall step is the same shape four times over: re-assert the Walls layer +
  // Line tool, snapshot the current wall count, and advance once it ticks up.
  const wallStep = (id, title, copy, anchor) => ({
    id,
    title,
    copy,
    anchor: anchor || null,
    enter: () => {
      tourEnsureLayerByName("Walls");
      if (typeof setTool === "function") setTool("line");
      tourSnapshot.cabinWallCount = tourCountShapesOnLayerName("Walls");
    },
    advance: () => tourCountShapesOnLayerName("Walls") > (tourSnapshot.cabinWallCount || 0),
  });

  return [
    {
      id: "welcome",
      title: "Let's build a cabin",
      copy: "We'll draw a small cabin together, start to finish — walls, a door and window, furniture, " +
            "a kitchen, then a second floor with stairs, and a printable sheet at the end. " +
            "Take it at your own pace; press Skip or Esc to leave any time.",
      manual: true,
      manualLabel: "Start building",
      spotlight: true,
    },
    wallStep(
      "cabin-wall-1",
      "Draw the first wall",
      "Easy Draft draws walls with the Line tool — selected for you. Click once to start, " +
        "move across, and click again to drop the bottom wall of your cabin. The cursor snaps " +
        "to the grid so the length lands clean.",
      () => document.querySelector('.tool[data-tool="line"]'),
    ),
    wallStep(
      "cabin-wall-2",
      "Now the right wall",
      "From the end of that first wall, click upward to draw the right side. Connect it to the " +
        "corner you just finished so the cabin starts to take shape.",
    ),
    wallStep(
      "cabin-wall-3",
      "Add the back wall",
      "Run a wall across the top, parallel to your first one. Three sides down — one to go.",
    ),
    wallStep(
      "cabin-wall-4",
      "Close the cabin",
      "Drop the last wall down the left side to close the rectangle. That's your cabin's footprint.",
    ),
    {
      id: "cabin-select-wall",
      title: "Click a wall to edit it",
      copy: "Switch gears: click directly on any wall you drew. A little popup appears right beside " +
            "it — that's the editor. In Easy Draft, almost everything works this way: click to edit.",
      anchor: null,
      enter: () => { if (typeof setTool === "function") setTool("select"); },
      advance: () => {
        if (state.selection.size !== 1) return false;
        const id = [...state.selection][0];
        const sh = findShapeById(id);
        return !!(sh && sh.type === "line");
      },
    },
    {
      id: "cabin-thicken",
      title: "Make them real walls",
      copy: "Walls have framing, not just a centerline. Click a wall, then click 'Ext. wood' in the popup to " +
            "turn it into an exterior framed wall — watch it thicken. Do this for all four walls (tip: drag a " +
            "box around all of them, or shift-click, to set them at once). We'll wait until every wall is framed.",
      anchor: () => {
        const row = document.getElementById("wall-thickness-row");
        if (!row || row.classList.contains("hidden")) return null;
        return row.querySelector('.wall-thickness-btn[data-preset="ext-wood"]') || row;
      },
      advance: () => {
        const walls = tourFindSublayerByName("Walls");
        if (!walls) return false;
        const lines = walls.shapes.filter((sh) => sh.type === "line");
        return lines.length >= 4 && lines.every((sh) => (sh.thickness || 0) > 0);
      },
    },
    {
      id: "cabin-switch-layer",
      title: "Switch to Windows & Doors",
      copy: "Layers organize your drawing AND swap your toolset. Click the words 'Windows & Doors' in " +
            "the layer panel on the right (not the eye or color dot — those just toggle visibility / color).",
      anchor: () => {
        const sub = tourFindSublayerByName("Windows & Doors");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        if (!row) return null;
        return row.querySelector(".sub-name") || row;
      },
      advance: () => {
        const sub = activeSublayer();
        return !!(sub && sub.name === "Windows & Doors");
      },
    },
    {
      id: "cabin-door",
      title: "Hang a door",
      copy: "The right panel is now a door catalog. Drag any door onto one of your walls — Easy Draft " +
            "snaps it to the centerline and cuts the wall at the opening for you.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => {
        tourSnapshot.doorCount = tourCountShapesByType("door");
        updatePaletteVisibility();
      },
      advance: () => tourCountShapesByType("door") > (tourSnapshot.doorCount || 0),
    },
    {
      id: "cabin-window",
      title: "Add a window",
      copy: "Same gesture: drag a window from the catalog onto another wall. Easy Draft handles the wall " +
            "cut for windows just like it did for the door.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.windowCount = tourCountShapesByType("window"); },
      advance: () => tourCountShapesByType("window") > (tourSnapshot.windowCount || 0),
    },
    {
      id: "cabin-open-layers",
      title: "Open the layer panel",
      copy: "The layer panel tucked itself away to make room for the door catalog. Click its collapse/expand " +
            "button (the little dash on the right edge of the layers bar) to bring the panel back.",
      anchor: () => layersMin || document.getElementById("layers-min"),
      advance: () => !!(layersPanel && !layersPanel.classList.contains("minimized")),
    },
    {
      id: "cabin-furniture-layer",
      title: "Open the Furniture catalog",
      copy: "Now click the word 'Furniture' in the layer panel (not the eye or color dot). The right panel " +
            "switches to a furniture catalog.",
      anchor: () => {
        const sub = tourFindSublayerByName("Furniture");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        if (!row) return null;
        return row.querySelector(".sub-name") || row;
      },
      enter: () => { if (typeof setTool === "function") setTool("select"); },
      advance: () => {
        const sub = activeSublayer();
        return !!(sub && sub.name === "Furniture");
      },
    },
    {
      id: "cabin-furnish",
      title: "Drop in a piece",
      copy: "Drag a bed, table, sofa, or any piece from the catalog into your cabin. Once it's placed, drag it " +
            "around to position it however you like.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.furnitureCount = tourCountShapesOnLayerName("Furniture"); },
      advance: () => tourCountShapesOnLayerName("Furniture") > (tourSnapshot.furnitureCount || 0),
    },
    {
      id: "cabin-kitchen-layer",
      title: "Set up the kitchen",
      copy: "Let's add a kitchen. Click the word 'Kitchen' in the layer panel — that opens the kitchen catalog " +
            "and its cabinet tools.",
      anchor: () => {
        const sub = tourFindSublayerByName("Kitchen");
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        return row ? (row.querySelector(".sub-name") || row) : null;
      },
      enter: () => {
        // Make sure the layer tree is showing (the panel collapses on palette
        // layers) and we're on the Select tool so the click lands cleanly.
        if (layersPanel) layersPanel.classList.remove("minimized");
        if (typeof setTool === "function") setTool("select");
      },
      advance: () => {
        const sub = activeSublayer();
        return !!(sub && sub.name === "Kitchen");
      },
    },
    {
      id: "cabin-cabinet",
      title: "Build a run of cabinets",
      copy: "Click 'Cabinet builder' in the kitchen panel. Then click along a wall to drop the run's corners — " +
            "one click per corner — and hit 'Finish' when you're done. Easy Draft keeps the counter flush to the wall.",
      anchor: () => document.querySelector('[data-palette-tool="cabinet-builder"]')
        || document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.cabinetCount = tourCountShapesByType("cabinet"); },
      advance: () => tourCountShapesByType("cabinet") > (tourSnapshot.cabinetCount || 0),
    },
    {
      id: "cabin-stove",
      title: "Add a stove",
      copy: "Now drag a 'Range' (that's the stove) from the kitchen catalog onto a wall. It snaps into the counter " +
            "line just like the cabinets.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.stoveCount = tourCountApplianceKind("range"); },
      advance: () => tourCountApplianceKind("range") > (tourSnapshot.stoveCount || 0),
    },
    {
      id: "cabin-fridge",
      title: "Add a refrigerator",
      copy: "Drag a 'Refrigerator' from the catalog into the kitchen too. Your cabin now has a working kitchen.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.fridgeCount = tourCountApplianceKind("fridge"); },
      advance: () => tourCountApplianceKind("fridge") > (tourSnapshot.fridgeCount || 0),
    },
    {
      id: "cabin-add-floor",
      title: "Add a second floor",
      copy: "Cabins can have an upstairs too. Click '+ Story' at the top of the layers bar, then choose " +
            "'Upper floor'. A whole new set of layers appears for the second story.",
      anchor: () => document.getElementById("add-story-btn"),
      enter: () => {
        tourSnapshot.preStoryIds = new Set((state.stories || []).map((s) => s.id));
      },
      // Advance only when a *new* upper story (level >= 1) appears, so the step
      // doesn't auto-skip when replaying on a document that already has floors.
      advance: () => {
        const pre = tourSnapshot.preStoryIds;
        if (!pre || !Array.isArray(state.stories)) return false;
        return state.stories.some((s) => !pre.has(s.id) && typeof s.level === "number" && s.level >= 1);
      },
    },
    {
      id: "cabin-stairs",
      title: "Run stairs upstairs",
      copy: "Connect the floors with stairs. Pick the Stairs tool on the left toolbar, then drag along the longest " +
            "open span of your cabin (so the run has room to fit) and click 'Build' in the dialog. The stairs land " +
            "on a Stairs layer and automatically show on the floor above with a 'DN' label.",
      anchor: () => document.querySelector('.tool[data-tool="stairs"]'),
      enter: () => {
        // Stairs route to the active story's Stairs layer, and the Stairs tool
        // is disabled on catalog layers — drop onto the ground-floor Stairs
        // layer (creating it if an older document lacks one) so the tool works
        // and the run rises to the new floor above.
        const ground = (typeof getStoryByLevel === "function")
          ? getStoryByLevel(0) : (state.stories && state.stories[0]) || null;
        const layer = (ground && typeof getStairsLayer === "function") ? getStairsLayer(ground) : null;
        if (layer) {
          state.activeSublayerId = layer.id;
          if (typeof renderLayerTree === "function") renderLayerTree();
          if (typeof updatePaletteVisibility === "function") updatePaletteVisibility();
        }
        tourSnapshot.stairCount = tourCountShapesByType("stairs");
      },
      advance: () => tourCountShapesByType("stairs") > (tourSnapshot.stairCount || 0),
    },
    {
      id: "cabin-upstairs-layer",
      title: "Head upstairs",
      copy: "Switch up to the new floor: in the layer panel, find the upstairs story group and click its " +
            "'Furniture' layer. Both floors stay visible so you can line things up over what's below.",
      anchor: () => {
        const story = tourUpperStory();
        if (!story) return null;
        const sub = story.sublayers.find((l) => l.name === FURNITURE_LAYER_NAME);
        if (!sub) return null;
        const row = document.querySelector(`.sub-row[data-sub-id="${sub.id}"]`);
        return row ? (row.querySelector(".sub-name") || row) : null;
      },
      enter: () => {
        if (layersPanel) layersPanel.classList.remove("minimized");
        if (typeof setTool === "function") setTool("select");
      },
      advance: () => {
        const story = tourUpperStory();
        const sub = activeSublayer();
        return !!(story && sub && sub.name === FURNITURE_LAYER_NAME
          && story.sublayers.some((l) => l.id === sub.id));
      },
    },
    {
      id: "cabin-upstairs-furnish",
      title: "Furnish the upstairs",
      copy: "Drag a bed or any piece from the catalog onto the second floor. It lands on the upstairs Furniture " +
            "layer, separate from what's downstairs.",
      anchor: () => document.getElementById("palette-panel"),
      enter: () => { tourSnapshot.upperFurnitureCount = tourUpperFurnitureCount(); },
      advance: () => tourUpperFurnitureCount() > (tourSnapshot.upperFurnitureCount || 0),
    },
    {
      id: "cabin-pick-measure",
      title: "Grab the Measure tool",
      copy: "Time to dimension your cabin. Click the Measure tool on the left toolbar (or press M).",
      anchor: () => document.querySelector('.tool[data-tool="measure"]'),
      enter: () => { tourEnsureLayerByName("Walls"); },
      advance: () => state.tool === "measure",
    },
    {
      id: "cabin-measure",
      title: "Measure a wall",
      copy: "Click two points to dimension the distance between them — try measuring the full width of your " +
            "cabin, clicking near one corner and then the other. The dimension lands on its own " +
            "'Measurements' layer.",
      anchor: null,
      enter: () => { tourSnapshot.measureCount = tourCountShapesByType("measure"); },
      advance: () => tourCountShapesByType("measure") > (tourSnapshot.measureCount || 0),
    },
    {
      id: "cabin-measure-ext",
      title: "Measure exterior to exterior",
      copy: "By default a dimension reads center-to-center. Click your new measurement to select it, then click " +
            "'ext. to ext.' in the popup — now it reads from the outside face of one wall to the outside face of " +
            "the other, the way a builder dimensions a plan.",
      anchor: () => {
        const el = document.getElementById("measure-modal");
        if (!el || el.classList.contains("hidden")) return null;
        return el;
      },
      enter: () => {
        if (typeof setTool === "function") setTool("select");
        tourEnsureLayerByName("Measurements");
      },
      advance: () => {
        if (state.selection.size !== 1) return false;
        const id = [...state.selection][0];
        const sh = findShapeById(id);
        return !!(sh && sh.type === "measure" && (sh.dimType || "center") === "ext");
      },
    },
    {
      id: "cabin-show-page",
      title: "Show the page outline",
      copy: "Easy Draft already has a printable sheet ready. In the 'Pages' list at the top-left, click the " +
            "eye on the sheet's row to overlay the page outline — drag the dashed rectangle to frame your cabin.",
      anchor: () => {
        if (!Array.isArray(state.sheets)) return null;
        const sheet = state.sheets.find((s) => (s.sheetType || "drawing") === "drawing");
        if (!sheet) return null;
        return document.querySelector(
          `.sheet-row[data-sheet-id="${sheet.id}"] [data-sheet-action="toggle-visibility"]`
        );
      },
      advance: () => Array.isArray(state.sheets) && state.sheets.some((s) => s.pageOutlineVisible),
    },
    {
      id: "cabin-center-page",
      title: "Center your cabin on the page",
      copy: "That dashed rectangle is your printable page — and you can move it. Drag the rectangle so your " +
            "cabin sits in the middle of it. Whatever falls inside the rectangle is what prints.",
      anchor: null,
      enter: () => {
        const sheet = Array.isArray(state.sheets)
          ? state.sheets.find((s) => (s.sheetType || "drawing") === "drawing")
          : null;
        tourSnapshot.pageOriginSig = sheet && sheet.pageOrigin
          ? `${sheet.pageOrigin.x.toFixed(3)}|${sheet.pageOrigin.y.toFixed(3)}`
          : "none";
      },
      advance: () => {
        const sheet = Array.isArray(state.sheets)
          ? state.sheets.find((s) => (s.sheetType || "drawing") === "drawing")
          : null;
        if (!sheet || !sheet.pageOrigin) return false;
        const sig = `${sheet.pageOrigin.x.toFixed(3)}|${sheet.pageOrigin.y.toFixed(3)}`;
        return sig !== tourSnapshot.pageOriginSig;
      },
    },
    {
      id: "cabin-plan-mode",
      title: "Switch to Plan mode",
      copy: "Two modes: Draw is where you build; Plan is where you compose it onto a titled sheet. Same " +
            "drawing, different lens. Click 'Plan' in the top bar.",
      anchor: () => document.querySelector('.mode-btn[data-mode="plan"]'),
      advance: () => state.viewMode === "plan",
    },
    {
      id: "cabin-export",
      title: "Export your cabin",
      copy: "Your cabin is now inside a real titled sheet with a scale bar and title block. Scroll down the " +
            "left sidebar (we just scrolled it for you) and hit 'Export PDF…' to save it. " +
            "You drew walls, fitted openings, furnished a room, dimensioned it, and exported — a complete plan.",
      anchor: () => document.getElementById("plan-export-btn"),
      manual: true,
      manualLabel: "One last thing",
    },
    {
      id: "cabin-feedback",
      title: "Help us make Easy Draft better",
      copy: "You're a beta tester — your feedback shapes what gets built next. If anything felt confusing, " +
            "broken, or missing, click 'Give Feedback' in the top-right and tell us. Thanks for building with us!",
      anchor: () => document.getElementById("feedback-btn"),
      manual: true,
      manualLabel: "Finish tour",
    },
  ];
}

// ---------- Lifecycle ----------

function startTour(variant) {
  if (tourState) endTour(false);
  for (const k of Object.keys(tourSnapshot)) delete tourSnapshot[k];
  // The early steps (Draw a wall, Switch to Select, etc.) all operate on the
  // Draw-mode canvas. If the user replays the tour from File → Walkthrough
  // while sitting in Plan mode, those steps deadlock because plan-mode
  // events.js guards bail before any pointerdown reaches a drawing tool.
  // Cheap insurance: drop them back into Draw mode at tour start.
  if (state.viewMode !== "draw" && typeof setViewMode === "function") {
    setViewMode("draw");
  }
  const steps = variant === "cabin" ? cabinTourStepList() : tourStepList();
  tourState = { steps, variant: variant || "quick", stepIndex: 0, cardEl: null, backdropEl: null, targetEl: null, rafId: 0 };
  // Flags the tour as active so editing popups (line/wall thickness, dimensions,
  // etc.) can stack above the walkthrough card instead of behind it.
  document.body.classList.add("tour-running");
  buildTourCard();
  enterStep(0);
  startTourTick();
  document.addEventListener("keydown", onTourKeydown, true);
}

function endTour(completed) {
  if (!tourState) return;
  if (tourState.rafId) cancelAnimationFrame(tourState.rafId);
  if (tourState.cardEl && tourState.cardEl.parentNode) tourState.cardEl.parentNode.removeChild(tourState.cardEl);
  if (tourState.backdropEl && tourState.backdropEl.parentNode) tourState.backdropEl.parentNode.removeChild(tourState.backdropEl);
  if (tourState.targetEl) tourState.targetEl.classList.remove("tour-target");
  tourState = null;
  document.body.classList.remove("tour-running");
  document.removeEventListener("keydown", onTourKeydown, true);
  if (completed) {
    try { localStorage.setItem(TOUR_STORAGE_KEY, "true"); } catch (_) { /* private mode, etc */ }
  }
}

function advanceTour() {
  if (!tourState) return;
  const next = tourState.stepIndex + 1;
  if (next >= tourState.steps.length) {
    endTour(true);
    return;
  }
  enterStep(next);
}

function enterStep(idx) {
  if (!tourState) return;
  tourState.stepIndex = idx;
  const step = tourState.steps[idx];
  if (typeof step.enter === "function") {
    try { step.enter(); } catch (e) { console.warn("[tour] enter() threw:", e); }
  }
  paintTourCard(step);
  paintTourTarget(step);
}

function startTourTick() {
  const tick = () => {
    if (!tourState) return;
    const step = tourState.steps[tourState.stepIndex];
    if (typeof step.advance === "function") {
      let done = false;
      try { done = step.advance(); } catch (_) { done = false; }
      if (done) {
        advanceTour();
        if (tourState) tourState.rafId = requestAnimationFrame(tick);
        return;
      }
    }
    // Anchor target may appear / disappear as the user works (modal popups,
    // layer tree re-render). Re-resolve it every frame so the glow follows.
    repaintTourTarget();
    tourState.rafId = requestAnimationFrame(tick);
  };
  tourState.rafId = requestAnimationFrame(tick);
}

function onTourKeydown(e) {
  if (e.key === "Escape") {
    // Don't swallow Escape if the user's just dismissing a modal — let the
    // app handle it first, then close the tour on the next press if needed.
    // Cheaper heuristic: only close the tour if no modal is open right now.
    const modalOpen = document.querySelector(
      ".dim-modal:not(.hidden), .line-modal:not(.hidden), .text-modal:not(.hidden)," +
      " .measure-modal:not(.hidden), .stairs-modal:not(.hidden), .cabinet-modal:not(.hidden)," +
      " .island-modal:not(.hidden), .layer-hint-modal:not(.hidden)," +
      " .settings-modal:not(.hidden)"
    );
    if (modalOpen) return;
    endTour(true);
  }
}

// ---------- Card + target rendering ----------

function buildTourCard() {
  // Backdrop sits behind the card on spotlight steps to dim everything else
  // and keep the user's eye on the card. Hidden by default — paintTourCard
  // toggles its visibility per step.
  const backdrop = document.createElement("div");
  backdrop.className = "tour-backdrop";
  // Clicking the backdrop should NOT start drawing on the canvas underneath.
  backdrop.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(backdrop);
  tourState.backdropEl = backdrop;

  const card = document.createElement("div");
  card.className = "tour-card";
  card.innerHTML = `
    <div class="tour-card-header">
      <div class="tour-card-title"></div>
      <div class="tour-card-step"></div>
    </div>
    <div class="tour-card-body"></div>
    <div class="tour-card-actions">
      <button type="button" class="tour-card-skip">Skip tour</button>
      <button type="button" class="tour-card-next">Next</button>
    </div>
  `;
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  card.querySelector(".tour-card-skip").addEventListener("click", () => endTour(true));
  card.querySelector(".tour-card-next").addEventListener("click", () => advanceTour());
  document.body.appendChild(card);
  tourState.cardEl = card;
}

function paintTourCard(step) {
  const card = tourState.cardEl;
  const backdrop = tourState.backdropEl;
  card.querySelector(".tour-card-title").textContent = step.title;
  card.querySelector(".tour-card-body").textContent = step.copy;
  card.querySelector(".tour-card-step").textContent =
    `Step ${tourState.stepIndex + 1} of ${tourState.steps.length}`;
  const next = card.querySelector(".tour-card-next");
  if (step.manual) {
    next.textContent = step.manualLabel || "Next";
    next.style.display = "";
  } else {
    next.style.display = "none";
  }
  // Spotlight steps get a centered card + dim backdrop + glowing pulse.
  // Everything else falls back to the bottom-of-screen layout.
  card.classList.toggle("tour-card-spotlight", !!step.spotlight);
  if (backdrop) backdrop.classList.toggle("visible", !!step.spotlight);
}

function paintTourTarget(step) {
  if (tourState.targetEl) {
    tourState.targetEl.classList.remove("tour-target");
    tourState.targetEl = null;
  }
  if (typeof step.anchor !== "function") return;
  let el = null;
  try { el = step.anchor(); } catch (_) { el = null; }
  if (!el) return;
  el.classList.add("tour-target");
  tourState.targetEl = el;
  // Make sure the anchor is actually on screen — anchors deep in a
  // scrollable sidebar (the Export button on the Plan view, in
  // particular) don't help if the user has to figure out they need to
  // scroll first. block: "center" keeps the highlight comfortably in
  // view rather than flush against an edge.
  scrollTourTargetIntoView(el);
}

function scrollTourTargetIntoView(el) {
  if (!el || typeof el.scrollIntoView !== "function") return;
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch (_) {
    // Older browsers without options-object support — fall back to the
    // legacy boolean form. Still does something useful, just less smooth.
    try { el.scrollIntoView(false); } catch (_) {}
  }
}

function repaintTourTarget() {
  if (!tourState) return;
  const step = tourState.steps[tourState.stepIndex];
  if (typeof step.anchor !== "function") return;
  let want = null;
  try { want = step.anchor(); } catch (_) { want = null; }
  if (want === tourState.targetEl) return;
  if (tourState.targetEl) tourState.targetEl.classList.remove("tour-target");
  if (want) want.classList.add("tour-target");
  tourState.targetEl = want;
}

// ---------- Entry points ----------

// Ask which experience the user wants before launching. Falls back to the
// quick walkthrough if the dialog helper isn't available for any reason.
function promptTourChoice() {
  if (typeof appChoice !== "function") { startTour("quick"); return; }
  appChoice(
    "Quick walkthrough is a two-minute tour of the essentials. Build a sample cabin takes a bit " +
      "longer and guides you through drawing your first complete plan — four walls, a door, a window, " +
      "furniture, and a finished export.",
    [
      { label: "Quick walkthrough", value: "quick", primary: true },
      { label: "Build a sample cabin", value: "cabin" },
      { label: "Cancel", value: null, cancel: true },
    ],
    { title: "Take the Tour" },
  ).then((choice) => {
    if (choice === "quick" || choice === "cabin") startTour(choice);
  });
}

function maybeAutoStartTour() {
  let done = "false";
  try { done = localStorage.getItem(TOUR_STORAGE_KEY) || "false"; } catch (_) { /* no-op */ }
  if (done === "true") return;
  startTour();
}

// Topbar "Take the Tour" button. The auto-start only fires once per browser
// (localStorage gate) and a returning visitor who skipped it has no obvious
// way back in — File → Walkthrough is buried. This always-visible button is
// the discoverable entry point; it relaunches the tour from step one
// regardless of the completed flag.
function bindTourButton() {
  const btn = document.getElementById("tour-btn");
  if (!btn) return;
  btn.addEventListener("click", () => promptTourChoice());
}
