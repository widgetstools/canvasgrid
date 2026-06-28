# Cycle 26 — 1.0 release — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 26
**FM coverage:** All remaining ⚠️ / ❌ rows audited and resolved
**Depends on:** Cycle 25 (perf budgets locked)

---

## Mental model: 1.0 is a quality + paperwork cycle, not a feature cycle

By Cycle 25, every feature is built, every perf budget hits target,
every a11y check passes. Cycle 26 ships THE PACKAGE: the bundle,
the docs site, the migration guide, the npm publish.

This cycle has NO new runtime code paths. Every commit is one of:
docs, bundle, FM verification, CHANGELOG, release tagging.

---

## Task 1 — Tree-shake + bundle audit

**Goal:** Confirm bundle size targets.

| Bundle | Target | Mechanism |
|---|---|---|
| `cgrid` core (gz) | < 150 KB | Tree-shaking via Vite + `sideEffects: false` |
| `cgrid` worker (gz) | < 80 KB | Worker built separately, lazy-loaded |
| `cgrid-react` adapter (gz) | < 5 KB | Out-of-scope per master plan ("framework adapters left to consuming apps") |

**Audit checklist:**

- Run `npx vite build --analyze`; inspect bundle composition.
- Identify dead modules; remove imports.
- Tighten side-effect annotations in `cgrid/package.json`.
- Confirm no AG Charts / no enterprise-only deps shipped.
- Run `npm pack`; inspect tarball contents — only `dist/` +
  `package.json` + LICENSE + README.

**Files:** `cgrid/package.json` (side-effects), `cgrid/vite.config.ts`,
`cgrid/.npmignore`.

---

## Task 2 — API reference site

**Goal:** TypeDoc generates a static site under `docs/api/`.

**Site structure:**

```
docs/api/
├── index.html       (overview)
├── classes/
│   ├── CGrid.html
│   └── CGridApi.html
├── interfaces/
│   ├── CGridOptions.html
│   ├── CColDef.html
│   └── ... (per public type)
├── modules/         (worker protocol types)
└── search.json
```

**Files:** `typedoc.json` (config), `docs/api/*` (generated, NOT
committed but built in CI for GitHub Pages).

**Custom TypeDoc plugin:** A small plugin that auto-links each type
to its FM row in `docs/catalog/FEATURE_MATRIX.md`, so readers can
click from `CGridOptions.rowGroupCols` → "Area 09 row #N".

---

## Task 3 — Migration guide (AG Grid → cgrid)

**Goal:** `docs/MIGRATING.md` walks ag-grid users through the rename
cheatsheet, the breaking-shape examples, the perf gains.

**Structure:**

1. **Why migrate** — Perf benchmarks, bundle size, single-tier OSS.
2. **API rename cheatsheet** — One table mapping every ag-grid type /
   option / event / method to its cgrid equivalent.
   - `ColDef` → `CColDef`
   - `GridOptions` → `CGridOptions`
   - `'agTextCellEditor'` → `'text'`
   - `RowNode` → `node`  
   - … etc.
3. **Breaking shape differences:**
   - cgrid's chunk format is not exposed (apps don't depend on
     internal data shape; ag-grid users sometimes do).
   - cgrid has no framework adapters (use the public surface from
     vanilla JS / your framework's native pattern).
   - cgrid has no module gates / license keys.
4. **Migration recipes** — Side-by-side ag-grid → cgrid for 10
   common app patterns: simple grid, grouped + aggregated, master-detail,
   server-side, custom cell renderer, etc.
5. **Performance gains** — Reproducible benchmarks; "what to expect"
   on your dataset size.

---

## Task 4 — FM verification sweep

**Goal:** Every row in `docs/catalog/FEATURE_MATRIX.md` updated to
✅ / ⚠️ / ❌ with current status; every ❌ has a documented rationale.

**Process:**

1. For each Area, walk every row.
2. Confirm ✅ rows by E2E / unit / manual test.
3. Walk ⚠️ rows: either flip to ✅ (test + fix) or to ❌ with
   "deliberately omitted because …" reason.
4. Walk ❌ rows: confirm rationale is current; update if the
   landscape changed.

**Files:** `docs/catalog/FEATURE_MATRIX.md` (mass update).

---

## Task 5 — Cookbook docs

**Goal:** `docs/cookbook/` with 20+ task-recipe examples. Each
recipe is a 1–2 page markdown with copy-pastable code.

**Recipe topics:**

| # | Title |
|---|---|
| 1 | "Hello grid" — minimal mount |
| 2 | Custom cell renderer |
| 3 | Custom cell editor |
| 4 | Custom aggregation function |
| 5 | Custom group cell renderer |
| 6 | Master/Detail with nested grid |
| 7 | Pivoting recipes |
| 8 | Server-side row model with REST datasource |
| 9 | Server-side row model with GraphQL |
| 10 | Server-side row model with WebSocket streaming |
| 11 | Tree data from a path callback |
| 12 | Custom theming (recipe per density) |
| 13 | Save / restore state to localStorage |
| 14 | React integration |
| 15 | Vue integration |
| 16 | Svelte integration |
| 17 | Solid integration |
| 18 | Vanilla TS in a webcomponent (shadow root) |
| 19 | Custom context menu |
| 20 | Custom status bar panel |
| 21 | Custom tool panel |
| 22 | High-frequency cell streaming (50k updates/sec demo) |
| 23 | Sparkline column with custom variant |
| 24 | Range chart integration |
| 25 | Excel export with custom styles |

**Files:** `docs/cookbook/*.md` (new directory).

---

## Task 6 — CHANGELOG.md

**Goal:** Full release notes 0.x → 1.0. Group by cycle.

**Sections:**

```markdown
# Changelog

## 1.0.0 — 2026-XX-XX

### Added (full feature set)
… organized by cycle (Cycle 4–25 each get a sub-section)

### Performance
… reproducible benchmarks linked

### Breaking changes from 0.x
… anything renamed during 0.x → 1.0

### Migration
See docs/MIGRATING.md
```

**File:** `cgrid/CHANGELOG.md`.

---

## Task 7 — npm publish dry-run

**Goal:** Verify package contents before real publish.

**Checklist:**

- `npm publish --dry-run` outputs a clean tarball.
- LICENSE included (MIT or Apache 2 — confirm with project owner).
- README.md is the npm-displayed README (not a stub).
- `package.json` has correct `main`, `module`, `types`, `exports`.
- `dist/` is up-to-date.
- No `src/` shipped (only `dist/`).
- No `.test.ts` files in tarball.
- Bundle size confirmed under target.

**File:** `cgrid/package.json`, `cgrid/LICENSE`.

---

## Task 8 — npm publish 1.0.0

**Goal:** Final publish.

**Steps:**

1. Bump version in `package.json` to `1.0.0`.
2. `git tag v1.0.0` + push tag.
3. `npm publish --access public`.
4. GitHub release: paste CHANGELOG section + perf comparison
   highlights; attach bundle artifacts (cgrid.min.js,
   cgrid-worker.min.js).
5. Announce: post to project's announcement channels.

---

## Exit criteria recap

- cgrid 1.0.0 on npm.
- Docs site live (TypeDoc API + cookbook + migration guide).
- `FEATURE_MATRIX.md` 100 % accounted for (every row ✅ / ⚠️ / ❌
  with rationale).
- Perf budgets documented in `docs/PERFORMANCE.md` with reproducible
  benchmarks.
- All Cycle 24 a11y gates green.
- All Cycle 25 perf gates green.
- Migration guide reviewed by ≥ 1 ag-grid practitioner.
- Public announcement posted.
