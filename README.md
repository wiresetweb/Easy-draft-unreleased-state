# Easy Draft / Drafting Studio

A single-page, canvas-based residential drafting tool. Plain HTML/CSS/JS, no build step, no npm dependencies, no test suite. Open `index.html` directly in a browser (`file://`) and the app runs.

Live online at [easydraftonline.com/app/](https://easydraftonline.com/app/).

---

## Quick start

Double-click `index.html`. That's it. The user works in `file://` mode — **do not** introduce ES modules, bundlers, or anything that requires HTTP serving without first asking.

Three things to know before drawing:

1. **Pick a layer first.** Every shape lives on a sub-layer of a story. The active layer is shown at the top of the layer tree on the right (`Layers` panel) and in the status block at the bottom-left.
2. **The grid is in feet.** Default grid is 1 ft, snap on. Change in the topbar.
3. **Two modes.** `Draw` is where you build the drawing. `Plan` is where you arrange it onto printable sheets and export to PDF.

---

## Concepts

### Stories and sub-layers

A drawing is organized as **stories** (e.g. *First*, *Second*, *Basement*) which contain **sub-layers** (e.g. *Walls*, *Windows & Doors*, *Kitchen*). Each shape belongs to exactly one sub-layer. Stories and sub-layers are independently visible / hidden, expandable / collapsed, and assigned a color.

A new project ships with one story and the default sub-layer set: **Floor, Walls, Windows & Doors, Kitchen, Bathroom, Furniture, Measurements**. Adding a second story drops *Kitchen* by default (most second stories don't have one). All layer names are renameable; the *Measurements* layer is created automatically the first time you use the measure tool if it doesn't exist.

Some sub-layers are **palette layers** — *Windows & Doors*, *Kitchen*, *Bathroom*, *Furniture*. On those, the right-side panel switches from the layer tree to a catalog of items you can drag onto the canvas. The drawing tools (line / box / stairs) auto-fall back to *Select* on palette layers because freehand drawing on them doesn't make sense.

### Coordinates and units

World units are **feet**. The grid is also in feet (default 1 ft, range 0.25–100). Sizes throughout the UI accept architectural notation: `3'-0"`, `2'6"`, `30"`, `5.5'` all work. Output is shown in feet-and-inches.

### File format

Drawings save as `.dstudio.json` — plain JSON containing stories / sub-layers / shapes / sheets / view settings. Files are local to your machine; no cloud, no account required to use the tool.

---

## The toolbar (Draw mode)

| Tool      | Shortcut | What it does                                                                 |
|-----------|----------|------------------------------------------------------------------------------|
| Select    | `V`      | Pick, marquee, transform, copy/paste, delete                                 |
| Line      | `L`      | Click two points to draw a wall / line                                       |
| Box       | `B`      | Click two opposite corners to draw a four-sided room                         |
| Stairs    | `S`      | Click + drag to set direction, then dial in dimensions                       |
| Text      | `T`      | Click to place a text label                                                  |
| Measure   | `M`      | Click two points to lay down a dimension line                                |
| Pan       | `H`      | Click + drag to pan the view (also: hold `Space`, or middle-mouse-drag)      |

Holding `Shift` while drawing a line locks it to 45° increments. Holding `Shift` during a transform constrains motion to one axis (move) or aspect ratio (resize), and snaps rotation to 15° steps.

---

## Walls

### Drawing

`L` (line) — click two points. Most plans start with the **Box** tool (`B`): two clicks define opposite corners and four walls are dropped in. When the active layer is *Walls*, drawing a box automatically merges any of its new edges that are collinear with existing walls — you don't end up with stacks of overlapping lines along the same edge.

### Wall thickness

Select a wall, and the line modal shows a stroke option (solid / dashed / dotted) plus a *Wall* row with thickness presets:

| Preset       | Thickness | What it represents                                       |
|--------------|-----------|----------------------------------------------------------|
| **None**     | 0         | Centerline only — single drawn line                       |
| **Int.**     | 4½"       | Interior partition: 2×4 stud + ½" drywall each side       |
| **Ext. wood** | 6½"      | Exterior wood-framed: 2×6 stud + ½" drywall + ½" sheathing |
| **Ext. blk** | 8"        | Exterior CMU / block                                      |
| Custom       | any       | Type any feet/inches into the input                       |

Thickness inflates the hit box, so you can grab the wall by its face — not just the centerline.

### Curve handles

Single-select a line or arc and drag the small circular handle on the curve to bend it. Pulling the handle back onto the chord collapses the arc back into a straight line.

---

## Doors and windows

Switch the active layer to **Windows & Doors** to bring up the door / window catalog. Drag any item onto a wall and it snaps onto the centerline at the drop point, oriented along the wall.

**Wall cutting.** When you drop a door or window on a wall, Easy Draft automatically splits the wall into two segments — one each side of the opening — so the wall in the title block schedule and the visible wall on the drawing both stop at the opening. The split happens silently; there's no confirmation prompt.

**Door flipping.** When a door is selected, the dimension modal shows two flip buttons:
- **Hinge** swaps the hinge side (left ↔ right)
- **Swing** flips the swing direction (in ↔ out)

The catalog covers exterior swing doors (2'-8" / 3'-0" / 3'-6"), sliding glass (6' / 8'), interior swings (2'-0" → 3'-0"), French doors (5' / 6'), pocket doors (2'-6" / 2'-8" / 3'-0"), and garage doors (9' / 10' / 16' / 18'). Windows include single/double hung, casement, awning, sliding, and picture in widths from 2' to 6'.

---

## Kitchen

The Kitchen palette has appliances at standard residential dimensions (range, cooktop, wall oven, refrigerator, dishwasher, sink, double sink, microwave, base cabinets, island). Drop any of them on the canvas; appliances align to the nearest wall when one is in range, islands free-place wherever you click.

### Cabinet builder

When the active layer is *Kitchen*, the palette includes a **Cabinet Builder** tool. Click points along a wall and the builder traces a cabinet run; the cabinet body extends into the room at the depth you choose (default 2'-0", or 24"). Right-click pops the last point. `Esc` finishes the run. Any kitchen appliance the cabinet runs through automatically cuts a notch in the cabinet so the visible run matches reality.

### Islands

Islands have their own modal: pick where the **tag** (label) sits — center, or one of the four corners — and toggle a raised **bar** along any side. The bar is drawn as the eat-at counter you'd see on a builder set.

---

## Bathroom

A separate palette of fixtures with manufacturer-spec dimensions: toilets (elongated / round front / wall-hung), bidet, urinal, pedestal sink, vanities (24" / 30" / 36" / 48"), double vanities (60" / 72"), tubs (alcove / soaker / freestanding / corner / tub-shower combos), showers (36"×36" through 60"×36" plus corner), and washer / dryer. Same drag-onto-wall-or-floor behavior as the Kitchen palette.

---

## Furniture

The built-in furniture catalog covers the residential staples: armchair, dining chair, stool, loveseat, sofa, sectional, media console, TV (stand or wall-mount), wardrobe, dresser, floor lamp.

### Custom Furniture Builder

The Furniture palette also includes a **+ New Custom** entry that opens the Furniture Builder modal. It's a separate canvas with a 4" grid where you can draw the piece you need:

- Tools: select / line / square (with optional rounded corners) / circle
- Type a name in the header, click **Save & Download**
- The builder writes to `js/custom-furniture.js` (downloaded as a file you save back into the project) and adds the piece to the palette immediately

Saved pieces persist across sessions only if you keep the downloaded `custom-furniture.js` in place — that's the file the page loads at startup.

---

## Stairs

`S` (or click *Stairs* in the toolbar). Click and drag to set the start point and direction. On release, the Stairs modal opens:

- **Ceiling Height** (default 8'-0")
- **Step Rise** (default 7")
- **Step Run** (default 11")
- **Width** (default 3'-0")

The builder calculates the number of treads, lays out the flight, and adds a landing at the top. If a wall is roughly parallel and within 6" of the start point, the landing snaps to align with it.

---

## Text

`T`, click where the text should anchor. The text modal sets the content, font (Sans / Serif / Mono / Wide / Hand), size in screen pixels, and outline style:

- **None** — plain text
- **Box** — rectangular border around the text
- **Bubble** — rounded pill border

Text size is in **screen pixels**, so it stays the same visual weight regardless of zoom — exactly like every other annotation system.

---

## Measurements

`M`, click the two points you want to dimension between. The measure tool snaps to **shape corners** rather than the grid, so you're measuring the actual feature, not where you happened to click.

Select an existing dimension and the measure modal lets you switch type:

- **int. to int.** — interior to interior (between inside faces)
- **ext. to ext.** — exterior to exterior (between outside faces)
- **¢ to ¢** — center to center (between centerlines, the default)

Dimensions live on a *Measurements* sub-layer that's created automatically the first time you reach for the tool. They render in red so they read as a different mode from the orange selection state.

---

## Selection and transforms

`V`, then click any shape. Drag in empty space to marquee-select multiple shapes (only on the active layer — see below).

Selected shapes get an oriented bounding box with eight corner / edge handles for **resize**, an outer ring for **rotate**, and a free interior for **move**. `Shift` constrains: axis-locked moves, aspect-locked resize, 15° rotation steps.

### Layer locking and the cross-layer hint

The select tool only grabs shapes on the **active** sub-layer. This is on purpose — it prevents you from accidentally moving a wall while editing furniture. If you click into empty space repeatedly near shapes that exist on inactive layers, after four misses Easy Draft pops up a **Looking for something else?** modal listing the candidate layers; click one to switch.

### Clipboard / history

| Action       | Shortcut          |
|--------------|-------------------|
| Cut          | `Ctrl+X`          |
| Copy         | `Ctrl+C`          |
| Paste        | `Ctrl+V`          |
| Duplicate    | `Ctrl+D`          |
| Select all   | `Ctrl+A`          |
| Delete       | `Delete` / `Backspace` |
| Undo         | `Ctrl+Z`          |
| Redo         | `Ctrl+Shift+Z` / `Ctrl+Y` |
| Nudge        | Arrow keys (half-grid) |
| Deselect     | `Esc`             |

Right-click anywhere in select mode for the same actions in a context menu. Paste anchors at the right-click location. Holding an arrow key for sustained nudges coalesces into a single undo entry instead of one per key repeat.

---

## Layers, stories, colors

The right-side **Layers** panel is the layer tree. From it you can:

- Add / rename / delete stories and sub-layers
- Toggle visibility (eye icon) per story or per sub-layer
- Pick a color for each sub-layer (12-color palette, or any custom hex)
- Reorder, expand / collapse stories
- Set the active sub-layer (click the row)

Default colors map by name: walls black, windows & doors blue, kitchen teal, plumbing sky blue, electrical red, etc. Every shape is rendered in its layer's color. Hidden layers don't render — but their shapes are still there, untouched, and reappear when you toggle visibility back on.

---

## Grid, snap, zoom, pan

Topbar controls:

- **Zoom** — `+` / `−` / *Reset* (also: mouse wheel)
- **Grid** — size in feet, 0.25 to 100; snap on/off; opacity slider
- **File** menu — see below

`Space` (held) or middle-mouse-drag pans without leaving the current tool. The status block at the bottom-left shows the cursor's world position, the current tool, and the active layer.

---

## File menu

| Action      | Behavior                                                                                                                     |
|-------------|------------------------------------------------------------------------------------------------------------------------------|
| **New**     | Confirms first, then resets the drawing                                                                                      |
| **Open…**   | File picker (Chrome / Edge use the File System Access API; Firefox / Safari fall back to a hidden `<input type=file>`)        |
| **Save**    | Writes back to the same file when supported; otherwise behaves like *Save As*                                                |
| **Save As…** | Save to a new path / filename                                                                                                |
| **Export…** | Render every plan-mode sheet to PDF — see below                                                                              |

In plan mode, **Export PDF…** is also surfaced as a button in the left sidebar so you don't have to fish through the File menu.

---

## Plan mode

`Plan` switches the canvas from "draw your house" to "lay out the printable sheets that will be the PDF." Each sheet is a separate page output.

### Sheet types

- **Drawing** — a viewport cropped from your drawing, with a title block, scale bar, and north arrow
- **Schedule** — auto-generated table of doors and windows in the project
- **Index** — auto-generated list of the other sheets in the document

### Sheet properties (left sidebar in Plan mode)

- **Type** — drawing / schedule / index
- **Paper** — ANSI-A (Letter) through ANSI-E (44×34"), ARCH-A (9×12") through ARCH-E (36×48", default *ARCH-D* 24×36" for residential), ISO A0 through A4
- **Orientation** — landscape / portrait
- **Scale** — 1/16"=1'-0" through 3"=1'-0" (default 1/4"=1'-0")
- **Text Size** — small / normal / large / extra large
- **Sheet Number** — free text (e.g. *A-101*)
- **Title block** — Title, Project, Address, Date, Drawn By
- **General Notes** — numbered list, edited inline, prints to the right column
- **Sheet Layers** — per-sheet override of which layers appear on this sheet (defaults to the global visibility)

### Positioning a drawing on a sheet

In *Draw* mode each drawing-type sheet has an opt-in **page outline** (toggle the eye on the page row in the *Pages* list). When visible, the page is shown as a dashed rectangle on the canvas; drag its edges to reposition the page over the part of the drawing you want printed. The inner viewport rectangle shows the area that will actually be cropped onto the sheet.

### North arrow / scale bar

Drawing-type sheets render a small north arrow and a graphic scale bar in the viewport area. North is always up — Easy Draft doesn't rotate the page. The scale bar is calibrated to the sheet's selected scale.

---

## Export to PDF

`File → Export…` (or the **Export PDF…** button in the Plan-mode sidebar) renders every sheet at 150 DPI and hands the result to your browser's print dialog. From there pick *Save as PDF* (every modern OS supports this) or send to a printer. Multi-page PDFs come for free — the print stage emits one page break per sheet.

### Watermark for unpaid users

Visitors without an active **base** entitlement get a large, repeating diagonal *DRAFT — easydraftonline.com* watermark with the Easy Draft logo overlaid in the center of every exported page. This is intentionally bypassable by anyone willing to read the JS — server-side gating isn't the point — but the watermark is unmissable enough that an unpaid export can't pass for a finished drawing.

Entitlement is checked against Supabase on page load. Any failure mode (file://, offline, no logged-in session, no entitlement row) leaves the visitor in the "unpaid" state. The check happens in the background; the editor itself is fully usable regardless.

---

## Demo mode

Append `?demo=garage` (or `addition`, `bedroom`) to the URL and the editor loads a pre-built drawing into a stripped-down read-mostly UI for marketing-site embeds. The sidebar, layer tree, palette, and most of the topbar are hidden; a minimal floating toolbar exposes only *Select*, *Wall*, *Measure*, and *Pan*. Demo mode is a no-op when `?demo=` is absent.

---

## Keyboard cheat sheet

```
Tools                   Editing                       View
  V  Select               Ctrl+Z   Undo                 Mouse wheel  Zoom
  L  Line                 Ctrl+Y   Redo                 Space + drag Pan
  B  Box                  Ctrl+X   Cut                  Middle-drag  Pan
  S  Stairs               Ctrl+C   Copy                 H            Pan tool
  T  Text                 Ctrl+V   Paste
  M  Measure              Ctrl+D   Duplicate
  H  Pan                  Ctrl+A   Select all
                          Del      Delete
Modifiers                 Arrows   Nudge by half-grid
  Shift  45° / axis lock  Esc      Cancel / deselect
  Shift  15° rotate steps
```

---

## For developers

The codebase is 28 classic `<script>` files loaded in dependency order from `index.html`. There is **no IIFE wrapper** and **no ES modules**. All top-level `const`/`let`/`function` declarations live in the shared classic-script lexical environment — they are visible to every other script that loads after them, but are NOT properties of `window`.

This has two consequences:

1. **Load order matters** for top-level imperative code (e.g. `const SHAPES = {...}` in `js/shapes.js` references `drawLineShape` from `js/render/line.js`, so line.js must load first). The order is fixed in `index.html`; don't reshuffle without understanding why.
2. **Function declarations resolve at call time across files**, so a function in file A can call a function defined in file B regardless of declaration order, as long as both files have loaded by the time the call runs (which they will, since `js/main.js` calls `init()` last).

```
js/
├── config.js         Supabase URL + publishable key (mirrors website's config.js)
├── state.js          constants, state object, DOM lookups, withAlpha, makeId
├── auth.js           loads Supabase JS UMD, sets state.paid based on entitlement
├── custom-furniture.js  generated catalog from the Furniture Builder
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
│   ├── wall-cuts.js       door / window dropped on wall splits the wall
│   ├── box-merge.js       collinear-overlap merge for box tool
│   ├── stairs.js          stairs builder geometry + ghost + modal
│   ├── cabinet.js         cabinet builder + preview + modal
│   └── furniture-builder.js  custom-furniture modal canvas + save/download
├── plan-view.js      plan-mode sheet rendering, paper sizes, scales, export
├── file.js           File menu (New / Open / Save / Save As / Export)
├── events.js         setTool + bindEvents + pointer handlers
├── main.js           init() definition + invocation (loaded LAST among app code)
└── demo-mode.js      no-op unless ?demo=<name> is in the URL
```

`app.js.bak` is the original 5359-line single-file IIFE, kept as a safety reference. It is no longer loaded.

### The SHAPES registry (central pattern)

Every shape type — `line`, `arc`, `measure`, `door`, `window`, `text`, `appliance`, `stairs`, `cabinet` — has one entry in `js/shapes.js`'s `SHAPES` table. The entry provides `draw`, `bbox`, `hitDistance`, `snapCorners`, `capture`/`restore`, `move`/`rotate`/`resize`, `duplicate`, plus optional `cloneExtra` for composite types and flags `selectionBg` and `isOpening`.

**Adding a new shape type:**
1. Write a `draw{Foo}Shape(sh, color, sub?)` helper in `js/render/foo.js`.
2. Add a `<script src="js/render/foo.js">` tag to `index.html` before `js/shapes.js`.
3. Add a `SHAPES.foo = { ... }` entry in `js/shapes.js`.
4. If a tool creates this shape, wire its pointer handler in `js/events.js` (or a new `js/tools/foo.js`).

**Do not** add `if (sh.type === "foo")` branches in dispatch sites (`drawShape`, `shapeBBox`, `findShapeAtScreen`, `snapshotSelected`, `applyMove`, `applyResize`, `applyRotate`, `duplicateSelected`, `ensureTransformHistory`, `cloneShape`, `shapeSnapCorners`, `hasOpeningSelected`, `drawShapeStrokeUnder`). Those all dispatch through the registry — touching them is a smell.

The two remaining `sh.type ===` references (`applianceCornersOnSameStory`, the box-tool collinear merge guard) are intentional type filters, not dispatches; they don't grow with new shape types.

### Conventions

- Coordinates: world units are feet (`PX_PER_FOOT = 20` at zoom 1). Angles in radians.
- Shape IDs come from `makeId(prefix)`; prefixes are short and lowercase by convention (`X` for duplicate, `S` for stories, `L` for layers).
- All transforms are anchor-relative; the snapshot captured by `SHAPES[type].capture` is what `move`/`rotate`/`resize` operate on (so the user's drag math works against the pre-drag state, not the live shape).
- `state.tool` drives pointer handler dispatch in `events.js`. Drawing tools (`line`, `box`, `stairs`) auto-fall back to `select` on layers that have a palette (Doors & Windows, Kitchen, Bathroom, Furniture) — see `LAYER_DRAW_TOOLS` and `isLayerDrawingBlocked` in `events.js`.
- `pushHistory()` is called explicitly before any state mutation that should be undoable. The select-tool transforms defer history via `ensureTransformHistory()` so a click-without-drag doesn't pollute the undo stack.

### Auth / entitlement

`js/auth.js` runs once on load. It reads `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from `js/config.js`, dynamically loads the Supabase JS UMD bundle from a CDN, calls `sb.auth.getSession()`, and queries the `entitlements` table for `(user_id = session.user.id, product_id = 'base', status = 'active')`. On success, `state.paid = true`; on any failure (file://, network, no session, no row, RLS error), `state.paid` stays `false`. The export pipeline reads that flag at render time and applies the watermark when it's false.

### Testing

There is no automated test suite. After a change:

1. `node --check <file>` for syntax sanity.
2. Reload `index.html`, F12 → Console, watch for errors.
3. Manually exercise: draw each shape type, select / move / rotate / resize, undo / redo, layer visibility, palette placement, cabinet builder, stairs builder, plan-mode export.

### Top-of-file index

`app.js.bak` and the live split files don't have inline section maps anymore — the file structure IS the map. If you need to find something, the layout above plus grep is faster than scanning.
