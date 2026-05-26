# Engineering Tool — Specification & Build Brief

**Status:** Spec locked, not yet implemented. Build on a clone / feature branch.

A guided, multi-step structural sanity-checker that reads a drawing plus
user-declared structural intent and reports, element by element, whether each
member **falls within IRC prescriptive tables or outside them**. It exists to
catch *impossible-to-build* designs early — never to approve a design.

Pairs with [materials-estimator.md](materials-estimator.md): this tool reuses the
estimator's structural-input model and resolves the header / joist sizing the
estimator defers.

---

# PART A — Specification

## A1. Purpose & one-line definition

A guided, multi-step structural sanity-checker. The only verdicts it issues are
**within table**, **outside table → consult a licensed engineer**, or **needs
more info**.

## A2. Inviolable behavioral rules

1. **Never says "ok," "safe," "sound," or "approved."** Scrub approval language
   from the entire surface, including tooltips and CSV.
2. **Prescriptive IRC only, US, one pinned edition.** Anything outside the
   prescriptive tables is a **referral to a PE/SE**, not a calculation the tool
   attempts. No engineered beam/column analysis.
3. **Multi-step, user-correctable.** Every value the tool derives (spans,
   tributary widths, candidate supports) is shown and editable at its step. The
   user advances by confirming or correcting — the tool never proceeds on a silent
   inference.
4. **No auto-detection of structure.** The user **declares** bearing walls, beams,
   posts, and framing direction. The tool checks the *consistency and continuity*
   of what the user declared; it does not guess what's structural.
5. **Gravity only (v1).** No lateral system — no wind, seismic, or braced-wall
   (IRC R602.10) checks. Snow is in (a vertical roof load); wind/seismic are out.

## A3. Strategic-timing guidance

Most useful **after** there's enough to reason about (walls + floors + at least
rough framing intent across the stories) but **before** the design is heavily
detailed. The product should:

- Offer a soft, dismissible nudge once a drawing crosses a completeness threshold
  (e.g. ≥2 stories, or a wall/floor count): *"Want to sanity-check your structure
  before you go further?"*
- Frame it in onboarding/help as a **mid-build checkpoint**, not a final step.
- Never block drawing or force the wizard.

## A4. Conceptual model: a declared, top-down gravity load path

Gravity flows roof → bearing walls → floor → bearing walls → foundation → soil.
The tool walks this **top-down**, story by story, using the user's declarations to
compute tributary loads and verify each load has a continuous path to the ground.
The hard problem (load-path topology) is tractable precisely because the **user
declares the structure** rather than the tool inferring it.

## A5. The multi-step flow (wizard)

Each step: the tool presents current understanding + a canvas overlay, the user
confirms/edits, unresolved required gaps are flagged before advancing.

1. **Basis & disclaimer** — confirm IRC edition (pinned, US), project location,
   occupancy/use. Acknowledge the "not an engineering approval" disclaimer.
2. **Design loads** — roof (dead + ground snow), floor (live by occupancy: 40 psf
   living / 30 sleeping, + dead). Pre-seeded from edition + location, fully
   editable. Snow is user-entered (no embedded snow map in v1).
3. **Framing, per level (roof down)** — for each floor/roof: joist/rafter
   **direction**, **size, species, grade, spacing**. (Same structural-input model
   the Materials Estimator introduces.)
4. **Declare bearing walls, per level** — user selects which walls are bearing.
   The only assist allowed is a *passive* visual hint (joist-direction arrows so
   the user can see which walls run perpendicular to the span) — selection is
   entirely the user's.
5. **Declare beams, posts, point loads** — where a bearing wall or load lands over
   open space, the user places the beam + posts that carry it. The tool flags
   continuity gaps here but the user supplies the fix.
6. **Openings in bearing walls → headers** — for each opening in a declared
   bearing wall, the tool computes tributary load and **sizes the header from the
   IRC table** (or flags off-table). This resolves the item the estimator defers.
7. **Foundation** (later phase) — bearing/point loads to footing widths vs. soil
   bearing.
8. **Review** — run all checks, produce the report (A7), with disclaimers and the
   strategic-timing reminder.

## A6. The checks (gravity, prescriptive)

Driven entirely by user declarations:

- **Tributary load** — from declared bearing lines + framing direction + spans,
  compute tributary width per bearing wall/beam/header, **stacked across all
  stories above**.
- **Joist/rafter span** — actual clear span (between declared supports) vs. IRC
  allowable span table (size/species/grade/spacing/load) → within / outside.
- **Header sizing** — tributary load over opening → IRC header table (R602.7) →
  required size; off-table → referral.
- **Girder/beam sizing** — declared beams vs. IRC girder/beam tables → size or
  referral.
- **Load-path continuity / stacking (flagship)** — every declared bearing wall,
  beam reaction, and post must land on a declared support continuing to the
  foundation. A bearing element over open span with nothing declared beneath →
  **ERROR: no support below; not buildable as drawn.** Checks continuity of
  *declarations*, not guesses.
- **Bearing minimums** — posts on beams/footings, beams on posts/walls, min
  bearing length (e.g. 1.5").

## A7. Outputs

- **Results report** — per element: *within table* / *outside table — consult
  engineer* / *needs info*. Each item clickable to highlight on canvas, with the
  governing **IRC section reference** and plain-English reason. No pass/safe
  language.
- **Structural overlay** — joist-direction arrows, declared bearing walls colored,
  beams/posts, annotated spans, continuity gaps in red.
- **Header/beam sizes written back** to the model so the Materials Estimator's
  deferred sizes become real (recommended — confirm in B8).
- **Deliverables (later phase)** — structural framing-plan sheet, header/beam
  schedule, structural notes, via the existing plan-sheet system.
- **Persistence** — all structural inputs saved in the `.dstudio.json`, shared
  with the estimator.

## A8. Honest limits (must be visible in-product)

- A 2D plan lacks section/vertical info; the tool relies on user declarations and
  asks for what it can't see (esp. roof framing).
- IRC edition pinned; **local amendments not covered**; US only.
- Gravity only — explicitly not a lateral/seismic/wind check.
- Prescriptive only — anything off-table is a referral, not a result.
- Never an approval or substitute for a licensed engineer; disclaim throughout.

## A9. Phasing

- **E-P1:** structural-input model + wizard skeleton + **span checks + header/beam
  sizing** (table lookups). High value, low risk; finishes the estimator's
  deferred headers.
- **E-P2:** **load-path continuity + beams/posts + multi-story tributary stacking**
  (the buildability core).
- **E-P3:** foundation/footings; framing-plan sheet + schedules.
- **Future (out of scope now):** lateral/bracing, seismic/wind, metric/other
  codes, true engineered calcs.

---

# PART B — Building-Agent Instructions

## B0. How to work

Large, multi-phase feature. **Plan first, build second.** Produce an
implementation plan (files, data-model changes, sequencing) and confirm the open
decisions (B8) **before** coding. Work on a clone / feature branch, commit
incrementally, validate with `node --check` + manual browser testing. Build
**E-P1 only** unless told otherwise. Do not start coding until the plan is
reviewed.

## B1. Read first

- `README.md` (esp. "For developers").
- **[materials-estimator.md](materials-estimator.md)** — this tool **shares its
  structural-input model and plan-sheet output**. Coordinate; do not duplicate.
  The estimator defers header sizing and joist sizing to *this* tool.

## B2. Hard constraints (unchanged from the rest of the app)

- Vanilla HTML/CSS/JS. **No build step, no npm, no ES modules, no bundler. Runs
  from `file://`.**
- Classic `<script>` files in dependency order via `index.html`; top-level decls
  share one scope.
- Shapes dispatch through the **`SHAPES` registry** (`js/shapes.js`) — don't add
  `if (sh.type===…)` at dispatch sites.
- Feet internally; `formatFeet`/`parseFeet`; respect `state.units`.
- Iterate with `forEachShape()` (`js/layers.js`).

## B3. The five behavioral rules (from A2) are acceptance criteria

No "ok/safe/approved" anywhere; prescriptive-IRC-US-one-edition only; multi-step +
every inference user-editable; **user declares structure (no auto-detect)**;
gravity only. A reviewer should be able to fail the PR on any violation.

## B4. New data model

- **Loads** — project-level: IRC edition, location, occupancy; per-level roof/floor
  load values (seeded, editable).
- **Framing (per level)** — joist/rafter direction, size, species, grade, spacing.
  *Shared with the estimator — design once.*
- **Bearing declarations** — a user-set `bearing` flag (per wall) + declared
  **beams** and **posts** as structural shapes (new `SHAPES` entries, or
  attributes — agent to propose).
- **Headers** — computed size written back onto the door/window (feeds estimator)
  — confirm B8.
- **IRC table data** — embed as `js/irc-tables.js`: span tables, header/girder
  tables for the pinned edition. Data only; verify values against the actual
  edition.

## B5. Engine (pure functions)

Implement as **pure functions: `(state, structuralInputs) → results`**, so the
wizard, overlay, write-back, and report all consume one structure. Cover:
tributary/stacking, joist/rafter span lookup, header & girder sizing, load-path
continuity, bearing minimums (A6). Verdicts strictly *within / outside /
needs-info*.

## B6. UI surfaces

- **Wizard modal** (multi-step, A5) — the primary surface; each step renders a
  canvas overlay and editable fields.
- **Structural overlay renderer** (`js/render/structural-overlay.js`) — arrows,
  bearing colors, beams/posts, spans, red continuity gaps.
- **Results report** — clickable items, IRC refs, severities.
- **Strategic-timing nudge** — soft, dismissible (A3).
- **Gating** — paid add-on; mirror the `auth.js` entitlement pattern (own
  `product_id`, or bundled with the estimator — confirm B8).

## B7. Suggested files

- `js/engineering.js` — engine + wizard state machine.
- `js/irc-tables.js` — embedded prescriptive tables (pinned edition).
- `js/render/structural-overlay.js` — overlay.
- Modify: `js/modals.js` (wizard UI + bearing/beam/post entry), `js/shapes.js`
  (beam/post shape entries if used), `js/layers.js`/`js/state.js` (framing + load
  fields), `js/file.js` (persist + CSV of results), `js/plan-view.js`
  (framing-plan sheet — E-P3), `js/auth.js` (entitlement), `index.html`
  (`<script>` order), `styles.css`.
- **Write-back recommendation:** the tool should write computed header/beam sizes
  back to the model so the estimator's deferred quantities resolve — confirm before
  relying on it.

## B8. Open decisions to confirm before building

1. **IRC edition** to pin (e.g. 2021 vs. 2018).
2. **Roof handling:** model rafter framing fully, or treat the roof as a declared
   uniform load on top-story bearing lines for v1? (Latter is simpler; roofs add
   pitch/ridge complexity.)
3. **Snow load:** user-entered ground snow (recommended — no reliable embedded map)
   vs. lookup.
4. **Bearing-wall assist:** is the *passive* joist-direction visual hint
   acceptable, or pure manual selection with no hint at all?
5. **Entitlement:** own `product_id` or bundled with the estimator add-on?
6. **Header write-back:** size-and-write-back to the model (recommended), or
   report-only?
7. **Species/grade:** one project default vs. per-member.
8. **Nudge trigger:** what completeness threshold fires the "run me now" prompt?

## B9. Testing

`node --check` each file. Manually build a two-story plan with declared bearing
walls, a beam + posts, openings in bearing walls, and at least one **intentional
continuity gap** (bearing wall over open span, no beam) and one **over-span
joist** — verify the report flags them as *outside table / not buildable* (never
"ok"), the overlay marks them red, header sizes compute and (if enabled) write
back, and the CSV carries no approval language.
