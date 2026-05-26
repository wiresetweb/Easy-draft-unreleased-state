# Feature planning docs

Specifications for two planned, not-yet-built features. Both are intended to be
implemented on a clone / feature branch, **plan-first** (produce an
implementation plan and confirm the open decisions before writing code).

| Doc | Feature | Status |
|-----|---------|--------|
| [materials-estimator.md](materials-estimator.md) | Materials Estimator — reads the drawing and produces a quantities-only bill of materials | Spec locked; not built |
| [engineering-tool.md](engineering-tool.md) | Engineering Tool — guided, multi-step IRC prescriptive structural sanity-checker | Spec locked; not built |

The two are a matched set: the Engineering Tool reuses the **structural-input
model** the Materials Estimator introduces, and it resolves the header/joist
sizing the estimator intentionally defers. Read the estimator spec first.
