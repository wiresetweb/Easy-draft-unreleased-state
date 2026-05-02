'use strict';

// ==============================================================================
// Constants — sizes, colors, door/window catalog, layer defaults
// ==============================================================================

// ---------- Constants ----------
const PX_PER_FOOT = 20;
const MAX_HISTORY = 100;

const MEASURE_COLOR = "#dc2626";
const MEASURE_BORDER_SOFT = "rgba(220, 38, 38, 0.5)";

// Selection / hover / curve handles use the brand orange (#E8602C) so the
// canvas chrome reads as part of the same palette as the topbar and
// sidebar. Red MEASURE_COLOR stays distinct since dimension lines need to
// read as a different mode from "this shape is selected".
const SELECT_COLOR = "#E8602C";
const SELECT_FILL_SOFT = "rgba(232, 96, 44, 0.08)";
const SELECT_LINE_SOFT = "rgba(232, 96, 44, 0.85)";
const SELECT_GLOW = "rgba(232, 96, 44, 0.32)";

const CURVE_PREVIEW_COLOR = "rgba(232, 96, 44, 0.85)";
const HOVER_GLOW = "rgba(232, 96, 44, 0.28)";

const HANDLE_HIT = 7;
const SHAPE_HIT = 6;
const ROT_INNER = 9;
const ROT_OUTER = 22;

const WINDOW_DOOR_LAYER_NAME = "Windows & Doors";
const KITCHEN_LAYER_NAME = "Kitchen";
const FURNITURE_LAYER_NAME = "Furniture";
const BATHROOM_LAYER_NAME = "Bathroom";
const DEFAULT_WINDOW_DEPTH_FT = 0.5; // 6" wall thickness
const SHAPE_COLOR = "#1A2A36"; // slate-near-black, matches brand --slate-ink

// 12-color palette for layers
const LAYER_COLOR_PALETTE = [
  "#1a1a1a", "#4a5568", "#92400e", "#dc2626",
  "#f59e0b", "#84cc16", "#15803d", "#0d9488",
  "#0ea5e9", "#2d4ee0", "#7c3aed", "#db2777",
];

const DEFAULT_LAYER_COLORS = {
  "Foundation":      "#4a5568",
  "Floor":           "#92400e",
  "Walls":           "#1a1a1a",
  "Windows & Doors": "#2d4ee0",
  "Kitchen":         "#0d9488",
  "Bathroom":        "#0ea5e9",
  "Furniture":       "#7c3aed",
  "Electrical":      "#dc2626",
  "Plumbing":        "#0ea5e9",
  "HVAC":            "#f59e0b",
  "Other":           "#4a5568",
  "Measurements":    "#dc2626",
};

const DEFAULT_LAYER_COLOR_FALLBACK = "#1a1a1a";

const DEFAULT_TEXT_FONT_FAMILY = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
// Text sizes are stored in screen pixels (constant size at any zoom — the way
// every other text system works). 14px is a comfortable on-screen default.
const DEFAULT_TEXT_SIZE_PX = 14;
const WALL_LAYER_NAME = "Walls";
const WALL_CUT_TOL_FT = 0.25;

// Standard residential wall thicknesses (feet). Conservative values that match
// what a contractor would draw on a plan set.
//   Interior partition: 2×4 stud (3½") + ½" drywall each side = 4½"
//   Exterior, wood-framed: 2×6 stud (5½") + ½" drywall + ½" sheathing = 6½"
//   Exterior, CMU/block: nominal 8" block
const WALL_THICKNESS_PRESETS = {
  "int":       4.5 / 12,
  "ext-wood":  6.5 / 12,
  "ext-block": 8 / 12,
};

// Stairs defaults
const DEFAULT_STAIRS_CEILING_FT = 8;
const DEFAULT_STAIRS_RISE_FT = 7 / 12;  // 7"
const DEFAULT_STAIRS_RUN_FT = 11 / 12;  // 11"
const DEFAULT_STAIRS_WIDTH_FT = 3;

// Cabinet builder defaults
const DEFAULT_CABINET_DEPTH_FT = 2; // 24" — standard base cabinet

const ORDINALS = [
  "First", "Second", "Third", "Fourth", "Fifth",
  "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"
];
// "Other" is intentionally absent — users can add it via "+ Sub-layer" when
// they actually need a catch-all bucket. Furniture replaces it as a default
// since most plans need furniture before they need an "Other".
const DEFAULT_SUBLAYERS_FIRST = [
  "Floor", "Walls", "Windows & Doors", "Kitchen", "Bathroom", "Furniture", "Measurements"
];
const DEFAULT_SUBLAYERS_OTHER = [
  "Floor", "Walls", "Windows & Doors", "Bathroom", "Furniture", "Measurements"
];

const MEASUREMENTS_LAYER_NAME = "Measurements";

// Standard residential doors / windows (US, plan-view symbol)
const PALETTE_ITEMS = {
  doors: [
    { name: 'Ext. Door 2\'-8"',     subtype: "swing",   width: 2 + 8 / 12 },
    { name: 'Ext. Door 3\'-0"',     subtype: "swing",   width: 3 },
    { name: 'Ext. Door 3\'-6"',     subtype: "swing",   width: 3.5 },
    { name: 'Sliding Glass 6\'-0"', subtype: "sliding", width: 6 },
    { name: 'Sliding Glass 8\'-0"', subtype: "sliding", width: 8 },
    { name: 'Int. Door 2\'-0"',     subtype: "swing",   width: 2 },
    { name: 'Int. Door 2\'-4"',     subtype: "swing",   width: 2 + 4 / 12 },
    { name: 'Int. Door 2\'-6"',     subtype: "swing",   width: 2.5 },
    { name: 'Int. Door 2\'-8"',     subtype: "swing",   width: 2 + 8 / 12 },
    { name: 'Int. Door 3\'-0"',     subtype: "swing",   width: 3 },
    { name: 'French Doors 5\'-0"',  subtype: "double",  width: 5 },
    { name: 'French Doors 6\'-0"',  subtype: "double",  width: 6 },
    { name: 'Pocket Door 2\'-6"',   subtype: "pocket",  width: 2.5 },
    { name: 'Pocket Door 2\'-8"',   subtype: "pocket",  width: 2 + 8 / 12 },
    { name: 'Pocket Door 3\'-0"',   subtype: "pocket",  width: 3 },
    { name: 'Garage Door 9\'-0"',   subtype: "garage",  width: 9 },
    { name: 'Garage Door 10\'-0"',  subtype: "garage",  width: 10 },
    { name: 'Garage Door 16\'-0"',  subtype: "garage",  width: 16 },
    { name: 'Garage Door 18\'-0"',  subtype: "garage",  width: 18 },
  ],
  windows: [
    { name: 'Single Hung 2\'-0" × 3\'-0"', width: 2 },
    { name: 'Single Hung 2\'-6" × 3\'-6"', width: 2.5 },
    { name: 'Single Hung 3\'-0" × 4\'-0"', width: 3 },
    { name: 'Double Hung 3\'-0" × 5\'-0"', width: 3 },
    { name: 'Casement 2\'-0" × 4\'-0"',     width: 2 },
    { name: 'Casement 2\'-6" × 4\'-0"',     width: 2.5 },
    { name: 'Awning 3\'-0" × 1\'-6"',       width: 3 },
    { name: 'Awning 4\'-0" × 2\'-0"',       width: 4 },
    { name: 'Sliding 4\'-0" × 3\'-0"',      width: 4 },
    { name: 'Sliding 6\'-0" × 4\'-0"',      width: 6 },
    { name: 'Picture 4\'-0" × 4\'-0"',      width: 4 },
    { name: 'Picture 6\'-0" × 5\'-0"',      width: 6 },
  ],
  // Kitchen appliances — width is along the wall, depth is into the room.
  // Standard residential dimensions (US) for plan-view symbols.
  kitchen: [
    { name: 'Range 30"',          kind: "range",       width: 2.5,        depth: 2 + 1 / 12 },
    { name: 'Range 36"',          kind: "range",       width: 3,          depth: 2 + 1 / 12 },
    { name: 'Cooktop 30"',        kind: "cooktop",     width: 2.5,        depth: 1 + 9 / 12 },
    { name: 'Cooktop 36"',        kind: "cooktop",     width: 3,          depth: 1 + 9 / 12 },
    { name: 'Wall Oven 30"',      kind: "oven",        width: 2.5,        depth: 2 },
    { name: 'Refrigerator 30"',   kind: "fridge",      width: 2.5,        depth: 2 + 8 / 12 },
    { name: 'Refrigerator 36"',   kind: "fridge",      width: 3,          depth: 2 + 8 / 12 },
    { name: 'Refrigerator 48"',   kind: "fridge",      width: 4,          depth: 2 + 8 / 12 },
    { name: 'Dishwasher 24"',     kind: "dishwasher",  width: 2,          depth: 2 },
    { name: 'Sink 24"',           kind: "sink",        width: 2,          depth: 1 + 9 / 12 },
    { name: 'Sink 30"',           kind: "sink",        width: 2.5,        depth: 1 + 9 / 12 },
    { name: 'Double Sink 33"',    kind: "sink-double", width: 2 + 9 / 12, depth: 1 + 9 / 12 },
    { name: 'Microwave 24"',      kind: "microwave",   width: 2,          depth: 1 + 4 / 12 },
    { name: 'Base Cabinet 24"',   kind: "cabinet",     width: 2,          depth: 2 },
    { name: 'Base Cabinet 30"',   kind: "cabinet",     width: 2.5,        depth: 2 },
    { name: 'Base Cabinet 36"',   kind: "cabinet",     width: 3,          depth: 2 },
    { name: 'Island 4\'-0" × 6\'-0"', kind: "island",  width: 6,          depth: 4 },
  ],
  // Standard US residential furniture footprints. Width is left-to-right when
  // facing the front of the piece; depth is front-to-back. We pick conservative
  // mid-line sizes — a Pottery Barn / West Elm "default" — so the symbols read
  // proportionally even before the user re-sizes anything.
  furniture: [
    { name: 'Armchair 32"',         kind: "armchair",       width: 2 + 8 / 12, depth: 2 + 8 / 12 },
    { name: 'Dining Chair 18"',     kind: "dining-chair",   width: 1.5,        depth: 1 + 7 / 12 },
    { name: 'Stool 15"',            kind: "stool",          width: 1.25,       depth: 1.25 },
    { name: 'Loveseat 5\'-3"',      kind: "loveseat",       width: 5.25,       depth: 3 + 2 / 12 },
    { name: 'Sofa 7\'-0"',          kind: "sofa",           width: 7,          depth: 3 + 2 / 12 },
    { name: 'Sectional 9\' × 6\'',  kind: "sectional",      width: 9,          depth: 6 },
    { name: 'Media Console 60"',    kind: "media-console",  width: 5,          depth: 1.5 },
    { name: 'TV 55" (stand)',       kind: "tv-stand",       width: 4,          depth: 0.5 },
    { name: 'TV 55" (wall)',        kind: "tv-wall",        width: 4,          depth: 0.25 },
    { name: 'Wardrobe 4\'-0"',      kind: "wardrobe",       width: 4,          depth: 2 },
    { name: 'Dresser 60"',          kind: "dresser",        width: 5,          depth: 1.5 },
    { name: 'Floor Lamp',           kind: "floor-lamp",     width: 1.25,       depth: 1.25 },
  ],
  // Standard US residential bathroom fixtures. Dimensions follow common
  // manufacturer spec sheets (Kohler / Toto / American Standard) and the
  // IRC / ANSI Z124 ranges used on builder plan sets.
  //   Toilet  — elongated bowl is 18½–19" wide × 28–30" deep; round front
  //             is ~27" deep. Tank ≈ 9" deep × 18–20" wide. Standard 12"
  //             rough-in puts the trap centerline at 12" from the wall.
  //   Lav     — 21" deep is the residential standard for vanities; bowls
  //             are 16–20" wide.
  //   Tub     — 60" alcove is the canonical "5-foot tub". Skirted tubs are
  //             30–32" deep; soaking tubs run 32–36" deep; freestanding
  //             slipper / oval tubs reach 66–72" × 32–42".
  //   Shower  — 36" × 36" is the IRC minimum (30" × 30" net interior);
  //             48" × 36", 60" × 32", and 60" × 36" are the common
  //             accessible / barrier-free sizes.
  bathroom: [
    { name: 'Toilet (Elongated)',     kind: "toilet",       width: 1 + 8 / 12,  depth: 2.5 },
    { name: 'Toilet (Round Front)',   kind: "toilet-round", width: 1 + 7 / 12,  depth: 2 + 3 / 12 },
    { name: 'Wall-Hung Toilet',       kind: "toilet-wall",  width: 1 + 4 / 12,  depth: 2 + 1 / 12 },
    { name: 'Bidet',                  kind: "bidet",        width: 1 + 3 / 12,  depth: 2 + 1 / 12 },
    { name: 'Urinal',                 kind: "urinal",       width: 1 + 2 / 12,  depth: 1 + 2 / 12 },
    { name: 'Pedestal Sink 22"',      kind: "lav-pedestal", width: 1 + 10 / 12, depth: 1 + 7 / 12 },
    { name: 'Vanity 24"',             kind: "vanity",       width: 2,           depth: 1 + 9 / 12 },
    { name: 'Vanity 30"',             kind: "vanity",       width: 2.5,         depth: 1 + 9 / 12 },
    { name: 'Vanity 36"',             kind: "vanity",       width: 3,           depth: 1 + 9 / 12 },
    { name: 'Vanity 48"',             kind: "vanity",       width: 4,           depth: 1 + 9 / 12 },
    { name: 'Double Vanity 60"',      kind: "vanity-double", width: 5,          depth: 1 + 9 / 12 },
    { name: 'Double Vanity 72"',      kind: "vanity-double", width: 6,          depth: 1 + 9 / 12 },
    { name: 'Bathtub 60" × 30"',      kind: "tub-alcove",   width: 5,           depth: 2.5 },
    { name: 'Bathtub 60" × 32"',      kind: "tub-alcove",   width: 5,           depth: 2 + 8 / 12 },
    { name: 'Tub/Shower 60" × 32"',   kind: "tub-shower",   width: 5,           depth: 2 + 8 / 12 },
    { name: 'Soaking Tub 66" × 36"',  kind: "tub-soaker",   width: 5.5,         depth: 3 },
    { name: 'Freestanding Tub 72"',   kind: "tub-freestand", width: 6,          depth: 3 + 2 / 12 },
    { name: 'Corner Tub 60" × 60"',   kind: "tub-corner",   width: 5,           depth: 5 },
    { name: 'Shower 36" × 36"',       kind: "shower",       width: 3,           depth: 3 },
    { name: 'Shower 48" × 36"',       kind: "shower",       width: 4,           depth: 3 },
    { name: 'Shower 60" × 36"',       kind: "shower",       width: 5,           depth: 3 },
    { name: 'Shower 60" × 32"',       kind: "shower",       width: 5,           depth: 2 + 8 / 12 },
    { name: 'Corner Shower 36"',      kind: "shower-corner", width: 3,          depth: 3 },
    { name: 'Washer 27"',             kind: "washer",       width: 2.25,        depth: 2.5 },
    { name: 'Dryer 27"',              kind: "dryer",        width: 2.25,        depth: 2.5 },
  ],
};

// ==============================================================================
// State — single global state object
// ==============================================================================

// ---------- State ----------
const state = {
  zoom: 1,
  pan: { x: 0, y: 0 },

  gridSize: 1,
  snap: true,
  gridOpacity: 0.5,

  stories: [],
  activeSublayerId: null,

  tool: "line",
  pending: null,
  cursorWorld: { x: 0, y: 0 },
  cursorScreen: { x: 0, y: 0 },

  panning: false,
  panStart: null,
  panOrigin: null,
  spaceDown: false,
  shiftDown: false,

  history: [],
  future: [],

  selection: new Set(),
  selectionMode: null,
  selectionData: null,
  marquee: null,

  curveDrag: null, // { shapeId, originalShape, historyPushed }

  placing: null, // { def, sectionKey }
  paletteExpanded: { doors: true, windows: true, kitchen: true, bathroom: true },

  colorPopup: null, // { subId } when open

  stairsDirection: null, // { start: {x,y}, angle? } during arrow placement

  cabinetBuilder: null, // { points: [{x,y}], depth, side, layerId, storyId } while building

  // Counter for consecutive empty selection attempts that landed near shapes
  // on inactive layers — used to surface the "did you mean another layer?"
  // hint after the user has clearly tried more than once.
  crossLayerMisses: 0,

  // Arrow-key nudge: timestamp of the last arrow-driven move. Successive
  // nudges within a short window coalesce into a single undo entry so
  // holding an arrow doesn't flood history.
  lastNudgeTime: 0,

  // File menu / current document. fileHandle is the FileSystemFileHandle from
  // window.showSaveFilePicker / showOpenFilePicker when supported (Chrome,
  // Edge); fileName is shown in the brand area.
  fileHandle: null,
  fileName: null,
  fileMenuOpen: false,

  // View mode: "draw" is the live drafting canvas; "plan" renders the
  // drawing inside a printable sheet layout (title block, viewport, notes).
  // Plan mode keeps its own list of sheets, each one a separate page output.
  viewMode: "draw",
  sheets: [],
  activeSheetId: null,

  // Plan-mode navigation (paper-space zoom + pan, separate from draw-mode
  // pan/zoom so neither view interferes with the other). zoom = 1 is the
  // auto-fit-to-canvas baseline; pan offsets the centered paper position.
  planView: { zoom: 1, pan: { x: 0, y: 0 }, panning: false, panStart: null, panOrigin: null },

  // Set non-null during export — { ppi } controls pixel-for-pixel rendering
  // in renderPlanView (no fit, no backdrop, no preview overlays). Cleared
  // immediately after capture so normal rendering resumes unchanged.
  printContext: null,

  // Cut / copy / paste — a flat array of cloned shapes. Paste places them
  // on the active layer, anchored to wherever the user right-clicked
  // (state.contextMenuAnchor) when the menu was triggered.
  clipboard: [],
  contextMenuAnchor: null,
};

// ==============================================================================
// DOM references
// ==============================================================================

// ---------- DOM ----------
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const wrap = document.querySelector(".canvas-wrap");

const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const zoomReadout = document.getElementById("zoom-readout");

const gridSizeInput = document.getElementById("grid-size");
const snapToggle = document.getElementById("snap-toggle");
const gridOpacityInput = document.getElementById("grid-opacity");

const toolListEl = document.getElementById("tool-list");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const clearBtn = document.getElementById("clear-btn");

const layerTreeEl = document.getElementById("layer-tree");
const addStoryBtn = document.getElementById("add-story-btn");

const statusPos = document.getElementById("status-pos");
const statusTool = document.getElementById("status-tool");
const statusActive = document.getElementById("status-active-layer");

const palettePanel = document.getElementById("palette-panel");
const paletteHeader = document.getElementById("palette-header");
const paletteBody = document.getElementById("palette-body");
const paletteMin = document.getElementById("palette-min");
const paletteResize = document.getElementById("palette-resize");

const layersPanel = document.getElementById("layers-panel");
const layersHeader = document.getElementById("layers-header");
const layersMin = document.getElementById("layers-min");
const layersResize = document.getElementById("layers-resize");

const dimModal = document.getElementById("dim-modal");
const dimWidthInput = document.getElementById("dim-width");
const doorFlipRow = document.getElementById("door-flip-row");

const colorPopupEl = document.getElementById("color-popup");

const lineModalEl = document.getElementById("line-modal");
const lineStrokeRow = document.getElementById("line-stroke-row");
const wallThicknessRow = document.getElementById("wall-thickness-row");
const wallThicknessInput = document.getElementById("wall-thickness-input");
const measureModalEl = document.getElementById("measure-modal");

const islandModalEl = document.getElementById("island-modal");
const islandTagPosSelect = document.getElementById("island-tag-pos");
const islandBarOnSelect = document.getElementById("island-bar-on");
const islandBarSideSelect = document.getElementById("island-bar-side");
const islandBarSideRow = document.getElementById("island-bar-side-row");
const textModalEl = document.getElementById("text-modal");
const textContentInput = document.getElementById("text-content");
const textFontSelect = document.getElementById("text-font");
const textSizeInput = document.getElementById("text-size");
const textOutlineSelect = document.getElementById("text-outline");

const stairsModal = document.getElementById("stairs-modal");
const stairsCeilingInput = document.getElementById("stairs-ceiling");
const stairsRiseInput = document.getElementById("stairs-rise");
const stairsRunInput = document.getElementById("stairs-run");
const stairsWidthInput = document.getElementById("stairs-width");
const stairsCancelBtn = document.getElementById("stairs-cancel");
const stairsBuildBtn = document.getElementById("stairs-build");

const layerHintModal = document.getElementById("layer-hint-modal");
const layerHintList = document.getElementById("layer-hint-list");
const layerHintClose = document.getElementById("layer-hint-close");

const brandSubEl = document.getElementById("brand-sub");
const fileMenuBtn = document.getElementById("file-menu-btn");
const fileMenuEl = document.getElementById("file-menu");
const modeSwitchEl = document.querySelector(".mode-switch");
const sheetListEl = document.getElementById("sheet-list");
const addSheetBtn = document.getElementById("add-sheet-btn");

const propSheetTypeSel  = document.getElementById("prop-sheet-type");
const propPaperSizeSel  = document.getElementById("prop-paper-size");
const propScaleSel      = document.getElementById("prop-scale");
const propTextScaleSel  = document.getElementById("prop-text-scale");
const propOrientationEl = document.getElementById("prop-orientation");
const propNumberInput   = document.getElementById("prop-number");
const propTitleInput    = document.getElementById("prop-title");
const propProjectInput  = document.getElementById("prop-project");
const propAddressInput  = document.getElementById("prop-address");
const propDateInput     = document.getElementById("prop-date");
const propDrawnByInput  = document.getElementById("prop-drawn-by");

const notesListEl = document.getElementById("notes-list");
const addNoteBtn  = document.getElementById("add-note-btn");

const sheetLayerTreeEl = document.getElementById("sheet-layer-tree");

const ctxMenuEl = document.getElementById("ctx-menu");

const cabinetModal = document.getElementById("cabinet-modal");
const cabinetDepthInput = document.getElementById("cabinet-depth");
const cabinetCancelBtn = document.getElementById("cabinet-cancel");
const cabinetFinishBtn = document.getElementById("cabinet-finish");

// ==============================================================================
// Tiny utilities
// ==============================================================================

function withAlpha(color, alpha) {
  if (typeof color !== "string") return color;
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function makeId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}
