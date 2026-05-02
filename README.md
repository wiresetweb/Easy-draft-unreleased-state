# Drafting Studio

A single-page, canvas-based residential drafting tool. Plain HTML/CSS/JS, no build step, no npm dependencies, no test suite. Open `index.html` directly in a browser (`file://`) and the app runs.

## Running it

Double-click `index.html`. That's it. The user works in `file://` mode — **do not** introduce ES modules, bundlers, or anything that requires HTTP serving without first asking.

To debug: F12 → Console. Errors will reference the source file and line directly.

## Architecture

The codebase is 26 classic `<script>` files loaded in dependency order from `index.html`. There is **no IIFE wrapper** and **no ES modules**. All top-level `const`/`let`/`function` declarations live in the shared classic-script lexical environment — they are visible to every other script that loads after them, but are NOT properties of `window`.

This has two consequences:

1. **Load order matters** for top-level imperative code (e.g. `const SHAPES = {...}` in `js/shapes.js` references `drawLineShape` from `js/render/line.js`, so line.js must load first). The order is fixed in `index.html`; don't reshuffle without understanding why.
2. **Function declarations resolve at call time across files**, so a function in file A can call a function defined in file B regardless of declaration order, as long as both files have loaded by the time the call runs (which they will, since `js/main.js` calls `init()` last).

```
js/
├── state.js          constants, state object, DOM lookups, withAlpha, makeId
├── canvas-view.js    fitCanvas, zoom, rounded-rect helpers, pathFromSamples
├── geometry.js       coords ↔ world, snap, feet parse/format, Bezier, distances, axes
├── history.js        cloneShape, snapshot, undo, redo
├── layers.js         story / sublayer model + layer tree UI + tree-only SVG icons
├── render/
│   ├── grid.js       drawGrid
│   ├── line.js       drawLineShape
│   ├── arc.js        drawArcShape
│   ├── door.js       drawDoorShape (+ drawArcSegment helper for swing arcs)
│   ├── window.js     drawWindowShape
│   ├── text.js       drawTextShape
│   ├── measure.js    drawMeasureShape + drawDimension + measureDimEndpoints
│   ├── appliance.js  drawApplianceShape + applianceCorners
│   ├── stairs.js     drawStairsShape + per-segment renderers (NOT the builder)
│   └── cabinet.js    drawCabinetShape + offsetPolyline + appliance-cut helpers
├── shapes.js         SHAPES registry — central dispatch table, see below
├── render.js         drawShape dispatch, glow, render() entry, selection rendering
├── selection.js      hit-test, bbox, transforms, ops, pointer + curve drag
├── palette.js        palette panel + paletteIconSvg + placeItem
├── modals.js         dim / line / text / inline editor / color popup
├── tools/
│   ├── wall-cuts.js  door / window dropped on wall splits the wall
│   ├── box-merge.js  collinear-overlap merge for box tool
│   ├── stairs.js     stairs builder geometry + ghost + modal
│   └── cabinet.js    cabinet builder + preview + modal
├── events.js         setTool + bindEvents + pointer handlers
└── main.js           init() definition + invocation (loaded LAST)
```

`app.js.bak` is the original 5359-line single-file IIFE, kept as a safety reference. It is no longer loaded.

## The SHAPES registry (central pattern)

Every shape type — `line`, `arc`, `measure`, `door`, `window`, `text`, `appliance`, `stairs`, `cabinet` — has one entry in `js/shapes.js`'s `SHAPES` table. The entry provides `draw`, `bbox`, `hitDistance`, `snapCorners`, `capture`/`restore`, `move`/`rotate`/`resize`, `duplicate`, plus optional `cloneExtra` for composite types and flags `selectionBg` and `isOpening`.

**Adding a new shape type:**
1. Write a `draw{Foo}Shape(sh, color, sub?)` helper in `js/render/foo.js`.
2. Add a `<script src="js/render/foo.js">` tag to `index.html` before `js/shapes.js`.
3. Add a `SHAPES.foo = { ... }` entry in `js/shapes.js`.
4. If a tool creates this shape, wire its pointer handler in `js/events.js` (or a new `js/tools/foo.js`).

**Do not** add `if (sh.type === "foo")` branches in dispatch sites (`drawShape`, `shapeBBox`, `findShapeAtScreen`, `snapshotSelected`, `applyMove`, `applyResize`, `applyRotate`, `duplicateSelected`, `ensureTransformHistory`, `cloneShape`, `shapeSnapCorners`, `hasOpeningSelected`, `drawShapeStrokeUnder`). Those all dispatch through the registry — touching them is a smell.

The two remaining `sh.type ===` references (`applianceCornersOnSameStory`, the box-tool collinear merge guard) are intentional type filters, not dispatches; they don't grow with new shape types.

## Conventions

- Coordinates: world units are feet (`PX_PER_FOOT = 20` at zoom 1). Angles in radians.
- Shape IDs come from `makeId(prefix)`; prefixes are short and lowercase by convention (`X` for duplicate, `S` for stories, `L` for layers).
- All transforms are anchor-relative; the snapshot captured by `SHAPES[type].capture` is what `move`/`rotate`/`resize` operate on (so the user's drag math works against the pre-drag state, not the live shape).
- `state.tool` drives pointer handler dispatch in `events.js`. Drawing tools (`line`, `box`, `stairs`) auto-fall back to `select` on layers that have a palette (Doors & Windows, Kitchen) — see `LAYER_DRAW_TOOLS` and `isLayerDrawingBlocked` in `events.js`.
- `pushHistory()` is called explicitly before any state mutation that should be undoable. The select-tool transforms defer history via `ensureTransformHistory()` so a click-without-drag doesn't pollute the undo stack.

## Testing

There is no automated test suite. After a change:

1. `node --check <file>` for syntax sanity.
2. Reload `index.html`, F12 → Console, watch for errors.
3. Manually exercise: draw each shape type, select / move / rotate / resize, undo / redo, layer visibility, palette placement, cabinet builder, stairs builder.

## Top-of-file index

`app.js.bak` and the live split files don't have inline section maps anymore — the file structure IS the map. If you need to find something, the layout above plus grep is faster than scanning.
