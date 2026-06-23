# AG Grid Feature Catalog

Granular reference for AG Grid 35.3.1 (Community + Enterprise), produced as input
to the canvas-based grid port described in `docs/superpowers/specs/2026-06-22-ag-grid-feature-catalog-design.md`.

## Navigation

- `FEATURE_MATRIX.md` — one row per feature; the entry point for "does AG Grid have X?".
- `01-grid-options.md` through `26-performance-knobs.md` — per-area deep dives. Each
  follows the same skeleton: Concept → Configuration surface → API methods → Events →
  Behaviors → Look & feel → Canvas-port implications.
- `screenshots/` — PNGs named `<area>-<feature>-<state>.png`, referenced from the
  Look & feel section of each area file.
- `v36-deltas.md` — notable behaviors that differ between 35.3.1 (this catalog) and
  the latest stable AG Grid release at the time of writing.

## Updating

- The catalog is a snapshot. The bottom row of `FEATURE_MATRIX.md` records the
  `Last verified` date; bump it when re-running the catalog production plan.
- Sources of truth, in priority order: installed `node_modules/ag-grid-*` types,
  AG Grid docs (via Context7), live behavior in the showcase app. Conflicts get an
  explicit note in the affected area file.
- New areas insert with a decimal suffix (e.g. `08a-quick-filter.md`) rather than
  renumbering.
