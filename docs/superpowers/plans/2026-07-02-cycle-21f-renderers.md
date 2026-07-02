# Cycle 21f — `@cgrid/renderers` (40 Rich Blotter Cell Renderers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all 40 catalog renderers as pure `CellPainter` registry clients — numeric/text/indicator/badge/bar/chart/composite/action — plus the ColumnStats + TickHistory main-side helpers, the `wireRenderersIntoKernel` bridge with typed ColDef builders, showcase demos, and E2E. Architecture: [design spec](../specs/2026-07-02-cycle-21f-renderers-design.md). Visual contracts: [renderer catalog](2026-07-01-canvasgrid-cell-renderer-catalog.md) — task briefs quote catalog rows VERBATIM; the catalog is the acceptance spec per renderer.

**Tech Stack:** TypeScript 5.9 strict, Vitest 2.1 (fake-gc draw-sequence harness), turborepo, Playwright.

## Global Constraints

- **ZERO KERNEL CHANGES.** `git diff main...HEAD -- packages/kernel` must be EMPTY at every task's end. A task that believes it needs a kernel change reports BLOCKED — coordinator decision, never a patch. Same for packages/{expression,format,rules,calc} (renderers imports format as a dep but does not modify it).
- **No feature deferral:** all 40 catalog renderers land (kernel's 5 existing sparklines are re-exported, not reimplemented — that's reuse, not deferral). The only reserves: worker-side windowed aggregates / calc-cache-fed stats (21d follow-up; main-side helpers ship instead) and 'visible'-scope ColumnStats (documented limitation).
- **Painter discipline (spec §2.2):** stateless painters; zero per-paint allocation beyond existing painter precedent (module-scope scratch); theme-aware colors via palette.ts only (no inline hex outside palette/tests); `p.params` typed per types.ts; fake-gc tests assert draw sequences.
- **Threading contract (spec §2.3):** multi-field renderers ride the minimal-composite-program threading proven in Task 3 — no other rowData channel exists.
- **Vocabulary/serialization:** `colId` never `columnId`; Date-free in src (injectable now; painters read `nowMs` from params); no raw NUL bytes; expression grammar facts where DSL appears (&&/||, ==/!=).
- **Baselines (main @ `b055115`, 2026-07-02):** kernel 2568, calc 215, rules 144, format 171, expression 185, showcase E2E 131, typecheck 21/21, build 13/13.
- **One PR**, branch `cycle21f/renderers`. Split-if-oversized (~500 LOC / ~150 test lines).
- Known env facts: kernel tests happy-dom; CPU-flaky perf tests protocol (standalone re-run); showcase dev server manual on :5185; showcase sources are TypeScript (`.js` files are emit stragglers — if Vite resolves a stale `.js` over a new `.ts`, delete the straggler from disk, never commit it).

## Preconditions (verified 2026-07-02)

- 21d merged (PR #96, main @ `b055115`); 21e merged (PR #95). Working tree: user's uncommitted dark-theme edits present (tokens.css/theming.test.ts/cycle4.spec.ts/positions snapshots) — DO NOT touch, commit, stash, or reset them; they are the user's.
- `packages/renderers/` scaffold: package.json (deps kernel+expression+format+calc+rules per 21a — Task 1 corrects to: dep format only, peer kernel; expression/calc/rules removed per spec §2.1), tsconfig, `src/index.ts` = `export {};`.
- Kernel surfaces (all landed, verified): `registerCellRenderer(name, painter)` + `CellPaintConfig` (params/rowData/colId/rowId/themeKind/flashAlpha/flashFromColor/ruleIndicator/content/decorators/padding), icon registry (Lucide bundle via format bridge; `resolveIcon`), sparkline family (`sparkline/{index,line,column,area,bar,pie}`), `rowsChanged`/`cellValueChanged` events, `forEachRow`, `getThemeKind`, `flashCells` overrides, `cellClicked` event (verify exact name at Task 12), context-menu surface (verify public API at Task 12).

## File Structure Overview

Per spec §2.1: `packages/renderers/src/{types,paintUtils,palette,numeric,text,indicators,badges,bars,charts,composite,actions,columnStats,tickHistory,bridge,index}.ts` + `vitest.config.ts` + `tests/**` (mirrors src; `tests/helpers/fakeGc.ts` shared harness) + `README.md`.
Showcase (Task 14): `apps/cgrid-showcase/src/features/{rendererBlotter,rendererCharts}.ts` + registration + package.json dep + `e2e/{rendererBlotter,rendererCharts}.spec.ts`.

---

## Phase A — scaffold + shared types (1 task)

### Task 1: Feature branch + package scaffold + param types + name table + skeletons

**Files:** Modify `packages/renderers/package.json` (deps: `"@cgrid/format": "*"` ONLY; peer `"@cgrid/kernel": "*"`; devDeps mirror packages/calc incl. coverage-v8; remove expression/calc/rules deps); Create `vitest.config.ts` (mirror packages/calc); Create `src/types.ts` — the canonical renderer NAME TABLE (`RENDERER_NAMES` const: all 46 canonical strings per spec §2.5 (the "40" in cycle titles is a stale headline count — the catalog enumerates 46 new implementations; 49 rows minus the 3 kernel-shipped sparkline rows), e.g. 'number','price','price-direction','pnl','delta','bps','pct-change','fractional-price','abbreviated-number','ticker','currency-pair','timestamp','age','relative-time','status-dot','quote-quality-dot','stale-flag','direction-arrow','structure-icon-strip','traffic-light','status-pill','rating-badge','rating-cluster','tag','venue-chip','side-chip','tif-pill','progress-bar','range-bar','bidirectional-bar','heat','gauge','spread-bar','volume-bar','maturity-ladder','win-loss-sparkline','yield-curve-sparkline','krd-bar-chart','depth-ladder','stacked-value','price-quote','nbbo','benchmark-spread','price-change-composite','icon-action-cluster','row-menu' — plus the 5 kernel re-export names 'line-sparkline','column-sparkline','area-sparkline','bar-sparkline','pie-sparkline') + EVERY params interface per catalog rows (each interface documented with its catalog row reference; field-mapping params for multi-field renderers; shared `SemanticColorMap`, `NowMsParam`); Create module skeletons (paintUtils/palette/category files/columnStats/tickHistory/bridge — final signatures, not-yet-implemented throws; palette exports typed CONST maps as real data where the catalog fixes them: status pill map, RAG, rating scale bands, default venue palette, structure glyph map per spec §2.6.6); Overwrite `src/index.ts` (full re-export surface); Test `tests/types.test.ts` (name table count === 51 — 46 implementations + 5 kernel re-exports; uniqueness, structuredClone-safety of palette maps).

**Steps:** branch `cycle21f/renderers` off main → manifest+config → types.ts → palette data + skeletons → index → test+tsc → commit `feat(renderers): cycle 21f task 1 — scaffold, param types, name table, palette data`.

---

## Phase B — shared paint infrastructure + data helpers (3 tasks)

### Task 2: paintUtils + palette implementation + fake-gc test harness

**Files:** Create `packages/renderers/tests/helpers/fakeGc.ts` — shared fake `CanvasRenderingContext2D` harness, modeled on `packages/kernel/tests/compositeRenderer.test.ts`'s inline `makeGc()` (fillRect/strokeRect/fillText/beginPath/arc/fill/stroke/moveTo/lineTo/save/restore/rect/clip/measureText/translate/scale as `vi.fn()`, `cache` Proxy get/set precedent for style-property writes, `measureText` deterministic at 7px/char) EXTENDED with a unified `calls: Array<{ op: string; args: unknown[] }>` log so cross-method draw ORDER is assertable in one array (not per-mock `invocationCallOrder`): every drawing-op mock (`beginPath`,`closePath`,`moveTo`,`lineTo`,`arcTo`,`arc`,`quadraticCurveTo`,`bezierCurveTo`,`fill`,`stroke`,`fillRect`,`strokeRect`,`fillText`,`strokeText`,`rect`,`clip`,`translate`,`scale`,`setLineDash`) pushes `{op,args}`; the `cache` Proxy's `set` trap ALSO pushes `{op: 'set:'+prop, args:[value]}` for `fillStyle`/`strokeStyle`/`font`/`textAlign`/`textBaseline`/`globalAlpha`/`lineWidth` (mirrors real paint sequencing: color set immediately precedes the draw it colors). `measureText` and property READS are excluded from `calls`. Export `makeFakeGc(overrides?: Partial<CanvasRenderingContext2D>): FakeGc` and `type FakeGc = CachedContext2D & { calls: Array<{ op: string; args: unknown[] }> }` (import `CachedContext2D` type-only from `../../../kernel/src/renderer/gc`, same deep-import precedent as compositeRenderer.test.ts). Create `packages/renderers/src/paintUtils.ts` exporting: `withAlpha(hex: string, alpha: number): string` (returns `rgba(r,g,b,alpha)`; consolidates the duplicated per-file helper at `packages/kernel/src/renderer/cellRenderers/sparkline/{areaSparkline,pieSparkline}.ts`); `mixHex(a: string, b: string, t: number): string` (linear sRGB byte mix, clamped `t∈[0,1]`, returns `#rrggbb`); `labInterpolate(a: string, b: string, t: number, curve?: 'lab' | 'linear'): string` (default `'lab'`: sRGB→CIE-Lab (D65, standard piecewise gamma + `f(t)` cube-root/linear branch at `(6/29)^3`) → lerp L*a*b* → Lab→sRGB; `curve:'linear'` lerps sRGB bytes directly, no Lab roundtrip — this is spec §2.6.2's HeatCell curve opt-out); `pill(gc, x, y, w, h, radius, fill, border?): void` (manual rounded-rect path via `beginPath`→4×`arcTo` corners→`closePath`→`fill()`, then `stroke()` iff `border` set — no dependency on `CanvasRenderingContext2D.roundRect`, which the fake-gc harness does not implement, matching existing sparkline-file precedent of hand-built paths); `dot(gc, cx, cy, r, color): void` (`beginPath`→`arc(cx,cy,r,0,2π)`→`fill()`); `miniBar(gc, x, y, w, h, frac, fillColor, trackColor?): void` (optional full-width track `fillRect` first, then fill `fillRect` sized `w*clamp(frac,0,1)`); `fragText(gc, text, x, y, opts?: { font?: string; color?: string; align?: CanvasTextAlign; maxWidth?: number }): void` (sets font/fillStyle/textAlign then `fillText`; when `maxWidth` given and `gc.measureText(text).width` exceeds it, truncates character-by-character from the end and appends `…`, mirroring `packages/kernel/src/renderer/cellRenderers/composite.ts:106-145`'s ellipsis algorithm — cite it, don't reinvent the trim loop shape). Create `packages/renderers/src/palette.ts` ADDING (Task 1 already created the file with catalog-fixed CONST data maps) the theme-aware FUNCTIONS: `resolveSemanticColors(): { positive: string; negative: string; warning: string; info: string; muted: string }` returning the catalog §1 fixed hex tokens verbatim — positive `#0aa063`, negative `#e63946`, warning `#f0b429`, info `#3b82f6`, muted a low-chroma gray CONST (same in light/dark — catalog does not differentiate by theme); `withThemeAlpha(alpha: number, themeKind: 'light' | 'dark'): number` — dark surfaces read lower-contrast at equal alpha, so dark multiplies by a fixed `1.4` factor clamped to `1` (document this as palette.ts's own testable design rule, not a catalog mandate); `resolvePillColors(status: string, themeKind: 'light'|'dark'): { bg: string; fg: string; border?: string }` built from Task 1's status-pill CONST map + `withAlpha`/`withThemeAlpha`. Tests: `tests/paintUtils.test.ts` — `withAlpha('#0aa063', 0.25)` → exact rgba string; `mixHex('#000000','#ffffff',0.5)` → `'#808080'` (128,128,128 — verified: linear byte average of 0 and 255 rounds to 128); `labInterpolate('#000000','#ffffff',0,'lab')` → `'#000000'` and `t=1` → `'#ffffff'` (endpoint exactness); `labInterpolate('#000000','#ffffff',0.5,'lab')` → `'#777777'` (119,119,119 — VERIFIED by direct CIE Lab computation: L*=50 gray converts to sRGB 119, not the naive 128, because sRGB gamma is non-linear w.r.t. L* — this is the concrete, checkable reason LAB beats linear mixing for HeatCell); `labInterpolate(...,0.5,'linear')` on the same pair → `'#808080'` (128 — proves the opt-out bypasses Lab entirely and matches `mixHex`); a monotonicity case on `labInterpolate('#e63946','#0aa063', t)` for `t=0,0.25,0.5,0.75,1` (no channel reverses direction); `pill()`/`dot()`/`miniBar()`/`fragText()` cases assert `gc.calls` sequences (op names + key args) for: normal pill with border, pill with `radius=0`, dot at r=0 edge case (still draws, no throw), miniBar at `frac=0` (no fill rect emitted, only track) and `frac>1` (clamped to full width), fragText truncation (`maxWidth` forces the `…`-suffixed shorter string passed to `fillText`) and non-truncation passthrough. Tests: `tests/palette.test.ts` — `resolveSemanticColors()` returns the 4 catalog hexes exactly; `withThemeAlpha(0.5,'dark')` → `0.7`, `withThemeAlpha(0.8,'dark')` → `1` (clamped), `withThemeAlpha(0.5,'light')` → `0.5` (pass-through); `resolvePillColors('WORKING','light')` vs `resolvePillColors('WORKING','dark')` differ only in alpha-derived `bg`, never in `fg` hue (dark-theme-variant case the Task brief calls for).

**Steps:** write `tests/helpers/fakeGc.ts` (harness, no assertions of its own) → write failing `tests/paintUtils.test.ts` + `tests/palette.test.ts` against not-yet-implemented functions → implement `src/paintUtils.ts` → implement `src/palette.ts` functions → tsc + renderers suite green → commit `feat(renderers): cycle 21f task 2 — paintUtils, palette, fake-gc harness`.

---

### Task 3: minimal-composite threading proof + ColumnStats

**Files:** (a) **Threading proof** — Modify `packages/renderers/tsconfig.json`: DROP the `"rootDir": "src"` key entirely (no replacement value, not even `"."`). VERIFIED by direct probe: `rootDir:"src"` fails `tsc` with TS6059 the moment `tests/**` exists at all (tests sit outside `src`); `rootDir:"."` (the calc/format precedent, wrong here) fails TS6059 on kernel's OWN internal imports once a test deep-imports `packages/kernel/src/core/propertyChain.ts` (it transitively imports `../types`, `../theming/cssReader`, etc., all outside `packages/renderers`); omitting `rootDir` lets tsc infer the common ancestor and compiles clean — confirmed zero errors in-repo before writing this task. Create `packages/renderers/tests/bridge/threading.test.ts` — the dedicated integration test proving spec §2.3's LOCKED design end-to-end using ONLY landed kernel mechanics, calling the kernel's resolve/paint pipeline directly (no CGrid instantiation needed — same pure-function style as `packages/kernel/tests/cellClassRules.test.ts`). Deep-imports (type + value, relative path from `tests/bridge/`): `resolveColDef`, `applyCellProps` (value) from `../../../kernel/src/core/propertyChain`; `CellPaintConfig` (type) from `../../../kernel/src/renderer/cellRenderers/registry`; `ResolvedTheme` (type) from `../../../kernel/src/theming/cssReader`; `FormatProgramShape` (type) from `../../../kernel/src/core/formatCompilerSlot`. Build a minimal synthetic-fragment `FormatProgramShape` stub: `{ formatText: () => '', resolveStyle: () => null, resolveIcon: () => null, resolveFragments: () => null, source: 'renderers-thread-stub', tiers: { tier0: false, tier1: false, tier2: true } }`. Test cases: (1) `resolveColDef({ field: 'summary', _compositeProgram: stub } as any)` (no explicit `cellRenderer` — cast needed since `_compositeProgram` is a `ResolvedColDef`-only field, not on the public `CColDef` input type) → `.cellRenderer === 'composite'` (VERIFIED fallback at `packages/kernel/src/core/propertyChain.ts:1109-1117`: `merged.cellRenderer ?? (_compositeProgram !== undefined ? 'composite' : null) ?? …`). (2) Same input PLUS explicit `cellRenderer: 'price'` → resolved `.cellRenderer === 'price'` — VERIFIED the explicit value wins via the first `??` operand, never reaching the composite fallback; this is the "explicit `cellRenderer` WINS" proof the plan header cites. (3) Feed case-2's resolved colDef into `applyCellProps(target, { theme: minimalTheme, colDef, value: null, valueFormatted: '', x:0,y:0,w:100,h:24, rowBg: theme.bg, prefillColor: theme.bg, isFocused:false, isSelected:false, isHovered:false, isHeader:false, rowData: { symbol:'AAPL', bid:100.1, ask:100.3 }, rowId: 'r1', themeKind: 'dark' })` on an empty `target: CellPaintConfig` → assert `target.rowData` deep-equals the fixture, `target.rowId === 'r1'`, `target.themeKind === 'dark'`, `target.compositeProgram === stub` — VERIFIED the threading gate at `propertyChain.ts` (`applyCellProps`, the `if (colDef._compositeProgram !== undefined && !ctx.isHeader)` block) keys ONLY on `_compositeProgram` presence, independent of which `cellRenderer` name won — i.e. a NATIVE painter (case 2's `'price'`) still receives full rowData/rowId/themeKind threading. (4) Register an inline test painter `{ paint(gc, p) { gc.fillText(String((p.rowData as { bid?: number } | undefined)?.bid ?? ''), 0, 0); } }`, call `.paint(makeFakeGc(), target)`, assert the fake gc's `calls` show `fillText` invoked with `'100.1'` — proves a real painter can read `p.rowData` end-to-end through the minimal-composite channel with zero kernel changes. `makeTheme()`/base-config helper mirrors `cellClassRules.test.ts`'s inline fixtures (copy the shape, don't import — that file isn't exported). (b) **ColumnStats** — Create `packages/renderers/tests/helpers/lcg.ts` (self-contained copy of `packages/calc/tests/helpers/lcg.ts`'s `makeLcg(seed): () => number` — renderers has no dep on calc, per §2.1; same algorithm, own file). Create `packages/renderers/src/columnStats.ts` per spec §2.4a: `export interface ColumnStatSnapshot { min: number | null; max: number | null; maxAbs: number | null; sum: number | null; count: number }`; `export class ColumnStats<TRow = unknown> { constructor(grid: CGridApi<TRow>, colIds: string[], opts?: { valueGetter?: (row: TRow, colId: string) => unknown }); for(colId: string): Readonly<ColumnStatSnapshot>; destroy(): void; }` (`CGridApi` type-only import from `@cgrid/kernel`, erased — peerDep per Task 1). Internals per-column: a `sum`/`count` accumulator PLUS three lazy-delete min-heaps (min, max-via-negation, maxAbs-via-negated-abs) — REUSE the exact heap+live-count-map algorithm at `packages/calc/src/aggregates/basic.ts:100-181` (`makeMin`/`makeMax`: binary min-heap of stored values + `live: Map<number,count>` for O(1) `removeRow` and amortized-O(log n) `finalize` via lazy pop of dead heap-tops) reimplemented locally — do not import from `@cgrid/calc` (not a dependency this cycle). Default `valueGetter` reads `(row as Record<string, unknown>)[colId]`; non-number/non-finite values are skipped (participation rule identical to the calc precedent). Constructor seeds via `grid.forEachRow((rowId, row) => { for (const colId of colIds) addRow(colId, valueGetter(row, colId)); })`, then subscribes `grid.addEventListener('rowsChanged', handler)` where `handler` applies `added`→addRow, `updated`→(removeRow(oldRow value) then addRow(newRow value)), `removed`→removeRow per watched colId (event shape VERIFIED at `packages/kernel/src/types/event.ts` lines ~103-138: `{ added: {rowId,row}[]; updated: {rowId,row,oldRow}[]; removed: {rowId,row}[] }`); `destroy()` calls `grid.removeEventListener('rowsChanged', handler)` (both methods VERIFIED on `CGridApi` at `packages/kernel/src/types/api.ts:425,428,502,507` — `forEachRow`, `getThemeKind`, `addEventListener`, `removeEventListener`). `for(colId)` is O(1) — returns the live accumulator record directly (no recompute), so a bridge painter closure can call it every repaint at zero cost. Tests: `tests/columnStats.test.ts` — seed 5 rows `pnl=[10,-5,20,-30,15]` via a fake `CGridApi` stub (plain object implementing `forEachRow`/`addEventListener`/`removeEventListener`/`getThemeKind`, no real CGrid) → `stats.for('pnl')` = `{min:-30,max:20,maxAbs:30,sum:10,count:5}`; simulated `rowsChanged` add of `pnl:-40` → min/maxAbs update to `-40`/`40`; simulated update that moves the row CURRENTLY holding max away from the max value → `stats.for('pnl').max` recomputes correctly (the exact scenario the lazy-delete heap exists for — a naive "track current max variable" implementation gets this wrong); simulated remove of all rows → `{min:null,max:null,maxAbs:null,sum:null,count:0}`; non-number/null values skipped without corrupting `count`; **incremental-parity-vs-recompute** property test: `makeLcg(seed)`-driven sequence of ~200 add/update/remove ops over a synthetic row set, after EVERY op assert `stats.for('pnl')` equals a brute-force recompute over the currently-live row map (naive `reduce`) — run across 3 seeds.

**Steps:** drop tsconfig `rootDir` → write failing `tests/bridge/threading.test.ts` (proof needs no new src — pure kernel-mechanics test) → confirm green (no implementation step for 3a beyond the tsconfig fix) → write `tests/helpers/lcg.ts` → write failing `tests/columnStats.test.ts` → implement `src/columnStats.ts` (heap-based min/max/maxAbs) → tsc + renderers suite green + `git diff main...HEAD -- packages/kernel` empty → commit `feat(renderers): cycle 21f task 3 — minimal-composite threading proof, ColumnStats`.

---

### Task 4: TickHistory

**Files:** Create `packages/renderers/src/tickHistory.ts` per spec §2.4b: `export interface TickHistoryColumnOptions { window?: number }` (default `60`); `export class TickHistory<TRow = unknown> { constructor(grid: CGridApi<TRow>, columns: Record<string, TickHistoryColumnOptions>, opts?: { valueGetter?: (row: TRow, colId: string) => unknown }); push(rowId: string, colId: string, value: number): void; get(rowId: string, colId: string): readonly number[]; destroy(): void; }`. Ring buffer per opted-in `(rowId, colId)` pair: a preallocated `Float64Array(window)` + `writeIndex` + `count` (`count` saturates at `window`), keyed in a `Map<string, RingBuffer>` via a `${rowId} ${colId}` composite key (NUL-separated per the vocabulary constraint's own spirit of a safe, collision-free separator not expected in rowId/colId text — verify no raw NUL ever reaches serialized output; this key is internal-only, never serialized/exported) — OR (implementer's choice, document whichever is picked) a nested `Map<rowId, Map<colId, RingBuffer>>`; either way, buffers are allocated lazily on first push for an opted-in column, never for non-opted-in columns. `push()` is O(1): writes `value` at `writeIndex`, increments `writeIndex = (writeIndex + 1) % window`, increments `count` up to `window` — zero allocation. `get()` is O(window): materializes a plain `number[]` in oldest→newest order by reading the ring starting at the correct offset (`count < window` reads `[0, count)` in insertion order; `count === window` reads starting at `writeIndex` wrapping around) — document this as O(window) allocation-per-call (acceptable: called ≤ once per repaint per cell, not per canvas draw primitive; distinct from the zero-alloc `push`). Bridge wiring (subscribes `grid.addEventListener('rowsChanged', handler)`, same event shape as Task 3): `added`/`updated` → `push(rowId, colId, valueGetter(row, colId))` for every opted-in colId where the value is a finite number (non-numbers silently skipped, no throw); `removed` → delete the buffer(s) for that `rowId` across all opted-in columns (eviction). `destroy()` removes the listener and clears the buffer map. Memory note (comment in source, matches spec verbatim): `window × liveRows × 8 bytes` per opted-in column (`Float64Array` entries are 8 bytes each). Tests: `tests/tickHistory.test.ts` (reuses `tests/helpers/lcg.ts` from Task 3) — ring wrap: `window=3`, push `[1,2,3,4,5]` for `(r1,'px')` → `get('r1','px')` → `[3,4,5]`; under-fill: `window=5`, push `[1,2]` → `get()` → `[1,2]` (not zero-padded); default window is `60` when a column opts in via `{}` (no explicit `window`); eviction: after a simulated `rowsChanged` with `removed:[{rowId:'r1',row:{}}]`, `get('r1','px')` → `[]`; multi-column/multi-row independence: pushing `(r1,'px')` never mutates `(r1,'size')` or `(r2,'px')`; non-numeric/`NaN`/`Infinity` values from a simulated `cellValueChanged`-driven push are skipped, buffer length unaffected; **seeded-stream property test**: `makeLcg(seed)` drives ~500 pushes across 10 rows × 2 opted-in columns with independent windows (e.g. 20 and 60), after every push assert the affected buffer's `get()` output equals a reference plain-JS-array model (`arr.push(v); if (arr.length > window) arr.shift();`) — run across 2 seeds.

**Steps:** write failing `tests/tickHistory.test.ts` against `src/tickHistory.ts`'s not-yet-implemented ring buffer → implement `src/tickHistory.ts` (Float64Array ring + eviction) → tsc + renderers suite green + `git diff main...HEAD -- packages/kernel` empty → commit `feat(renderers): cycle 21f task 4 — TickHistory ring buffers`.

---

## Phase C1 — category I: numeric + text (2 tasks)

### Task 5: Numeric category — 9 painters

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.1 rows — each renderer's Visual column is the acceptance spec:

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **NumberCell** | T1 | General-purpose numeric, precision + sign policy | Tabular figures, right-aligned, format-string-driven precision; currency prefix/suffix at 70% opacity |
| **PriceCell** | T1 | Ticking price with flash background | NumberCell base; on tick up flashes `#0aa063 @ 25% α` 500ms then fades 1000ms; red on tick down; no flash unchanged |
| **PriceDirectionCell** | T1 | Ticking price with inline arrow, coloured foreground | Lucide `trending-up` / `trending-down` / `minus` Path2D glyph inline; number foreground colour matches; used in dense columns where background flash would strobe |
| **PnlCell** | T1 | Signed currency P&L | Right-aligned tabular currency; red foreground negative / green positive; currency symbol muted; sign always shown |
| **DeltaCell** | T1 | Absolute + percentage change composite | `+0.42 (+1.18%)` in one cell; both values coloured together; percentage slightly muted (~85% opacity) |
| **BpsCell** | T1 | Basis points, always signed | Right-aligned integer `+12` / `-185`; colour vs zero or configured benchmark; `bps` suffix muted; used everywhere in fixed-income spreads |
| **PctChangeCell** | T1 | Signed percentage | `+1.18%` two-decimal default; green/red foreground; sign always shown |
| **FractionalPriceCell** | T2 | Treasury 32nds/64ths convention | `99-16+` renders as "99 and 16.5/32nds"; `+` denotes half-32nd; bond desks read this natively |
| **AbbreviatedNumberCell** | T1 | K/M/B/T magnitude suffix | `1.2M`, `450K`, `$3.4B`; precision configurable per magnitude; uses format DSL Tier 0 magnitude suffix |

**Files:** Modify `packages/renderers/src/numeric.ts` — replace skeleton throws with real `CellPainter.paint` implementations for all 9 names (`number`, `price`, `price-direction`, `pnl`, `delta`, `bps`, `pct-change`, `fractional-price`, `abbreviated-number`). Shared module-scope scratch only (no per-paint closures/arrays/objects). Import `paintBackground` pattern from kernel registry is NOT available — painters call `gc.fillRect` for bg when needed (PriceCell flash overlay only; others use `p.bg`/`prefillColor` skip like kernel default renderer). Import helpers from `./paintUtils` (`fragText`, `withAlpha`) and `./palette` (`resolveSemanticColors`, `withThemeAlpha`, `SEMANTIC_COLORS`). Type-only `CellPaintConfig`/`CellPainter` from `@cgrid/kernel`.

Implementation contracts (per renderer, beyond catalog Visual):
- **Shared numeric layout:** right-aligned tabular figures — set `gc.cache.font` to base `p.font` with `'tnum'` feature (append `font-feature-settings:'tnum'` or use a module-scope font string builder mirroring composite's `fragFont` precedent); `textAlign='right'`; x anchor = `p.bounds.x + p.bounds.w - padRight` where `padRight = p.padding?.right ?? 6`; y = vertical middle of cell (same cy math as kernel default text renderer).
- **NumberCell:** read `NumberCellParams` from `p.params`; primary text = `p.valueFormatted` (host/format owns precision — params `format` is documentation-only this cycle unless valueFormatted empty then stringify `p.value`); apply `signPolicy`; optional `currencyPrefix`/`currencySuffix` as separate muted (`withAlpha(fg,0.7)`) fragments painted left/right of the number via two `fragText` calls measuring suffix width first.
- **PriceCell:** extends NumberCell paint path; flash bg BEFORE text when `p.flashAlpha > 0` — fill cell bounds with `p.flashFromColor ?? derivedDirectionColor` at `p.flashAlpha` (kernel already drains 500ms sat + 1000ms fade — painter only reads alpha); when flash channel absent derive direction by comparing numeric `p.value` vs `(p.rowData as Record)[prevField]` when `prevField` set (up→positive semantic, down→negative, equal→no flash); unchanged tick = no directional color on text.
- **PriceDirectionCell:** NO background flash; inline direction glyph BEFORE the number (leading icon slot ~12px); direction from flash channel OR `prevField` delta like PriceCell; foreground color = semantic positive/negative/muted-flat; icon drawing: simple inline Path2D chevrons (triangle up/down, horizontal bar for flat) stroked/filled in semantic color — do NOT import kernel `drawIcon` at runtime (peer boundary); params `iconUp`/`iconDown`/`iconFlat` reserved for bridge Task 13 Lucide wiring, painter uses geometric fallback this task.
- **PnlCell:** always show explicit sign (`+`/`-`); color fg by sign via `resolveSemanticColors(params.colors)`; currency symbol param (default `'$'`) muted at 70% opacity leading the number.
- **DeltaCell:** multi-field — reads `absoluteField` + `percentField` from `p.rowData` (requires bridge builder to thread rowData via minimal composite program per Task 3 proof; unit tests supply `rowData` on config directly); formats `+abs (+pct%)` as one right-aligned string with shared semantic color; percent fragment at `params.percentOpacity ?? 0.85` via `withAlpha` on the shared hue.
- **BpsCell:** integer-rounded bps from `p.value`; sign always; color vs `0` OR vs `(rowData[benchmarkField])` when set; suffix `params.suffix ?? ' bps'` muted trailing.
- **PctChangeCell:** `precision ?? 2`; sign always; `%` suffix; semantic fg.
- **FractionalPriceCell:** parse decimal price into whole + 32nds (or 64ths) + optional half-tick (`showHalfTick` default true, trailing `+` in input denotes +0.5 tick); render bond-desk string e.g. `99-16+` → display `99-16+` literally (catalog: "99 and 16.5/32nds" — painter renders the compact desk notation from `valueFormatted` when host supplies it, else derives from numeric `p.value`).
- **AbbreviatedNumberCell:** magnitude suffix K/M/B/T with configurable `precision`; optional `currencyPrefix`; uses `p.value` numeric path when valueFormatted absent.

Create `packages/renderers/tests/numeric.test.ts` — fake-gc harness; `makePaintConfig()` helper building minimal `CellPaintConfig` + typed params; **≥3 cases per renderer:** nominal, edge (null/NaN/missing rowData field → empty string or dash, no throw), dark-theme variant (`themeKind:'dark'` with `withThemeAlpha` paths where applicable). Assert `gc.calls` sequences (fillStyle/set:font/fillText order). PriceCell: case with `flashAlpha:0.25` + `flashFromColor:'#0aa063'` asserts bg fillRect/globalAlpha before fillText; case with prevField rowData delta up/down/no-change. DeltaCell: requires injected `rowData`. FractionalPriceCell: `99.515625` → `99-16+` display. Run: `npm run test -w @cgrid/renderers`.

**Steps:** write failing `tests/numeric.test.ts` → implement `src/numeric.ts` (all 9) → tsc + renderers suite green + `git diff main...HEAD -- packages/kernel packages/{expression,format,rules,calc}` empty → commit `feat(renderers): cycle 21f task 5 — numeric category painters`.

---

### Task 6: Text / identity category — 5 painters

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.2 rows:

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **TickerCell** | T1 | Symbol + secondary label | Bold primary (13px), muted secondary line below (11px, ~65% opacity); never abbreviate ticker |
| **CurrencyPairCell** | T2 | FX pair + mono-spaced rate | `EUR/USD  1.0834`; optional flag glyphs; pair in smaller font; rate in mono |
| **TimestampCell** | T1 | Time-of-day right-aligned | `HH:MM:SS.mmm`; muted date prefix if not today; mono |
| **AgeCell** | T1 | Live-updating elapsed seconds | `00:04` → `03:12`; neutral <30s, amber <5m, red ≥5m; ticks every 1s discretely |
| **RelativeTimeCell** | T2 | Human-readable relative time | `"3m ago"`, `"just now"`; refreshes every 1s up to 60s, then 1m intervals |

**Files:** Modify `packages/renderers/src/text.ts` — implement `ticker`, `currency-pair`, `timestamp`, `age`, `relative-time` painters. Helpers: stacked two-line layout function (module scope) — primary line at top third, secondary at bottom third; never truncate ticker (catalog: "never abbreviate"). **TickerCell:** primary = `p.valueFormatted` bold 13px; secondary from `rowData[secondaryField]` at 11px `withAlpha(fg, secondaryOpacity ?? 0.65)`. **CurrencyPairCell:** multi-field via rowData (`pairField`, `rateField`); pair left smaller; rate right mono (`font-family` swap to monospace token in font string); double-space gap; `showFlags` stub OK (no flag glyphs this task — omit draw calls, param reserved). **TimestampCell:** `TimestampCellParams` + injectable `nowMs`; format epoch `p.value` ms → `HH:MM:SS.mmm` when `showMillis!==false`; if calendar day ≠ today (UTC date compare using `nowMs`), prefix muted `YYYY-MM-DD ` (date prefix rule — catalog "if not today"); right-aligned mono; halign right. **AgeCell:** requires `nowMs` + `sinceField`; elapsed = `nowMs - rowData[sinceField]`; display `MM:SS` under 1h else `H:MM:SS`; color neutral below `warnAfterMs` (30s default), warning semantic below `dangerAfterMs` (5m default), danger semantic above. **RelativeTimeCell:** bucketed human strings (`just now`, `Ns ago`, `Nm ago`, `Nh ago`, `Nd ago`); refresh granularity: &lt;60s → 1s buckets; ≥60s → 1m buckets (use injectable `nowMs`, never `Date.now()`).

Create `packages/renderers/tests/text.test.ts` — ≥3 cases each: TickerCell two-line stack asserts two fillText y positions; TimestampCell today vs not-today (fixed nowMs); AgeCell 15s neutral / 120s amber / 400s red; RelativeTimeCell `just now` / `3m ago`; CurrencyPairCell mono rate on right. Dark-theme case per renderer where color differs.

**Steps:** write failing `tests/text.test.ts` → implement `src/text.ts` → tsc + suite green + zero-kernel-diff → commit `feat(renderers): cycle 21f task 6 — text category painters`.

---

<!-- PHASE-C2 -->

### Task 7: Indicators category — 6 painters

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.3 rows:

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **StatusDot** | T1 | 8px filled circle in semantic colour | Optional label after dot; used for connection/health/session state |
| **QuoteQualityDot** | T2 | Fresh/tight/deep quality indicator | Green fresh+tight+deep / amber thin+wide / red stale+one-sided |
| **StaleFlag** | T1 | Aged-data indicator | Cell drops to 60% opacity + inline icon; tooltip shows `"last tick 8s ago"` |
| **DirectionArrow** | T1 | Standalone ▲/▼/▬ | Used inside composites; Lucide Path2D; coloured per direction |
| **StructureIconStrip** | T2 | Fixed-income feature icons | Inline row of monochrome 12–16px icons (callable, puttable, sinker, floater, step-up, make-whole); tinted amber/blue when active; hover tooltip |
| **TrafficLightCell** | T2 | Three-state RAG dot | 8px filled circle green/amber/red for risk-limit / margin / credit-line state |

**Files:** Modify `packages/renderers/src/indicators.ts` — implement all 6. Use `dot()` from paintUtils for 8px circles (StatusDot, QuoteQualityDot, TrafficLightCell). **QuoteQualityDot:** derive state from boolean rowData fields (`freshField`, `tightField`, `deepField`, `staleField`, `oneSidedField`) with catalog priority: stale or one-sided → red; else fresh+tight+deep → green; else amber. **StaleFlag:** `globalAlpha=0.6` on entire cell content layer (save/restore); inline stale icon (simple clock/bar Path2D or unicode ⏱); `title`/tooltip string NOT painted on canvas — expose `p.params.tooltip` only if bridge sets host tooltip hook (painter stores computed `"last tick Ns ago"` on a module-scope last pass for bridge Task 13; unit test asserts alpha + icon draw only). **DirectionArrow:** centered ▲/▼/▬ via `dot`/line primitives or Unicode; semantic colors. **StructureIconStrip:** iterate `STRUCTURE_GLYPH_MAP` keys where `params.flags[key]`; 12px icon slots; active tint amber (`SEMANTIC_COLORS.warning`) vs inactive muted; tooltip deferred to bridge. **TrafficLightCell:** `state` param or `stateField` on rowData → RAG palette (green `#0aa063`, amber `#f0b429`, red `#e63946`).

Create `packages/renderers/tests/indicators.test.ts` — ≥3 cases/renderer; QuoteQualityDot truth-table cases; StaleFlag alpha 0.6 assertion; StructureIconStrip two-flag active layout width.

**Steps:** write failing tests → implement → green + zero-kernel-diff → commit `feat(renderers): cycle 21f task 7 — indicator category painters`.

---

### Task 8: Badges / pills category — 7 painters

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.4 rows:

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **StatusPill** | T1 | Order/state label with semantic colour | 2–4px radius pill, 10–11px caps text; `WORKING` cyan, `PART FILL` amber, `FILLED` green, `CANCELLED` grey, `REJECTED` red on white, `PENDING` grey dashed border |
| **RatingBadge** | T2 | Single agency rating | Small badge; colour-graded AAA green → D red; IG/HY split at BBB-/Baa3 (junk gets orange/red tint); NR/WD muted grey; text labels only (no proprietary logos) |
| **RatingClusterCell** | T2 | S&P / Moody's / Fitch cluster | Three RatingBadges side-by-side (`AAA / Aa1 / AA`); tight spacing; agency name muted below each in nano text (optional) |
| **TagCell** | T1 | Generic muted-grey tag | `144A`, `TRACE`, `DELAYED`, `AXE`, arbitrary text |
| **VenueChip** | T2 | Execution venue MIC | Coloured chip: `XNAS`, `ARCX`, `BATS`, `EDGX`; venue-specific palette |
| **SideChip** | T2 | Long/short single-char | `L` green background / `S` red background; 14–16px square |
| **TimeInForcePill** | T2 | Order TIF label | `DAY`, `GTC`, `IOC`, `FOK` colour-coded; hover tooltip expands abbreviation |

**Files:** Modify `packages/renderers/src/badges.ts` — implement all 7 using `pill()` + `fragText()` + palette maps (`STATUS_PILL_MAP`, `resolvePillColors`, `RATING_SCALE_BANDS`, `DEFAULT_VENUE_PALETTE`). **StatusPill:** uppercase label; map lookup via `resolvePillColors(status, p.themeKind ?? 'light')`; dashed border when `PENDING`. **RatingBadge:** grade lookup in `RATING_SCALE_BANDS`; NR/WD muted. **RatingClusterCell:** multi-field rowData (`spField`, `moodysField`, `fitchField` per types.ts); three compact badges in one row; optional nano agency labels (10px muted) — param flag `showAgencyLabels`. **TagCell:** muted grey pill, arbitrary `valueFormatted`. **VenueChip:** MIC lookup in venue palette; centered chip. **SideChip:** 14–16px square pill, `L`/`S` from value. **TimeInForcePill:** TIF color map (module-scope CONST); tooltip deferred.

Create `packages/renderers/tests/badges.test.ts` — StatusPill WORKING/REJECTED/PENDING dashed; RatingBadge AAA vs BB+ vs NR; RatingClusterCell triple layout; SideChip L/S colors; VenueChip XNAS color token.

**Steps:** write failing tests → implement → green + zero-kernel-diff → commit `feat(renderers): cycle 21f task 8 — badge category painters`.

### Task 9: Bars / gauges category — 8 painters

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.5 rows:

| Renderer | Tier | Purpose | Visual | Deps |
|---|---|---|---|---|
| **ProgressBarCell** | T1 | 0–100% fill (order fill ratio) | Horizontal fill bar, text overlaid; neutral grey track, green fill at 100% | kernel |
| **RangeBarCell** | T2 | Position within a range | Horizontal bar with two endpoint labels; marker dot shows current position (52w range, day range) | kernel |
| **BidirectionalBarCell** | T1 | Centre-zero left-red / right-green | Position size or P&L across visible rows; extends left (short/negative) red, right (long/positive) green; bar width proportional to `abs(value) / max(abs)` in scope | kernel, calc (scope max) |
| **HeatCell** | T1 | Column-wide gradient background | Full-cell background tint; darkest for extreme values in the column's range; interpolated for middle values; classic heat map | calc (column-wide value range) |
| **GaugeCell** | T2 | Segmented gauge with tick marker | Horizontal segmented gauge (e.g. `-20bps / 0 / +20bps` zones); coloured tick shows current value; used for implementation shortfall, default probability | kernel |
| **SpreadBarCell** | T2 | Bid/ask spread-width indicator | Thin bar behind mid price; wider bar as bid/ask spread widens; amber at 1σ, red at 2σ vs rolling average | calc (rolling stats) |
| **VolumeBar** | T2 | Full-cell horizontal bar for volume | Bar sized to `volume / max(volume)` in scope; text overlays with reverse-out colour | calc (scope max) |
| **MaturityLadderBar** | T3 | Fixed-income tenor bucket bar | Full-cell segmented bar by tenor bucket (0-1y, 1-3y, 3-5y, 5-10y, 10y+); segment widths = notional at each bucket | calc |

**Files:** Modify `packages/renderers/src/bars.ts` — implement all 8 using `miniBar()`/`dot()`/`labInterpolate()`/`fragText()`. **ProgressBarCell:** `fraction`/`fractionField`, track + fill, green at 100%. **RangeBarCell:** min/max/value fields, marker dot. **BidirectionalBarCell:** `params.stats.maxAbs` scope denominator; degrade to `abs(value)` when stats absent. **HeatCell:** LAB default (`curve:'lab'`), full-cell tint via `labInterpolate(negative,positive,t)`. **GaugeCell:** zone segments + vertical tick. **SpreadBarCell:** spread from bid/ask fields; rolling σ from `params.history.values`. **VolumeBar:** `value/stats.max`; optional reverse-out text. **MaturityLadderBar:** `bucketFields` keyed by `MaturityBucket`.

Create `packages/renderers/tests/bars.test.ts` — ≥3 cases/renderer; HeatCell LAB vs linear; BidirectionalBarCell scope max; SpreadBarCell history band.

**Steps:** write failing tests → implement → green + zero-kernel-diff → commit `feat(renderers): cycle 21f task 9 — bar category painters`.

---

### Task 10: In-cell charts category — 4 new + 5 kernel re-exports

**Catalog acceptance (quote VERBATIM in task brief):** catalog §3.6 rows (new four; line/column/area/bar/pie re-exported per §2.6.5):

| Renderer | Tier | Purpose | Visual | Deps |
|---|---|---|---|---|
| **LineSparkline** | T1 | Trend line, ~30–120 points | Thin polyline left-to-right; optional first/last/min/max highlight dots; stroke colour by trend direction | expression (windowed data) |
| **AreaSparkline** | T1 | Filled trend for cumulative curves | Line + semi-transparent fill below; used for running P&L, cumulative volume | expression |
| **BarSparkline** | T1 | Column bars per period | Discrete bars, gap between each; positive/negative split at zero line; used for daily volume, per-minute trades | expression |
| **WinLossSparkline** | T3 | Binary up/down bars | 1px-wide bars, all same height; up green above zero-line, down red below; used for daily P&L strings | expression |
| **YieldCurveSparkline** | T2 | Multi-tenor yield curve | 6-point line with tenor labels below (`2y 5y 10y 30y`); marker dot on the bond's own tenor; axis is tenor not time | expression, format |
| **KRDBarChart** | T3 | Key-rate duration grouped bars | Micro histogram per tenor bucket (2y/5y/10y/30y bars); bp-per-tenor sensitivity | expression |
| **DepthLadderCell** | T2 | Mini order book (3–5 levels) | Vertical mini-ladder; bid volumes left (red bars, right-aligned) / ask right (green bars, left-aligned); sizes on outer edges; prices centre | kernel |

**Files:** Modify `packages/renderers/src/charts.ts`. **Re-exports:** thin adapters delegating to kernel `paint*Sparkline` via `@kernel-src` alias (vitest `fs.allow` + tsconfig paths — same deep-import precedent as Task 3 threading proof); set `params.sparkline.type` per canonical name (`line-sparkline`→`'line'`, `column-sparkline`→`'column'`, etc.); reuse kernel `coerceToNumberArray`. **WinLossSparkline:** read `valuesField` array from rowData. **YieldCurveSparkline:** polyline + tenor labels + optional marker. **KRDBarChart:** signed micro-bars per tenor. **DepthLadderCell:** multi-field bid/ask price/size arrays, `levels` capped at 5.

Create `packages/renderers/tests/charts.test.ts` — ≥3 cases per new renderer; re-export smoke tests assert stroke/fillRect delegation.

**Steps:** write failing tests → implement → green + zero-kernel-diff → commit `feat(renderers): cycle 21f task 10 — chart category painters + sparkline re-exports`.

---

### Task 11: Composite category — 5 painters

**Catalog acceptance:** catalog §3.7 rows (StackedValueCell, PriceQuoteCell, NBBOCell, BenchmarkSpreadCell, PriceChangeComposite). Multi-field via minimal-composite threading (Task 3). Composes numeric/text/badge/bar sub-patterns.

**Files:** `packages/renderers/src/composite.ts` + `tests/composite.test.ts`. Commit `feat(renderers): cycle 21f task 11 — composite category painters`.

---

### Task 12: Action category — 2 painters + hit router stub

**Catalog acceptance:** catalog §3.8 (IconActionCluster, RowMenuCell). Verify kernel `cellClicked` event name + context-menu public API at implementation time. Hit regions ≥24×24; kebab opens context menu or host callback.

**Files:** `packages/renderers/src/actions.ts` + `tests/actions.test.ts`. Commit `feat(renderers): cycle 21f task 12 — action category painters`.

---

<!-- PHASE-CHECKPOINT -->

<!-- PHASE-DE -->
