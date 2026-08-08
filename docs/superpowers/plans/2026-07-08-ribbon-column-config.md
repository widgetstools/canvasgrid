# Ribbon Quick Column Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the focused/selected column(s)' common features from the ribbon — floating filter, filter type (incl. set), groupable, pivotable, aggregation (function + header visibility), sortable/resizable/editable/pinned/hidden — via a new Column group (⚙ popover + live agg pill + quick toggles) replacing the dead Edit/Group placeholder groups.

**Architecture:** Phase A (Task 1-2) plumbs seven def-level flags through calc's own-template pipeline (`ColumnEditPatch` → `EDITABLE_SCALAR_KEYS` → fold `SCALAR_KEYS` → `overrideToKernelPatch`) so they persist via templates/layouts exactly like `editable`/`hide`/`width`. Aggregation and pinning use the kernel's existing runtime APIs (value columns / `setColumnsPinned`), which already persist via grid state. Phase B (Tasks 3-5) builds the popover + ribbon group in ext from the shared control factories. Task 6 is the E2E gate.

**Tech Stack:** TypeScript; vitest (calc/kernel/ext); plain DOM + `--vg-*` tokens in ext (factories from `toolbar/ui.ts`); Playwright E2E in `apps/cgrid-ext-demo`.

**Spec:** `docs/superpowers/specs/2026-07-08-ribbon-column-config-design.md`

## Global Constraints

- Def-level flags ride calc own-templates; NO `updateGridOptions({ columnDefs })` def-churn anywhere in this feature.
- Aggregation uses `getValueColumns` / `addValueColumn` / `setValueColumnAggFunc` / `removeValueColumn` (never templates); pinned uses `setColumnsPinned`; hidden uses `editColumn({ hide })`.
- `filter: null` removes the stored key (same convention as `format`/`cellIcon`); stored templates never hold `null`.
- All ext controls built from the shared factories — `menu()` for the popover (never hand-rolled positioning/click-away), the labeled-trigger chrome for the ⚙ button; `vgext-col-` class prefix; `--vg-*` tokens with neutral-dark fallbacks; 12px font (bar-uniform rule).
- Apply per `targetCols()` (Selected/All scope fans out); popover stays open across edits; Escape closes; no selection → hint row + disabled quick controls.
- Kernel throws surface non-fatally (row error tint + title), never crash the panel.
- Working branch: `cgridext/ribbon-density`. Commit after every task.
- Suites: `cd packages/<pkg> && npx vitest run && npx tsc --noEmit`. Kernel changes require `npm run build` in packages/kernel before demo E2E. E2E: `cd apps/cgrid-ext-demo && npx playwright test` (kill stale :5188 before, kill server/browser after).

---

### Task 1: Calc — def-flag keys through the own-template pipeline

**Files:**
- Modify: `packages/calc/src/types.ts` (`ColumnOverride`, ~:64-77)
- Modify: `packages/calc/src/calcEngine.ts` (`EDITABLE_SCALAR_KEYS` :78, `ColumnEditPatch` :80-93, the null-removal block after the scalar merge)
- Modify: `packages/calc/src/templates.ts` (`SCALAR_KEYS` :12-14)
- Modify: `packages/calc/src/overrides.ts` (`overrideToKernelPatch`)
- Test: `packages/calc/tests/columnConfigFlags.test.ts` (new)

**Interfaces:**
- Produces: `ColumnEditPatch` accepts `floatingFilter?: boolean; filter?: 'text' | 'number' | 'date' | 'set' | null; enableRowGroup?: boolean; enablePivot?: boolean; sortable?: boolean; resizable?: boolean; suppressAggFuncInHeader?: boolean`. `resolvedPatchFor` forwards all seven verbatim onto the kernel colDef patch. Tasks 2/4/6 rely on these exact key names.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/calc/tests/columnConfigFlags.test.ts
import { describe, it, expect } from 'vitest';
import { CalcEngine } from '../src/calcEngine';

// Mirror the local fixture idiom of packages/calc/tests (see editColumn
// coverage there): a bare engine + resolvedPatchFor readback.
const makeEngine = () => new CalcEngine();

describe('editColumn — column-config def flags', () => {
  it('merges every flag into the own template and resolvedPatchFor forwards them', () => {
    const e = makeEngine();
    const res = e.editColumn('px', {
      floatingFilter: true,
      filter: 'set',
      enableRowGroup: true,
      enablePivot: false,
      sortable: false,
      resizable: false,
      suppressAggFuncInHeader: true,
    }, { now: 1 });
    expect(res.ok).toBe(true);
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.floatingFilter).toBe(true);
    expect(patch.filter).toBe('set');
    expect(patch.enableRowGroup).toBe(true);
    expect(patch.enablePivot).toBe(false);   // defined-falsy must land
    expect(patch.sortable).toBe(false);
    expect(patch.resizable).toBe(false);
    expect(patch.suppressAggFuncInHeader).toBe(true);
  });

  it('filter: null removes the stored key (format/cellIcon parity)', () => {
    const e = makeEngine();
    e.editColumn('px', { filter: 'set' }, { now: 1 });
    expect(e.resolvedPatchFor('px', 'number')!.filter).toBe('set');
    e.editColumn('px', { filter: null }, { now: 2 });
    expect(e.resolvedPatchFor('px', 'number')!.filter).toBeUndefined();
  });

  it('flags fold through shared template chains (later layer wins, defined-falsy wins)', () => {
    const e = makeEngine();
    e.saveTemplate({ id: 't1', name: 'T1', overrides: { enableRowGroup: true, sortable: true } }, { now: 1 });
    e.applyTemplate('px', 't1');
    e.editColumn('px', { sortable: false }, { now: 2 }); // own template folds highest
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.enableRowGroup).toBe(true);
    expect(patch.sortable).toBe(false);
  });

  it('partial patches leave unrelated flags untouched', () => {
    const e = makeEngine();
    e.editColumn('px', { floatingFilter: true }, { now: 1 });
    e.editColumn('px', { enableRowGroup: true }, { now: 2 });
    const patch = e.resolvedPatchFor('px', 'number')!;
    expect(patch.floatingFilter).toBe(true);
    expect(patch.enableRowGroup).toBe(true);
  });
});
```

Adapt `makeEngine`/`saveTemplate`/`applyTemplate` call shapes to the engine's actual signatures (check neighboring tests — `saveTemplate` may take `(template, { now })` or stamp internally; the behavioral contract above is binding, the helper shapes are not).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/calc && npx vitest run tests/columnConfigFlags.test.ts`
Expected: FAIL — the patch keys don't exist / typecheck errors on the patch literal.

- [ ] **Step 3: Implement**

`types.ts` — extend `ColumnOverride` (after `width?: number;`):
```ts
  /** Column-config def flags (ribbon quick column configuration). Stored
   *  values only — `filter` never holds null in a template. */
  floatingFilter?: boolean;
  filter?: 'text' | 'number' | 'date' | 'set';
  enableRowGroup?: boolean;
  enablePivot?: boolean;
  sortable?: boolean;
  resizable?: boolean;
  suppressAggFuncInHeader?: boolean;
```

`calcEngine.ts`:
```ts
const EDITABLE_SCALAR_KEYS = [
  'format', 'cellRenderer', 'editable', 'hide', 'width',
  'floatingFilter', 'filter', 'enableRowGroup', 'enablePivot',
  'sortable', 'resizable', 'suppressAggFuncInHeader',
] as const;
```
`ColumnEditPatch`: widen the `Pick` to include the six boolean flags
(`'floatingFilter' | 'enableRowGroup' | 'enablePivot' | 'sortable' | 'resizable' | 'suppressAggFuncInHeader'`)
and add alongside `format`:
```ts
  /** Filter type. `null` REMOVES the stored key (revert to the
   *  cellDataType default); undefined leaves it untouched. */
  filter?: 'text' | 'number' | 'date' | 'set' | null;
```
After the existing `if (patch.format === null) delete target.format;` add:
```ts
    // filter — `null` → remove from the own template (format parity).
    if (patch.filter === null) delete target.filter;
```

`templates.ts`:
```ts
const SCALAR_KEYS = [
  'headerName', 'format', 'cellRenderer', 'editable', 'hide', 'width',
  'floatingFilter', 'filter', 'enableRowGroup', 'enablePivot',
  'sortable', 'resizable', 'suppressAggFuncInHeader',
] as const satisfies ReadonlyArray<keyof TemplateOverrides>;
```

`overrides.ts` — after `if (merged.width !== undefined) patch.width = merged.width;`:
```ts
  // Column-config def flags — forwarded verbatim; the kernel colDef carries
  // each under the same name (types/column.ts: floatingFilter :198,
  // filter :186, enablePivot :509, enableValue-adjacent flags, sortable/
  // resizable resolveColDef defaults, suppressAggFuncInHeader :231).
  if (merged.floatingFilter !== undefined) patch.floatingFilter = merged.floatingFilter;
  if (merged.filter !== undefined) patch.filter = merged.filter;
  if (merged.enableRowGroup !== undefined) patch.enableRowGroup = merged.enableRowGroup;
  if (merged.enablePivot !== undefined) patch.enablePivot = merged.enablePivot;
  if (merged.sortable !== undefined) patch.sortable = merged.sortable;
  if (merged.resizable !== undefined) patch.resizable = merged.resizable;
  if (merged.suppressAggFuncInHeader !== undefined) patch.suppressAggFuncInHeader = merged.suppressAggFuncInHeader;
```

- [ ] **Step 4: Verify green + full suites**

Run: `cd packages/calc && npx vitest run && npx tsc --noEmit && cd ../kernel && npx vitest run 2>&1 | tail -3 && npx tsc --noEmit`
Expected: calc green (new file + existing), kernel green (patch type flows into `VelocityGridApi.editColumn`).

- [ ] **Step 5: Commit**

```bash
git add packages/calc/src packages/calc/tests/columnConfigFlags.test.ts
git commit -m "feat(calc): column-config def flags ride own-templates — floatingFilter/filter/group/pivot/sortable/resizable/aggHeader"
```

---

### Task 2: Kernel integration — template-borne flags reach the resolved surface

**Files:**
- Test: `packages/kernel/tests/columnConfigFlags.integration.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's patch keys via the public `grid.editColumn`; `@wellsfargo-starui/velocity-grid-calc`'s `wireIntoKernel` (kernel devDeps already include sibling packages — precedent: `conditionalRuleRender.integration.test.ts` wires `@wellsfargo-starui/velocity-grid-rules`).
- Produces: proof the flags flow template → calcSlot → resolved colDef; Task 6's E2E builds on the same behaviors in a real browser.

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/tests/columnConfigFlags.integration.test.ts
import { describe, it, expect } from 'vitest';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';

// Reuse the wired-grid harness idiom from cgrid.integration.test.ts
// (buildWiredGrid with the fake Worker routed through createWorkerHost) —
// copy the local helper, don't import across test files.

describe('column-config flags — template → resolved def', () => {
  it('editColumn flags reach the resolved colDef and survive a defs rebuild', async () => {
    const { grid, restore } = buildWiredGrid(
      [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }],
      [{ field: 'id' }, { field: 'qty', type: 'number' }],
    );
    wireCalc(grid as never);
    await new Promise((r) => setTimeout(r, 50));

    grid.editColumn('qty', {
      floatingFilter: true, filter: 'set', enableRowGroup: true,
      sortable: false, suppressAggFuncInHeader: true,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    // Resolved def readback — the calcSlot folds the patch pre-resolve.
    const def = (grid as any).columnDefsMap.get('qty');
    expect(def.floatingFilter).toBe(true);
    expect(def.filter).toBe('set');
    expect(def.enableRowGroup).toBe(true);
    expect(def.sortable).toBe(false);
    expect(def.suppressAggFuncInHeader).toBe(true);

    // filter: null reverts to the type default (key gone from the def).
    grid.editColumn('qty', { filter: null } as never);
    await new Promise((r) => setTimeout(r, 50));
    expect((grid as any).columnDefsMap.get('qty').filter).toBeUndefined();

    grid.destroy();
    restore();
  });

  it('flags round-trip getState/setState via the calc module slices', async () => {
    const { grid, restore } = buildWiredGrid(
      [{ id: 'a', qty: 1 }],
      [{ field: 'id' }, { field: 'qty', type: 'number' }],
    );
    wireCalc(grid as never);
    await new Promise((r) => setTimeout(r, 50));
    grid.editColumn('qty', { enableRowGroup: true, floatingFilter: true } as never);
    await new Promise((r) => setTimeout(r, 50));
    const snap = grid.getState();
    grid.editColumn('qty', { enableRowGroup: false, floatingFilter: false } as never);
    await new Promise((r) => setTimeout(r, 50));
    grid.setState(snap);
    await new Promise((r) => setTimeout(r, 50));
    const def = (grid as any).columnDefsMap.get('qty');
    expect(def.enableRowGroup).toBe(true);
    expect(def.floatingFilter).toBe(true);
    grid.destroy();
    restore();
  });
});
```

(If `columnDefsMap` values are pre-resolve patches rather than resolved defs, read via the resolved path the harness exposes — assert through whatever the calcSlot writes; the binding contract is "the kernel def surface carries the flags after editColumn".)

- [ ] **Step 2: Run to verify failure/green baseline**

Run: `cd packages/kernel && npx vitest run tests/columnConfigFlags.integration.test.ts`
Expected: with Task 1 landed this may already PASS — that's fine (it's the cross-package proof, TDD-red was Task 1's job). If it fails, the forwarding chain has a gap — fix in calc, not here.

- [ ] **Step 3: Full kernel suite + build**

Run: `npx vitest run 2>&1 | tail -3 && npx tsc --noEmit && npm run build | tail -1`
Expected: all green, build clean.

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/tests/columnConfigFlags.integration.test.ts packages/kernel/package.json
git commit -m "test(kernel): column-config flags — template-borne def flags reach resolved defs + state round-trip"
```

(Include package.json only if `@wellsfargo-starui/velocity-grid-calc` had to be added to devDependencies.)

---

### Task 3: Column popover skeleton — `toolbar/columnPanel.ts` + row factories

**Files:**
- Create: `packages/ext/src/toolbar/columnPanel.ts`
- Create: `packages/ext/tests/columnPanelHarness.ts`
- Test: `packages/ext/tests/columnPanel.test.ts`

**Interfaces:**
- Consumes: `menu`, `svg` from `./ui`.
- Produces (Tasks 4/5 rely on these exact names):

```ts
export type AggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
export interface ColumnConfigGrid {
  editColumn(colId: string, patch: Record<string, unknown>): unknown;
  getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
  getGridOption(key: string): unknown;
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  addValueColumn(colId: string, aggFunc: string): void;
  setValueColumnAggFunc(colId: string, aggFunc: string): void;
  removeValueColumn(colId: string): void;
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null }>;
}
export interface ColumnPanelHost {
  targetCols(): string[];
  grid: ColumnConfigGrid;
  onApplied(): void; // ribbon refresh hook
}
export function columnPanelMenu(anchor: HTMLElement, host: ColumnPanelHost): { toggle(): void; destroy(): void };
// Effective-value resolution (exported for tests + Task 5's quick toggles):
export type FlagKey = 'floatingFilter' | 'filter' | 'enableRowGroup' | 'enablePivot' | 'sortable' | 'resizable' | 'suppressAggFuncInHeader' | 'hide' | 'editable';
export function effectiveFlag(grid: ColumnConfigGrid, colId: string, key: FlagKey): unknown;
export function mixedValue(grid: ColumnConfigGrid, cols: string[], key: FlagKey): { value: unknown; mixed: boolean };
```

DOM contract: panel root `.vgext-menu.vgext-col` (~300px); section heading `.vgext-col-caps`; rows `.vgext-col-row[data-k]` with `.vgext-col-label` + control; switch control `button.vgext-col-switch[aria-checked]` (adds `.is-mixed` when indeterminate); segmented control `.vgext-col-seg` with `button[data-v]`; empty state `.vgext-fmt-empty` (reuse the format-picker class + copy "Select a cell or column first.").

`effectiveFlag` resolution order: own template override (`getTemplates()` `__cgridOwn:<colId>` → `overrides[key]`) → base colDef (walk `getGridOption('columnDefs')` tree by colId) → per-key default: `sortable`/`resizable` → true; `floatingFilter` → `!!getGridOption('floatingFilter')`... the demo enables the filter row grid-wide, so the grid-level option is the fallback; `enableRowGroup`/`enablePivot`/`hide`/`suppressAggFuncInHeader` → false; `editable` → base def ?? `!!defaultColDef.editable` (read `getGridOption('defaultColDef')`); `filter` → undefined (= Auto).

- [ ] **Step 1: Write the harness**

```ts
// packages/ext/tests/columnPanelHarness.ts
import { vi } from 'vitest';
import type { ColumnConfigGrid, ColumnPanelHost } from '../src/toolbar/columnPanel';

export class FakeColumnGrid implements ColumnConfigGrid {
  templates = new Map<string, Record<string, unknown>>(); // colId → own overrides
  defs: Array<Record<string, unknown>> = [
    { colId: 'px', cellDataType: 'number' },
    { colId: 'qty', cellDataType: 'number', enableRowGroup: true },
  ];
  valueCols: Array<{ colId: string; aggFunc: string }> = [];
  pinnedByCol = new Map<string, 'left' | 'right' | null>();
  options: Record<string, unknown> = { columnDefs: this.defs, floatingFilter: true, defaultColDef: { editable: true } };

  editColumn = vi.fn((colId: string, patch: Record<string, unknown>) => {
    const own = this.templates.get(colId) ?? {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete own[k]; else own[k] = v;
    }
    this.templates.set(colId, own);
    return { ok: true };
  });
  getTemplates() {
    return [...this.templates.entries()].map(([colId, overrides]) => ({ id: `__cgridOwn:${colId}`, overrides }));
  }
  getGridOption(key: string) { return this.options[key]; }
  getValueColumns() { return this.valueCols.map((v) => ({ ...v })); }
  addValueColumn = vi.fn((colId: string, aggFunc: string) => { this.valueCols.push({ colId, aggFunc }); });
  setValueColumnAggFunc = vi.fn((colId: string, aggFunc: string) => {
    const v = this.valueCols.find((x) => x.colId === colId); if (v) v.aggFunc = aggFunc;
  });
  removeValueColumn = vi.fn((colId: string) => { this.valueCols = this.valueCols.filter((x) => x.colId !== colId); });
  setColumnsPinned = vi.fn((keys: string[], pinned: 'left' | 'right' | null) => {
    for (const k of keys) this.pinnedByCol.set(k, pinned);
  });
  getColumnState() { return this.defs.map((d) => ({ colId: d.colId as string, pinned: this.pinnedByCol.get(d.colId as string) ?? null })); }
}

export function mountColumnPanel(cols: string[] = ['px'], grid = new FakeColumnGrid()) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const host: ColumnPanelHost = { targetCols: () => cols, grid, onApplied: vi.fn() };
  // Import here so the module registers its styles lazily like the picker.
  const { columnPanelMenu } = require('../src/toolbar/columnPanel') as typeof import('../src/toolbar/columnPanel');
  const m = columnPanelMenu(anchor, host);
  m.toggle();
  const panel = document.querySelector<HTMLElement>('.vgext-menu.vgext-col')!;
  return { anchor, host, grid, m, panel };
}
```

(Use a top-level import if the ESM config rejects `require` — precedent from the format-picker harness.)

- [ ] **Step 2: Write the failing tests**

```ts
// packages/ext/tests/columnPanel.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { effectiveFlag, mixedValue } from '../src/toolbar/columnPanel';
import { FakeColumnGrid, mountColumnPanel } from './columnPanelHarness';

afterEach(() => { document.body.replaceChildren(); });

describe('effectiveFlag resolution', () => {
  it('own template beats base def beats default', () => {
    const g = new FakeColumnGrid();
    expect(effectiveFlag(g, 'qty', 'enableRowGroup')).toBe(true);   // base def
    expect(effectiveFlag(g, 'px', 'enableRowGroup')).toBe(false);   // default
    expect(effectiveFlag(g, 'px', 'sortable')).toBe(true);          // default true
    expect(effectiveFlag(g, 'px', 'floatingFilter')).toBe(true);    // grid option fallback
    g.editColumn('qty', { enableRowGroup: false });
    expect(effectiveFlag(g, 'qty', 'enableRowGroup')).toBe(false);  // own template wins
  });
  it('mixedValue detects divergent targets', () => {
    const g = new FakeColumnGrid();
    g.editColumn('px', { sortable: false });
    expect(mixedValue(g, ['px', 'qty'], 'sortable')).toEqual({ value: undefined, mixed: true });
    expect(mixedValue(g, ['qty'], 'sortable')).toEqual({ value: true, mixed: false });
  });
});

describe('panel anatomy', () => {
  it('renders the four section headings and the empty state without targets', () => {
    const { panel } = mountColumnPanel();
    const caps = [...panel.querySelectorAll('.vgext-col-caps')].map((c) => c.textContent);
    expect(caps).toEqual(['FILTER', 'GROUPING', 'AGGREGATION', 'BEHAVIOR']);
    document.body.replaceChildren();
    const { panel: empty } = mountColumnPanel([]);
    expect(empty.querySelector('.vgext-fmt-empty')!.textContent).toContain('Select a cell or column');
    expect(empty.querySelector('.vgext-col-row')).toBeNull();
  });
  it('switch rows expose aria-checked from effective state', () => {
    const { panel } = mountColumnPanel(['qty']);
    const sw = panel.querySelector<HTMLElement>('.vgext-col-row[data-k="enableRowGroup"] .vgext-col-switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
  it('Escape closes; destroy cleans up', () => {
    const { panel, m } = mountColumnPanel();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-col')).toBeNull();
    m.destroy();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/columnPanel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the skeleton**

```ts
// packages/ext/src/toolbar/columnPanel.ts
/**
 * Column configuration popover — the ribbon's quick per-column settings:
 * FILTER (floating filter, filter type incl. set), GROUPING (row group,
 * pivot), AGGREGATION (function + show-in-header), BEHAVIOR (sortable,
 * resizable, editable, pinned, hidden). Def-level flags write through the
 * calc own-template pipeline (persist via profiles/layouts); aggregation
 * and pinning use the kernel's runtime state APIs. Every edit applies to
 * ALL target columns immediately; the popover stays open for more edits.
 */
import { menu, svg } from './ui';

export type AggFunc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';
export const AGG_FUNCS: readonly AggFunc[] = ['sum', 'avg', 'min', 'max', 'count', 'first', 'last'];

export interface ColumnConfigGrid {
  editColumn(colId: string, patch: Record<string, unknown>): unknown;
  getTemplates(): Array<{ id: string; overrides: Record<string, unknown> }>;
  getGridOption(key: string): unknown;
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  addValueColumn(colId: string, aggFunc: string): void;
  setValueColumnAggFunc(colId: string, aggFunc: string): void;
  removeValueColumn(colId: string): void;
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null }>;
}
export interface ColumnPanelHost {
  targetCols(): string[];
  grid: ColumnConfigGrid;
  onApplied(): void;
}

export type FlagKey =
  | 'floatingFilter' | 'filter' | 'enableRowGroup' | 'enablePivot'
  | 'sortable' | 'resizable' | 'suppressAggFuncInHeader' | 'hide' | 'editable';

const FLAG_DEFAULTS: Partial<Record<FlagKey, unknown>> = {
  sortable: true, resizable: true,
  enableRowGroup: false, enablePivot: false, hide: false, suppressAggFuncInHeader: false,
};

function baseDefOf(grid: ColumnConfigGrid, colId: string): Record<string, unknown> | undefined {
  const walk = (defs: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const d of defs) {
      const def = d as { colId?: string; children?: unknown[] };
      if (def.colId === colId) return def as Record<string, unknown>;
      if (def.children) { const hit = walk(def.children); if (hit) return hit; }
    }
    return undefined;
  };
  try { return walk((grid.getGridOption('columnDefs') as unknown[]) ?? []); } catch { return undefined; }
}

/** Own template → base colDef → per-key default. */
export function effectiveFlag(grid: ColumnConfigGrid, colId: string, key: FlagKey): unknown {
  try {
    const own = grid.getTemplates().find((t) => t.id === `__cgridOwn:${colId}`);
    const v = own?.overrides?.[key];
    if (v !== undefined) return v;
  } catch { /* engine absent */ }
  const base = baseDefOf(grid, colId)?.[key];
  if (base !== undefined) return base;
  if (key === 'floatingFilter') { try { return !!grid.getGridOption('floatingFilter'); } catch { return false; } }
  if (key === 'editable') {
    try { return !!(grid.getGridOption('defaultColDef') as { editable?: boolean } | undefined)?.editable; }
    catch { return false; }
  }
  return FLAG_DEFAULTS[key]; // filter → undefined = Auto
}

/** All targets agree → {value, mixed:false}; else {undefined, mixed:true}. */
export function mixedValue(grid: ColumnConfigGrid, cols: string[], key: FlagKey): { value: unknown; mixed: boolean } {
  const values = cols.map((c) => effectiveFlag(grid, c, key));
  const first = values[0];
  return values.every((v) => v === first) ? { value: first, mixed: false } : { value: undefined, mixed: true };
}

export function columnPanelMenu(anchor: HTMLElement, host: ColumnPanelHost): { toggle(): void; destroy(): void } {
  injectColumnPanelStyles();
  return menu(anchor, (close) => buildPanel(host, close), undefined, { align: 'left' });
}

function buildPanel(host: ColumnPanelHost, close: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vgext-col';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (host.targetCols().length === 0) {
    el.innerHTML = `<div class="vgext-fmt-empty">Select a cell or column first.</div>`;
    return el;
  }
  renderSections(el, host); // Task 4 fills the rows; skeleton renders headings.
  return el;
}

// ── Row factories (Task 4 wires state/apply through these) ────────────────
export function switchRow(
  key: string, label: string,
  state: { value: unknown; mixed: boolean },
  onToggle: (next: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vgext-col-row';
  row.dataset.k = key;
  const lab = document.createElement('span');
  lab.className = 'vgext-col-label';
  lab.textContent = label;
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'vgext-col-switch' + (state.mixed ? ' is-mixed' : '');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', state.mixed ? 'mixed' : String(!!state.value));
  sw.innerHTML = '<span class="vgext-col-knob"></span>';
  sw.addEventListener('click', () => onToggle(state.mixed ? true : !state.value));
  row.append(lab, sw);
  return row;
}

export function segRow(
  key: string, label: string,
  options: Array<{ v: string; text: string }>,
  active: string | undefined, // undefined on mixed → nothing marked
  onPick: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vgext-col-row';
  row.dataset.k = key;
  const lab = document.createElement('span');
  lab.className = 'vgext-col-label';
  lab.textContent = label;
  const seg = document.createElement('span');
  seg.className = 'vgext-col-seg';
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = opt.v;
    b.textContent = opt.text;
    b.classList.toggle('is-on', opt.v === active);
    b.addEventListener('click', () => onPick(opt.v));
    seg.append(b);
  }
  row.append(lab, seg);
  return row;
}

export function sectionCaps(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'vgext-col-caps';
  h.textContent = text;
  return h;
}

// Task 4 replaces this stub body with the four sections.
function renderSections(el: HTMLElement, host: ColumnPanelHost): void {
  el.append(sectionCaps('FILTER'), sectionCaps('GROUPING'), sectionCaps('AGGREGATION'), sectionCaps('BEHAVIOR'));
  void host;
  void svg;
}

export function injectColumnPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('vgext-col-styles')) return;
  const style = document.createElement('style');
  style.id = 'vgext-col-styles';
  style.textContent = COL_CSS;
  document.head.appendChild(style);
}

const COL_CSS = `
.vgext-menu.vgext-col { width: 300px; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.vgext-col-caps {
  padding: 8px 2px 4px; font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-col-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 5px 4px; border-radius: 6px;
}
.vgext-col-row:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.05)); }
.vgext-col-label { font-size: 12px; color: var(--vg-fg-color, #e5e9f0); }
.vgext-col-switch {
  appearance: none; width: 30px; height: 17px; border-radius: 9px; position: relative;
  border: 1px solid var(--vg-border-color, #2a3140);
  background: var(--vg-control-bg, rgba(255,255,255,0.06)); cursor: pointer; flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}
.vgext-col-switch[aria-checked="true"] {
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 55%, transparent);
  border-color: var(--vg-accent-color, #4f9cf9);
}
.vgext-col-knob {
  position: absolute; top: 1px; left: 1px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--vg-fg-color, #e5e9f0); transition: left 120ms ease;
}
.vgext-col-switch[aria-checked="true"] .vgext-col-knob { left: 14px; }
.vgext-col-switch.is-mixed { border-style: dashed; }
.vgext-col-switch.is-mixed .vgext-col-knob { left: 7.5px; opacity: 0.6; }
.vgext-col-switch:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
.vgext-col-seg { display: inline-flex; gap: 2px; }
.vgext-col-seg > button {
  appearance: none; height: 22px; padding: 0 8px; border-radius: 5px;
  border: 1px solid var(--vg-border-color, #2a3140); background: transparent;
  color: var(--vg-muted-fg-color, #9aa4b6); font: inherit; font-size: 11.5px; cursor: pointer;
}
.vgext-col-seg > button.is-on {
  color: var(--vg-accent-color, #4f9cf9); border-color: var(--vg-accent-color, #4f9cf9);
  background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 12%, transparent);
}
.vgext-col-row.is-error { box-shadow: inset 0 0 0 1px var(--vg-neg-color, #e2606c); }
.vgext-col-select {
  height: 24px; padding: 0 6px; border-radius: 6px;
  border: 1px solid var(--vg-border-color, #2a3140);
  background: var(--vg-control-bg, rgba(0,0,0,0.25)); color: var(--vg-fg-color, #e5e9f0);
  font: inherit; font-size: 12px;
}
`;
```

Note the format-picker's `.vgext-fmt-empty` class is styled in formatPicker's stylesheet — the popover reuses the CLASS; ensure `injectFormatPickerStyles()` has run (it has whenever the ribbon rendered) or duplicate the 3-line rule into `COL_CSS` under `.vgext-col .vgext-fmt-empty` — do the latter for standalone safety:
```css
.vgext-col .vgext-fmt-empty { padding: 18px 10px; font-size: 12.5px; color: var(--vg-muted-fg-color, #9aa4b6); }
```

- [ ] **Step 5: Verify green + suite**

Run: `cd packages/ext && npx vitest run tests/columnPanel.test.ts && npx vitest run && npx tsc --noEmit`
Expected: new tests pass, suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/ext/src/toolbar/columnPanel.ts packages/ext/tests/columnPanelHarness.ts packages/ext/tests/columnPanel.test.ts
git commit -m "feat(ext): column popover skeleton — effective-flag resolution, switch/segment row factories"
```

---

### Task 4: Popover sections — live state, immediate apply, mixed state

**Files:**
- Modify: `packages/ext/src/toolbar/columnPanel.ts` (replace `renderSections`)
- Test: `packages/ext/tests/columnPanel.test.ts` (append)

**Interfaces:**
- Consumes: Task 3's factories + host; Task 1's patch keys.
- Produces DOM rows (Task 6 E2E hooks): `data-k` values `floatingFilter`, `filter`, `enableRowGroup`, `enablePivot`, `aggFunc` (a `<select class="vgext-col-select">` with options none+AGG_FUNCS), `aggHeader`, `sortable`, `resizable`, `editable`, `pinned` (seg values `left`/`none`/`right`), `hide`.

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('sections — state read + apply fan-out', () => {
  const row = (panel: HTMLElement, k: string) => panel.querySelector<HTMLElement>(`.vgext-col-row[data-k="${k}"]`)!;

  it('floating filter switch applies editColumn to every target', () => {
    const grid = new FakeColumnGrid();
    const { panel, host } = mountColumnPanel(['px', 'qty'], grid);
    row(panel, 'floatingFilter').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    // grid option floatingFilter=true → effective true → toggle writes false
    expect(grid.editColumn).toHaveBeenCalledWith('px', { floatingFilter: false });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { floatingFilter: false });
    expect(host.onApplied).toHaveBeenCalled();
    expect(document.querySelector('.vgext-menu.vgext-col')).not.toBeNull(); // stays open
  });

  it('filter type segment: Set writes filter:set, Auto writes filter:null', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'filter').querySelector<HTMLElement>('.vgext-col-seg button[data-v="set"]')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { filter: 'set' });
    row(panel, 'filter').querySelector<HTMLElement>('.vgext-col-seg button[data-v="auto"]')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { filter: null });
  });

  it('agg select drives the value-column APIs (add / change / remove)', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    const sel = row(panel, 'aggFunc').querySelector<HTMLSelectElement>('select')!;
    sel.value = 'sum'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.addValueColumn).toHaveBeenCalledWith('px', 'sum');
    grid.valueCols = [{ colId: 'px', aggFunc: 'sum' }];
    sel.value = 'avg'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.setValueColumnAggFunc).toHaveBeenCalledWith('px', 'avg');
    grid.valueCols = [{ colId: 'px', aggFunc: 'avg' }];
    sel.value = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(grid.removeValueColumn).toHaveBeenCalledWith('px');
  });

  it('show-in-header switch writes the INVERSE suppress flag and is disabled without an agg', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px'], grid);
    const sw = row(panel, 'aggHeader').querySelector<HTMLButtonElement>('.vgext-col-switch')!;
    expect(sw.disabled).toBe(true); // no agg on px
    document.body.replaceChildren();
    grid.valueCols = [{ colId: 'px', aggFunc: 'sum' }];
    const { panel: p2 } = mountColumnPanel(['px'], grid);
    const sw2 = row(p2, 'aggHeader').querySelector<HTMLButtonElement>('.vgext-col-switch')!;
    expect(sw2.disabled).toBe(false);
    expect(sw2.getAttribute('aria-checked')).toBe('true'); // suppress default false → shown
    sw2.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { suppressAggFuncInHeader: true });
  });

  it('pinned segment uses setColumnsPinned; hidden switch uses editColumn hide', () => {
    const grid = new FakeColumnGrid();
    const { panel } = mountColumnPanel(['px', 'qty'], grid);
    row(panel, 'pinned').querySelector<HTMLElement>('button[data-v="left"]')!.click();
    expect(grid.setColumnsPinned).toHaveBeenCalledWith(['px', 'qty'], 'left');
    row(panel, 'pinned').querySelector<HTMLElement>('button[data-v="none"]')!.click();
    expect(grid.setColumnsPinned).toHaveBeenCalledWith(['px', 'qty'], null);
    row(panel, 'hide').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    expect(grid.editColumn).toHaveBeenCalledWith('px', { hide: true });
  });

  it('mixed multi-column state renders indeterminate and normalizes on first toggle', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn('px', { sortable: false });
    grid.editColumn.mockClear();
    const { panel } = mountColumnPanel(['px', 'qty'], grid);
    const sw = row(panel, 'sortable').querySelector<HTMLElement>('.vgext-col-switch')!;
    expect(sw.classList.contains('is-mixed')).toBe(true);
    sw.click(); // mixed → true for ALL
    expect(grid.editColumn).toHaveBeenCalledWith('px', { sortable: true });
    expect(grid.editColumn).toHaveBeenCalledWith('qty', { sortable: true });
  });

  it('a throwing apply marks the row with the error tint, no crash', () => {
    const grid = new FakeColumnGrid();
    grid.editColumn.mockImplementationOnce(() => { throw new Error('nope'); });
    const { panel } = mountColumnPanel(['px'], grid);
    row(panel, 'enableRowGroup').querySelector<HTMLElement>('.vgext-col-switch')!.click();
    expect(row(panel, 'enableRowGroup').classList.contains('is-error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/columnPanel.test.ts`
Expected: Task-3 tests pass; new block fails (rows absent).

- [ ] **Step 3: Implement `renderSections`**

```ts
function renderSections(el: HTMLElement, host: ColumnPanelHost): void {
  const { grid } = host;
  const cols = host.targetCols();
  const rerender = () => {
    el.querySelectorAll('.vgext-col-caps, .vgext-col-row').forEach((n) => n.remove());
    renderSections(el, host);
  };
  /** Fan an apply over every target; error-tints the row on throw. */
  const applyAll = (row: HTMLElement, fn: (colId: string) => void): void => {
    row.classList.remove('is-error');
    row.removeAttribute('title');
    for (const colId of cols) {
      try { fn(colId); } catch (err) {
        row.classList.add('is-error');
        row.title = err instanceof Error ? err.message : String(err);
      }
    }
    host.onApplied();
    rerender(); // re-read live state so every row reflects the new truth
  };
  const flagSwitch = (key: FlagKey, label: string, patchKey?: string): HTMLElement => {
    const state = mixedValue(grid, cols, key);
    const row = switchRow(key, label, state, (next) => {
      applyAll(row, (colId) => grid.editColumn(colId, { [patchKey ?? key]: next }));
    });
    return row;
  };

  // ── FILTER ──
  el.append(sectionCaps('FILTER'));
  el.append(flagSwitch('floatingFilter', 'Floating filter'));
  {
    const state = mixedValue(grid, cols, 'filter');
    const active = state.mixed ? undefined : ((state.value as string | undefined) ?? 'auto');
    const row = segRow('filter', 'Filter type', [
      { v: 'auto', text: 'Auto' }, { v: 'text', text: 'Text' }, { v: 'number', text: 'Num' },
      { v: 'date', text: 'Date' }, { v: 'set', text: 'Set' },
    ], active, (v) => {
      applyAll(row, (colId) => grid.editColumn(colId, { filter: v === 'auto' ? null : v }));
    });
    el.append(row);
  }

  // ── GROUPING ──
  el.append(sectionCaps('GROUPING'));
  el.append(flagSwitch('enableRowGroup', 'Groupable'));
  el.append(flagSwitch('enablePivot', 'Pivotable'));

  // ── AGGREGATION ──
  el.append(sectionCaps('AGGREGATION'));
  {
    const valueCols = grid.getValueColumns();
    const aggOf = (colId: string) => valueCols.find((v) => v.colId === colId)?.aggFunc;
    const aggs = cols.map(aggOf);
    const mixed = !aggs.every((a) => a === aggs[0]);
    const current = mixed ? '' : (aggs[0] ?? 'none');
    const row = document.createElement('div');
    row.className = 'vgext-col-row';
    row.dataset.k = 'aggFunc';
    const lab = document.createElement('span');
    lab.className = 'vgext-col-label';
    lab.textContent = 'Function';
    const sel = document.createElement('select');
    sel.className = 'vgext-col-select';
    for (const v of ['none', ...AGG_FUNCS]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v === 'none' ? 'None' : v;
      sel.append(o);
    }
    if (mixed) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '(mixed)'; o.disabled = true;
      sel.prepend(o);
    }
    sel.value = current;
    sel.addEventListener('change', () => {
      const v = sel.value;
      applyAll(row, (colId) => {
        const has = grid.getValueColumns().some((x) => x.colId === colId);
        if (v === 'none') { if (has) grid.removeValueColumn(colId); }
        else if (has) grid.setValueColumnAggFunc(colId, v);
        else grid.addValueColumn(colId, v);
      });
    });
    row.append(lab, sel);
    el.append(row);

    // Show-in-header — inverse of suppressAggFuncInHeader; needs an agg.
    const anyAgg = cols.some((c) => aggOf(c) !== undefined);
    const supState = mixedValue(grid, cols, 'suppressAggFuncInHeader');
    const shown = { value: supState.mixed ? undefined : !(supState.value as boolean), mixed: supState.mixed };
    const hdrRow = switchRow('aggHeader', 'Show in header', shown, (next) => {
      applyAll(hdrRow, (colId) => grid.editColumn(colId, { suppressAggFuncInHeader: !next }));
    });
    const hdrSwitch = hdrRow.querySelector<HTMLButtonElement>('.vgext-col-switch')!;
    hdrSwitch.disabled = !anyAgg;
    el.append(hdrRow);
  }

  // ── BEHAVIOR ──
  el.append(sectionCaps('BEHAVIOR'));
  el.append(flagSwitch('sortable', 'Sortable'));
  el.append(flagSwitch('resizable', 'Resizable'));
  el.append(flagSwitch('editable', 'Editable'));
  {
    const states = cols.map((c) => grid.getColumnState().find((s) => s.colId === c)?.pinned ?? null);
    const mixed = !states.every((s) => s === states[0]);
    const active = mixed ? undefined : (states[0] ?? 'none') || 'none';
    const row = segRow('pinned', 'Pinned', [
      { v: 'left', text: 'Left' }, { v: 'none', text: '–' }, { v: 'right', text: 'Right' },
    ], active === null ? 'none' : (active as string), (v) => {
      row.classList.remove('is-error');
      try { grid.setColumnsPinned(cols, v === 'none' ? null : (v as 'left' | 'right')); }
      catch (err) { row.classList.add('is-error'); row.title = String(err); }
      host.onApplied();
      rerender();
    });
    el.append(row);
  }
  el.append(flagSwitch('hide', 'Hidden'));
}
```

(Remove the `void host; void svg;` stub lines; drop the `svg` import if now unused.)

- [ ] **Step 4: Verify green + full suite**

Run: `cd packages/ext && npx vitest run tests/columnPanel.test.ts && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/columnPanel.ts packages/ext/tests/columnPanel.test.ts
git commit -m "feat(ext): column popover sections — filter/grouping/aggregation/behavior with live state + fan-out apply"
```

---

### Task 5: Ribbon Column group — trigger, agg pill, quick toggles

**Files:**
- Modify: `packages/ext/src/toolbar/ribbon.ts` (replace `grp('Edit', …)` + `grp('Group', …)` at the formatting-cluster append, currently :377-378; FormattingRefs; wiring + refresh)
- Test: `packages/ext/tests/ribbonColumnGroup.test.ts` (new; static-guard level, mirroring ribbonFormatPicker.test.ts)

**Interfaces:**
- Consumes: Task 3/4's `columnPanelMenu` + `ColumnPanelHost` + `effectiveFlag` + `AGG_FUNCS`; the wiring closures `targetCols`, `refresh`, `grid`, `disposers`, `menu`.
- Produces DOM hooks (Task 6): trigger `[data-col="open"]` (labeled chrome `⚙ Column ⌄`), agg pill `[data-col="agg"]`, quick toggles `[data-col="ff"]`, `[data-col="grp"]`, `[data-col="aggh"]` (`.vgext-rb-toggle` with `is-on`).

- [ ] **Step 1: Write the failing static-guard test**

```ts
// packages/ext/tests/ribbonColumnGroup.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('ribbon Column group wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/toolbar/ribbon.ts'), 'utf8');
  it('placeholder Edit/Group groups are gone', () => {
    expect(src.includes("grp('Edit'")).toBe(false);
    expect(src.includes("grp('Group'")).toBe(false);
  });
  it('the Column group + panel are wired', () => {
    expect(src.includes("grp('Column'")).toBe(true);
    expect(src.includes('columnPanelMenu')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ext && npx vitest run tests/ribbonColumnGroup.test.ts`
Expected: FAIL — placeholders still present.

- [ ] **Step 3: Implement**

Imports:
```ts
import { columnPanelMenu, effectiveFlag, AGG_FUNCS, type ColumnConfigGrid, type ColumnPanelHost } from './columnPanel';
```

Render side — create the controls (near the other Row-A controls), replacing nothing yet:
```ts
      // Column group — quick per-column configuration (spec 2026-07-08).
      const colOpen = document.createElement('button');
      colOpen.type = 'button';
      colOpen.className = 'vgext-ip-open'; // labeled-control chrome (well-less variant)
      colOpen.dataset.col = 'open';
      colOpen.innerHTML =
        `${svg(I.settings, 14)}<span>Column</span>` +
        '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      const aggPill = pill('Σ None');
      aggPill.dataset.col = 'agg';
      const colFF = toggleBtn(I.filter, 'Floating filter');
      colFF.dataset.col = 'ff';
      const colGrp = toggleBtn(I.agg, 'Groupable');
      colGrp.dataset.col = 'grp';
      const colAggH = toggleBtn(I.rows, 'Show aggregation in header');
      colAggH.dataset.col = 'aggh';
```

Replace the two placeholder groups (:377-378) with:
```ts
        grp('Column', mini(colOpen, aggPill), mini(colFF, colGrp, colAggH)),
```
Delete nothing else — the placeholder pills/icons were created inline inside those `grp()` calls and vanish with them.

Refs — pass + declare:
```ts
        colOpen, aggPill, colFF, colGrp, colAggH,
```
```ts
  colOpen: HTMLButtonElement; aggPill: HTMLButtonElement;
  colFF: HTMLButtonElement; colGrp: HTMLButtonElement; colAggH: HTMLButtonElement;
```

Wiring (in `wireFormattingToolbar`, after the borders block; `grid` there is the structural surface — widen its inline type with the five value-column/pinned/state methods, mirroring `ColumnConfigGrid`):
```ts
  // ── Column group — popover + agg pill + quick toggles ────────────────────
  const colGrid = grid as unknown as ColumnConfigGrid;
  const colHost: ColumnPanelHost = { targetCols, grid: colGrid, onApplied: () => refresh() };
  const colPanel = columnPanelMenu(r.colOpen, colHost);
  r.colOpen.addEventListener('click', () => colPanel.toggle());
  disposers.push(() => colPanel.destroy());

  const aggOfFirst = (): string | undefined => {
    const c = targetCols()[0];
    if (!c) return undefined;
    try { return colGrid.getValueColumns().find((v) => v.colId === c)?.aggFunc; } catch { return undefined; }
  };
  const aggMenu = menu(r.aggPill, (close) => {
    const list = h('vgext-menu-list');
    for (const v of ['none', ...AGG_FUNCS]) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'vgext-menu-item' + ((aggOfFirst() ?? 'none') === v ? ' is-active' : '');
      it.textContent = v === 'none' ? 'None' : v;
      it.addEventListener('click', () => {
        for (const colId of targetCols()) {
          try {
            const has = colGrid.getValueColumns().some((x) => x.colId === colId);
            if (v === 'none') { if (has) colGrid.removeValueColumn(colId); }
            else if (has) colGrid.setValueColumnAggFunc(colId, v);
            else colGrid.addValueColumn(colId, v);
          } catch { /* non-aggregable */ }
        }
        refresh();
        close();
      });
      list.appendChild(it);
    }
    return list;
  });
  r.aggPill.addEventListener('click', () => aggMenu.toggle());
  disposers.push(() => aggMenu.destroy());

  const quickFlag = (btn: HTMLButtonElement, key: 'floatingFilter' | 'enableRowGroup', patch: (next: boolean) => Record<string, unknown>): void => {
    btn.addEventListener('click', () => {
      const first = targetCols()[0];
      if (!first) return;
      const next = !effectiveFlag(colGrid, first, key);
      for (const colId of targetCols()) {
        try { grid.editColumn(colId, patch(next)); } catch { /* unknown column */ }
      }
      ctx.profiles.markDirty();
      refresh();
    });
  };
  quickFlag(r.colFF, 'floatingFilter', (next) => ({ floatingFilter: next }));
  quickFlag(r.colGrp, 'enableRowGroup', (next) => ({ enableRowGroup: next }));
  r.colAggH.addEventListener('click', () => {
    const first = targetCols()[0];
    if (!first) return;
    const next = !effectiveFlag(colGrid, first, 'suppressAggFuncInHeader'); // toggle suppress
    for (const colId of targetCols()) {
      try { grid.editColumn(colId, { suppressAggFuncInHeader: next }); } catch { /* unknown column */ }
    }
    ctx.profiles.markDirty();
    refresh();
  });
```

`refresh()` additions (after the borders sync block):
```ts
    // Column group — quick toggles + agg pill mirror the focused column.
    const colFirst = cols[0];
    r.colOpen.disabled = none;
    r.aggPill.disabled = none;
    for (const b of [r.colFF, r.colGrp, r.colAggH]) b.disabled = none;
    if (!none && colFirst) {
      const cg = grid as unknown as ColumnConfigGrid;
      r.colFF.classList.toggle('is-on', !!effectiveFlag(cg, colFirst, 'floatingFilter'));
      r.colGrp.classList.toggle('is-on', !!effectiveFlag(cg, colFirst, 'enableRowGroup'));
      r.colAggH.classList.toggle('is-on', !effectiveFlag(cg, colFirst, 'suppressAggFuncInHeader'));
      let agg: string | undefined;
      try { agg = cg.getValueColumns().find((v) => v.colId === colFirst)?.aggFunc; } catch { /* absent */ }
      r.aggPill.querySelector('span')!.textContent = `Σ ${agg ?? 'None'}`;
      r.aggPill.classList.toggle('is-set', agg !== undefined);
    } else {
      r.aggPill.querySelector('span')!.textContent = 'Σ None';
    }
```
(`.is-set` accent rule exists from the format pill: `.vgext-rb-pill.is-set`.)

Also widen the wiring `grid` structural type (the inline interface near the top of `wireFormattingToolbar`) with:
```ts
    getValueColumns(): Array<{ colId: string; aggFunc: string }>;
    addValueColumn(colId: string, aggFunc: string): void;
    setValueColumnAggFunc(colId: string, aggFunc: string): void;
    removeValueColumn(colId: string): void;
    setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
    getColumnState(): Array<{ colId: string; pinned?: 'left' | 'right' | null }>;
```

- [ ] **Step 4: Verify green + suites**

Run: `cd packages/ext && npx vitest run && npx tsc --noEmit`
Expected: all green (91+ tests incl. the new static guard).

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/ribbon.ts packages/ext/tests/ribbonColumnGroup.test.ts
git commit -m "feat(ext): ribbon Column group — ⚙ popover trigger, live Σ agg pill, floating-filter/groupable/agg-header quick toggles"
```

---

### Task 6: E2E — column configuration in the ext demo

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/columnConfig.spec.ts`

**Interfaces:**
- Consumes: `window.__ext.grid` (editColumn/getTemplates/getValueColumns, `rowIdAt` for focus), Task 5's `[data-col=…]` hooks, Task 4's `[data-k=…]` rows; the demo's `notionalAmount` (number) column.

- [ ] **Step 1: Write the E2E spec**

```ts
import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.vgext-titlebar')).toBeVisible();
});

const openPanel = async (page: Page) => {
  await page.locator('[data-col="open"]').click();
  await expect(page.locator('.vgext-menu.vgext-col')).toBeVisible();
};
const row = (page: Page, k: string) => page.locator(`.vgext-col-row[data-k="${k}"]`);
const selectCol = (page: Page, colId: string) => page.evaluate((c) => {
  const g = (window as any).__ext.grid;
  g.clearCellRanges();
  g.addCellRange({ rowStartIndex: 0, rowEndIndex: 0, colIds: [c] });
}, colId);
const ownFlag = (page: Page, colId: string, key: string) => page.evaluate(([c, k]) => {
  const own = (window as any).__ext.grid.getTemplates().find((t: any) => t.id === `__cgridOwn:${c}`);
  return own?.overrides?.[k];
}, [colId, key] as [string, string]);

test('popover flags: floating filter + set filter + groupable write templates; persists across reload', async ({ page }) => {
  await selectCol(page, 'notionalAmount');
  await openPanel(page);
  // Behavioral proof, not just the template flag: the column's floating-
  // filter input must leave the DOM when the flag goes off. The overlay is
  // kernel DOM — find the per-column input selector in
  // packages/kernel/src/interaction/floatingFilterOverlay.ts (it renders one
  // input per visible column; use its column-identifying attribute/class) and
  // count inputs before/after. If the overlay exposes no per-column hook,
  // assert on the TOTAL input count dropping by one.
  const ffInputs = () => page.evaluate(() => document.querySelectorAll('.vg-floating-filter input, [class*="floating-filter"] input').length);
  const before = await ffInputs();
  await row(page, 'floatingFilter').locator('.vgext-col-switch').click();
  expect(await ownFlag(page, 'notionalAmount', 'floatingFilter')).toBe(false); // demo default is on
  await page.waitForFunction((n) => document.querySelectorAll('.vg-floating-filter input, [class*="floating-filter"] input').length < n, before);
  await row(page, 'filter').locator('button[data-v="set"]').click();
  expect(await ownFlag(page, 'notionalAmount', 'filter')).toBe('set');
  await row(page, 'enableRowGroup').locator('.vgext-col-switch').click();
  expect(await ownFlag(page, 'notionalAmount', 'enableRowGroup')).toBe(true);
  await page.keyboard.press('Escape');

  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('enableRowGroup')));
  await page.reload();
  await expect(page.locator('.vgext-titlebar')).toBeVisible();
  await page.waitForFunction(() => {
    const own = (window as any).__ext.grid.getTemplates?.()
      ?.find((t: any) => t.id === '__cgridOwn:notionalAmount');
    return own?.overrides?.enableRowGroup === true;
  }, { timeout: 20000 });
  expect(await ownFlag(page, 'notionalAmount', 'filter')).toBe('set');
});

test('aggregation: pill sets sum, popover switches header visibility, none removes', async ({ page }) => {
  await selectCol(page, 'yield');
  const agg = () => page.evaluate(() =>
    (window as any).__ext.grid.getValueColumns().find((v: any) => v.colId === 'yield')?.aggFunc);
  await page.locator('[data-col="agg"]').click();
  await page.locator('.vgext-menu-item', { hasText: /^sum$/ }).click();
  expect(await agg()).toBe('sum');
  await expect(page.locator('[data-col="agg"]')).toContainText('Σ sum');

  await openPanel(page);
  await row(page, 'aggHeader').locator('.vgext-col-switch').click();
  expect(await ownFlag(page, 'yield', 'suppressAggFuncInHeader')).toBe(true);
  await page.keyboard.press('Escape');

  await page.locator('[data-col="agg"]').click();
  await page.locator('.vgext-menu-item', { hasText: /^None$/ }).click();
  expect(await agg()).toBeUndefined();
});

test('quick toggles + pinned + hidden behave and reflect state', async ({ page }) => {
  await selectCol(page, 'spread');
  const ff = page.locator('[data-col="ff"]');
  await ff.click();
  expect(await ownFlag(page, 'spread', 'floatingFilter')).toBe(false);
  await expect(ff).not.toHaveClass(/is-on/);
  await ff.click();
  expect(await ownFlag(page, 'spread', 'floatingFilter')).toBe(true);

  await openPanel(page);
  await row(page, 'pinned').locator('button[data-v="left"]').click();
  const pinned = await page.evaluate(() =>
    (window as any).__ext.grid.getColumnState().find((s: any) => s.colId === 'spread')?.pinned);
  expect(pinned).toBe('left');
  await row(page, 'pinned').locator('button[data-v="none"]').click();
  await row(page, 'hide').locator('.vgext-col-switch').click();
  expect(await ownFlag(page, 'spread', 'hide')).toBe(true);
  await row(page, 'hide').locator('.vgext-col-switch').click(); // restore
});
```

- [ ] **Step 2: Run the new spec, then the full suite**

Run: `cd apps/cgrid-ext-demo && npx playwright test e2e/columnConfig.spec.ts` → 3 pass;
then `npx playwright test` → ALL pass (13 total across 5 files). Rebuild the kernel first (`cd packages/kernel && npm run build`) and clear `node_modules/.vite` if the demo behaves stale; kill stale :5188 before, kill server/browser after. Note `hide: true` may remove the column from ranges — the final restore-click keeps the demo state clean; if the hidden column breaks the row lookup, restore via `page.evaluate(() => (window as any).__ext.grid.editColumn('spread', { hide: false }))` instead.

- [ ] **Step 3: Commit**

```bash
git add apps/cgrid-ext-demo/e2e/columnConfig.spec.ts
git commit -m "test(e2e): ribbon column config — popover flags, agg pill, quick toggles, pinning, reload persistence"
```

---

## Batch closeout (after all 6 tasks)

ONE closeout review over Tasks 1-6 + a single fix wave (standing batch-review rule). Verification: calc + kernel + ext unit suites and typechecks, kernel build, full demo E2E, and a manual light/dark browser pass of the popover + Column group (theme toggle via the overflow menu), automation processes killed after.
