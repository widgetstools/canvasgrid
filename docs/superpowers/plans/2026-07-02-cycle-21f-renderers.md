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

**Files:** Modify `packages/renderers/package.json` (deps: `"@cgrid/format": "*"` ONLY; peer `"@cgrid/kernel": "*"`; devDeps mirror packages/calc incl. coverage-v8; remove expression/calc/rules deps); Create `vitest.config.ts` (mirror packages/calc); Create `src/types.ts` — the canonical renderer NAME TABLE (`RENDERER_NAMES` const: all 40 canonical strings per spec §2.5, e.g. 'number','price','price-direction','pnl','delta','bps','pct-change','fractional-price','abbreviated-number','ticker','currency-pair','timestamp','age','relative-time','status-dot','quote-quality-dot','stale-flag','direction-arrow','structure-icon-strip','traffic-light','status-pill','rating-badge','rating-cluster','tag','venue-chip','side-chip','tif-pill','progress-bar','range-bar','bidirectional-bar','heat','gauge','spread-bar','volume-bar','maturity-ladder','win-loss-sparkline','yield-curve-sparkline','krd-bar-chart','depth-ladder','stacked-value','price-quote','nbbo','benchmark-spread','price-change-composite','icon-action-cluster','row-menu' — plus the 5 kernel re-export names 'line-sparkline','column-sparkline','area-sparkline','bar-sparkline','pie-sparkline') + EVERY params interface per catalog rows (each interface documented with its catalog row reference; field-mapping params for multi-field renderers; shared `SemanticColorMap`, `NowMsParam`); Create module skeletons (paintUtils/palette/category files/columnStats/tickHistory/bridge — final signatures, not-yet-implemented throws; palette exports typed CONST maps as real data where the catalog fixes them: status pill map, RAG, rating scale bands, default venue palette, structure glyph map per spec §2.6.6); Overwrite `src/index.ts` (full re-export surface); Test `tests/types.test.ts` (name table count === 45 incl. re-exports, uniqueness, structuredClone-safety of palette maps).

**Steps:** branch `cycle21f/renderers` off main → manifest+config → types.ts → palette data + skeletons → index → test+tsc → commit `feat(renderers): cycle 21f task 1 — scaffold, param types, name table, palette data`.

---

<!-- PHASE-B -->

<!-- PHASE-C1 -->

<!-- PHASE-C2 -->

<!-- PHASE-CHECKPOINT -->

<!-- PHASE-DE -->
