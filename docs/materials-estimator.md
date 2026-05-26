# Build Brief — Materials Estimator add-on

**Status:** Spec locked, not yet implemented. Build on a clone / feature branch.

A self-contained brief for an agent with no prior context. Reads the drawing and
produces a materials takeoff (quantities only), shown as a new Plan-mode sheet
and exportable to CSV. A paid add-on.

---

## 0. How to work

This is a large feature. **Plan first, build second.** Produce a step-by-step
implementation plan (files to add/modify, data-model changes, sequencing) and
confirm the open decisions in §12 **before** writing code. Work on a
clone / feature branch, commit incrementally, validate with `node --check` +
manual browser testing (there is no test suite). Do not begin coding until the
plan is reviewed.

## 1. The app and its hard constraints

Easy-Draft is a single-page, canvas-based residential drafting tool. **Read
`README.md` fully first**, especially "For developers."

- **Vanilla HTML/CSS/JS. No build step, no npm, no ES modules, no bundler. Runs
  from `file://`.** Do not introduce any of these.
- ~28 classic `<script>` files loaded in dependency order from `index.html`.
  Top-level declarations share one lexical scope (not on `window`). Adding a file
  means adding a `<script>` tag in the correct load-order slot.
- Shapes go through a central **`SHAPES` registry** (`js/shapes.js`). Don't add
  `if (sh.type===…)` branches at dispatch sites.
- World units are **feet** internally (`PX_PER_FOOT = 20`). Use
  `formatFeet()`/`parseFeet()` (`js/geometry.js`) for all display/parse; respect
  `state.units` (`imperial`/`metric`).
- Iterate the drawing with **`forEachShape(cb)`** (`js/layers.js`).

## 2. Locked product decisions

1. **Scope: finishes + framing + structure only. No MEP** (plumbing / electrical
   / HVAC) — that's a future pack.
2. **No assumptions** — see §3. The tool forces the user to supply what only they
   know; it never silently guesses.
3. **Per-story ceiling height** is the source of wall height (new required field
   on the story).
4. **Quantities only — no pricing** (pricing waits until there's a live price
   source).
5. **Output = a new Plan-mode sheet type** ("Estimate"), **exportable to CSV**.
6. **Paid add-on** — gated behind a *new* entitlement, separate from `base`.
7. A **structural / engineering "can this be built?" check is a separate, later
   tool** (see `engineering-tool.md`). The estimator leaves clean hooks (header
   member sizing, joist adequacy) but does not attempt them.

## 3. Guiding principle: "No assumptions"

Nothing the estimate uses may be a hidden guess. Every input is one of:

- **Class A — Project facts (must be entered; never defaulted).** If missing, the
  item is flagged and excluded — never estimated from a guess. These are:
  **per-story ceiling height; per-opening rough-opening height; the assembly type
  of any wall whose thickness isn't a known preset; (if joists are estimated)
  joist size / spacing / direction.**
- **Class B — Visible settings (user-owned, pre-seeded with editable standard
  values, saved in the project file, and printed on the sheet so the basis is
  transparent).** Editable defaults are acceptable (confirmed). These are: stud
  spacing, waste % per material, sheet sizes (drywall / sheathing), stock lumber
  lengths, plate count, cripple spacing, fastener allowances.
- **Class C — Stated construction conventions (baked into formulas but documented
  on the sheet, not silent):** e.g., 2 king + 2 jack studs per opening, riser
  count = tread + 1, stringer count by stair width.

A completeness check enforces Class A. Class B/C must be visible on the output so
a builder can audit the math.

## 4. Scope detail

**In:**

- **Framing:** studs, plates, headers (count + length + ply only — *member sizing
  is deferred to the Engineering Tool*), king / jack / cripple studs, rough sills,
  sheathing, blocking.
- **Finishes:** drywall, insulation, corner bead (+ inside-corner tape), flooring
  (by pattern), baseboard / trim, casing, optionally paint.
- **Structure:** subfloor sheathing, stair stringers, and joists **only if** the
  user supplies joist inputs (Class A). Member adequacy / sizing is the
  Engineering Tool's job, not the estimator's.
- **Schedules (counts):** doors, windows, appliances, fixtures, cabinets, stairs.

**Out (v1):** all MEP; structural adequacy / sizing; per-wall sloped / gable /
knee-wall heights; pricing.

## 5. Codebase map (verified — agent should still confirm)

| Thing | Location | Notes |
|---|---|---|
| Iterate all shapes | `forEachShape()` / `forEachVisibleShape()` in `js/layers.js` | entry point for the takeoff |
| Story model | `state.stories[]` → `{id,name,level,visible,sublayers[]}` in `js/state.js`/`js/layers.js` | `level`: 0 ground, +up, −basement. **Add ceiling height here.** |
| Walls | `type:"line"` `{x1,y1,x2,y2,thickness}`; presets `WALL_THICKNESS_PRESETS` (`int`=4.5/12, `ext-wood`=6.5/12, `ext-block`=8/12) | curved walls = `type:"arc"`; use `sampleArcPoints()` for arc length |
| Openings | `type:"door"` `{x,y,width,angle,subtype,swing,kind}`, `type:"window"` `{x,y,width,depth,angle,kind}` | **no height stored — add it.** Openings already split walls (`js/tools/wall-cuts.js`) |
| Floors | `type:"floor"` `{points[],pattern}`; patterns `hardwood/lvp/tile-square/tile-hex/carpet` | **area not computed — add Shoelace to `js/geometry.js`** |
| Cabinets | `type:"cabinet"` `{points[],depth,side}` | polyline length → linear feet |
| Appliances/fixtures | `type:"appliance"` `{x,y,width,depth,angle,kind,label}` | catalogs in `js/state.js`; kinds enumerated there |
| Stairs | `type:"stairs"` with rise/run/width/ceiling-height; tread count computed | `js/tools/stairs.js` |
| Existing schedule (model to copy) | `collectScheduleData()` in `js/plan-view.js` | groups doors/windows by `kind`, counts |
| Sheet system + table render | `state.sheets[]`, `renderPlanView()`, `drawTableContent()`/`drawScheduleTable()` in `js/plan-view.js` | sheet types: drawing/schedule/index — **add "estimate"** |
| File I/O | `serializeDocument()`/`loadDocument()` in `js/file.js` | persist new fields + settings here |
| Entitlement | `js/auth.js` checks Supabase `entitlements` for `product_id='base'` → `state.paid` | **add a new product_id for this add-on** |
| Geometry helpers | `js/geometry.js`: `pointToSegmentDist`, `pointInPolygon`, distances, arc sampling | no polygon-area yet |

## 6. Data-model additions

- **Story:** `ceilingHeight` (feet). Required at estimate time; not defaulted.
- **Door/Window:** `roughHeight` (feet). Required at estimate time. Add UI to the
  dim/line modals (`js/modals.js`). **Do not parse height from the `kind`
  string** — that would be a guess.
- **Wall assembly resolution:** the 3 thickness presets auto-map (4.5"→2×4 stud /
  6.5"→2×6 stud / 8"→CMU block). `thickness:0` and custom thicknesses are
  **unresolved** → user must tag them (add an assembly selector). Unresolved walls
  are Class-A gaps.
- **Polygon area:** add a Shoelace `polygonArea(points)` to `js/geometry.js` (also
  a `polygonPerimeter` for baseboard).
- **Estimate settings (Class B):** a project-saved object (in `serializeDocument`)
  with the visible knobs from §3, pre-seeded with editable defaults. Provide a
  settings UI.
- **Joist inputs (Class A, if joists are in scope):** per-story joist size +
  spacing + direction. *Design this shared with the Engineering Tool.*

## 7. Calculation spec (per category)

Implement as **pure functions: `state → estimateObject`** so the sheet, CSV, and
a future pricing layer all consume the same structure. Group line items by
category and subtotal by story.

**Walls — framed (2×4 / 2×6):** per segment with length `L` (hypot or arc length)
and height `H` (= story ceiling height):

- Studs: `ceil(L*12 / spacing) + 1`; add corner adders, T-intersection adders, and
  opening king/jack studs (from openings).
- Plates: `3 × L` LF in matching stud size; bottom plate on exterior/slab =
  pressure-treated.
- Sheathing (exterior only): `L*H ÷ 32` sheets (4×8) + waste.
- Drywall: interior partition = **both** faces; exterior = interior face only.
  `area ÷ sheetArea` + waste.
- Insulation (exterior): `L*H`, R-value by assembly (Class-B setting).
- Convert LF → **pieces** using stock lengths (Class B).

**Walls — CMU (8"):** blocks ≈ `1.125 × faceArea(L*H)`; mortar, rebar, grout for
filled cells as separate lines. Its own branch, not a tweak.

**Corners:** cluster wall endpoints within snap tolerance → junctions with ≥2
ends. Corner bead LF = `outsideCorners × H`; inside corners → tape.
Convex/concave classification is **best-effort and user-correctable**; report the
junction count confidently even if classification is uncertain.

**Openings (per door/window):** removes wall area in the hole; adds: header
(length ≈ `width + ~7"` bearing, ply count a Class-B setting — **member size
deferred to the Engineering Tool**), 2 king + 2 jack studs, cripples
`ceil(width / spacing)` above (and below for windows), rough sill (windows),
casing (3 sides doors / 4 windows). The unit itself comes from the schedule
count. Requires `roughHeight`.

**Flooring (per polygon):** `polygonArea × (1 + wastePct[pattern])` → boxes/units.
Tile adds thinset (bags/area) + grout. Carpet: note 12'-roll behavior. Floating
floors add underlayment. Transition strips = LF of shared edges between differing
patterns. Baseboard = `polygonPerimeter` (minus door openings) LF.

**Structure:** subfloor sheathing = `floorArea ÷ 32` + waste. Stair stringers =
2–3 (3 if width>36") × `hypot(totalRun,totalRise)`. Joists only with Class-A
inputs. Header *sizing* and joist *adequacy* → Engineering Tool.

**Stairs:** treads `N`, risers `N+1`, stringers (above), handrail = run length,
balusters ≈ 1/tread, newels.

**Cabinets:** polyline length → LF; countertop SF = `LF × depth`; backsplash =
`LF × height` (height a setting).

**Appliances/fixtures:** count + schedule, grouped by `kind` with dimensions
(reuse `collectScheduleData` pattern). No rough-ins (MEP deferred).

**Paint (optional finish — confirm):** wall + ceiling area ÷ coverage × coats (all
Class B).

## 8. Output

- **New Plan-mode sheet type `"estimate"`** wired into `renderPlanView()`
  dispatch, rendered with `drawTableContent`/`drawScheduleTable`. Sections:
  Framing, Sheathing, Drywall, Insulation, Finishes (corner bead / baseboard /
  casing / paint), Flooring, Structure, Stairs, Cabinets, plus the Door/Window and
  Fixture **schedules**. Print the Class-B settings + Class-C conventions used.
  Subtotal by story.
- **A prominent "Missing inputs" block** when the completeness check finds Class-A
  gaps (list the offending stories / walls / openings; ideally clickable to jump
  to them). Complete items still estimate; incomplete items are listed, never
  guessed.
- **CSV export** of every line item (`category, story, item, qty, unit,
  basis/notes`). Add an action (Plan sidebar button + File menu), mirroring the
  PDF export entry points.

## 9. Gating (paid add-on)

Add a **new entitlement product** (e.g. `product_id='estimator'`) checked
alongside `base` in `js/auth.js`, setting a flag like `state.hasEstimator`. Gate
the Estimate sheet + CSV on it. Client-side gating is intentionally bypassable
here (same philosophy as the export watermark) — coordinate the Supabase side
(new product row) separately.

## 10. Suggested files

- `js/estimate.js` — pure calc (`state → estimate`), completeness check, CSV
  serialization.
- `js/render/estimate-sheet.js` — sheet renderer.
- Modify: `js/geometry.js` (area/perimeter), `js/layers.js` (story ceiling-height
  UI), `js/modals.js` (opening height + wall-assembly UI), `js/plan-view.js`
  (sheet type + sidebar action), `js/file.js` (persist new fields/settings; CSV
  download), `js/auth.js` (entitlement), `index.html` (`<script>` tags in correct
  order), `styles.css`.

## 11. Testing

`node --check` each touched file. Manually build a test plan covering: each wall
assembly (incl. CMU + a custom/0 wall to trigger the gap flag), doors/windows with
and without heights set, a floor of each pattern, stairs, cabinets, fixtures, and
**two stories**. Verify quantities by hand, the CSV, gating on/off, and that
missing heights produce the "Missing inputs" block rather than silent numbers.

## 12. Open decisions to confirm before building

Resolved already: editable Class-B defaults are fine; header member sizing and
joist adequacy move to the Engineering Tool; the estimator counts joists only when
the user supplies inputs.

Still open:

1. **Completeness gate strictness:** estimate-what's-complete + list gaps
   (recommended) vs. block the whole estimate until every Class-A input is filled.
2. **Inside/outside corner rigor:** acceptable to ship best-effort classification +
   user override?
3. **Settings scope:** save estimate settings in the `.dstudio.json` (recommended,
   for reproducible estimates) — confirm.
4. **New entitlement `product_id`** name + Supabase setup owner; own product or
   bundled with the Engineering Tool?
5. **Paint:** include in v1 finishes or drop?
