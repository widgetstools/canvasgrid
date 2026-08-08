# Damage-Region Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cgrid repaint cost proportional to what changed — semantic damage ledger, clipped paint passes, per-source damage wiring, scroll self-blit — so the grid is hitch-free under OpenFin/Electron-class runtimes whose Canvas2D is 3–10× slower than Chrome.

**Architecture:** A `DamageLedger` accumulates semantic damage (rows / cells / bands / rects / full) between paints and resolves it to merged, bled, DPR-snapped clip rects against the live `ViewportState` at paint time. `Renderer.paint` gains an optional damage parameter: full damage is byte-identical to today; partial damage clips the six existing passes and culls row iteration. Sources migrate one category at a time (worker `touchedRows` → chunk, flash keys, hover rows, selection/focus); anything un-migrated keeps full-repaint semantics. Scroll adds a canvas self-blit with a full-paint fallback. `getPaintStats()` instruments everything; a pixel-invariance Playwright harness enforces the bleed contract.

**Tech Stack:** TypeScript, vitest (happy-dom) for kernel units, Playwright (cgrid-ext-demo, port 5188) for the invariance harness + E2E.

**Spec:** `docs/superpowers/specs/2026-07-11-damage-region-rendering-design.md` — its §4 bleed rules and §7 test matrix are binding.

## Global Constraints

- Cumulative pixels after any partial paint must equal a full repaint's (spec §1); the invariance harness (Task 6) is the enforcement mechanism.
- Un-migrated `requestRepaint()` call sites keep FULL-damage semantics — a call with no ledger entry means full (spec §3c). Never make partial the default for an unknown source.
- Rect cap: >12 resolved rects or union area >60% of canvas ⇒ collapse to full (spec §3a).
- Bleed contract (spec §4): every rect +2px; sticky band ∪ shadow extension; row rects span full body width; header/pinned/totals band-atomic extension; DPR-snap outward.
- Grid option `suppressPartialRepaint?: boolean` (default `false`) forces full damage everywhere (spec §8).
- `packages/kernel/src/velocityGrid.ts` contains a NUL byte (~offset 127773): plain grep sees it as binary — use `grep -a` / `rg -a`, and pipe reads through `tr -d '\000'` when needed. Edit tool works normally.
- Verification per task: `cd packages/kernel && npx vitest run <files>` then the FULL kernel suite + `npx tsc --noEmit` before each commit.
- Commit directly to branch `cgridext/cursor-theme`. Batch review: NO per-task reviewers; ONE closeout review + one fix wave at the end (user standing rule).

## File Structure

- Create `packages/kernel/src/core/damageLedger.ts` — ledger + resolution (pure, no DOM).
- Create `packages/kernel/tests/damageLedger.test.ts`, `tests/rendererDamage.test.ts`, `tests/paintStats.integration.test.ts`.
- Modify `packages/kernel/src/renderer/renderer.ts` (damage param + clip), `src/renderer/painters/byRows.ts` (row/col culling), `src/core/canvas.ts` (expose canvas to component paint — blit), `src/velocityGrid.ts` (ledger ownership, source wiring, stats, scroll blit decision), `src/worker/worker.ts` + `src/worker/viewportSlicer.ts` + `src/worker/protocol.ts` (touchedRows), `src/types/api.ts` + `src/types/options.ts` (getPaintStats / suppressPartialRepaint).
- Create `apps/cgrid-ext-demo/e2e/paintInvariance.spec.ts` + a `?paintHarness` hook in `apps/cgrid-ext-demo/src/main.ts`.

---

### Task 1: DamageLedger core

**Files:**
- Create: `packages/kernel/src/core/damageLedger.ts`
- Test: `packages/kernel/tests/damageLedger.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2–5):

```ts
export type Damage =
  | { kind: 'full' }
  | { kind: 'rows'; rowIndices: number[] }            // DATA-row local indices (DataSubgrid space)
  | { kind: 'cells'; cells: Array<{ rowId: number; colId: string }> }
  | { kind: 'band'; top: number; bottom: number }     // CSS px, canvas space
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'scroll'; dy: number };                   // Task 5 consumes; ledger just stores

export interface Rect { x: number; y: number; w: number; h: number }

export interface ResolvedDamage {
  full: boolean;
  rects: Rect[];            // merged, bled, snapped; empty when full
  blit: { dy: number } | null; // non-null only when the ONLY damage is one 'scroll' + optional band/cells
}

export interface DamageResolveCtx {
  canvasWidth: number; canvasHeight: number; dpr: number;
  bodyTop: number; bodyBottom: number; bodyLeft: number; bodyRight: number;
  /** Sticky group band bottom edge in CSS px, or null when no sticky band. Rect
   *  intersecting [bodyTop, stickyBottom] extends to cover the band + SHADOW_BLEED. */
  stickyBandBottom: number | null;
  /** Pinned-row / totals band rects (CSS px). A damage rect intersecting one
   *  extends to cover that whole band (spec §4.4 — those painters assume
   *  band-atomic draws). Empty array when none. */
  pinnedBandRects: Rect[];
  /** Resolve a DATA-row local index to its ViewportRow band, or null if off-screen. */
  rowBand(localRowIndex: number): { top: number; bottom: number } | null;
  /** Resolve numeric rowId → DATA-row local index, or null when not in the fetched window. */
  rowIndexForRowId(rowId: number): number | null;
  /** Resolve colId → column x/width in CSS px, or null when scrolled out. */
  colBounds(colId: string): { x: number; w: number } | null;
}

export class DamageLedger {
  add(d: Damage): void;
  hasAny(): boolean;
  /** Drain + resolve. Empty ledger resolves to FULL (correctness default for
   *  legacy requestRepaint() calls that recorded nothing). */
  takeResolved(ctx: DamageResolveCtx): ResolvedDamage;
}
export const DAMAGE_BLEED_PX = 2;
export const DAMAGE_MAX_RECTS = 12;
export const DAMAGE_MAX_AREA_FRACTION = 0.6;
export const STICKY_SHADOW_BLEED_PX = 8;
```

- [ ] **Step 1: Write the failing tests**

`packages/kernel/tests/damageLedger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DamageLedger, DAMAGE_BLEED_PX, type DamageResolveCtx } from '../src/core/damageLedger';

const ctx = (over: Partial<DamageResolveCtx> = {}): DamageResolveCtx => ({
  canvasWidth: 1000, canvasHeight: 600, dpr: 2,
  bodyTop: 40, bodyBottom: 580, bodyLeft: 0, bodyRight: 1000,
  stickyBandBottom: null,
  pinnedBandRects: [],
  rowBand: (i) => (i >= 0 && i < 20 ? { top: 40 + i * 24, bottom: 40 + (i + 1) * 24 } : null),
  rowIndexForRowId: (id) => (id >= 100 && id < 120 ? id - 100 : null),
  colBounds: (colId) => (colId === 'px' ? { x: 200, w: 80 } : null),
  ...over,
});

describe('DamageLedger', () => {
  it('empty ledger resolves to FULL (legacy requestRepaint safety)', () => {
    const l = new DamageLedger();
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('full damage wins over everything and drains', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [1] });
    l.add({ kind: 'full' });
    expect(l.takeResolved(ctx()).full).toBe(true);
    // drained: next take (with nothing added) is full again by the empty rule
    expect(l.hasAny()).toBe(false);
  });

  it('rows resolve to full-width bled bands', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [2] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.rects).toHaveLength(1);
    const rect = r.rects[0]!;
    // row 2 band = [88, 112]; +2 bleed; full body width; snapped OUT to 0.5px (dpr 2)
    expect(rect.y).toBeLessThanOrEqual(86);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(114);
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(1000);
  });

  it('cells resolve via rowId → local index → band ∩ column bounds', () => {
    const l = new DamageLedger();
    l.add({ kind: 'cells', cells: [{ rowId: 103, colId: 'px' }] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    const rect = r.rects[0]!;
    expect(rect.x).toBeLessThanOrEqual(198);           // 200 - bleed
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(282); // 280 + bleed
  });

  it('off-screen cells resolve to nothing (partial with zero rects)', () => {
    const l = new DamageLedger();
    l.add({ kind: 'cells', cells: [{ rowId: 999, colId: 'px' }] });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.rects).toHaveLength(0);
  });

  it('overlapping rects merge', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rows', rowIndices: [3, 4] }); // adjacent bands + bleed overlap
    expect(l.takeResolved(ctx()).rects).toHaveLength(1);
  });

  it('caps: >12 disjoint rects collapse to full', () => {
    const l = new DamageLedger();
    // 14 disjoint single-cell rects via rect damage
    for (let i = 0; i < 14; i++) l.add({ kind: 'rect', x: i * 70, y: 40 + (i % 5) * 90, w: 10, h: 10 });
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('caps: union area >60% collapses to full', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 0, y: 0, w: 1000, h: 400 }); // 66%
    expect(l.takeResolved(ctx()).full).toBe(true);
  });

  it('sticky band: rect intersecting the band extends to band + shadow', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 100, y: 50, w: 10, h: 10 });
    const r = l.takeResolved(ctx({ stickyBandBottom: 88 }));
    const rect = r.rects[0]!;
    expect(rect.y).toBeLessThanOrEqual(40);                 // extends up to bodyTop
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(88 + 8); // band bottom + shadow bleed
  });

  it('pinned/totals band: intersecting rect extends to the whole band', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 500, y: 555, w: 10, h: 10 });
    const r = l.takeResolved(ctx({ pinnedBandRects: [{ x: 0, y: 556, w: 1000, h: 24 }] }));
    const rect = r.rects[0]!;
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(1000);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(580);
  });

  it('DPR snapping lands on device-pixel boundaries', () => {
    const l = new DamageLedger();
    l.add({ kind: 'rect', x: 10.3, y: 41.7, w: 20.2, h: 9.1 });
    const rect = l.takeResolved(ctx()).rects[0]!;
    expect((rect.x * 2) % 1).toBe(0);
    expect((rect.y * 2) % 1).toBe(0);
    expect(((rect.x + rect.w) * 2) % 1).toBe(0);
    expect(((rect.y + rect.h) * 2) % 1).toBe(0);
  });

  it('scroll damage alone resolves to a blit', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 48 });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(false);
    expect(r.blit).toEqual({ dy: 48 });
    // exposed band at the bottom, bled
    expect(r.rects.length).toBeGreaterThanOrEqual(1);
  });

  it('scroll + full collapses to full, no blit', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 48 });
    l.add({ kind: 'full' });
    const r = l.takeResolved(ctx());
    expect(r.full).toBe(true);
    expect(r.blit).toBeNull();
  });

  it('consecutive scrolls accumulate dy', () => {
    const l = new DamageLedger();
    l.add({ kind: 'scroll', dy: 20 });
    l.add({ kind: 'scroll', dy: 30 });
    expect(l.takeResolved(ctx()).blit).toEqual({ dy: 50 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/kernel && npx vitest run tests/damageLedger.test.ts`
Expected: FAIL — module `../src/core/damageLedger` not found.

- [ ] **Step 3: Implement `core/damageLedger.ts`**

```ts
/**
 * Damage-region ledger — accumulates SEMANTIC damage between paints and
 * resolves it to merged clip rects against the live viewport at paint time.
 * Semantic entries (row indices, rowId+colId cells) survive scroll because
 * geometry is computed at paint, not at enqueue. Design:
 * docs/superpowers/specs/2026-07-11-damage-region-rendering-design.md §3a/§4.
 *
 * Correctness defaults: an EMPTY ledger resolves to FULL (legacy
 * requestRepaint() callers recorded nothing); unknown/unresolvable entries
 * degrade toward full, never toward under-painting.
 */

export type Damage =
  | { kind: 'full' }
  | { kind: 'rows'; rowIndices: number[] }
  | { kind: 'cells'; cells: Array<{ rowId: number; colId: string }> }
  | { kind: 'band'; top: number; bottom: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'scroll'; dy: number };

export interface Rect { x: number; y: number; w: number; h: number }

export interface ResolvedDamage {
  full: boolean;
  rects: Rect[];
  blit: { dy: number } | null;
}

export interface DamageResolveCtx {
  canvasWidth: number; canvasHeight: number; dpr: number;
  bodyTop: number; bodyBottom: number; bodyLeft: number; bodyRight: number;
  stickyBandBottom: number | null;
  pinnedBandRects: Rect[];
  rowBand(localRowIndex: number): { top: number; bottom: number } | null;
  rowIndexForRowId(rowId: number): number | null;
  colBounds(colId: string): { x: number; w: number } | null;
}

export const DAMAGE_BLEED_PX = 2;
export const DAMAGE_MAX_RECTS = 12;
export const DAMAGE_MAX_AREA_FRACTION = 0.6;
export const STICKY_SHADOW_BLEED_PX = 8;

const FULL: ResolvedDamage = { full: true, rects: [], blit: null };

export class DamageLedger {
  private entries: Damage[] = [];
  private isFull = false;
  private scrollDy = 0;

  add(d: Damage): void {
    if (this.isFull) return;
    if (d.kind === 'full') { this.isFull = true; this.entries.length = 0; this.scrollDy = 0; return; }
    if (d.kind === 'scroll') { this.scrollDy += d.dy; return; }
    this.entries.push(d);
  }

  hasAny(): boolean { return this.isFull || this.scrollDy !== 0 || this.entries.length > 0; }

  takeResolved(ctx: DamageResolveCtx): ResolvedDamage {
    const entries = this.entries; const wasFull = this.isFull; const dy = this.scrollDy;
    this.entries = []; this.isFull = false; this.scrollDy = 0;

    // Empty ledger = legacy requestRepaint() with no recorded damage → full.
    if (wasFull || (entries.length === 0 && dy === 0)) return FULL;

    const rects: Rect[] = [];
    const pushBand = (top: number, bottom: number): void => {
      rects.push({ x: 0, y: top, w: ctx.canvasWidth, h: bottom - top });
    };

    for (const d of entries) {
      switch (d.kind) {
        case 'rows':
          for (const i of d.rowIndices) {
            const b = ctx.rowBand(i);
            if (b) pushBand(b.top, b.bottom);
          }
          break;
        case 'cells':
          for (const c of d.cells) {
            const idx = ctx.rowIndexForRowId(c.rowId);
            if (idx === null) continue;
            const b = ctx.rowBand(idx);
            if (!b) continue;
            const col = ctx.colBounds(c.colId);
            if (col) rects.push({ x: col.x, y: b.top, w: col.w, h: b.bottom - b.top });
            else pushBand(b.top, b.bottom); // unknown column → row-atomic
          }
          break;
        case 'band': pushBand(d.top, d.bottom); break;
        case 'rect': rects.push({ x: d.x, y: d.y, w: d.w, h: d.h }); break;
        // 'full'/'scroll' never stored in entries
      }
    }

    // Scroll: only usable as a blit when no full; exposed band becomes damage.
    let blit: { dy: number } | null = null;
    if (dy !== 0) {
      blit = { dy };
      const exposed = Math.min(Math.abs(dy), ctx.bodyBottom - ctx.bodyTop);
      if (dy > 0) pushBand(ctx.bodyBottom - exposed, ctx.bodyBottom);
      else pushBand(ctx.bodyTop, ctx.bodyTop + exposed);
      // Sticky band + shadow never scrolls with content — always redamage it.
      if (ctx.stickyBandBottom !== null) pushBand(ctx.bodyTop, ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX);
    }

    // Bleed + sticky extension + clamp + snap.
    const snapped = rects.map((r) => this.expand(r, ctx)).filter((r) => r.w > 0 && r.h > 0);
    const merged = mergeRects(snapped);

    const area = merged.reduce((a, r) => a + r.w * r.h, 0);
    const canvasArea = ctx.canvasWidth * ctx.canvasHeight;
    if (merged.length > DAMAGE_MAX_RECTS || area > canvasArea * DAMAGE_MAX_AREA_FRACTION) return FULL;

    return { full: false, rects: merged, blit };
  }

  private expand(r: Rect, ctx: DamageResolveCtx): Rect {
    let x0 = r.x - DAMAGE_BLEED_PX, y0 = r.y - DAMAGE_BLEED_PX;
    let x1 = r.x + r.w + DAMAGE_BLEED_PX, y1 = r.y + r.h + DAMAGE_BLEED_PX;
    // Sticky band: anything touching it repaints the whole band + shadow.
    if (ctx.stickyBandBottom !== null && y0 < ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX && y1 > ctx.bodyTop) {
      y0 = Math.min(y0, ctx.bodyTop);
      y1 = Math.max(y1, ctx.stickyBandBottom + STICKY_SHADOW_BLEED_PX);
    }
    // Pinned/totals bands are band-atomic (spec §4.4): intersecting one
    // extends the rect to cover that whole band.
    for (const b of ctx.pinnedBandRects) {
      if (x0 <= b.x + b.w && b.x <= x1 && y0 <= b.y + b.h && b.y <= y1) {
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
    }
    // Clamp to canvas.
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(ctx.canvasWidth, x1); y1 = Math.min(ctx.canvasHeight, y1);
    // Snap OUT to device pixels.
    const d = ctx.dpr || 1;
    x0 = Math.floor(x0 * d) / d; y0 = Math.floor(y0 * d) / d;
    x1 = Math.ceil(x1 * d) / d; y1 = Math.ceil(y1 * d) / d;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/** Merge overlapping/touching rects until fixpoint. O(n²) on ≤ ~20 rects. */
export function mergeRects(rects: Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        if (a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
          const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
          out[i] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          out.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/damageLedger.test.ts` — Expected: all PASS. Adjust test expectations ONLY if the discrepancy is an arithmetic detail (snapping direction), never the behavioral contract.

- [ ] **Step 5: Full suite + typecheck + commit**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add packages/kernel/src/core/damageLedger.ts packages/kernel/tests/damageLedger.test.ts
git commit -m "feat(kernel): DamageLedger — semantic damage accumulation resolved to merged clip rects"
```

---

### Task 2: Damage-aware Renderer.paint + PaintStats + API surface

**Files:**
- Modify: `packages/kernel/src/renderer/renderer.ts` (paint signature + clip, lines ~153–205)
- Modify: `packages/kernel/src/renderer/painters/byRows.ts` (row culling in the `vs.visibleRows` loops)
- Modify: `packages/kernel/src/velocityGrid.ts` (ledger field, paint closure at :1450, stats, API methods)
- Modify: `packages/kernel/src/types/api.ts` (getPaintStats/resetPaintStats), `src/types/options.ts` or wherever `VelocityGridOptions` lives (`suppressPartialRepaint`)
- Test: `packages/kernel/tests/rendererDamage.test.ts`

**Interfaces:**
- Consumes: `DamageLedger`, `ResolvedDamage`, `Rect` from Task 1.
- Produces:
  - `Renderer.paint(gc: CachedContext2D, damage?: ResolvedDamage): void` — `undefined` or `{full:true}` behaves exactly as today.
  - `pctx.damageBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null` — added to the painter context; byRows culls rows/columns against it.
  - On `VelocityGrid`: `private damageLedger = new DamageLedger()`, `private paintStats: MutablePaintStats`, helpers `repaintFull()`, `repaintRows(indices: number[])`, `repaintCells(cells: Array<{rowId:number;colId:string}>)` — each adds damage then calls `this.cgridCanvas.requestRepaint()`. `suppressPartialRepaint` option forces `repaint*` helpers to record `full`.
  - Public API: `getPaintStats(): PaintStats`, `resetPaintStats(): void` with
    `interface PaintStats { paints: number; fullPaints: number; partialPaints: number; blits: number; lastRects: number; lastAreaPct: number; avgPaintMs: number; worstPaintMs: number }`.

- [ ] **Step 1: Write the failing renderer test**

`packages/kernel/tests/rendererDamage.test.ts` — a recorded-gc test: build a minimal `Renderer` with stub opts (empty viewport is fine) and a fake `CachedContext2D` that records method calls (`{ cache: { save(){}, restore(){}, fillStyle:'' }, save/restore/beginPath/rect/clip/fillRect/... }` recording into an array; mirror the fake-gc idiom used by existing painter tests — find one with `grep -rln "fillRect" packages/kernel/tests | head` and reuse its fake). Assert:

```ts
it('full damage paints without any clip', () => {
  renderer.paint(gc, { full: true, rects: [], blit: null });
  expect(calls.filter((c) => c.m === 'clip')).toHaveLength(0);
  expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W && c.args[3] === CANVAS_H)).toBe(true);
});

it('partial damage clips to the union and background-fills per rect', () => {
  renderer.paint(gc, { full: false, rects: [{ x: 10, y: 20, w: 100, h: 50 }], blit: null });
  expect(calls.some((c) => c.m === 'clip')).toBe(true);
  expect(calls.some((c) => c.m === 'rect' && c.args[0] === 10 && c.args[1] === 20)).toBe(true);
  // background fill is per damage rect, NOT full surface
  expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W && c.args[3] === CANVAS_H)).toBe(false);
  expect(calls.some((c) => c.m === 'fillRect' && c.args[0] === 10 && c.args[3] === 50)).toBe(true);
});

it('zero-rect partial damage paints nothing', () => {
  const before = calls.length;
  renderer.paint(gc, { full: false, rects: [], blit: null });
  expect(calls.length).toBe(before); // no draw calls at all
});

it('undefined damage behaves as full (back-compat)', () => {
  renderer.paint(gc);
  expect(calls.some((c) => c.m === 'fillRect' && c.args[2] === CANVAS_W)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/rendererDamage.test.ts` fails (paint has no damage param).

- [ ] **Step 3: Implement renderer changes**

In `renderer/renderer.ts`, change the signature and wrap the phases (current body: pctx build at 154–180, bg fill at 184–188, then the five painter calls):

```ts
paint(gc: CachedContext2D, damage?: ResolvedDamage): void {
  const partial = damage !== undefined && !damage.full;
  if (partial && damage.rects.length === 0 && !damage.blit) return; // nothing visible changed

  const pctx = { /* … existing fields unchanged … */
    damageBounds: partial ? boundsOf(damage.rects) : null,
  };
  const w = this.opts.getCanvasWidth();
  const h = this.opts.getCanvasHeight();

  if (partial) {
    gc.save();
    gc.beginPath();
    for (const r of damage.rects) gc.rect(r.x, r.y, r.w, r.h);
    gc.clip();
    gc.cache.fillStyle = pctx.theme.bg;
    for (const r of damage.rects) gc.fillRect(r.x, r.y, r.w, r.h);
  } else {
    gc.cache.fillStyle = pctx.theme.bg;
    gc.fillRect(0, 0, w, h);
  }

  paintCellsByRows(gc, pctx);
  paintGridLines(gc, pctx);
  paintStickyGroups(gc, pctx);
  paintOverlay(gc, pctx);
  paintRangeOverlay(gc, pctx);

  if (partial) gc.restore();
}
```

with `boundsOf(rects)` returning `{minX,minY,maxX,maxY}`. If `CachedContext2D` lacks `beginPath`/`rect`/`clip` passthroughs (check `src/renderer/gc.ts` — save/restore exist at :101–106), add them as plain passthrough methods following the existing property-forwarding idiom in that file. `ResolvedDamage`/`Rect` types import from `../core/damageLedger`.

In `byRows.ts`, at each `for (…vs.visibleRows…)` loop that paints row content (lines ~130, 151, 157, 212, 282 — every loop whose body draws), add the cull guard as the FIRST statement:

```ts
const db = pctx.damageBounds;
// per row:
if (db && (row.bottom < db.minY || row.top > db.maxY)) continue;
```

and in the per-column loops (~110, 244): `if (db && (colRight < db.minX || colLeft > db.maxX)) continue;` using the loop's existing x/width locals. Add `damageBounds` to the painter-context type (`renderer/painters/types.ts` — find the `pctx` interface there).

- [ ] **Step 4: Wire ledger + stats + API in velocityGrid.ts**

At the class fields (near `hoveredRowIndex`, :699): add

```ts
private readonly damageLedger = new DamageLedger();
private paintStats = { paints: 0, fullPaints: 0, partialPaints: 0, blits: 0, lastRects: 0, lastAreaPct: 100, avgPaintMs: 0, worstPaintMs: 0 };
```

Replace the paint closure at :1450 (`paint: (gc) => this.renderer.paint(gc)`) with:

```ts
paint: (gc) => {
  const t0 = performance.now();
  const damage = this.options.suppressPartialRepaint
    ? { full: true as const, rects: [], blit: null }
    : this.damageLedger.takeResolved(this.buildDamageResolveCtx());
  this.renderer.paint(gc, damage);
  const ms = performance.now() - t0;
  const s = this.paintStats;
  s.paints++;
  if (damage.full) { s.fullPaints++; s.lastRects = 0; s.lastAreaPct = 100; }
  else {
    s.partialPaints++;
    if (damage.blit) s.blits++;
    s.lastRects = damage.rects.length;
    const area = damage.rects.reduce((a, r) => a + r.w * r.h, 0);
    const ca = this.canvasBounds.width * this.canvasBounds.height;
    s.lastAreaPct = ca > 0 ? Math.round((area / ca) * 1000) / 10 : 0;
  }
  s.avgPaintMs = s.avgPaintMs === 0 ? ms : s.avgPaintMs * 0.9 + ms * 0.1;
  if (ms > s.worstPaintMs) s.worstPaintMs = ms;
},
```

Add `buildDamageResolveCtx(): DamageResolveCtx` as a private method reading the live `this.viewportState` (`vs.bodyTop/bodyBottom/bodyLeft/bodyRight`, `vs.visibleRows`, `vs.visibleColumns`), `this.canvasBounds`, `devicePixelRatio`; `stickyBandBottom` from the sticky-ancestors band the renderer uses (`getStickyAncestors()` — band height = ancestors.length × their row height; read how `stickyGroups.ts` computes `lastRowBottom` and mirror; return null when no ancestors); `rowBand(local)` scans `vs.visibleRows` for the DataSubgrid row with `localRowIndex === local`; `rowIndexForRowId(id)` scans the CURRENT chunk (`this.lastChunk` or whatever field `handleViewportChunk` stores — find with `grep -an "chunk.rowIds" src/velocityGrid.ts | head`) for `rowIds[i] === id` → `rowStart + i`; `colBounds(colId)` scans `vs.visibleColumns`.

Add the three repaint helpers near `refresh()` (~:5217):

```ts
private repaintFull(): void { this.damageLedger.add({ kind: 'full' }); this.cgridCanvas.requestRepaint(); }
private repaintRows(rowIndices: number[]): void {
  if (this.options.suppressPartialRepaint) return this.repaintFull();
  this.damageLedger.add({ kind: 'rows', rowIndices }); this.cgridCanvas.requestRepaint();
}
private repaintCells(cells: Array<{ rowId: number; colId: string }>): void {
  if (this.options.suppressPartialRepaint) return this.repaintFull();
  this.damageLedger.add({ kind: 'cells', cells }); this.cgridCanvas.requestRepaint();
}
```

Public API (add to `VelocityGridApi` in `src/types/api.ts` with doc comments, and implement on VelocityGrid next to `flashCells` — find with `grep -an "flashCells(" src/velocityGrid.ts`):

```ts
getPaintStats(): PaintStats { return { ...this.paintStats }; }
resetPaintStats(): void { this.paintStats = { paints: 0, fullPaints: 0, partialPaints: 0, blits: 0, lastRects: 0, lastAreaPct: 100, avgPaintMs: 0, worstPaintMs: 0 }; }
```

`PaintStats` interface lives in `src/types/api.ts` and re-exports from the package entry alongside the other API types. Add `suppressPartialRepaint?: boolean` to `VelocityGridOptions` (find the options interface: `grep -rn "interface VelocityGridOptions" src/types`).

**Critical invariant of this task:** no `requestRepaint()` call site is migrated yet — every existing caller records nothing, the ledger resolves EMPTY → FULL, so behavior is byte-identical to today. This task must be a pure no-op for rendering output.

- [ ] **Step 5: Run tests** — `npx vitest run tests/rendererDamage.test.ts` PASS, then FULL kernel suite (`npx vitest run`) — all 3152+ pass unchanged (proves the no-op invariant), `npx tsc --noEmit`, `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/kernel/src packages/kernel/tests/rendererDamage.test.ts
git commit -m "feat(kernel): damage-aware Renderer.paint + PaintStats API — ledger plumbed, no sources migrated yet"
```

---

### Task 3: Tick + flash damage (worker touchedRows → rows; flash → cells)

**Files:**
- Modify: `packages/kernel/src/worker/worker.ts` (queue flush ~:428–455), `src/worker/workerState.ts` (add `pendingTouched`), `src/worker/viewportSlicer.ts` (~:361–412), `src/worker/protocol.ts` (ViewportChunk field)
- Modify: `packages/kernel/src/velocityGrid.ts` — `handleViewportChunk` (:7508–7620), flash tick loop (:7710–7735)
- Modify: `packages/kernel/src/core/flashRegistry.ts` (expose active cell keys)
- Test: `packages/kernel/tests/viewportSlicerTouched.test.ts`, extend `tests/paintStats.integration.test.ts` (created here)

**Interfaces:**
- Consumes: `repaintRows`, `repaintCells`, `repaintFull` from Task 2.
- Produces: `ViewportChunk.touchedRows?: Uint32Array` — window-relative row indices whose row was touched since the previous slice for this client; rides the structured-clone path (NOT chunkFormat binary — mirror how `stringRowIds` is documented at protocol.ts:164–172). `FlashRegistry.activeCells(): Array<{ rowId: number; colId: string }>`.

- [ ] **Step 1: Failing slicer test** — `tests/viewportSlicerTouched.test.ts`: drive the slicer the way `tests/viewportSlicer.test.ts` does (copy its fixture setup), pass a `pendingTouched: Set<string>` containing one visible rowId and one off-window rowId, assert the chunk's `touchedRows` contains exactly the window-relative index of the visible one; assert `touchedRows` is `undefined` when the set is empty.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Worker implementation**

  - `workerState.ts`: add `pendingTouched: Set<string>` next to `pendingFlashes` (initialized alongside it — `pendingFlashes: new Map()` site, worker.ts:551).
  - `worker.ts` flush fn (:448–452): after the loop populates `touched`, add `for (const id of touched) state!.pendingTouched.add(id);`.
  - `viewportSlicer.ts`: alongside the flashMask block (:361–395), build `touchedRows` with the same window walk (`visibleOrder[rowStart + r]` / `postFilterIds[entry.rowIndex]` idiom):

```ts
let touchedRows: Uint32Array | undefined;
if (pendingTouched !== undefined && pendingTouched.size > 0 && count > 0) {
  const hit: number[] = [];
  for (let r = 0; r < count; r++) {
    const entry = visibleOrder[rowStart + r]!;
    if (entry.kind !== 'row') continue;
    const rowId = postFilterIds[entry.rowIndex];
    if (rowId !== undefined && pendingTouched.has(rowId)) hit.push(r);
  }
  if (hit.length > 0) touchedRows = Uint32Array.from(hit);
}
```

  add `touchedRows` to the returned chunk (:398+) and thread `pendingTouched` into the slicer with the same plumbing `pendingFlashes` uses (trace its parameter path from the getViewport handler — `grep -rn "pendingFlashes" src/worker/handlers src/worker/viewportSlicer.ts`). **Drain rule: clear `pendingTouched` exactly where `pendingFlashes` is drained/cleared after a slice — mirror its lifecycle line-for-line** (find with `grep -rn "pendingFlashes.clear\|pendingFlashes = new" src/worker`). Protocol: add to `ViewportChunk` after `flashMask`:

```ts
/** Damage-region rendering — window-relative indices of rows touched by
 *  transactions since the previous slice for this client. Structured-clone
 *  path (like stringRowIds); absent ⇒ receiver must treat the whole chunk
 *  as changed (full damage), present-but-empty never ships (undefined
 *  instead). See specs/2026-07-11-damage-region-rendering-design.md §3d. */
touchedRows?: Uint32Array;
```

  If `normalizeViewportChunk` (protocol.ts — grep it) fills defaults for optional fields, leave `touchedRows` absent (absence is meaningful).

- [ ] **Step 4: Main-thread wiring in `handleViewportChunk` (velocityGrid.ts :7610–7616)**

Replace the tail `this.recomputeViewport(); this.cgridCanvas.requestRepaint();` with:

```ts
this.refreshRowHeightIndex(chunk);
this.recomputeViewport();
// Damage-region: a chunk for the SAME window whose touchedRows names the
// changed rows repaints only those bands. A chunk with no touchedRows field
// (older worker, first fetch, window move, sort/filter reorder) repaints
// fully — absence means "unknown", never "nothing".
const sameWindow = chunk.rowStart === this.lastDamageWindowStart && chunk.rowCount === this.lastDamageWindowCount;
this.lastDamageWindowStart = chunk.rowStart; this.lastDamageWindowCount = chunk.rowCount;
if (sameWindow && chunk.touchedRows !== undefined) {
  const indices: number[] = [];
  for (const r of chunk.touchedRows) indices.push(chunk.rowStart + r);
  this.repaintRows(indices);
} else {
  this.repaintFull();
}
this.updateA11y();
```

with `private lastDamageWindowStart = -1; private lastDamageWindowCount = -1;` fields. NOTE: `rows` damage uses DATA-local indices — confirm `chunk.rowStart + r` matches `ViewportRow.localRowIndex` space (the slicer's `rowStart` is the data-window start; `viewport.ts` builds `localRowIndex` from the same space — verify with one integration test before trusting, and if they differ, convert in `rowBand()`; the integration test in Step 6 is the proof).

Also: group/total flash diffs in the same function (the `groupFlashMap.set` loops at :7579–7600) — those cells live on group/footer rows; ship their damage as `repaintFull()` ONLY when `groupFlashMap` gained entries this chunk and `sameWindow` was true (replace the partial branch with full in that case — group rows aren't in `touchedRows`). Concretely: track `const groupFlashChanged = /* set in the two diff loops */;` and use `if (sameWindow && chunk.touchedRows !== undefined && !groupFlashChanged)` for the partial branch.

- [ ] **Step 5: Flash loop damage**

`flashRegistry.ts`: add

```ts
/** Active (non-expired) cell keys for damage-region repaints. */
activeCells(): Array<{ rowId: number; colId: string }> {
  const out: Array<{ rowId: number; colId: string }> = [];
  for (const e of this.entries.values()) out.push({ rowId: e.rowId, colId: e.colId });
  return out;
}
```

In `FlashRegistry.tick` (:168–178), the `deps.requestRepaint()` dep is wired from cgrid — change the dep wiring (find `new FlashRegistry(` in velocityGrid.ts) so the registry's repaint dep calls `this.repaintCells(this.flashRegistry.activeCells())` instead of raw requestRepaint. In the grid's own flash tick loop (velocityGrid.ts :7725), the `groupFlashMap` branch keeps `requestRepaint()` **replaced by `this.repaintFull()`** (group rows have no rowId-cell rects yet — full is the correct conservative damage; note this in a comment).

- [ ] **Step 6: Integration test** — `tests/paintStats.integration.test.ts` using the `buildWiredGrid` harness idiom from `tests/cgrid.integration.test.ts` (copy the local helper; wire a real worker via createWorkerHost fake):
  1. Boot grid with data, wait first paint → `getPaintStats().fullPaints >= 1`.
  2. `resetPaintStats()`; apply an async transaction updating 2 rows; flush; pump RAF (the harness idiom for flushing paints — search how existing integration tests await paint side-effects, e.g. the flash tests).
  3. Assert `getPaintStats().partialPaints >= 1` and `lastAreaPct < 30`.
  4. Set `suppressPartialRepaint: true` on a second grid; same transaction → `partialPaints === 0`.

- [ ] **Step 7: Full suite + typecheck + build + commit**

```bash
git add -A packages/kernel
git commit -m "feat(kernel): tick + flash damage — worker touchedRows protocol, chunk rows-damage, flash cell rects"
```

---

### Task 4: Hover, selection, and focus damage

**Files:**
- Modify: `packages/kernel/src/interaction/features/onHover.ts` (:39, :74), `packages/kernel/src/velocityGrid.ts` (selection onChange :2294–2327, setHoveredRow dep :1710)
- Test: extend `packages/kernel/tests/paintStats.integration.test.ts`

**Interfaces:**
- Consumes: `repaintRows`/`repaintFull` (Task 2). Hover/selection features reach the grid through `ctx.grid` (`VelocityGridEventCtx['grid']`) — extend that structural type with `repaintRows?: (rows: number[]) => void` (find it: `grep -rn "interface VelocityGridEventCtx" src/interaction`), optional so tests with stub grids still compile.

- [ ] **Step 1: Failing integration tests** (same harness): (a) simulate hover row change via the grid's `setHoveredRow` path + assert a partial paint with small area; (b) focus a cell (`setFocusedCell` or the selection API used by existing tests) → partial; (c) select-all → full (row-selection of everything must NOT enumerate 5k rows into the ledger).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

  - `onHover.ts` `handleMouseMove` (:74): replace `ctx.grid.canvas.requestRepaint()` with

```ts
const rows: number[] = [];
if (prevRow !== null) rows.push(prevRow);
if (nextRow !== null) rows.push(nextRow);
if (rows.length && ctx.grid.repaintRows) ctx.grid.repaintRows(rows);
else ctx.grid.canvas.requestRepaint();
```

    and `reset` (:39): damage the previously hovered row the same way (prev row index from `prev`), falling back to `requestRepaint()`.
  - Selection onChange (velocityGrid.ts :2324): compute damage from the state delta. Keep a `lastSelectionDamage` snapshot `{ selectedRowIndices: number[] | 'all', focusedRowIndex: number | null, rangeRects: string }`. Rules:
    - focus-only change (selection sets untouched, ranges unchanged): `repaintRows([oldFocusRow, newFocusRow].filter(n => n !== null))`.
    - row-selection change where `|old Δ new| ≤ 24` indices: `repaintRows(delta)`.
    - anything else (range gestures, select-all, header select, >24 rows): `repaintFull()`.
    Serialize ranges cheaply (`JSON.stringify(state.cellRanges ?? [])` — find the actual field name on the selection state: `grep -n "cellRanges\|ranges" src/interaction/selectionModel.ts | head`) to detect range changes. Range-rect precision is future work — full on range change is correct and still rare.
  - `setHoveredRow` dep (:1710) requires no change (the feature calls repaint itself).

- [ ] **Step 4: Run tests → pass; full suite; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add -A packages/kernel
git commit -m "feat(kernel): hover + selection/focus damage — row-band repaints for pointer + focus churn"
```

---

### Task 5: Scroll blit

**Files:**
- Modify: `packages/kernel/src/renderer/renderer.ts` (blit execution), `packages/kernel/src/velocityGrid.ts` (afterScrollTick :1332, blit-decision state), `packages/kernel/src/renderer/gc.ts` (drawImage passthrough if missing)
- Test: `packages/kernel/tests/scrollBlit.test.ts` + extend `tests/paintStats.integration.test.ts`

**Interfaces:**
- Consumes: `Damage {kind:'scroll'}` (Task 1), renderer damage path (Task 2).
- Produces: `Renderer` blit step; `RendererOpts.getCanvasElement?: () => HTMLCanvasElement` (needed as `drawImage` source).

- [ ] **Step 1: Failing unit test** — `tests/scrollBlit.test.ts` for a pure decision function:

```ts
import { decideScrollDamage } from '../src/core/damageLedger'; // exported helper

it('pure vertical scroll within body height → scroll damage', () => {
  expect(decideScrollDamage({ dx: 0, dy: 48, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
    .toEqual({ kind: 'scroll', dy: 48 });
});
it('horizontal component → full', () => {
  expect(decideScrollDamage({ dx: 3, dy: 48, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
    .toEqual({ kind: 'full' });
});
it('|dy| >= bodyHeight → full', () => {
  expect(decideScrollDamage({ dx: 0, dy: 600, bodyHeight: 500, dprChanged: false, boundsChanged: false }))
    .toEqual({ kind: 'full' });
});
it('dpr/bounds change → full', () => {
  expect(decideScrollDamage({ dx: 0, dy: 10, bodyHeight: 500, dprChanged: true, boundsChanged: false }))
    .toEqual({ kind: 'full' });
});
```

- [ ] **Step 2: Verify failure; implement `decideScrollDamage` in `damageLedger.ts`** (exact translation of the four rules; spec §5.4).

- [ ] **Step 3: Wire the scroll path.** In velocityGrid.ts `afterScrollTick` (:1332): track `lastPaintedScrollLeft/Top` fields (updated inside the paint closure from Task 2 after each paint); compute `dx/dy` as `current - lastPainted`, call `decideScrollDamage`, `this.damageLedger.add(result)`, then `requestRepaint()`. Horizontal-scroll-only frames therefore go full (Phase B scope is vertical; note in comment). Pinned rows / totals bands: the resolver already redamages the sticky band on scroll (Task 1); ALSO redamage the pinned/totals band rect — extend the ledger's scroll resolution to push every `ctx.pinnedBandRects` rect whenever `blit !== null` (the field exists since Task 1; cgrid's `buildDamageResolveCtx` supplies the totals/pinned-row band rects from its viewport state — find where totals rows get their y-band in `viewport.ts` / `byRows.ts` totals handling).

- [ ] **Step 4: Blit execution in Renderer.paint** — before the clip/fill block:

```ts
if (partial && damage.blit) {
  const canvas = this.opts.getCanvasElement?.();
  if (canvas) {
    const dpr = canvas.width / Math.max(1, w); // backing / CSS ratio
    const bodyTop = pctx.viewport.bodyTop, bodyBottom = pctx.viewport.bodyBottom;
    const dy = damage.blit.dy;
    const sy = (bodyTop + Math.max(0, dy)) * dpr;
    const dyDst = (bodyTop + Math.max(0, -dy)) * dpr;
    const hPx = (bodyBottom - bodyTop - Math.abs(dy)) * dpr;
    if (hPx > 0) gc.drawImage(canvas, 0, sy, w * dpr, hPx, 0, dyDst, w * dpr, hPx);
  }
}
```

  (drawImage in device px with 1:1 scale; if `CachedContext2D` lacks `drawImage`, add the passthrough in gc.ts.) `getCanvasElement` wired in velocityGrid.ts's `new Renderer({...})` bag (:1353): `getCanvasElement: () => this.cgridCanvas.canvas`.

- [ ] **Step 5: Integration test** — programmatic `scrollTo`/`setScrollTop` (find the API existing tests use: `grep -an "scrollTop\|ensureRowIndexVisible" packages/kernel/tests/cgrid.integration.test.ts | head`) by one row height → `getPaintStats().blits >= 1` and `lastAreaPct < 30`. Then a full-page jump (≥ body height) → full paint, `blits` unchanged.

- [ ] **Step 6: Full suite + typecheck + build + commit**

```bash
git add -A packages/kernel
git commit -m "feat(kernel): scroll self-blit — vertical scrolls copy the valid body and repaint only the exposed band"
```

---

### Task 6: Pixel-invariance harness + demo E2E

**Files:**
- Modify: `apps/cgrid-ext-demo/src/main.ts` (expose `window.__paintHarness` when `?paintHarness` is in the URL)
- Create: `apps/cgrid-ext-demo/e2e/paintInvariance.spec.ts`

**Interfaces:**
- Consumes: `getPaintStats`, `resetPaintStats`, `suppressPartialRepaint` (grid option), `api.flashCells`, `applyTransactionAsync` (via `window.__ext.grid`), plus a second grid instance created by the harness hook.

- [ ] **Step 1: Harness hook in main.ts.** When `new URLSearchParams(location.search).has('paintHarness')`, after boot expose:

```ts
(window as any).__paintHarness = {
  snapshot(): string {
    const c = document.querySelector('.vg-canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let h = 0; // FNV-1a over every 16th byte — fast, deterministic
    for (let i = 0; i < d.length; i += 16) { h ^= d[i]!; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  },
};
```

**getImageData on the live canvas can force the canvas off the GPU for the page's lifetime — that is why this is a dedicated `?paintHarness` page and never default-on.** Also disable the STOMP feed under `?paintHarness` (skip `connectStomp`) so the two runs see identical data; seed deterministic rows instead (reuse the demo's Position type with a fixed 200-row array and a fixed RNG seed — write a tiny `mulberry32(42)` inline).

- [ ] **Step 2: The invariance spec.** `e2e/paintInvariance.spec.ts` — two pages: `/?paintHarness` (partial) and `/?paintHarness&suppressPartial` (main.ts maps `suppressPartial` → `suppressPartialRepaint: true` in grid options). Scripted steps executed IDENTICALLY on both pages, hashing after each step and requiring pumped-settled paints (a `waitForFunction` that two consecutive RAFs produce no new paints — expose `getPaintStats().paints` and wait for it to stabilize):

```ts
const STEPS: Array<{ name: string; run: (g: any) => void | Promise<void> }> = [
  { name: 'tx-update-2rows', run: (g) => g.applyTransactionAsync({ update: [{ positionId: 'HARNESS-0003', pnl: 111111 }, { positionId: 'HARNESS-0007', pnl: -222222 }] }) }, // ids from the seeded 200-row set (HARNESS-<i>)
  { name: 'flash-cells',     run: (g) => g.flashCells({ rowIds: ['HARNESS-0003', 'HARNESS-0007'], columns: ['pnl'] }) },
  { name: 'hover-row',       run: () => { /* dispatch mousemove over row 5 via page.mouse.move on canvas coords */ } },
  { name: 'focus-cell',      run: (g) => g.setFocusedCell(3, 'pnl') },
  { name: 'select-range',    run: (g) => g.addCellRange({ rowStart: 2, rowEnd: 6, colIds: ['pnl', 'dv01'] }) },
  { name: 'scroll-3rows',    run: (g) => g.setScrollTop(96) },
  { name: 'scroll-back',     run: (g) => g.setScrollTop(0) },
  { name: 'flash-expire',    run: () => new Promise((r) => setTimeout(r, 1800)) },
];
```

For each step: run on partial page → settle → `hashP = __paintHarness.snapshot()`; run on suppressed page → settle → `hashF`; `expect(hashP).toBe(hashF)` with the step name in the assertion message. After all steps assert on the partial page `getPaintStats().partialPaints > getPaintStats().fullPaints`. (Exact API names — `setFocusedCell`, `setScrollTop`, `addCellRange` signatures — verify against `src/types/api.ts` and adjust; behavioral contract binding, names not.) Flash timing: `flash-expire` waits past `cellFlashDuration + cellFadeDuration` so both pages settle to no-flash pixels before hashing.

- [ ] **Step 3: Run** `cd apps/cgrid-ext-demo && npx playwright test paintInvariance.spec.ts` until green. A hash mismatch is a REAL BUG in Tasks 2–5's bleed handling — fix the kernel, never widen the hash stride or skip the step.

- [ ] **Step 4: Live-tick stats spec.** Second test in the same file against the NORMAL demo page (no `?paintHarness`, STOMP feed live): wait for rows, `resetPaintStats()`, wait 5s of ticking, then assert `getPaintStats().partialPaints > getPaintStats().fullPaints * 3` and `lastAreaPct < 5` (spec §7). Skip gracefully (`test.skip`) when the feed is unreachable so CI without ws://8081 stays green — but it must RUN in the Task 7 gate.

- [ ] **Step 5: Full demo E2E suite** (`npx playwright test`) — all pre-existing specs still green. Kill any processes started.

- [ ] **Step 6: Commit**

```bash
git add apps/cgrid-ext-demo
git commit -m "test(e2e): pixel-invariance harness — partial and full painting produce identical pixels per step"
```

---

### Task 7: Verification gates + OpenFin measurement + docs

**Files:**
- Modify: `apps/cgrid-ext-demo/openfin/PERF-NOTES.md` (results section)
- Test: full suites + OpenFin probe run

- [ ] **Step 1: Full gates** — kernel suite + tsc + build; ext suite; calc suite (untouched but cheap); full demo E2E.

- [ ] **Step 2: OpenFin measurement.** Rebuild demo (`npm run build`), serve `npx vite preview --port 4188 --strictPort`, launch OpenFin runtime 41.134.102.3 with the repo manifest **from a shell without `ELECTRON_RUN_AS_NODE`** (see PERF-NOTES.md reproduction section), run `node openfin/perf-probe.mjs 9223 openfin-damage` twice (discard the warm-up run). Success bar (spec §7): steady-state **zero frames >50ms** over the probe window at default tick load, scroll p99 ≤ 34ms. Record the numbers in PERF-NOTES.md under a "After damage-region rendering" section, alongside `getPaintStats()` output (areaPct under ticking). Kill the runtime + preview after.

- [ ] **Step 3: If the bar is missed** — do NOT tune blindly: capture `getPaintStats()` (is `fullPaints` unexpectedly high? which source still records full?) and report findings in the task report for the closeout review to adjudicate. The spec's Phase-C trigger (row-strip bitmap cache) is a USER decision, not an implementer escalation.

- [ ] **Step 4: Commit**

```bash
git add apps/cgrid-ext-demo/openfin/PERF-NOTES.md
git commit -m "docs(demo): OpenFin re-measured after damage-region rendering"
```

---

### Batch closeout (after Task 7)

Single closeout review (fable) over the whole batch + ONE fix wave — no per-task reviewers. Review lenses: the Global Constraints above verbatim; cross-task seams (ledger semantics vs renderer consumption vs source wiring); the no-op invariant of Task 2; drain-lifecycle parity of `pendingTouched` with `pendingFlashes`; test-weakening (especially any invariance-step deletion or hash-stride widening); silent scope drift.
