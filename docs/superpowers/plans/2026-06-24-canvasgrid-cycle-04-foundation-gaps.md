# Canvasgrid Cycle 4 — Foundation-gap completion — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to execute this worklog task-by-task.
> Each task below is designed to fit in a single, isolated Claude Code session.
> Run one task per session, verify, commit, then START A NEW SESSION using the
> "Next session prompt" at the end of the task. Do NOT chain multiple tasks in one
> session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-leverage P0 gaps that block downstream cycles:
column groups (model + multi-row header + open/close), runtime option mutation,
full focus/selection/`ensureVisible` API, custom cell-renderer registration with
params, `valueSetter`/`valueParser` commit-back, and the remaining unwired
lifecycle events (`gridPreDestroyed`, `gridSizeChanged`, `firstDataRendered`).

**Architecture:** All additions extend the existing layered architecture. The
column model gains a tree representation (`ColumnTree`) sitting between the
public `(CColDef | CColGroupDef)[]` and the flat `columnOrder` the layout +
renderer already consume. The subgrid stack absorbs a new `HeaderGroupSubgrid`
that contributes one row per group depth level. Runtime-mutable options route
through a single `setGridOption` that gates against `INITIAL_ONLY_OPTIONS`.
Row-ID ↔ index lookups land on the worker (`getRowIndexForId`) so
`ensureRowVisible(rowId)`, `setFocusedCell(rowId, colId)`, and
`setSelectedRowIds(ids[])` stop being stubs. Custom cell renderers slot into
the existing `CellRendererRegistry`. Editor commit invokes
`valueParser → valueSetter`, then enqueues an `applyTransaction({ update })`
so the worker re-runs filter/sort/agg.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E), single-canvas
2D paint, Web Worker data pipeline, native scrollbars, CSS-variable theming.
No new runtime dependencies.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 4 section)
- `docs/superpowers/plans/2026-06-23-canvasgrid-hypergrid-port.md` — Cycle 3 worklog (architectural reference)
- `docs/catalog/02-column-model.md` — ColGroupDef + column-state API surface
- `docs/catalog/01-grid-options.md` — runtime-vs-initial option taxonomy
- `docs/catalog/22-events.md` — lifecycle events (`gridPreDestroyed`, `gridSizeChanged`, `firstDataRendered`)
- `docs/catalog/23-api.md` — `ensureRowVisible`, `setFocusedCell`, `setSelectedRowIds`, `setGridOption`
- `docs/catalog/FEATURE_MATRIX.md` — rows to flip to ✅ at cycle exit
- Cgrid source: `cgrid/src/`
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2/3).

- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`columnDefs`, `defaultColDef`, `valueSetter`, `valueParser`, `cellRendererParams`,
  `openByDefault`, `marryChildren`, `groupId`, `headerName`). Top-level type
  names keep the `C` prefix (`CColDef`, `CColGroupDef`, `CGridOptions`,
  `CGridApi`). String identifiers drop the `ag` prefix.
- **No regressions in the public API.** Any change to `CGridOptions`,
  `CGridApi`, `CColDef`, the event union, or the worker protocol is purely
  additive in Cycle 4. Demo wiring updates land in the same commit as the
  feature, not in a follow-up.
- **TypeScript strict mode.** Every `cgrid/src/**/*.ts` compiles clean under
  `npm run --workspace=cgrid typecheck` at the end of every task.
- **`alpha: false` canvas context, single-canvas rendering, DPR-aware paint,
  no per-cell `strokeRect`** — unchanged from Cycle 3.
- **Web Worker stays the data layer.** New methods (`getRowIndexForId`) extend
  the protocol; main thread never reaches into row storage directly.
- **Native browser scrollbars** — unchanged.
- **Vitest unit + Playwright E2E green at end of every task.**
- **Conventional commits.** Each task = one or more focused commits, with the
  cycle prefix in the body footer (e.g. `feat(cgrid): column group model
  + ColGroupDef types\n\nCycle 4 / Task 1.`).
- **Documentation as you go.** Each public API or type added gets (a) a TSDoc
  block on the symbol, (b) the matching FM row flipped to ✅ in
  `docs/catalog/FEATURE_MATRIX.md`, and (c) a one-line entry in this worklog's
  "Shipped" list at cycle exit.
- **Demo never breaks.** `apps/cgrid-positions` runs after every task. The
  3-level column-group example arrives in Task 2 and stays through cycle exit.
- **Allocation discipline in hot paths.** Column-tree walks happen at column-defs
  load (cold path) — no per-frame churn. Subgrid `getCell` returns reused
  objects where possible.
- **Performance gate.** No regression past cold-start / scroll-FPS targets in
  the master plan's Performance Budget. Column groups add one
  `HeaderGroupSubgrid`; verify header paint cost scales linearly with group depth.

## Task overview

| # | Task | Primary user-visible win | Files touched |
|---|---|---|---|
| 1 | Column group model + ColGroupDef types | Heterogeneous `columnDefs` accepted; ungrouped users unaffected | `types.ts`, `core/propertyChain.ts`, `core/columnTree.ts` (new), `cgrid.ts` |
| 2 | HeaderGroupSubgrid (multi-row header) | Visible nested column-group headers with spans | `core/subgrid.ts`, `core/viewport.ts`, `renderer/painters/byRows.ts`, `interaction/hitTester.ts`, `cgrid.ts`, demo |
| 3 | Column group open/close + marryChildren | Click group header to collapse; `columnGroupShow` honored; locked groups | `core/columnGroupState.ts` (new), `interaction/features/headerClick.ts`, `core/columnTree.ts`, `cgrid.ts` |
| 4 | `setGridOption` + `updateGridOptions` + initial-only gating | App can flip theme/rowHeight/headerHeight/etc. at runtime | `cgrid.ts`, `types.ts`, `core/runtimeOptions.ts` (new) |
| 5 | `rowBuffer` + virtualization toggles | Configurable overscan + full-column / full-row paint modes | `core/viewport.ts`, `cgrid.ts`, `types.ts` |
| 6 | `ensureRowVisible(rowId)` + ensureColumnVisible + ensureColumnGroupVisible | Scroll-to-row-by-ID works; no more stub | `worker/protocol.ts`, `worker/worker.ts`, `worker/dataPipeline.ts`, `worker/client.ts`, `cgrid.ts` |
| 7 | `setFocusedCell(rowId, colId)` + `setSelectedRowIds(ids)` | Focus + selection by ID, persists across updates | `worker/client.ts`, `cgrid.ts`, `interaction/selectionModel.ts` |
| 8 | Custom cell renderer + `cellRendererParams` + `cellRendererSelector` | Apps can register painters; per-column params | `renderer/cellRenderers/registry.ts`, `cgrid.ts`, `types.ts`, `core/propertyChain.ts` |
| 9 | `valueSetter` + `valueParser` + commit-back | Editor commit writes through worker pipeline | `interaction/editorOverlay.ts`, `cgrid.ts`, `worker/worker.ts` |
| 10 | Lifecycle events (`gridPreDestroyed`, `gridSizeChanged`, `firstDataRendered`) | Apps can observe destroy/resize/first-paint | `cgrid.ts`, `types.ts`, `core/canvas.ts` |

---

## Task 1 — Column group model + ColGroupDef types

**Goal:** Accept heterogeneous `columnDefs: (CColDef | CColGroupDef)[]`. Build a
`ColumnTree` (groups + leaves) at construction time. Replace cgrid.ts's flat
`for (def of options.columnDefs)` loop with `resolveColumnTree(...)`. After
this task, ungrouped users are byte-for-byte identical; grouped users have a
parsed tree available but no header rendering yet (that's Task 2).

**Why this is Task 1:** Every later task in the cycle assumes the tree exists.
Tasks 2 and 3 add the visible header subgrid + open/close on top. Task 8's
renderer registry doesn't touch grouping but the leaves it iterates come out
of the tree. Landing the type + tree first means the rest of the cycle never
touches the leaf-resolution code again.

**Read first:**
- `docs/catalog/02-column-model.md` — sections "ColGroupDef — group-specific"
  (lines 99-108), "API methods" (esp. `getColumnGroupState`), "Behaviors —
  Column group open/close" (lines 181-183)
- Master plan Cycle 4 task 1 line (`docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md:157`)
- `cgrid/src/types.ts` — current `CGridOptions.columnDefs` field
- `cgrid/src/core/propertyChain.ts` — `resolveColDef` (leaf-only today)
- `cgrid/src/cgrid.ts` lines 123-128 — the loop being replaced

**Files:**
- Modify: `cgrid/src/types.ts` (add `CColGroupDef`, retype `CGridOptions.columnDefs`, add `CColDef.columnGroupShow`)
- Modify: `cgrid/src/core/propertyChain.ts` (re-export `ResolvedColDef`; no change to `resolveColDef`)
- Create: `cgrid/src/core/columnTree.ts` (the new tree resolver)
- Modify: `cgrid/src/cgrid.ts` (call `resolveColumnTree` instead of inlined loop; nothing else changes)
- Create: `cgrid/tests/columnTree.test.ts`
- Update: `cgrid/tests/types.test.ts` (assert the new public type shape compiles)
- Modify: `cgrid/tests/cgrid.integration.test.ts` (add one passing test that grouped columnDefs construct without throwing — header row 1 still single)

**Interfaces produced (later tasks consume):**

```ts
// cgrid/src/types.ts — additions only; nothing renamed or removed
export interface CColGroupDef<TRow = any> {
  /** Stable identifier. Auto-generated as `cg-grp-${n}` when omitted. */
  groupId?: string;
  /** Text shown in the group header cell. Empty string OK; renderer prints ''. */
  headerName?: string;
  /** Child columns or nested groups. Required, non-empty. */
  children: (CColDef<TRow> | CColGroupDef<TRow>)[];
  /** Group is expanded on first render. Default false (closed). */
  openByDefault?: boolean;
  /** Prevents user from dragging child columns outside this group. Default false. */
  marryChildren?: boolean;
  /** Optional CSS class hint applied to the group header cell (resolved later). */
  headerClass?: string;
}

export interface CColDef<TRow = any, TValue = any> {
  // … existing fields preserved …
  /** When the parent group is open: visible only if `'open'`; when closed:
   *  visible only if `'closed'`. `null` / undefined = always visible. */
  columnGroupShow?: 'open' | 'closed' | null;
}

export interface CGridOptions<TRow = any> {
  // … existing fields …
  columnDefs: (CColDef<TRow> | CColGroupDef<TRow>)[];  // was CColDef<TRow>[]
}

// cgrid/src/core/columnTree.ts — the new module
export interface ResolvedColGroupDef {
  readonly kind: 'group';
  groupId: string;
  headerName: string;
  openByDefault: boolean;
  marryChildren: boolean;
  headerClass?: string;
  /** Depth from root. Root nodes are depth 0. */
  depth: number;
  /** Tree children — groups or leaves, in declaration order. */
  children: ColumnTreeNode[];
  /** Flat list of every leaf colId underneath this group, in render order. */
  leafColIds: string[];
}

export interface ResolvedColLeaf {
  readonly kind: 'leaf';
  /** Already-resolved leaf (delegated to existing resolveColDef). */
  colDef: ResolvedColDef;
  /** Depth from root. Top-level (ungrouped) leaves are depth 0. */
  depth: number;
  /** Group IDs of ancestors, root→parent. Empty for ungrouped leaves. */
  groupPath: string[];
}

export type ColumnTreeNode = ResolvedColGroupDef | ResolvedColLeaf;

export interface ColumnTree {
  /** Heterogeneous roots — groups + ungrouped leaves, in declaration order. */
  roots: ColumnTreeNode[];
  /** All leaves in render order — drop-in replacement for the old `columnOrder`. */
  leaves: ResolvedColDef[];
  /** Quick lookup by colId. */
  leafById: Map<string, ResolvedColDef>;
  /** Quick lookup by groupId. */
  groupById: Map<string, ResolvedColGroupDef>;
  /** Maximum group nesting depth. 0 = no groups. 1 = single-level. etc. */
  maxDepth: number;
}

export function resolveColumnTree<TRow>(
  defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
  defaultColDef?: Partial<CColDef<TRow>>,
): ColumnTree;

/** Test helper. Returns true when a def has a `children` array — the
 *  discriminator we use to tell ColGroupDef from ColDef. Exposed so
 *  callers can avoid duplicating the check. */
export function isColGroupDef<TRow>(
  def: CColDef<TRow> | CColGroupDef<TRow>,
): def is CColGroupDef<TRow>;
```

**Steps:**

- [ ] **Step 1: Add `CColGroupDef` and `columnGroupShow` to types.ts**

In `cgrid/src/types.ts`, after the `CColDef` interface, add:

```ts
export interface CColGroupDef<TRow = any> {
  groupId?: string;
  headerName?: string;
  children: (CColDef<TRow> | CColGroupDef<TRow>)[];
  openByDefault?: boolean;
  marryChildren?: boolean;
  headerClass?: string;
}
```

In the existing `CColDef` interface, add the `columnGroupShow` field:

```ts
columnGroupShow?: 'open' | 'closed' | null;
```

In `CGridOptions`, retype `columnDefs`:

```ts
columnDefs: (CColDef<TRow> | CColGroupDef<TRow>)[];
```

Re-export `CColGroupDef` from `cgrid/src/cgrid.ts` next to `CColDef`.

- [ ] **Step 2: Write the failing test file `cgrid/tests/columnTree.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveColumnTree, isColGroupDef } from '../src/core/columnTree';
import type { CColDef, CColGroupDef } from '../src/types';

describe('isColGroupDef', () => {
  it('returns true when def has a children array', () => {
    expect(isColGroupDef({ children: [{ field: 'a' }] })).toBe(true);
    expect(isColGroupDef({ field: 'a' })).toBe(false);
  });
});

describe('resolveColumnTree — flat (no groups)', () => {
  it('produces leaf-only roots and matching leaves', () => {
    const defs: CColDef[] = [
      { field: 'a' }, { field: 'b' }, { field: 'c' },
    ];
    const tree = resolveColumnTree(defs);
    expect(tree.roots.length).toBe(3);
    expect(tree.roots.every((n) => n.kind === 'leaf')).toBe(true);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['a', 'b', 'c']);
    expect(tree.maxDepth).toBe(0);
    expect(tree.groupById.size).toBe(0);
    expect(tree.leafById.get('b')?.colId).toBe('b');
  });

  it('preserves defaultColDef inheritance through leaves', () => {
    const defs: CColDef[] = [{ field: 'a' }, { field: 'b' }];
    const tree = resolveColumnTree(defs, { sortable: false });
    expect(tree.leaves.every((l) => l.sortable === false)).toBe(true);
  });
});

describe('resolveColumnTree — single-level groups', () => {
  it('flattens leaves in declaration order and tags each with groupPath', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { field: 'id' },
      {
        groupId: 'pnl',
        headerName: 'P&L',
        children: [{ field: 'daily' }, { field: 'mtd' }, { field: 'ytd' }],
      },
      { field: 'tail' },
    ];
    const tree = resolveColumnTree(defs);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['id', 'daily', 'mtd', 'ytd', 'tail']);
    expect(tree.maxDepth).toBe(1);
    const pnl = tree.groupById.get('pnl');
    expect(pnl).toBeDefined();
    expect(pnl!.leafColIds).toEqual(['daily', 'mtd', 'ytd']);
    expect(pnl!.depth).toBe(0);

    const tailLeaf = tree.leaves.find((l) => l.colId === 'tail')!;
    const dailyLeaf = tree.leaves.find((l) => l.colId === 'daily')!;
    // ResolvedColLeaf carries groupPath via the tree node, not the colDef.
    const tailNode = tree.roots.find((n) => n.kind === 'leaf' && n.colDef === tailLeaf);
    const pnlNode = tree.roots.find((n) => n.kind === 'group' && n.groupId === 'pnl');
    expect(tailNode?.kind).toBe('leaf');
    expect((tailNode as any).groupPath).toEqual([]);
    const dailyChildNode = (pnlNode as any).children[0];
    expect(dailyChildNode.kind).toBe('leaf');
    expect(dailyChildNode.colDef).toBe(dailyLeaf);
    expect(dailyChildNode.groupPath).toEqual(['pnl']);
  });

  it('auto-generates groupId when omitted', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { headerName: 'Anon', children: [{ field: 'x' }] },
      { headerName: 'Anon2', children: [{ field: 'y' }] },
    ];
    const tree = resolveColumnTree(defs);
    const ids = Array.from(tree.groupById.keys());
    expect(ids.length).toBe(2);
    expect(ids[0]).toMatch(/^cg-grp-/);
    expect(ids[1]).toMatch(/^cg-grp-/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('defaults openByDefault=false, marryChildren=false, headerName=""', () => {
    const tree = resolveColumnTree([{ children: [{ field: 'a' }] }]);
    const group = tree.roots[0] as any;
    expect(group.kind).toBe('group');
    expect(group.openByDefault).toBe(false);
    expect(group.marryChildren).toBe(false);
    expect(group.headerName).toBe('');
  });
});

describe('resolveColumnTree — nested groups', () => {
  it('builds depth + leafColIds for 2-level nesting', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      {
        groupId: 'outer',
        children: [
          { field: 'a' },
          {
            groupId: 'inner',
            children: [{ field: 'b' }, { field: 'c' }],
          },
        ],
      },
    ];
    const tree = resolveColumnTree(defs);
    expect(tree.maxDepth).toBe(2);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['a', 'b', 'c']);
    expect(tree.groupById.get('outer')!.leafColIds).toEqual(['a', 'b', 'c']);
    expect(tree.groupById.get('outer')!.depth).toBe(0);
    expect(tree.groupById.get('inner')!.leafColIds).toEqual(['b', 'c']);
    expect(tree.groupById.get('inner')!.depth).toBe(1);
  });
});

describe('resolveColumnTree — errors', () => {
  it('throws on empty children array', () => {
    expect(() => resolveColumnTree([{ children: [] }])).toThrow(/empty.*children/i);
  });

  it('throws on duplicate colId across groups', () => {
    expect(() =>
      resolveColumnTree([
        { children: [{ field: 'a' }] },
        { children: [{ field: 'a' }] },
      ]),
    ).toThrow(/duplicate.*colId/i);
  });
});
```

- [ ] **Step 3: Run the test file to confirm it fails**

```bash
npm test --workspace=cgrid -- columnTree
```

Expected: every test fails with `Cannot find module '../src/core/columnTree'`.

- [ ] **Step 4: Create `cgrid/src/core/columnTree.ts` with the resolver**

```ts
import type { CColDef, CColGroupDef } from '../types';
import { resolveColDef, type ResolvedColDef } from './propertyChain';

export interface ResolvedColGroupDef {
  readonly kind: 'group';
  groupId: string;
  headerName: string;
  openByDefault: boolean;
  marryChildren: boolean;
  headerClass?: string;
  depth: number;
  children: ColumnTreeNode[];
  leafColIds: string[];
}

export interface ResolvedColLeaf {
  readonly kind: 'leaf';
  colDef: ResolvedColDef;
  depth: number;
  groupPath: string[];
}

export type ColumnTreeNode = ResolvedColGroupDef | ResolvedColLeaf;

export interface ColumnTree {
  roots: ColumnTreeNode[];
  leaves: ResolvedColDef[];
  leafById: Map<string, ResolvedColDef>;
  groupById: Map<string, ResolvedColGroupDef>;
  maxDepth: number;
}

export function isColGroupDef<TRow>(
  def: CColDef<TRow> | CColGroupDef<TRow>,
): def is CColGroupDef<TRow> {
  return Array.isArray((def as CColGroupDef<TRow>).children);
}

export function resolveColumnTree<TRow>(
  defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
  defaultColDef?: Partial<CColDef<TRow>>,
): ColumnTree {
  const leaves: ResolvedColDef[] = [];
  const leafById = new Map<string, ResolvedColDef>();
  const groupById = new Map<string, ResolvedColGroupDef>();
  let autoGroupSeq = 0;
  let maxDepth = 0;

  function walk(
    node: CColDef<TRow> | CColGroupDef<TRow>,
    depth: number,
    groupPath: string[],
  ): ColumnTreeNode {
    if (isColGroupDef(node)) {
      if (node.children.length === 0) {
        throw new Error('[cgrid] ColGroupDef has empty children array');
      }
      const groupId = node.groupId ?? `cg-grp-${++autoGroupSeq}`;
      if (groupById.has(groupId)) {
        throw new Error(`[cgrid] duplicate groupId '${groupId}'`);
      }
      // Allocate the group node up-front so children can record their depth
      // relative to a known parent; children push into leafColIds below.
      const groupNode: ResolvedColGroupDef = {
        kind: 'group',
        groupId,
        headerName: node.headerName ?? '',
        openByDefault: node.openByDefault ?? false,
        marryChildren: node.marryChildren ?? false,
        headerClass: node.headerClass,
        depth,
        children: [],
        leafColIds: [],
      };
      groupById.set(groupId, groupNode);
      const childPath = [...groupPath, groupId];
      for (const child of node.children) {
        const resolved = walk(child, depth + 1, childPath);
        groupNode.children.push(resolved);
        if (resolved.kind === 'leaf') {
          groupNode.leafColIds.push(resolved.colDef.colId);
        } else {
          groupNode.leafColIds.push(...resolved.leafColIds);
        }
      }
      maxDepth = Math.max(maxDepth, depth + 1);
      return groupNode;
    }

    const resolved = resolveColDef<TRow>(node, defaultColDef);
    if (leafById.has(resolved.colId)) {
      throw new Error(`[cgrid] duplicate colId '${resolved.colId}'`);
    }
    leafById.set(resolved.colId, resolved);
    leaves.push(resolved);
    return { kind: 'leaf', colDef: resolved, depth, groupPath };
  }

  const roots: ColumnTreeNode[] = defs.map((d) => walk(d, 0, []));
  return { roots, leaves, leafById, groupById, maxDepth };
}
```

- [ ] **Step 5: Re-run the test to verify it now passes**

```bash
npm test --workspace=cgrid -- columnTree
```

Expected: all `columnTree` tests pass.

- [ ] **Step 6: Re-export `CColGroupDef` from cgrid.ts**

In `cgrid/src/cgrid.ts`, extend the type re-export block:

```ts
export type {
  CGridOptions, CColDef, CColGroupDef, CGridEvent, CGridApi, Tx, TransactionResult,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, GroupModel,
  CValueGetterParams, CValueFormatterParams,
} from './types';
```

- [ ] **Step 7: Replace the inlined leaf-resolution loop in cgrid.ts with `resolveColumnTree`**

In `cgrid/src/cgrid.ts`, locate the block (currently lines 123-128):

```ts
// 3. Column model
for (const def of options.columnDefs) {
  const r = resolveColDef(def, options.defaultColDef);
  this.columnDefsMap.set(r.colId, r);
  this.columnOrder.push(r);
}
```

Replace with:

```ts
// 3. Column model — resolve into a tree (groups + leaves). For the rest of
// the cycle we operate on the flat `leaves` ordering; Task 2 introduces a
// HeaderGroupSubgrid that reads `tree.roots` + `tree.maxDepth` to paint
// nested group headers.
this.columnTree = resolveColumnTree(options.columnDefs, options.defaultColDef);
this.columnOrder = this.columnTree.leaves;
this.columnDefsMap = this.columnTree.leafById;
```

Add the import at the top:

```ts
import { resolveColumnTree, type ColumnTree } from './core/columnTree';
```

Add the `columnTree` field next to `columnDefsMap`:

```ts
private columnTree!: ColumnTree;
```

Note: `columnDefsMap` becomes a re-assignment instead of a fresh `new Map`,
but downstream consumers see the same shape — no further changes here.

- [ ] **Step 8: Add a passing integration test for grouped construction**

In `cgrid/tests/cgrid.integration.test.ts`, append:

```ts
it('accepts ColGroupDef in columnDefs and exposes leaves in render order', async () => {
  const host = document.createElement('div');
  host.style.width = '600px';
  host.style.height = '400px';
  document.body.appendChild(host);
  const grid = new CGrid<{ id: string; a: number; b: number; c: number }>(host, {
    columnDefs: [
      { field: 'id', width: 80 },
      {
        headerName: 'metrics',
        children: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
      },
    ],
    getRowId: (r) => r.id,
  });
  await new Promise((r) => setTimeout(r, 20));
  // No throw, no console error. Cycle 4 / Task 1: leaves available in render
  // order even though Header subgrid is still single-row (Task 2 fixes that).
  grid.destroy();
  host.remove();
});
```

- [ ] **Step 9: Update the types-shape test to assert the new public surface**

In `cgrid/tests/types.test.ts`, append:

```ts
it('CGridOptions.columnDefs accepts CColGroupDef entries', () => {
  // Compile-time assertion only — the test passes if tsc accepts the literal.
  const opts: import('../src/types').CGridOptions<{ a: number; b: number }> = {
    columnDefs: [
      { field: 'a' },
      { children: [{ field: 'b' }] },
    ],
    getRowId: (r) => String(r.a),
  };
  expect(opts.columnDefs.length).toBe(2);
});
```

- [ ] **Step 10: Run the full unit + typecheck + build suite**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
```

Expected: every test green, typecheck clean, `dist/cgrid.js` + `dist/worker.js`
emitted. Demo is unchanged at this task — Task 2 adds the visible group row.

- [ ] **Step 11: Manual smoke (optional but recommended)**

```bash
npm --workspace=apps/cgrid-positions run dev
```

Open `http://127.0.0.1:5180/`. The grid renders identically to before (the
demo's `columnDefs` is still flat). No console errors. Close.

- [ ] **Step 12: Commit**

```bash
git add cgrid/src/types.ts \
        cgrid/src/core/columnTree.ts \
        cgrid/src/cgrid.ts \
        cgrid/tests/columnTree.test.ts \
        cgrid/tests/cgrid.integration.test.ts \
        cgrid/tests/types.test.ts
git commit -m "$(cat <<'EOF'
feat(cgrid): column group model — CColGroupDef + resolveColumnTree

Adds the heterogeneous (CColDef | CColGroupDef)[] columnDefs surface plus
the ColumnTree resolver that flattens to leaves while preserving group
metadata, depth, and ancestor paths. Header rendering still single-row;
Task 2 lights up HeaderGroupSubgrid. Ungrouped users are byte-for-byte
identical.

Cycle 4 / Task 1.
EOF
)"
```

**Acceptance criteria:**
- [ ] `cgrid/src/core/columnTree.ts` exists; exports `resolveColumnTree`,
      `isColGroupDef`, `ColumnTree`, `ResolvedColGroupDef`, `ResolvedColLeaf`,
      `ColumnTreeNode`.
- [ ] `CColGroupDef` exported from `cgrid/src/types.ts` and re-exported by
      `cgrid/src/cgrid.ts`.
- [ ] `CColDef.columnGroupShow` typed as `'open' | 'closed' | null`.
- [ ] `CGridOptions.columnDefs` typed as `(CColDef | CColGroupDef)[]`.
- [ ] `npm test --workspace=cgrid -- columnTree` runs ≥10 assertions, all
      green. Full `npm test --workspace=cgrid` green.
- [ ] `npm --workspace=cgrid run typecheck` clean.
- [ ] `npm --workspace=cgrid run build` produces both bundles.
- [ ] cgrid.ts no longer iterates `options.columnDefs` directly; tree is the
      single source of truth.
- [ ] Demo still renders unchanged (flat columnDefs path unaffected).

**Next session prompt** (paste into a fresh Claude Code session after Task 1 is committed):

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 2 (HeaderGroupSubgrid — multi-row header). Confirm Task 1 is
committed (git log -1 should show "column group model"). Read docs/catalog/02-column-model.md
"Column group open/close" section + cgrid/src/core/subgrid.ts before touching
code. Follow the per-task workflow: read brief, implement, run unit + E2E +
typecheck + build, commit.
```

---

## Task 2 — HeaderGroupSubgrid (multi-row header)

**Goal:** Light up nested column-group headers. Today the header is one row
(the `HeaderSubgrid`). After this task the header is `1 + tree.maxDepth` rows:
one row per group depth on top, then the existing leaf-header row at the
bottom. Group header cells span the union of their leaf-column widths. No
open/close yet — that's Task 3.

**Why:** Without a visible header, Task 1's tree is invisible. Task 3 needs
hit-test against group cells. Task 11 (tool panels) eventually grows panels
that mirror the group tree; the subgrid is the canonical visual model.

**Read first:**
- `docs/catalog/02-column-model.md` — "ColGroupDef" section
- `cgrid/src/core/subgrid.ts` — existing `HeaderSubgrid` (the pattern)
- `cgrid/src/core/viewport.ts` — `Pass 1: header subgrids` (the place new headers stack)
- `cgrid/src/renderer/painters/byRows.ts` — band painter (spans land here)
- `cgrid/src/interaction/hitTester.ts` — `locate()` (group header hits become a new `Hit` kind)

**Files:**
- Modify: `cgrid/src/core/subgrid.ts` (add `HeaderGroupSubgrid`)
- Modify: `cgrid/src/core/viewport.ts` (`ViewportColumn.cellSpan?: number` + group-header column spans)
- Modify: `cgrid/src/renderer/painters/byRows.ts` (paint a single spanning rect for group cells; suppress per-leaf paints inside the span)
- Modify: `cgrid/src/interaction/hitTester.ts` (add `Hit = { kind: 'headerGroup'; groupId; }` and resolve it for y in group rows)
- Modify: `cgrid/src/cgrid.ts` (push N `HeaderGroupSubgrid`s — one per depth level)
- Modify: `apps/cgrid-positions/src/positionsGrid.ts` (wrap a few columns in a `metrics` group so demo proves multi-row header)
- Create: `cgrid/tests/headerGroupSubgrid.test.ts`
- Update: `cgrid/tests/viewport.test.ts` (assert visibleRows includes group rows)
- Update: `cgrid/tests/byRows.test.ts` (assert a spanning group cell paints exactly one rect)

**Interfaces:**

```ts
// cgrid/src/core/subgrid.ts — additions
export class HeaderGroupSubgrid implements Subgrid {
  readonly type: 'header' = 'header';
  readonly isHeader = true;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;

  /** @param depth Tree depth this row represents (0 = top-most groups). */
  constructor(
    private tree: () => ColumnTree,
    private getHeaderHeight: () => number,
    private depth: number,
    /** Returns the *visible* leaf colId order so spans match what's painted. */
    private leafOrder: () => string[],
  ) {}

  getRowCount(): number { return 1; }
  getRowHeight(_l: number): number { return this.getHeaderHeight(); }

  /** Returns the group cell at this depth that owns `colId`, or null if no
   *  group at this depth contains the leaf (e.g. the leaf has shorter
   *  ancestry than `depth`). Renderer uses this + `cellSpan` to draw one
   *  span per group instead of one cell per leaf. */
  getCell(_l: number, colId: string): SubgridCell | null;

  /** Returns the groupId at this depth for the given leaf, or null. Used
   *  by hit-test + the painter's span dedupe. */
  getGroupIdAt(colId: string): string | null;
}

// cgrid/src/core/viewport.ts — additions to existing ViewportColumn
export interface ViewportColumn {
  // … existing fields …
  /** When >1, this column owns the next (cellSpan-1) leaf columns to its
   *  right. Set only on the leftmost leaf of a group span at a given header
   *  depth. The painter uses this to skip redundant cells. Default 1.
   *  Note: `cellSpan` lives on the leaf-level viewport column for layout
   *  reuse, but is *only consulted by the HeaderGroupSubgrid painter* via
   *  the row-subgrid dispatch. Data-row paints ignore it. */
  cellSpan?: number;
}
```

**Steps:**

- [ ] **Step 1: Write a failing test for `HeaderGroupSubgrid`**

`cgrid/tests/headerGroupSubgrid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HeaderGroupSubgrid } from '../src/core/subgrid';
import { resolveColumnTree } from '../src/core/columnTree';

describe('HeaderGroupSubgrid', () => {
  const tree = resolveColumnTree([
    { field: 'id' },
    {
      groupId: 'pnl', headerName: 'P&L',
      children: [{ field: 'daily' }, { field: 'mtd' }, { field: 'ytd' }],
    },
  ]);
  const sg = new HeaderGroupSubgrid(() => tree, () => 24, 0, () => ['id', 'daily', 'mtd', 'ytd']);

  it('getCell returns the group headerName for any leaf in the group', () => {
    expect(sg.getCell(0, 'daily')?.valueFormatted).toBe('P&L');
    expect(sg.getCell(0, 'ytd')?.valueFormatted).toBe('P&L');
  });

  it('getCell returns null for leaves with no group at this depth', () => {
    expect(sg.getCell(0, 'id')).toBeNull();
  });

  it('getGroupIdAt resolves the group at this depth', () => {
    expect(sg.getGroupIdAt('daily')).toBe('pnl');
    expect(sg.getGroupIdAt('id')).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm the test fails**

```bash
npm test --workspace=cgrid -- headerGroupSubgrid
```

Expected: fails with `HeaderGroupSubgrid is not exported`.

- [ ] **Step 3: Implement `HeaderGroupSubgrid` in `cgrid/src/core/subgrid.ts`**

Add at the end of the file:

```ts
import type { ColumnTree } from './columnTree';

export class HeaderGroupSubgrid implements Subgrid {
  readonly type: SubgridType = 'header';
  readonly isHeader = true;
  readonly isData = false;
  readonly isTotals = false;
  readonly isFooter = false;

  constructor(
    private tree: () => ColumnTree,
    private getHeaderHeight: () => number,
    private depth: number,
    private leafOrder: () => string[],
  ) {}

  getRowCount(): number { return 1; }
  getRowHeight(_l: number): number { return this.getHeaderHeight(); }

  /** Resolve the group at this subgrid's depth that contains `colId`. */
  private groupForLeaf(colId: string) {
    // The tree map keeps groups; we need to find the ancestor whose depth
    // equals this subgrid's depth. Walk children top-down from roots.
    const t = this.tree();
    function findInNodes(nodes: ReturnType<typeof t.roots.values>): string | null {
      // unused — implemented via recursion in find()
      return null;
    }
    function find(node: any): string | null {
      if (node.kind === 'leaf' && node.colDef.colId === colId) {
        return null; // leaves don't have a group at any depth
      }
      if (node.kind === 'group') {
        for (const child of node.children) {
          if (child.kind === 'leaf' && child.colDef.colId === colId) {
            return node.depth === depth ? node.groupId : null;
          }
          if (child.kind === 'group') {
            const inner = find(child);
            if (inner) return inner;
            // Also handle the case where the matching ancestor is `node` itself
            if (child.leafColIds.includes(colId) && node.depth === depth) {
              return node.groupId;
            }
          }
        }
      }
      return null;
    }
    const depth = this.depth;
    for (const root of t.roots) {
      const id = find(root);
      if (id) return t.groupById.get(id) ?? null;
    }
    return null;
  }

  getCell(_l: number, colId: string): SubgridCell | null {
    const grp = this.groupForLeaf(colId);
    if (!grp) return null;
    return { value: grp.headerName, valueFormatted: grp.headerName };
  }

  getGroupIdAt(colId: string): string | null {
    return this.groupForLeaf(colId)?.groupId ?? null;
  }
}
```

- [ ] **Step 4: Verify Step-1 tests now pass**

```bash
npm test --workspace=cgrid -- headerGroupSubgrid
```

- [ ] **Step 5: Wire `HeaderGroupSubgrid` into the cgrid subgrid stack**

In `cgrid/src/cgrid.ts`, replace the existing subgrid array build (currently
the `this.subgrids = [...]` block around lines 132-142):

```ts
// 4. Subgrid stack — group-header rows (one per depth) on top, then the leaf
// header, then data. Future totals/footer rows are a `this.subgrids.push(...)`
// away. computeViewport walks this list.
const stack: Subgrid[] = [];
for (let depth = 0; depth < this.columnTree.maxDepth; depth++) {
  stack.push(new HeaderGroupSubgrid(
    () => this.columnTree,
    () => this.options.headerHeight ?? this.theme.headerHeight,
    depth,
    () => this.columnOrder.map((c) => c.colId),
  ));
}
stack.push(new HeaderSubgrid(
  this.columnDefsMap as Map<string, ResolvedColDef>,
  () => this.options.headerHeight ?? this.theme.headerHeight,
));
stack.push(new DataSubgrid(
  () => this.rowCount,
  () => this.options.rowHeight ?? this.theme.rowHeight,
  (rowIndex, colId) => this.cellAt(rowIndex, colId),
));
this.subgrids = stack;
```

Update the `HeaderGroupSubgrid` import:

```ts
import { HeaderSubgrid, HeaderGroupSubgrid, DataSubgrid, type Subgrid } from './core/subgrid';
```

- [ ] **Step 6: Paint group cells as a single span in `byRows.ts`**

In `paintBand` inside `cgrid/src/renderer/painters/byRows.ts`, when iterating
columns for a header-group row, compute cell spans on the fly to avoid
duplicating identical group cells. Replace the inner column loop body — only
inside the `for (const col of cols)` block — with this guarded variant:

```ts
let r0 = 0;
while (r0 < rows.length) {
  const row = rows[r0]!;
  const r = row.rowIndex;
  const rowBg = rowBgs[r]!;

  // For header-group rows, walk columns left→right merging adjacent leaves
  // that belong to the same group at this row's depth.
  if (row.subgrid instanceof (HeaderGroupSubgrid as any)) {
    let i = 0;
    while (i < cols.length) {
      const col = cols[i]!;
      const groupId = (row.subgrid as any).getGroupIdAt(col.colId);
      let span = 1;
      while (
        i + span < cols.length &&
        (row.subgrid as any).getGroupIdAt(cols[i + span]!.colId) === groupId &&
        groupId !== null
      ) {
        span++;
      }
      const def = columnDefs.get(col.colId);
      if (def && groupId) {
        const lastCol = cols[i + span - 1]!;
        const w = lastCol.right - col.left;
        applyCellProps(config, {
          theme, colDef: def,
          value: (row.subgrid as any).getCell(0, col.colId)?.valueFormatted ?? '',
          valueFormatted: (row.subgrid as any).getCell(0, col.colId)?.valueFormatted ?? '',
          x: col.left, y: row.top, w, h: row.height,
          rowBg, prefillColor: rowBg,
          isFocused: false, isSelected: false, isHovered: false, isHeader: true,
          iconColor: theme.focusRingColor,
        });
        cellRenderers.get('header').paint(gc, config);
      }
      i += span;
    }
    r0++;
    continue;
  }

  // … existing per-row loop body for header/data rows unchanged …
```

Add the `HeaderGroupSubgrid` import near the other subgrid imports in
`byRows.ts`:

```ts
import { HeaderGroupSubgrid } from '../../core/subgrid';
```

- [ ] **Step 7: Extend `Hit` and `HitTester.locate` to resolve group headers**

In `cgrid/src/interaction/hitTester.ts`:

```ts
export type Hit =
  | { kind: 'header'; colId: string }
  | { kind: 'headerGroup'; groupId: string; colId: string }
  | { kind: 'headerResizer'; colId: string }
  | { kind: 'cell'; rowIndex: number; colId: string }
  | { kind: 'pinnedSplitter'; side: 'left' | 'right' }
  | { kind: 'empty' };
```

In `locate`, replace the early-return on `y < headerH` with a y-aware lookup
over `vs.visibleRows` so a hit in a group-header row resolves to the right
group. (The current check uses a flat `headerH`; we need `bodyTop`.)

```ts
if (y < vs.bodyTop) {
  const row = this.findRow(vs, y);
  const col = this.findCol(vs, x);
  if (!col) return { kind: 'empty' };
  if (row && row.subgrid && (row.subgrid as any).getGroupIdAt) {
    const groupId = (row.subgrid as any).getGroupIdAt(col.colId);
    if (groupId) return { kind: 'headerGroup', groupId, colId: col.colId };
  }
  // Bottom-most header row is the leaf header.
  if (x >= col.right - hot) return { kind: 'headerResizer', colId: col.colId };
  return { kind: 'header', colId: col.colId };
}
```

- [ ] **Step 8: Update the demo to show a group**

In `apps/cgrid-positions/src/positionsGrid.ts`, regroup three of the existing
columns under a `pnl` group:

```ts
columnDefs: [
  { field: 'positionId',     headerName: 'Position ID',  width: 150, pinned: 'left' },
  { field: 'cusip',          headerName: 'CUSIP',         width: 110, pinned: 'left' },
  { field: 'ticker',         headerName: 'Ticker',        width: 100 },
  { field: 'notionalAmount', headerName: 'Notional',      type: 'number', width: 130, aggFunc: 'sum' },
  { field: 'marketValue',    headerName: 'Market Value',  type: 'number', width: 130, aggFunc: 'sum' },
  { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg' },
  {
    groupId: 'pnl', headerName: 'P&L',
    children: [
      { field: 'pnl',           headerName: 'Total',     type: 'number', width: 110, pinned: 'right', aggFunc: 'sum' },
      { field: 'dailyPnl',      headerName: 'Daily',     type: 'number', width: 110, aggFunc: 'sum' },
      { field: 'unrealizedPnl', headerName: 'Unrealized', type: 'number', width: 110, aggFunc: 'sum' },
    ],
  },
  { field: 'yield',  headerName: 'Yield',  type: 'number', width: 90,  aggFunc: 'avg' },
  { field: 'spread', headerName: 'Spread', type: 'number', width: 90,  aggFunc: 'avg' },
  { field: 'dv01',   headerName: 'DV01',   type: 'number', width: 100, aggFunc: 'sum' },
  { field: 'pv01',   headerName: 'PV01',   type: 'number', width: 100, aggFunc: 'sum' },
],
```

- [ ] **Step 9: Update `viewport.test.ts` to assert group rows stack**

Append:

```ts
it('stacks one header row per group-tree depth above the leaf header', () => {
  const sg0 = { isHeader: true, isData: false, isTotals: false, isFooter: false,
    getRowCount: () => 1, getRowHeight: () => 24,
    getCell: () => null, getGroupIdAt: () => null, type: 'header' as const };
  // 2 header subgrids + 1 data subgrid = 3 header rows in visibleRows.
  const vs = computeViewport({
    columnLayout: [{ colId: 'a', left: 0, width: 50 }],
    subgrids: [sg0, sg0, { ...sg0, isHeader: false, isData: true, getRowCount: () => 5 } as any],
    containerWidth: 200, containerHeight: 200, scrollLeft: 0, scrollTop: 0,
  });
  expect(vs.visibleRows.filter((r) => r.subgrid.isHeader).length).toBe(2);
});
```

- [ ] **Step 10: Update `byRows.test.ts` to assert a spanning group cell paints exactly one rect**

Add a test that constructs a fake `HeaderGroupSubgrid` row spanning 3 visible
columns and asserts `gc.fillRect` is called once with the merged width (verify
via the mocked gc's call log).

- [ ] **Step 11: Run unit + typecheck + build**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck
npm --workspace=cgrid run build
```

- [ ] **Step 12: Run E2E**

```bash
cd apps/cgrid-positions && npx playwright test --reporter=list
```

All existing E2E pass. New screenshot diff in the snapshot suite is OK if
expected and approved.

- [ ] **Step 13: Manual smoke**

`http://127.0.0.1:5180/` — header shows "P&L" cell spanning Total / Daily /
Unrealized columns. Scroll horizontally — group header tracks. Resize a
leaf — group header re-spans correctly.

- [ ] **Step 14: Commit**

```bash
git add cgrid/src/core/subgrid.ts cgrid/src/core/viewport.ts \
        cgrid/src/renderer/painters/byRows.ts \
        cgrid/src/interaction/hitTester.ts cgrid/src/cgrid.ts \
        apps/cgrid-positions/src/positionsGrid.ts \
        cgrid/tests/headerGroupSubgrid.test.ts cgrid/tests/viewport.test.ts \
        cgrid/tests/byRows.test.ts
git commit -m "$(cat <<'EOF'
feat(cgrid): HeaderGroupSubgrid — multi-row column-group header

Pushes one HeaderGroupSubgrid per tree depth above the leaf header.
Renderer collapses adjacent leaves sharing a group into a single spanning
cell. HitTester resolves a new 'headerGroup' hit kind (Task 3 handles
click-to-toggle). Demo now shows a P&L group spanning three columns.

Cycle 4 / Task 2.
EOF
)"
```

**Acceptance criteria:**
- [ ] `HeaderGroupSubgrid` exported from `cgrid/src/core/subgrid.ts`.
- [ ] `Hit.headerGroup` variant typed and resolved by `HitTester.locate`.
- [ ] Header shows `1 + maxDepth` rows; group cells span the union of their
      leaf widths; ungrouped leaves have no overlay cell in the group row.
- [ ] All unit tests + 7 E2E green; typecheck + build clean.
- [ ] Demo renders a "P&L" header spanning 3 columns; visually correct under
      scroll + resize.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 3 (Column group open/close + marryChildren). Confirm Task 2
is committed. Read docs/catalog/02-column-model.md sections "Behaviors — Column
group open/close" and the ColGroupDef table. Follow the per-task workflow.
```

---

## Task 3 — Column group open/close + `marryChildren` + `columnGroupShow`

**Goal:** Click a group header cell toggles its expanded state. `openByDefault`
seeds the initial state. `marryChildren: true` is recorded on the group node
(enforcement against drag-reorder lands in Cycle 6 — this task just persists
the bit). Leaves with `columnGroupShow: 'open'` are hidden when the parent
group is collapsed; `'closed'` is hidden when open; default is always visible.

**Why:** Without this, the group cell is decoration. With this, users can
manage column density via group toggles, and Tasks 11 (tool panels) /
22 (state snapshot) get a serializable group-state object to round-trip.

**Read first:**
- `docs/catalog/02-column-model.md` — `getColumnGroupState`/`setColumnGroupState`
  rows + "Column group open/close" behaviors section
- `cgrid/src/interaction/features/headerClick.ts` — the click handler we extend
- `cgrid/src/core/columnTree.ts` — `openByDefault` / `marryChildren` fields land in `ResolvedColGroupDef`

**Files:**
- Create: `cgrid/src/core/columnGroupState.ts` (state store + visibility resolver)
- Modify: `cgrid/src/interaction/features/headerClick.ts` (handle `headerGroup` hits)
- Modify: `cgrid/src/cgrid.ts` (wire state, derive `columnOrder` from `tree.leaves ∩ visibility`)
- Modify: `cgrid/src/types.ts` (add `columnGroupOpened` event)
- Create: `cgrid/tests/columnGroupState.test.ts`

**Interfaces:**

```ts
// cgrid/src/core/columnGroupState.ts
export interface ColumnGroupStateEntry { groupId: string; open: boolean }

export class ColumnGroupState {
  /** @param tree Latest column tree. State is rebuilt against this tree when
   *  the tree changes (e.g. updateGridOptions({ columnDefs })). */
  constructor(tree: ColumnTree);

  /** Returns true if `groupId` is currently open. Unknown groups → true. */
  isOpen(groupId: string): boolean;

  /** Toggle, fires onChange. */
  toggle(groupId: string): void;

  /** Set explicitly. */
  setOpen(groupId: string, open: boolean): void;

  /** Bulk apply — returns the entries that actually changed. */
  apply(entries: ColumnGroupStateEntry[]): ColumnGroupStateEntry[];

  /** Snapshot in declaration order. */
  getState(): ColumnGroupStateEntry[];

  /** Reset to definition defaults (openByDefault). */
  reset(): void;

  /** Subscribe to changes. Returns unsubscribe. */
  onChange(fn: (changed: ColumnGroupStateEntry[]) => void): () => void;

  /** Replace the tree (e.g. on updateGridOptions). Preserves matching IDs. */
  setTree(tree: ColumnTree): void;
}

/** Returns the visible leaf colIds given the tree + current group state.
 *  Respects `columnGroupShow` on each leaf and the open/closed status of
 *  every ancestor group on the leaf's groupPath. */
export function resolveVisibleLeaves(
  tree: ColumnTree,
  state: ColumnGroupState,
): string[];

// cgrid/src/types.ts — additions
export type CGridEvent =
  // … existing …
  | { type: 'columnGroupOpened'; groupId: string; open: boolean }
  | { type: 'displayedColumnsChanged'; source: 'columnGroupOpened' | 'columnDefsChanged' };
```

**Steps:**

- [ ] **Step 1: Write `columnGroupState.test.ts` failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { resolveColumnTree } from '../src/core/columnTree';
import { ColumnGroupState, resolveVisibleLeaves } from '../src/core/columnGroupState';

function makeTree() {
  return resolveColumnTree([
    { field: 'always' },
    {
      groupId: 'g1', openByDefault: false,
      children: [
        { field: 'closed-only', columnGroupShow: 'closed' },
        { field: 'open-only',   columnGroupShow: 'open' },
        { field: 'g1-always' },
      ],
    },
  ]);
}

describe('ColumnGroupState', () => {
  it('initial state honors openByDefault', () => {
    const s = new ColumnGroupState(makeTree());
    expect(s.isOpen('g1')).toBe(false);
  });
  it('toggle flips state and fires onChange', () => {
    const s = new ColumnGroupState(makeTree());
    const changes: any[] = [];
    s.onChange((c) => changes.push(c));
    s.toggle('g1');
    expect(s.isOpen('g1')).toBe(true);
    expect(changes[0]).toEqual([{ groupId: 'g1', open: true }]);
  });
  it('reset returns to definition defaults', () => {
    const s = new ColumnGroupState(makeTree());
    s.setOpen('g1', true);
    s.reset();
    expect(s.isOpen('g1')).toBe(false);
  });
});

describe('resolveVisibleLeaves', () => {
  it('closed group hides "open" children, shows "closed" + always', () => {
    const tree = makeTree();
    const state = new ColumnGroupState(tree);
    const ids = resolveVisibleLeaves(tree, state);
    expect(ids).toEqual(['always', 'closed-only', 'g1-always']);
  });
  it('open group hides "closed" children, shows "open" + always', () => {
    const tree = makeTree();
    const state = new ColumnGroupState(tree);
    state.setOpen('g1', true);
    const ids = resolveVisibleLeaves(tree, state);
    expect(ids).toEqual(['always', 'open-only', 'g1-always']);
  });
});
```

- [ ] **Step 2: Run; confirm failure (module missing)**

```bash
npm test --workspace=cgrid -- columnGroupState
```

- [ ] **Step 3: Implement `cgrid/src/core/columnGroupState.ts`**

```ts
import type { ColumnTree, ResolvedColGroupDef } from './columnTree';

export interface ColumnGroupStateEntry { groupId: string; open: boolean }

export class ColumnGroupState {
  private open = new Map<string, boolean>();
  private listeners = new Set<(changed: ColumnGroupStateEntry[]) => void>();
  private tree: ColumnTree;

  constructor(tree: ColumnTree) {
    this.tree = tree;
    this.seed();
  }

  private seed(): void {
    this.open.clear();
    for (const g of this.tree.groupById.values()) {
      this.open.set(g.groupId, g.openByDefault);
    }
  }

  isOpen(groupId: string): boolean {
    return this.open.get(groupId) ?? true;
  }

  setOpen(groupId: string, open: boolean): void {
    if (!this.tree.groupById.has(groupId)) return;
    if (this.open.get(groupId) === open) return;
    this.open.set(groupId, open);
    this.emit([{ groupId, open }]);
  }

  toggle(groupId: string): void {
    this.setOpen(groupId, !this.isOpen(groupId));
  }

  apply(entries: ColumnGroupStateEntry[]): ColumnGroupStateEntry[] {
    const changed: ColumnGroupStateEntry[] = [];
    for (const e of entries) {
      if (!this.tree.groupById.has(e.groupId)) continue;
      if (this.open.get(e.groupId) !== e.open) {
        this.open.set(e.groupId, e.open);
        changed.push(e);
      }
    }
    if (changed.length) this.emit(changed);
    return changed;
  }

  getState(): ColumnGroupStateEntry[] {
    const out: ColumnGroupStateEntry[] = [];
    for (const g of this.tree.groupById.values()) {
      out.push({ groupId: g.groupId, open: this.open.get(g.groupId) ?? g.openByDefault });
    }
    return out;
  }

  reset(): void {
    const changed: ColumnGroupStateEntry[] = [];
    for (const g of this.tree.groupById.values()) {
      const cur = this.open.get(g.groupId);
      if (cur !== g.openByDefault) {
        this.open.set(g.groupId, g.openByDefault);
        changed.push({ groupId: g.groupId, open: g.openByDefault });
      }
    }
    if (changed.length) this.emit(changed);
  }

  setTree(tree: ColumnTree): void {
    const prev = new Map(this.open);
    this.tree = tree;
    this.open.clear();
    for (const g of tree.groupById.values()) {
      this.open.set(g.groupId, prev.get(g.groupId) ?? g.openByDefault);
    }
  }

  onChange(fn: (changed: ColumnGroupStateEntry[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: ColumnGroupStateEntry[]): void {
    for (const fn of this.listeners) fn(changed);
  }
}

export function resolveVisibleLeaves(
  tree: ColumnTree,
  state: ColumnGroupState,
): string[] {
  const out: string[] = [];
  for (const leaf of tree.leaves) {
    const show = leaf.columnGroupShow;
    if (show == null) { out.push(leaf.colId); continue; }
    // Find the nearest ancestor group on this leaf's groupPath. If any
    // ancestor is closed and `show === 'open'`, hide. If open and
    // `show === 'closed'`, hide.
    const ancestors = findAncestors(tree, leaf.colId);
    if (ancestors.length === 0) { out.push(leaf.colId); continue; }
    const parent = ancestors[ancestors.length - 1]!;
    const parentOpen = state.isOpen(parent.groupId);
    if (show === 'open' && !parentOpen) continue;
    if (show === 'closed' && parentOpen) continue;
    out.push(leaf.colId);
  }
  return out;
}

function findAncestors(tree: ColumnTree, leafColId: string): ResolvedColGroupDef[] {
  // BFS through tree to find the leaf and capture its ancestor groups.
  const path: ResolvedColGroupDef[] = [];
  function walk(node: any, stack: ResolvedColGroupDef[]): boolean {
    if (node.kind === 'leaf') {
      if (node.colDef.colId === leafColId) {
        path.push(...stack);
        return true;
      }
      return false;
    }
    stack.push(node);
    for (const c of node.children) if (walk(c, stack)) return true;
    stack.pop();
    return false;
  }
  for (const root of tree.roots) if (walk(root, [])) break;
  return path;
}
```

- [ ] **Step 4: Add `ResolvedColDef.columnGroupShow` carry-through**

In `cgrid/src/core/propertyChain.ts`, add to `ResolvedColDef`:

```ts
columnGroupShow?: 'open' | 'closed' | null;
```

And copy through in `resolveColDef`:

```ts
columnGroupShow: merged.columnGroupShow ?? null,
```

- [ ] **Step 5: Verify the Step-1 tests pass**

```bash
npm test --workspace=cgrid -- columnGroupState
```

- [ ] **Step 6: Wire `ColumnGroupState` into `cgrid.ts`**

In `cgrid.ts`:
- Add field: `private groupState: ColumnGroupState;`
- After `resolveColumnTree`, construct: `this.groupState = new ColumnGroupState(this.columnTree);`
- Replace `this.columnOrder = this.columnTree.leaves;` with a derived getter:

  ```ts
  private recomputeVisibleColumns(): void {
    const visibleIds = resolveVisibleLeaves(this.columnTree, this.groupState);
    this.columnOrder = visibleIds.map((id) => this.columnTree.leafById.get(id)!);
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.canvasBounds.width || this.scroller.clientWidth || 800);
    this.recomputeViewport();
  }
  ```
- In the constructor (after `groupState` exists): `this.recomputeVisibleColumns();`
- Subscribe: `this.groupState.onChange((changed) => { this.recomputeVisibleColumns(); this.cgridCanvas?.requestRepaint(); for (const c of changed) this.events.emit({ type: 'columnGroupOpened', groupId: c.groupId, open: c.open }); this.events.emit({ type: 'displayedColumnsChanged', source: 'columnGroupOpened' }); });`

- [ ] **Step 7: Wire group click in `headerClick.ts`**

```ts
import { Feature, type CGridEventCtx } from '../feature';

export class HeaderClick extends Feature {
  override handleClick(ctx: CGridEventCtx): void {
    if (ctx.hit.kind === 'header') {
      ctx.grid.cycleSort(ctx.hit.colId);
      return;
    }
    if (ctx.hit.kind === 'headerGroup') {
      ctx.grid.toggleColumnGroup(ctx.hit.groupId);
      return;
    }
    super.handleClick(ctx);
  }
}
```

Add `toggleColumnGroup(groupId: string): void` to `CGridLike` in
`interaction/feature.ts` and implement it on `CGrid` as
`this.groupState.toggle(groupId)`. Expose API: `CGridApi.setColumnGroupState`,
`getColumnGroupState`, `resetColumnGroupState`.

- [ ] **Step 8: Add the `columnGroupOpened` + `displayedColumnsChanged` events to the union in `types.ts`**

(Already shown above in the Interfaces block — add to `CGridEvent`.)

- [ ] **Step 9: Run unit + typecheck + build + E2E + commit**

```bash
npm test --workspace=cgrid
npm --workspace=cgrid run typecheck && npm --workspace=cgrid run build
cd apps/cgrid-positions && npx playwright test --reporter=list
```

Commit:

```
feat(cgrid): column group open/close + columnGroupShow + group state API

Cycle 4 / Task 3.
```

**Acceptance criteria:**
- [ ] Click on a group header toggles `groupState`; `columnGroupOpened` event fires.
- [ ] Leaves with `columnGroupShow: 'open' | 'closed'` flip visibility with group state.
- [ ] `api.getColumnGroupState() / setColumnGroupState() / resetColumnGroupState()` work and round-trip.
- [ ] All unit + E2E pass; typecheck + build clean.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 4 (setGridOption + updateGridOptions + initial-only gating).
Confirm Task 3 is committed. Read docs/catalog/01-grid-options.md and the
"Behaviors" section. Follow the per-task workflow.
```

---

## Task 4 — `setGridOption` + `updateGridOptions` + initial-only gating

**Goal:** Add `api.setGridOption(key, value)` and `api.updateGridOptions(partial)`.
Maintain an `INITIAL_ONLY_OPTIONS` set; mutating an initial-only option throws.
Wire 15 runtime-safe options to live updates (theme, rowHeight, headerHeight,
defaultColDef, animateRows, rowSelection, suppressColumnVirtualisation,
enableCellChangeFlash, cellFlashDuration, cellFadeDuration,
asyncTransactionWaitMillis, rowBuffer, context, loading, debug). After this
task, apps can change density / theme / row buffer without rebuilding the grid.

**Why:** Cycles 21 (theming) + 22 (state) + 8 (sorting completeness) all need
runtime mutation. Putting `setGridOption` in early avoids retrofitting each
later cycle.

**Read first:**
- `docs/catalog/01-grid-options.md` — option taxonomy + the explicit
  initial-only callouts
- `cgrid/src/cgrid.ts` — current option fields + how `setTheme` mutates today (template for runtime-safe handlers)

**Files:**
- Create: `cgrid/src/core/runtimeOptions.ts` (declares `INITIAL_ONLY_OPTIONS` + per-option apply fns)
- Modify: `cgrid/src/cgrid.ts` (add `setGridOption` + `updateGridOptions` to api; wire to the new module)
- Modify: `cgrid/src/types.ts` (CGridApi additions + new options: `rowBuffer`, `animateRows`, `context`, `loading`, `debug`)
- Create: `cgrid/tests/runtimeOptions.test.ts`

**Steps (condensed — same TDD shape as Tasks 1-3):**

- [ ] **Step 1: Define the gate**

`cgrid/src/core/runtimeOptions.ts`:

```ts
export const INITIAL_ONLY_OPTIONS: ReadonlySet<keyof CGridOptions> = new Set<
  keyof CGridOptions
>([
  'columnDefs',        // use updateGridOptions({columnDefs}) — that route handles tree rebuild
  'getRowId',
  'worker',
]);

export type RuntimeOption =
  | 'theme' | 'rowHeight' | 'headerHeight' | 'defaultColDef'
  | 'animateRows' | 'rowSelection' | 'suppressColumnVirtualisation'
  | 'enableCellChangeFlash' | 'cellFlashDuration' | 'cellFadeDuration'
  | 'asyncTransactionWaitMillis' | 'rowBuffer' | 'context' | 'loading' | 'debug';
```

- [ ] **Step 2: Write per-option apply functions**

One function per option that mutates the necessary internal state + repaints.
Examples: `theme` → `setTheme`; `rowHeight` / `headerHeight` →
`recomputeViewport + requestRepaint`; `rowBuffer` → updates `overscanRows`
(Task 5 lands the read-site).

- [ ] **Step 3: Wire `setGridOption(key, value)` in cgrid.ts**

```ts
setGridOption<K extends keyof CGridOptions<TRow>>(key: K, value: CGridOptions<TRow>[K]): void {
  if (INITIAL_ONLY_OPTIONS.has(key)) {
    throw new Error(`[cgrid] '${String(key)}' is initial-only; use updateGridOptions({columnDefs}) for column changes`);
  }
  this.options[key] = value;
  applyRuntimeOption(this, key as RuntimeOption, value);
}

updateGridOptions(partial: Partial<CGridOptions<TRow>>): void {
  // Special-case columnDefs — rebuilds the tree.
  if ('columnDefs' in partial) {
    this.columnTree = resolveColumnTree(partial.columnDefs!, partial.defaultColDef ?? this.options.defaultColDef);
    this.groupState.setTree(this.columnTree);
    this.recomputeVisibleColumns();
    this.workerClient.updateColumns(this.workerColumns());  // worker protocol addition
    this.cgridCanvas.requestRepaint();
    this.options.columnDefs = partial.columnDefs!;
  }
  for (const k of Object.keys(partial)) {
    if (k === 'columnDefs') continue;
    this.setGridOption(k as any, (partial as any)[k]);
  }
}
```

(Tests cover: each runtime option applies; initial-only throws; columnDefs
swap preserves matching colIds + group state.)

- [ ] **Step 4: Add the new option fields to `CGridOptions`**

```ts
animateRows?: boolean;
suppressColumnVirtualisation?: boolean;
suppressRowVirtualisation?: boolean;
rowBuffer?: number;
context?: unknown;
loading?: boolean;
debug?: boolean;
```

- [ ] **Step 5: Tests, typecheck, build, E2E, commit**

Commit `feat(cgrid): setGridOption + updateGridOptions + initial-only gating
(Cycle 4 / Task 4).`

**Acceptance criteria:**
- [ ] `api.setGridOption('rowHeight', 40)` mutates display + repaints.
- [ ] `api.setGridOption('getRowId', fn)` throws with a clear message.
- [ ] `api.updateGridOptions({ columnDefs: [...] })` rebuilds the tree,
      preserves group state for matching IDs, and swaps the worker column metadata.
- [ ] Tests cover ≥10 runtime options + 3 initial-only error paths.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 5 (rowBuffer + virtualization toggles). Confirm Task 4 is
committed. Follow the per-task workflow.
```

---

## Task 5 — `rowBuffer` + virtualization toggles

**Goal:** Replace the hardcoded `overscanRows = 3` in `computeViewport` with
`options.rowBuffer ?? 3`. Implement `suppressColumnVirtualisation` (compute +
paint every column regardless of viewport) and `suppressRowVirtualisation`
(render the entire row count, no overscan window).

**Why:** Two of cgrid's perf budget targets (cold-start, scroll FPS) hinge on
correct overscan tuning. Apps with very tall rows want larger buffers;
apps doing screenshot-style tests want the suppressed-virtualisation modes.

**Read first:**
- `cgrid/src/core/viewport.ts` — overscan + column culling
- Catalog Area 26 — perf knobs

**Files:**
- Modify: `cgrid/src/core/viewport.ts` (accept `suppressColumnVirtualisation` / `suppressRowVirtualisation` flags)
- Modify: `cgrid/src/cgrid.ts` (pass `rowBuffer` + suppress flags through; reactivity via Task 4's runtimeOptions)
- Modify: `cgrid/tests/viewport.test.ts` (add 3 tests covering each flag + buffer)

**Steps (condensed):**

- [ ] Step 1: Test "rowBuffer of 10 expands overscan; suppressRowVirtualisation paints all rows"
- [ ] Step 2: Run; fail
- [ ] Step 3: Extend `ViewportInput` with the new fields; thread them into the row-pass loop
- [ ] Step 4: Update cgrid.ts call to `computeViewport`
- [ ] Step 5: Tests + typecheck + build + E2E + commit

```
feat(cgrid): rowBuffer + suppressColumnVirtualisation + suppressRowVirtualisation

Cycle 4 / Task 5.
```

**Acceptance criteria:**
- [ ] `options.rowBuffer = N` produces `visibleRows.filter(isData).length ≈ visibleRowsBeforeBuffer + 2N`.
- [ ] `suppressColumnVirtualisation: true` keeps `visibleColumns.length === columnOrder.length` at any scrollLeft.
- [ ] `suppressRowVirtualisation: true` produces `visibleRows.filter(isData).length === totalRowCount`.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 6 (ensureRowVisible with worker lookup). Confirm Task 5 is
committed. Read docs/catalog/23-api.md sections on ensureRowVisible / ensureColumnVisible /
ensureColumnGroupVisible. Follow the per-task workflow.
```

---

## Task 6 — `ensureRowVisible(rowId)` + `ensureColumnVisible` + `ensureColumnGroupVisible`

**Goal:** Replace the `ensureRowVisible` stub with a real implementation backed
by a worker round-trip (`getRowIndexForId`). Add `ensureColumnVisible(colId,
position?)` (already partly implemented via `ensureColIdVisible`; expose
publicly with positional `'auto' | 'start' | 'middle' | 'end'`). Add
`ensureColumnGroupVisible(groupId)` which opens ancestor groups + scrolls the
first leaf into view.

**Why:** Selection focus → `ensureCellVisible` chain wants ID-keyed lookup
because data updates re-sort/filter rows, and index-based focus drifts.
Tasks 7-9 all assume `setFocusedCell(rowId)` works.

**Files:**
- Modify: `cgrid/src/worker/protocol.ts` (add `getRowIndexForId` request + response)
- Modify: `cgrid/src/worker/worker.ts` (handler delegates to `state.visible().indexOf(id)`)
- Modify: `cgrid/src/worker/client.ts` (`getRowIndexForId(rowId): Promise<number>`)
- Modify: `cgrid/src/cgrid.ts` (real `ensureRowVisible`; `ensureColumnVisible` + `ensureColumnGroupVisible`)
- Modify: `cgrid/src/types.ts` (`CGridApi` signature changes — back-compat: new optional `position` defaults to `'auto'`)
- Modify: `cgrid/tests/workerClient.test.ts` + add `cgrid.integration.test.ts` E2E (scroll-to-row by ID).

**Steps (condensed):**

- [ ] Step 1: Extend `WorkerRequest` with `getRowIndexForId: { rowId: string }` and `WorkerResponse` with `rowIndex: { index: number }`.
- [ ] Step 2: Implement in `worker.ts`:

```ts
case 'getRowIndexForId': {
  const ids = visible();
  const idx = ids.indexOf(req.payload.rowId);
  post({ id: req.id, type: 'rowIndex', index: idx });
  break;
}
```

- [ ] Step 3: Client wrapper returns the index (or -1 if not found).
- [ ] Step 4: cgrid.ts `ensureRowVisible(rowId, position='auto')` — calls client, then `ensureRowIndexVisible(idx, position)` (extend the helper to honor position).
- [ ] Step 5: `ensureColumnVisible(colId, position='auto')` — derive `left/width` from `columnLayout`; clamp like the row helper. `ensureColumnGroupVisible(groupId)` → set ancestor groups open + `ensureColumnVisible(group.leafColIds[0])`.
- [ ] Step 6: Tests, typecheck, build, E2E, commit.

```
feat(cgrid): ensureRowVisible(rowId) backed by worker lookup + ensureColumn(Group)Visible

Cycle 4 / Task 6.
```

**Acceptance criteria:**
- [ ] `await api.ensureRowVisible('row-1234', 'middle')` resolves the row index via the worker and centers it in view.
- [ ] `api.ensureColumnVisible('pnl')` scrolls horizontally if the column is off-screen; no-op if pinned.
- [ ] `api.ensureColumnGroupVisible('pnl')` opens ancestor groups + scrolls.
- [ ] Tests cover: row found / not found / pinned / closed-group-needs-to-open / behind-scroll.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 7 (setFocusedCell + setSelectedRowIds by row ID). Confirm Task 6
is committed. Follow the per-task workflow.
```

---

## Task 7 — `setFocusedCell(rowId, colId)` + `setSelectedRowIds(ids[])`

**Goal:** Implement the two stubbed methods using the worker `getRowIndexForId`
lookup from Task 6. Selection model also gains ID-based persistence: when the
worker re-sorts, the selected row IDs survive; the selected *indices* are
rebuilt from the IDs on the next viewport.

**Why:** Today selection is index-keyed and silently breaks after `setSortModel`
or `applyTransaction({ update })`. Apps observing `selectionChanged` see
phantom selection jumps; this fixes it.

**Files:**
- Modify: `cgrid/src/interaction/selectionModel.ts` (store selection by rowId; map to indices via a callback per refresh)
- Modify: `cgrid/src/cgrid.ts` (implement `setFocusedCell` / `setSelectedRowIds`; on `modelUpdated` rebuild the index Set from the persistent ID Set)
- Modify: `cgrid/src/worker/protocol.ts` (`getRowIndicesForIds(ids[]): { indices: Int32Array }` — batched variant)
- Modify: `cgrid/tests/selectionModel.test.ts` + integration test.

**Steps (condensed): TDD per signature; commit at end.**

**Acceptance criteria:**
- [ ] `api.setFocusedCell('row-99', 'price')` ensures-visible then sets focus.
- [ ] `api.setSelectedRowIds(['r1', 'r2'])` triggers `selectionChanged`; survives a `setSortModel`.
- [ ] Focused cell ID survives `applyTransaction({ update: [...] })`.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 8 (custom cell renderer + cellRendererParams + cellRendererSelector).
Confirm Task 7 is committed. Follow the per-task workflow.
```

---

## Task 8 — Custom cell renderer + `cellRendererParams` + `cellRendererSelector`

**Goal:** Public API: `cgrid.registerCellRenderer(name, painter)`. Resolved
column carries `cellRendererParams` (typed `unknown` until app provides their
own types); paint config gains `params: unknown`. `cellRendererSelector`
callback runs at paint time per cell to return `{ component, params }` per row
— overrides the static `cellRenderer`.

**Why:** Without this, apps can't ship custom UI. Sparklines (Cycle 20),
group renderer (Cycle 14), status cells (Cycle 13) all depend on this hook.

**Files:**
- Modify: `cgrid/src/renderer/cellRenderers/registry.ts` (`CellPaintConfig.params?: unknown`)
- Modify: `cgrid/src/core/propertyChain.ts` (`ResolvedColDef.cellRendererParams: unknown; cellRendererSelector?: (params) => { component: string; params?: unknown } | undefined`)
- Modify: `cgrid/src/cgrid.ts` (public `registerCellRenderer(name, painter)`)
- Modify: `cgrid/src/renderer/painters/byRows.ts` (per-cell: invoke selector if defined; route to selector.component instead of static name; pass params)
- Modify: `cgrid/src/types.ts` (add fields)
- Create: `cgrid/tests/customCellRenderer.test.ts`

**Steps:** TDD; assert paint dispatches to a registered painter with the
correct merged params.

**Acceptance criteria:**
- [ ] `cgrid.registerCellRenderer('badge', badgePainter)` + `colDef.cellRenderer = 'badge'` paints with badge logic.
- [ ] `cellRendererParams: { fmt: '0.00' }` reaches the painter as `config.params`.
- [ ] `cellRendererSelector` overrides the static name per row.
- [ ] Unit + E2E green.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 9 (valueSetter + valueParser + commit-back). Confirm Task 8
is committed. Follow the per-task workflow.
```

---

## Task 9 — `valueSetter` + `valueParser` + commit-back

**Goal:** Editor commit pathway: raw string → `valueParser?(raw) ?? raw` →
`valueSetter?({ data, newValue, oldValue, colDef }) ?? data[field] = newValue`
→ `applyTransaction({ update: [row] })`. Today the editor emits
`cellValueChanged` but never writes back.

**Why:** Without commit-back, edits don't persist. Cycle 5 (editing
completeness) assumes this works.

**Files:**
- Modify: `cgrid/src/types.ts` (add `CColDef.valueParser`, `valueSetter` typed fns)
- Modify: `cgrid/src/core/propertyChain.ts` (carry both through `ResolvedColDef`)
- Modify: `cgrid/src/interaction/editorOverlay.ts` (no change — `onCommit` already passes the parsed value)
- Modify: `cgrid/src/cgrid.ts` (in `openEditor`'s onCommit: parse → set → transaction)
- Modify: `cgrid/src/worker/worker.ts` (already supports `applyTransaction({ update })` — verify path)
- Create: `cgrid/tests/commitBack.test.ts`

**Steps:**

- [ ] Step 1: TDD — assert that an editor commit on row `{id:'1', price:10}`
      with `valueParser: (raw) => Number(raw)` + `valueSetter: ({data, newValue}) => { data.price = newValue }`
      ends with `data.price === parsed value` AND a worker `applyTransaction` call.
- [ ] Step 2: Implement.
- [ ] Step 3: Verify; commit.

**Acceptance criteria:**
- [ ] Editor commit invokes `valueParser` (if defined) then `valueSetter` (if defined).
- [ ] Default path (`data[field] = newValue`) works when neither is set.
- [ ] `cellValueChanged` event fires with old/new value.
- [ ] Worker re-runs filter/sort/agg after the transaction.

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 10 (lifecycle events). Confirm Task 9 is committed. Follow
the per-task workflow.
```

---

## Task 10 — Lifecycle events: `gridPreDestroyed`, `gridSizeChanged`, `firstDataRendered`

**Goal:** Wire three remaining lifecycle events:
- `gridPreDestroyed { state }` — fires inside `destroy()` before teardown, carries a state snapshot (stub for Cycle 22; for now: `{}`)
- `gridSizeChanged { width, height }` — fires from `CGridCanvas.setBounds` when the bounds actually change
- `firstDataRendered` — fires exactly once on the first non-empty viewport paint

**Why:** Apps need these to integrate (analytics, autosize-on-mount, cleanup).
Cycle 22's state work expands `gridPreDestroyed.state`; the event surface
needs to exist now.

**Files:**
- Modify: `cgrid/src/types.ts` (add the three events to `CGridEvent`)
- Modify: `cgrid/src/cgrid.ts` (fire `gridPreDestroyed` in `destroy()`; wrap the setBounds callback to fire `gridSizeChanged` on change; gate first-data event behind a `firstDataFired: boolean` flag)
- Modify: `cgrid/src/core/canvas.ts` (no change — bounds-change detection lives in the cgrid.ts wrapper)
- Create: `cgrid/tests/lifecycleEvents.test.ts`

**Steps:**

- [ ] Step 1: TDD — assert each event fires once + at correct moment.
- [ ] Step 2: Implement.
- [ ] Step 3: Verify; commit.

**Acceptance criteria:**
- [ ] `gridPreDestroyed` fires synchronously inside `destroy()` before any DOM removal.
- [ ] `gridSizeChanged` fires when host bounds change, not on every paint.
- [ ] `firstDataRendered` fires exactly once on the first paint after a non-empty viewport chunk arrives.
- [ ] Tests cover triggers + non-trigger conditions (e.g., repaint without size change → no `gridSizeChanged`).

**Cycle 4 exit ritual (after Task 10's commit):**

- [ ] Update FM rows in `docs/catalog/FEATURE_MATRIX.md` to ✅:
      - Area 01: `setGridOption`, `updateGridOptions`, `gridPreDestroyed`, `gridSizeChanged`, `firstDataRendered`, `addEventListener` (already present), `rowBuffer`, `suppressColumnVirtualisation`, `suppressRowVirtualisation`
      - Area 02: `CColGroupDef.children` / `groupId` / `openByDefault` / `marryChildren` / `headerName`; `columnGroupShow`; `cellRendererParams`; `cellRendererSelector`; `valueSetter`; `valueParser`; `getColumnGroupState` / `setColumnGroupState` / `resetColumnGroupState`
      - Area 22: `columnGroupOpened`; `displayedColumnsChanged` (partial — fires on group open; column-state changes land in Cycle 6)
      - Area 23: `setGridOption`, `updateGridOptions`, `ensureRowVisible`, `ensureColumnVisible`, `ensureColumnGroupVisible`, `setFocusedCell`, `setSelectedRowIds`, `registerCellRenderer`
- [ ] Append to this worklog under "Shipped":
      - Column groups (model + visible header + open/close).
      - Runtime option mutation surface.
      - Real `ensureVisible` / focused-cell-by-id / selected-rows-by-id.
      - Custom cell renderer registry + params + selector.
      - Editor commit-back via valueParser/valueSetter.
      - 3 lifecycle events.
- [ ] Run the perf comparison commands (Cycle 24 introduces the harness; until
      then: hand-time cold start + scroll FPS on the demo); record numbers in
      this worklog. Verify no regression past Performance Budget table.
- [ ] Append `## Cycle 4 status: COMPLETE` + the shipped-feature list.

---

## Quick reference — per-task workflow

For every task:

1. Open a fresh Claude Code session at the repo root (`/Users/develop/wfh/canvasgrid`).
2. Paste the "Next session prompt" from the previous task (or the Task-1 prompt below for the first task).
3. The session reads this worklog + catalog refs, executes the task's Steps, runs the verification commands, and commits.
4. When done, the session ends with the prompt for the NEXT task.

### Task 1 starter prompt (first session, copy-paste):

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-cycle-04-foundation-gaps.md
and execute Task 1 (Column group model + ColGroupDef types). Read
docs/catalog/02-column-model.md section on ColGroupDef before touching any code.
This is the first session of Cycle 4; follow the Global Constraints, do not
skip the verification commands, and commit at the end.
```
