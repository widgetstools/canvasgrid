# Column Groups Editor Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native "Column Groups" customizer tab (after Options) that lets a user create/nest/rename/delete column groups, assign & reorder columns, toggle visibility, and style group headers — authoring the grid's `columnDefs` tree.

**Architecture:** A kernel-native tool panel (`agColumnGroupsToolPanel`, shortcut `'columnGroups'`) beside `columnsPanel`/`gridOptionsPanel`. The panel holds a **normalized flat working model** (`Node[]` with `parentId`/`order`); all edits are O(1) field writes; a pure `project()` folds it back to the nested `columnDefs` only on **Apply** (Reset re-flattens the last-applied defs). Header styling reuses the Phase 1 `settingsForm` renderer.

**Tech Stack:** TypeScript, `@cgrid/kernel` (vanilla DOM, happy-dom + Vitest), Phase 1 `settingsForm` + `tokens.css`. Zero new dependencies. E2E in `apps/cgrid-customizer-demo` (Vite, port 5187) against live STOMP.

## Global Constraints

- **NATIVE tier:** vanilla DOM in `@cgrid/kernel`, zero new dependencies, themed only via `tokens.css` CSS variables (no hard-coded colors).
- **Kernel tests:** Vitest + happy-dom. Run a single file with `npx vitest run <path> --root packages/kernel`; whole package with `npm test --workspace=@cgrid/kernel`.
- **Panel contract:** `interface ToolPanel { init(params: ToolPanelParams): void; getGui(): HTMLElement; refresh(): void; destroy(): void }` from `interaction/toolPanels/types.ts`. `ToolPanelParams` exposes `params.api` (the `CGridApi`).
- **Write path is Apply-only:** the panel must never touch the grid except inside the Apply handler, which calls `api.updateGridOptions({ columnDefs })` exactly once. No live/debounced pushes (protects the 300-upd/s stream).
- **Commit after every task.** End PR bodies / commits with the Co-Authored-By trailer already used in this repo.
- **Before building UI (Tasks 3–4):** consult `docs/catalog/screenshots/17-sidebar-columns-panel-open.png` and run `/frontend-design` for row layout, drag affordances, and the Style band. Full E2E run is the done-gate.

Spec: `docs/superpowers/specs/2026-07-03-cycle-21i-column-groups-editor-design.md`.

---

## File Structure

- Create `packages/kernel/src/interaction/columnGroups/model.ts` — pure flat model: types, `flatten`, `project`, mutation helpers, validation. No DOM.
- Create `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts` — the `ColumnGroupsToolPanel` class (chrome, tree render, buttons, drag, Apply/Reset, Style band).
- Create `packages/kernel/tests/columnGroupsModel.test.ts` — unit tests for `model.ts`.
- Create `packages/kernel/tests/columnGroupsToolPanel.test.ts` — panel tests with a mock API.
- Modify `packages/kernel/src/types/api.ts` — add `getColumnGroupDefs()` to `CGridApi`.
- Modify `packages/kernel/src/cgrid.ts` — implement `getColumnGroupDefs`; register `agColumnGroupsToolPanel`.
- Modify `packages/kernel/src/interaction/sideBar/host.ts` — add `case 'columnGroups'` to `expandToolPanelShortcut`.
- Modify `apps/cgrid-customizer-demo/src/main.ts` — add `'columnGroups'` to `sideBar.toolPanels`; seed example groups.
- Create `apps/cgrid-customizer-demo/tests/columnGroups.e2e.ts` (or the repo's existing E2E location) — end-to-end journey.

---

## Task 1: Kernel reader — `getColumnGroupDefs()`

**Files:**
- Modify: `packages/kernel/src/types/api.ts` (near `getColumnGroupState`, ~line 296)
- Modify: `packages/kernel/src/cgrid.ts` (public method + it already stores `this.options.columnDefs`, kept current by `updateGridOptions` at cgrid.ts:5358)
- Test: `packages/kernel/tests/columnGroupsDefs.test.ts`

**Interfaces:**
- Consumes: `this.options.columnDefs: (CColDef<TRow> | CColGroupDef<TRow>)[]` (current authored tree; `updateGridOptions({columnDefs})` overwrites it).
- Produces: `CGridApi.getColumnGroupDefs(): (CColDef | CColGroupDef)[]` — the seed source for the editor's `flatten()`.

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/tests/columnGroupsDefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef } from '../src/types';

function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new CGrid(el, { columnDefs, rowData: [] });
}

describe('api.getColumnGroupDefs', () => {
  it('returns the current authored column-def tree, groups included', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      { colId: 'a', field: 'a' },
      { groupId: 'g1', headerName: 'Prices', children: [
        { colId: 'bid', field: 'bid' },
        { colId: 'ask', field: 'ask' },
      ] },
    ];
    const grid = mount(defs);
    const out = grid.api.getColumnGroupDefs();
    expect(out).toHaveLength(2);
    const group = out.find((d): d is CColGroupDef => 'children' in d)!;
    expect(group.groupId).toBe('g1');
    expect(group.children.map((c) => (c as CColDef).colId)).toEqual(['bid', 'ask']);
  });

  it('reflects a tree swapped in via updateGridOptions', () => {
    const grid = mount([{ colId: 'a', field: 'a' }]);
    grid.api.updateGridOptions({
      columnDefs: [{ groupId: 'g2', headerName: 'X', children: [{ colId: 'a', field: 'a' }] }],
    });
    const out = grid.api.getColumnGroupDefs();
    expect((out[0] as CColGroupDef).groupId).toBe('g2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/columnGroupsDefs.test.ts --root packages/kernel`
Expected: FAIL — `getColumnGroupDefs is not a function`.

- [ ] **Step 3: Add the type to `CGridApi`**

In `packages/kernel/src/types/api.ts`, directly above `getColumnGroupState()` (~line 296):

```ts
  /** Cycle 21i — the current authored column-def tree (leaves and
   *  groups, arbitrarily nested), as last set at construction or via
   *  `updateGridOptions({ columnDefs })`. The Column Groups editor seeds
   *  its working model from this. Returns the live reference — callers
   *  must not mutate it; clone before editing. */
  getColumnGroupDefs(): (CColDef<TRow> | CColGroupDef<TRow>)[];
```

- [ ] **Step 4: Implement on the api object in `cgrid.ts`**

Find the api literal that defines `getColumnGroupState:` (cgrid.ts ~line 3341 is the internal accessor bag; the PUBLIC `api` object is where `getColumnGroupState`/`updateGridOptions` are exposed — locate it by searching `getColumnGroupState:` inside the public `this.api = { ... }` block). Add:

```ts
      getColumnGroupDefs: () => this.options.columnDefs ?? [],
```

Place it adjacent to the existing `getColumnGroupState` entry in the public api object so it is exported on `grid.api`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/columnGroupsDefs.test.ts --root packages/kernel`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/types/api.ts packages/kernel/src/cgrid.ts packages/kernel/tests/columnGroupsDefs.test.ts
git commit -m "feat(kernel): api.getColumnGroupDefs() reader for the Column Groups editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Normalized flat model — `columnGroups/model.ts`

**Files:**
- Create: `packages/kernel/src/interaction/columnGroups/model.ts`
- Test: `packages/kernel/tests/columnGroupsModel.test.ts`

**Interfaces:**
- Consumes: `CColDef`, `CColGroupDef`, `ColCellOverrides`, `HeaderClass` from `../../types`.
- Produces:
  - `type Node = GroupNode | ColumnNode` (fields per spec §2).
  - `flatten(defs: (CColDef | CColGroupDef)[]): Node[]`
  - `project(nodes: Node[]): (CColDef | CColGroupDef)[]`
  - Mutations (all `(nodes: Node[], ...) => Node[]`, pure, returning a new array): `createGroup(nodes, parentId, headerName)`, `renameGroup(nodes, id, headerName)`, `deleteGroup(nodes, id)`, `moveNode(nodes, id, newParentId, newOrder)`, `setHidden(nodes, colId, hide)`, `setColumnHeaderName(nodes, colId, headerName)`, `setGroupStyle(nodes, id, patch)`.
  - `canDrop(nodes: Node[], dragId: string, targetParentId: string | null): boolean`
  - `validate(nodes: Node[]): { ok: true } | { ok: false; groupId: string; message: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/tests/columnGroupsModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  flatten, project, createGroup, deleteGroup, moveNode, setHidden,
  setColumnHeaderName, setGroupStyle, canDrop, validate,
  type Node, type GroupNode,
} from '../src/interaction/columnGroups/model';
import type { CColDef, CColGroupDef } from '../src/types';

const nested: (CColDef | CColGroupDef)[] = [
  { colId: 'sym', field: 'sym', headerName: 'Symbol' },
  { groupId: 'trade', headerName: 'Trade', children: [
    { groupId: 'prices', headerName: 'Prices', children: [
      { colId: 'bid', field: 'bid', headerName: 'Bid' },
      { colId: 'ask', field: 'ask', headerName: 'Ask' },
    ] },
    { colId: 'last', field: 'last', headerName: 'Last' },
  ] },
];

describe('flatten/project round-trip', () => {
  it('is structurally identity for flat + nested + subgroup trees', () => {
    const out = project(flatten(nested));
    expect(out).toEqual(nested);
  });

  it('flatten emits ungrouped leaves with parentId null', () => {
    const nodes = flatten(nested);
    const sym = nodes.find((n) => n.kind === 'column' && n.colId === 'sym')!;
    expect(sym.parentId).toBeNull();
  });

  it('flatten preserves nesting depth via parentId chain', () => {
    const nodes = flatten(nested);
    const bid = nodes.find((n) => n.kind === 'column' && (n as any).colId === 'bid')!;
    const prices = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Prices')!;
    const trade = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Trade')!;
    expect(bid.parentId).toBe(prices.id);
    expect(prices.parentId).toBe(trade.id);
    expect(trade.parentId).toBeNull();
  });
});

describe('mutations', () => {
  it('createGroup adds an empty top-level group', () => {
    const nodes = createGroup(flatten(nested), null, 'Risk');
    const g = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Risk');
    expect(g).toBeDefined();
    expect(g!.parentId).toBeNull();
  });

  it('moveNode reparents a column into a group', () => {
    let nodes = flatten(nested);
    const risk = createGroup(nodes, null, 'Risk');
    const riskId = (risk.find((n) => (n as GroupNode).headerName === 'Risk') as GroupNode).id;
    const last = risk.find((n) => n.kind === 'column' && (n as any).colId === 'last')!;
    const moved = moveNode(risk, last.id, riskId, 0);
    expect(moved.find((n) => n.id === last.id)!.parentId).toBe(riskId);
  });

  it('deleteGroup reparents children to the group parent (no orphans)', () => {
    const nodes = flatten(nested);
    const prices = nodes.find((n) => n.kind === 'group' && (n as GroupNode).headerName === 'Prices') as GroupNode;
    const after = deleteGroup(nodes, prices.id);
    expect(after.find((n) => n.id === prices.id)).toBeUndefined();
    const bid = after.find((n) => n.kind === 'column' && (n as any).colId === 'bid')!;
    expect(bid.parentId).toBe(prices.parentId); // now under 'trade'
  });

  it('setHidden marks a column hidden and project writes hide:true', () => {
    const nodes = setHidden(flatten(nested), 'ask', true);
    const defs = project(nodes);
    const trade = defs.find((d): d is CColGroupDef => (d as any).groupId === 'trade')!;
    const prices = trade.children.find((d): d is CColGroupDef => (d as any).groupId === 'prices')!;
    const ask = prices.children.find((c) => (c as CColDef).colId === 'ask') as CColDef;
    expect(ask.hide).toBe(true);
  });

  it('setColumnHeaderName rewrites the leaf headerName on project', () => {
    const nodes = setColumnHeaderName(flatten(nested), 'sym', 'Ticker');
    const defs = project(nodes);
    expect((defs[0] as CColDef).headerName).toBe('Ticker');
  });

  it('setGroupStyle writes headerStyle on project', () => {
    const nodes0 = flatten(nested);
    const trade = nodes0.find((n) => (n as GroupNode).headerName === 'Trade') as GroupNode;
    const nodes = setGroupStyle(nodes0, trade.id, { headerStyle: { backgroundColor: '#123' } });
    const defs = project(nodes);
    const g = defs.find((d): d is CColGroupDef => (d as any).groupId === 'trade')!;
    expect((g.headerStyle as any).backgroundColor).toBe('#123');
  });
});

describe('validation', () => {
  it('canDrop rejects dropping a group into its own descendant', () => {
    const nodes = flatten(nested);
    const trade = nodes.find((n) => (n as GroupNode).headerName === 'Trade') as GroupNode;
    const prices = nodes.find((n) => (n as GroupNode).headerName === 'Prices') as GroupNode;
    expect(canDrop(nodes, trade.id, prices.id)).toBe(false);
    expect(canDrop(nodes, prices.id, null)).toBe(true);
  });

  it('validate fails on an empty group', () => {
    const nodes = createGroup(flatten(nested), null, 'Empty');
    const res = validate(nodes);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/columnGroupsModel.test.ts --root packages/kernel`
Expected: FAIL — cannot find module `../src/interaction/columnGroups/model`.

- [ ] **Step 3: Implement `model.ts`**

Create `packages/kernel/src/interaction/columnGroups/model.ts`:

```ts
/**
 * Cycle 21i — normalized flat working model for the Column Groups editor.
 *
 * The editor never mutates the nested CColGroupDef tree directly. It works
 * over a flat Node[] where every edit is an O(1) field write; `project()`
 * folds the flat model back to the nested `columnDefs` on Apply, and
 * `flatten()` seeds the model from `api.getColumnGroupDefs()`. Preserving
 * every non-structural CColDef field is done by keeping the original leaf
 * def keyed by colId — only headerName/hide/order are editor-owned.
 */
import type { CColDef, CColGroupDef, ColCellOverrides, HeaderClass } from '../../types';

export interface GroupNode {
  id: string;
  kind: 'group';
  parentId: string | null;
  order: number;
  headerName: string;
  openByDefault?: boolean;
  marryChildren?: boolean;
  headerStyle?: ColCellOverrides;
  headerClass?: HeaderClass;
}
export interface ColumnNode {
  id: string;
  kind: 'column';
  parentId: string | null;
  order: number;
  colId: string;
  headerName: string;
  hide?: boolean;
  /** Frozen reference to the original leaf def — every non-editor field
   *  (field, cellRenderer, valueFormatter, width…) is carried through
   *  project() unchanged. */
  readonly def: CColDef;
}
export type Node = GroupNode | ColumnNode;

const isGroupDef = (d: CColDef | CColGroupDef): d is CColGroupDef =>
  Array.isArray((d as CColGroupDef).children);

let seq = 0;
const nextGroupId = (existing?: string) => existing ?? `cg-grp-${++seq}`;

export function flatten(defs: (CColDef | CColGroupDef)[]): Node[] {
  const out: Node[] = [];
  const walk = (list: (CColDef | CColGroupDef)[], parentId: string | null) => {
    list.forEach((d, order) => {
      if (isGroupDef(d)) {
        const id = nextGroupId(d.groupId);
        out.push({
          id, kind: 'group', parentId, order,
          headerName: d.headerName ?? '',
          openByDefault: d.openByDefault,
          marryChildren: d.marryChildren,
          headerStyle: d.headerStyle as ColCellOverrides | undefined,
          headerClass: d.headerClass,
        });
        walk(d.children, id);
      } else {
        out.push({
          id: d.colId!, kind: 'column', parentId, order,
          colId: d.colId!, headerName: d.headerName ?? d.colId!,
          hide: d.hide, def: d,
        });
      }
    });
  };
  walk(defs, null);
  return out;
}

export function project(nodes: Node[]): (CColDef | CColGroupDef)[] {
  const childrenOf = (parentId: string | null): (CColDef | CColGroupDef)[] =>
    nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((n) => {
        if (n.kind === 'group') {
          const g: CColGroupDef = { groupId: n.id, headerName: n.headerName, children: childrenOf(n.id) };
          if (n.openByDefault !== undefined) g.openByDefault = n.openByDefault;
          if (n.marryChildren !== undefined) g.marryChildren = n.marryChildren;
          if (n.headerStyle !== undefined) g.headerStyle = n.headerStyle;
          if (n.headerClass !== undefined) g.headerClass = n.headerClass;
          return g;
        }
        const leaf: CColDef = { ...n.def, colId: n.colId, headerName: n.headerName };
        if (n.hide !== undefined) leaf.hide = n.hide;
        return leaf;
      });
  return childrenOf(null);
}

const clone = (nodes: Node[]): Node[] => nodes.map((n) => ({ ...n }));
const reindex = (nodes: Node[]): Node[] => {
  const perParent = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const arr = perParent.get(n.parentId) ?? [];
    arr.push(n);
    perParent.set(n.parentId, arr);
  }
  for (const arr of perParent.values()) arr.sort((a, b) => a.order - b.order).forEach((n, i) => { n.order = i; });
  return nodes;
};

export function createGroup(nodes: Node[], parentId: string | null, headerName: string): Node[] {
  const next = clone(nodes);
  const siblings = next.filter((n) => n.parentId === parentId).length;
  next.push({ id: nextGroupId(), kind: 'group', parentId, order: siblings, headerName });
  return reindex(next);
}

export function renameGroup(nodes: Node[], id: string, headerName: string): Node[] {
  return clone(nodes).map((n) => (n.id === id && n.kind === 'group' ? { ...n, headerName } : n));
}

export function deleteGroup(nodes: Node[], id: string): Node[] {
  const target = nodes.find((n) => n.id === id);
  if (!target || target.kind !== 'group') return nodes;
  const next = clone(nodes)
    .map((n) => (n.parentId === id ? { ...n, parentId: target.parentId } : n))
    .filter((n) => n.id !== id);
  return reindex(next);
}

export function moveNode(nodes: Node[], id: string, newParentId: string | null, newOrder: number): Node[] {
  if (!canDrop(nodes, id, newParentId)) return nodes;
  const next = clone(nodes).map((n) => (n.id === id ? { ...n, parentId: newParentId, order: newOrder - 0.5 } : n));
  return reindex(next);
}

export function setHidden(nodes: Node[], colId: string, hide: boolean): Node[] {
  return clone(nodes).map((n) => (n.kind === 'column' && n.colId === colId ? { ...n, hide } : n));
}

export function setColumnHeaderName(nodes: Node[], colId: string, headerName: string): Node[] {
  return clone(nodes).map((n) => (n.kind === 'column' && n.colId === colId ? { ...n, headerName } : n));
}

export function setGroupStyle(
  nodes: Node[], id: string,
  patch: Partial<Pick<GroupNode, 'headerStyle' | 'headerClass' | 'openByDefault' | 'marryChildren'>>,
): Node[] {
  return clone(nodes).map((n) => (n.id === id && n.kind === 'group' ? { ...n, ...patch } : n));
}

export function canDrop(nodes: Node[], dragId: string, targetParentId: string | null): boolean {
  if (dragId === targetParentId) return false;
  // Walk up from the target; if we reach dragId, the drop would create a cycle.
  let cur: string | null = targetParentId;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (cur) {
    if (cur === dragId) return false;
    cur = byId.get(cur)?.parentId ?? null;
  }
  // marryChildren: a column may not leave a marry-children group.
  const drag = byId.get(dragId);
  if (drag && drag.kind === 'column' && drag.parentId) {
    const parent = byId.get(drag.parentId);
    if (parent && parent.kind === 'group' && parent.marryChildren && targetParentId !== drag.parentId) return false;
  }
  return true;
}

export function validate(nodes: Node[]): { ok: true } | { ok: false; groupId: string; message: string } {
  for (const n of nodes) {
    if (n.kind === 'group') {
      const hasChild = nodes.some((c) => c.parentId === n.id);
      if (!hasChild) return { ok: false, groupId: n.id, message: 'Group has no columns' };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/columnGroupsModel.test.ts --root packages/kernel`
Expected: PASS (all cases). If the round-trip identity test fails on `groupId`, confirm `flatten` reuses `d.groupId` and `project` re-emits it as `groupId`.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/interaction/columnGroups/model.ts packages/kernel/tests/columnGroupsModel.test.ts
git commit -m "feat(kernel): normalized flat model for Column Groups editor (flatten/project + mutations)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tool panel — tree, buttons, drag, Apply/Reset

**Files:**
- Create: `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts`
- Modify: `packages/kernel/src/cgrid.ts` (register ctor near line 943 beside `GridOptionsToolPanel`)
- Modify: `packages/kernel/src/interaction/sideBar/host.ts` (add `case 'columnGroups'` in `expandToolPanelShortcut`, ~line 525)
- Test: `packages/kernel/tests/columnGroupsToolPanel.test.ts`

**Interfaces:**
- Consumes: `ToolPanel`, `ToolPanelParams` from `./types`; `api.getColumnGroupDefs()` (Task 1); model fns (Task 2); `api.updateGridOptions`.
- Produces: `class ColumnGroupsToolPanel implements ToolPanel`; sidebar shortcut `'columnGroups'` → `{ id: 'agColumnGroupsToolPanel', toolPanel: 'agColumnGroupsToolPanel', iconKey: 'group', labelDefault: 'Column Groups' }`.

**Before writing DOM:** open `docs/catalog/screenshots/17-sidebar-columns-panel-open.png` and run `/frontend-design` for the tree row, drag handle, and footer.

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/tests/columnGroupsToolPanel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ColumnGroupsToolPanel } from '../src/interaction/toolPanels/columnGroupsPanel';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';
import type { CColDef, CColGroupDef } from '../src/types';

function makeParams(onApply: ReturnType<typeof vi.fn>) {
  const defs: (CColDef | CColGroupDef)[] = [
    { colId: 'sym', field: 'sym', headerName: 'Symbol' },
    { groupId: 'trade', headerName: 'Trade', children: [
      { colId: 'bid', field: 'bid' }, { colId: 'ask', field: 'ask' },
    ] },
  ];
  return {
    api: {
      getColumnGroupDefs: () => defs,
      updateGridOptions: onApply,
    },
  } as unknown as ToolPanelParams;
}

describe('ColumnGroupsToolPanel', () => {
  it('renders a row per group and per column', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    expect(gui.querySelectorAll('[data-cg-node]').length).toBe(4); // sym, trade, bid, ask
    expect(gui.querySelector('[data-cg-node="trade"]')!.getAttribute('data-kind')).toBe('group');
  });

  it('Apply is disabled until an edit dirties the model', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('clicking "+ Group" dirties the model and enables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it('Apply on an empty new group is validation-blocked (no write)', () => {
    const onApply = vi.fn();
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(onApply));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement).click();
    expect(onApply).toHaveBeenCalledTimes(0); // empty group fails validate()
  });

  it('Reset re-seeds from getColumnGroupDefs and disables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-cg-reset]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(panel.getGui().querySelectorAll('[data-cg-node]').length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/columnGroupsToolPanel.test.ts --root packages/kernel`
Expected: FAIL — cannot find module `columnGroupsPanel`.

- [ ] **Step 3: Implement `columnGroupsPanel.ts`**

Create `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts`. Own only the chrome + tree render + Apply/Reset; delegate all state to the Task 2 model. Structure:

```ts
/**
 * Cycle 21i — Column Groups tool panel (built-in `agColumnGroupsToolPanel`,
 * sidebar shortcut `'columnGroups'`). Authors the columnDefs group tree via
 * the normalized flat model; writes to the grid only on Apply.
 */
import type { ToolPanel, ToolPanelParams } from './types';
import {
  flatten, project, createGroup, renameGroup, deleteGroup, moveNode,
  setHidden, setColumnHeaderName, setGroupStyle, validate, type Node, type GroupNode,
} from '../columnGroups/model';
import type { CColDef, CColGroupDef, CGridApi } from '../../types';

export class ColumnGroupsToolPanel implements ToolPanel {
  private root!: HTMLElement;
  private tree!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private api!: Pick<CGridApi, 'getColumnGroupDefs' | 'updateGridOptions'>;
  private nodes: Node[] = [];
  /** Canonical JSON of the last-applied projected tree — comparing against
   *  `project(nodes)` (also projected) makes seed→dirty reliably false even
   *  though raw defs and projected defs differ by key order / dropped
   *  undefineds. */
  private baseline = '';
  private selectedGroupId: string | null = null;

  init(params: ToolPanelParams): void {
    this.api = params.api as unknown as typeof this.api;
    this.root = el('div', 'cg-colgroups-panel');
    this.root.appendChild(this.buildToolbar());   // "+ Group", search
    this.tree = el('div', 'cg-colgroups-tree cg-scrollbar');
    this.root.appendChild(this.tree);
    this.root.appendChild(this.buildStyleSection()); // Task 4 fills this
    this.root.appendChild(this.buildFooter());       // Apply / Reset
    this.seed();
  }

  getGui(): HTMLElement { return this.root; }
  refresh(): void { this.seed(); }
  destroy(): void { this.root.remove(); }

  private seed(): void {
    const defs = this.api.getColumnGroupDefs();
    this.nodes = flatten(structuredClone(defs));
    this.baseline = JSON.stringify(project(this.nodes)); // canonical, not raw defs
    this.selectedGroupId = null;
    this.render();
  }

  private mutate(fn: (n: Node[]) => Node[]): void { this.nodes = fn(this.nodes); this.render(); }

  private get dirty(): boolean {
    return JSON.stringify(project(this.nodes)) !== this.baseline;
  }

  private onApply(): void {
    const res = validate(this.nodes);
    if (!res.ok) { this.flagGroup(res.groupId, res.message); return; }
    const defs = project(this.nodes);
    this.api.updateGridOptions({ columnDefs: defs });
    this.baseline = JSON.stringify(defs);
    this.render();
  }

  private render(): void {
    this.tree.replaceChildren();
    // Render top-level (parentId null) then recurse by parentId, ordered by order.
    const renderLevel = (parentId: string | null, depth: number) => {
      this.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
        .forEach((n) => { this.tree.appendChild(this.rowFor(n, depth)); renderLevel(n.id, depth + 1); });
    };
    // Ungrouped header, then groups — both live at parentId null; a synthetic
    // label separates ungrouped leaves visually (see /frontend-design output).
    renderLevel(null, 0);
    this.applyBtn.disabled = !this.dirty;
  }

  private rowFor(n: Node, depth: number): HTMLElement {
    const row = el('div', 'cg-colgroups-row');
    row.setAttribute('data-cg-node', n.id);
    row.setAttribute('data-kind', n.kind);
    row.style.paddingInlineStart = `${8 + depth * 16}px`;
    if (n.kind === 'group') {
      // expander, editable name, "+ Subgroup", delete; click selects for styling
      row.append(this.groupControls(n as GroupNode));
    } else {
      // ⋮⋮ drag handle, visibility checkbox, editable name
      row.append(this.columnControls(n));
    }
    this.wireDrag(row, n);
    return row;
  }

  // groupControls / columnControls / wireDrag / buildToolbar / buildFooter /
  // buildStyleSection / flagGroup — each builds tokens-only DOM and calls
  // this.mutate(...) with the matching model fn. Drag drop handlers call
  // this.mutate((ns) => moveNode(ns, dragId, targetParentId, targetOrder)).
  // Full bodies follow the columnsPanel.ts idiom (drag handle markup, checkbox).
  private buildToolbar(): HTMLElement {
    const bar = el('div', 'cg-colgroups-toolbar');
    const add = el('button', 'cg-btn') as HTMLButtonElement;
    add.textContent = '+ Group';
    add.setAttribute('data-cg-add-group', '');
    add.onclick = () => this.mutate((ns) => createGroup(ns, null, 'New Group'));
    bar.appendChild(add);
    return bar;
  }
  private buildFooter(): HTMLElement {
    const footer = el('div', 'cg-colgroups-footer');
    this.applyBtn = el('button', 'cg-btn cg-btn-primary') as HTMLButtonElement;
    this.applyBtn.textContent = 'Apply'; this.applyBtn.setAttribute('data-cg-apply', '');
    this.applyBtn.disabled = true; this.applyBtn.onclick = () => this.onApply();
    this.resetBtn = el('button', 'cg-btn') as HTMLButtonElement;
    this.resetBtn.textContent = 'Reset'; this.resetBtn.setAttribute('data-cg-reset', '');
    this.resetBtn.onclick = () => this.seed();
    footer.append(this.applyBtn, this.resetBtn);
    return footer;
  }
  // ...groupControls, columnControls, wireDrag, buildStyleSection (Task 4),
  //    flagGroup — implement per the idiom above.
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }
```

Implement the elided members (`groupControls`, `columnControls`, `wireDrag`, `buildStyleSection` stub returning an empty selected-group container, `flagGroup`) using the `columnsPanel.ts` drag-handle/checkbox idiom and tokens-only styling. All must route edits through `this.mutate(fn)` with the Task 2 helpers.

- [ ] **Step 4: Register the ctor in `cgrid.ts`**

At cgrid.ts ~line 943 (next to `this.toolPanelRegistry.register('agGridOptionsToolPanel', GridOptionsToolPanel);`):

```ts
    this.toolPanelRegistry.register('agColumnGroupsToolPanel', ColumnGroupsToolPanel);
```

Add the import near line 67:

```ts
import { ColumnGroupsToolPanel } from './interaction/toolPanels/columnGroupsPanel';
```

- [ ] **Step 5: Add the sidebar shortcut in `host.ts`**

In `expandToolPanelShortcut` (host.ts ~line 525), add a case before `default:`:

```ts
    case 'columnGroups':
      // Cycle 21i — native Column Groups editor tab (after Options).
      return {
        id: 'agColumnGroupsToolPanel',
        labelDefault: 'Column Groups',
        labelKey: 'columnGroups',
        iconKey: 'group',
        toolPanel: 'agColumnGroupsToolPanel',
      };
```

Update the `default:` throw message to include `'columnGroups'` in the expected list.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/columnGroupsToolPanel.test.ts --root packages/kernel`
Expected: PASS (4 tests).

- [ ] **Step 7: Add CSS (tokens only)**

Add `.cg-colgroups-*` rules to the kernel stylesheet that already carries `.cg-settings-panel` (find with `grep -rl "cg-settings-panel" packages/kernel/src`). Use existing CSS variables only — no literal colors. Mirror row height, hover, and drag-handle styles from the `.cg-tool-panel`/columns rules.

- [ ] **Step 8: Commit**

```bash
git add packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts packages/kernel/src/cgrid.ts packages/kernel/src/interaction/sideBar/host.ts packages/kernel/tests/columnGroupsToolPanel.test.ts packages/kernel/src/**/*.css
git commit -m "feat(kernel): Column Groups tool panel — tree, buttons, drag, Apply/Reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Group-header Style band

**Files:**
- Modify: `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts` (implement `buildStyleSection` + `renderStyleFor(groupId)`)
- Test: `packages/kernel/tests/columnGroupsToolPanel.test.ts` (append cases)

**Interfaces:**
- Consumes: `SettingsForm` from `../settingsForm/form`; `SettingsSection`, `SettingsField` from `../../types/settingsSchema`; `setGroupStyle` (Task 2).
- Produces: a per-group Style section that writes `headerStyle`/`headerClass`/`openByDefault`/`marryChildren` into the selected `GroupNode`.

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/tests/columnGroupsToolPanel.test.ts`:

```ts
it('selecting a group reveals a Style section bound to that group', () => {
  const panel = new ColumnGroupsToolPanel();
  panel.init(makeParams(vi.fn()));
  (panel.getGui().querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
  const style = panel.getGui().querySelector('[data-cg-style]')!;
  expect(style.getAttribute('data-for')).toBe('trade');
  // toggling marryChildren dirties the model
  const marry = style.querySelector('[data-cg-field="marryChildren"] input') as HTMLInputElement;
  marry.checked = true; marry.dispatchEvent(new Event('change'));
  const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
  expect(apply.disabled).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/columnGroupsToolPanel.test.ts --root packages/kernel`
Expected: FAIL — no `[data-cg-style]` / no selection wiring.

- [ ] **Step 3: Implement the Style band**

In `columnGroupsPanel.ts`: give each group row a selectable hit-target (`data-cg-select`) that sets `this.selectedGroupId` and calls `this.renderStyle()`. Implement `buildStyleSection()` to return a container `<div data-cg-style>`; `renderStyle()` builds a `SettingsSection` for the selected group and mounts a `SettingsForm`:

```ts
private buildStyleSection(): HTMLElement {
  this.styleHost = el('div', 'cg-colgroups-style');
  this.styleHost.setAttribute('data-cg-style', '');
  return this.styleHost;
}

private renderStyle(): void {
  this.styleHost.replaceChildren();
  if (!this.selectedGroupId) return;
  const g = this.nodes.find((n) => n.id === this.selectedGroupId && n.kind === 'group') as GroupNode | undefined;
  if (!g) return;
  this.styleHost.setAttribute('data-for', g.id);
  const patch = (p: Partial<GroupNode>) => this.mutate((ns) => setGroupStyle(ns, g.id, p));
  const section: SettingsSection = {
    id: 'cg-group-style', title: `Style — ${g.headerName}`,
    bands: [{
      id: 'header', title: 'Header',
      fields: [
        field('backgroundColor', 'Background', 'color',
          () => g.headerStyle?.backgroundColor, (v) => patch({ headerStyle: { ...g.headerStyle, backgroundColor: v as string } })),
        field('color', 'Text colour', 'color',
          () => g.headerStyle?.color, (v) => patch({ headerStyle: { ...g.headerStyle, color: v as string } })),
        field('fontWeight', 'Bold', 'switch',
          () => g.headerStyle?.fontWeight === 'bold', (v) => patch({ headerStyle: { ...g.headerStyle, fontWeight: v ? 'bold' : undefined } })),
        field('marryChildren', 'Marry children', 'switch',
          () => g.marryChildren === true, (v) => patch({ marryChildren: v as boolean })),
        field('openByDefault', 'Open by default', 'switch',
          () => g.openByDefault === true, (v) => patch({ openByDefault: v as boolean })),
      ],
    }],
  };
  const form = new SettingsForm(section);
  // tag fields for the test selector
  form.root.querySelectorAll('[data-field-key]').forEach((n) =>
    n.setAttribute('data-cg-field', n.getAttribute('data-field-key')!));
  this.styleHost.appendChild(form.root);
}
```

Add a `field(...)` helper returning a `SettingsField`. Confirm the `data-field-key` attribute exists on `settingsForm` rows; if the attribute name differs, map to whatever `form.ts` emits (grep `data-` in `settingsForm/form.ts`). Call `this.renderStyle()` at the end of `render()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/columnGroupsToolPanel.test.ts --root packages/kernel`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts packages/kernel/tests/columnGroupsToolPanel.test.ts
git commit -m "feat(kernel): per-group header Style band in Column Groups panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Demo wiring + E2E

**Files:**
- Modify: `apps/cgrid-customizer-demo/src/main.ts` (add shortcut; seed example groups)
- Create: E2E spec at the repo's E2E location (match existing `apps/cgrid-customizer-demo` or showcase E2E harness — grep for `*.e2e.ts` / playwright config first)

**Interfaces:**
- Consumes: everything above via consumer API only (no feature code in the app).

- [ ] **Step 1: Add the tab + seed groups in `main.ts`**

Change the sideBar line to include the new tab after Options:

```ts
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
```

Wrap 2–3 existing leaf defs (incl. a nested subgroup) so the tab opens with content, e.g.:

```ts
const columnDefs: CColDef<Position>[] | (CColDef<Position> | CColGroupDef<Position>)[] = [
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', width: 90 },
  { groupId: 'trade', headerName: 'Trade', openByDefault: true, children: [
    { groupId: 'prices', headerName: 'Prices', children: [
      num('Bid', 'bid'), num('Ask', 'ask'),
    ] },
    num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
  ] },
  // ...remaining flat columns unchanged
];
```

- [ ] **Step 2: Verify the tab renders live**

Run the demo: `npm run dev --workspace=apps/cgrid-customizer-demo` (port 5187). Open the sidebar → "Column Groups" tab is present after Options and shows the seeded `trade`/`prices` subgroup tree. Kill the dev server when done.

- [ ] **Step 3: Write the E2E journey**

Using the repo's existing E2E harness (Playwright/chrome-devtools per the showcase E2E setup), script: open Column Groups tab → click "+ Group", rename to "Risk" → drag a column into Risk → toggle a column's visibility checkbox → select a group, set header background → click Apply → assert the grid's header row now shows the new group + styling → reload page → assert the group structure persisted (via Phase 1 `persistState`). Kill the automation browser at the end (standing rule).

- [ ] **Step 4: Run the full kernel test + E2E**

Run: `npm test --workspace=@cgrid/kernel` — expected: all green (kernel baseline + new suites).
Run: the E2E command for `apps/cgrid-customizer-demo` — expected: the journey passes.

- [ ] **Step 5: Commit**

```bash
git add apps/cgrid-customizer-demo
git commit -m "feat(demo): Column Groups tab wired after Options + E2E journey

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §1 placement → T3/T5; §2 flat model → T2; §3 T1 reader → T1, T2 model → T2, T3 panel → T3, T4 style → T4, T5 demo → T5; §5 edge cases (empty group, marryChildren, cycle) → T2 `validate`/`canDrop` + tests; §6 persistence → free via Phase 1, exercised in T5 E2E reload.
- **Apply-only invariant:** the panel writes only in `onApply`; `dirty` compares `project(nodes)` vs `baseline` so Reset/round-trips settle to disabled.
- **Type consistency:** `flatten`/`project`/`createGroup`/`deleteGroup`/`moveNode`/`setHidden`/`setColumnHeaderName`/`setGroupStyle`/`canDrop`/`validate`, `Node`/`GroupNode`/`ColumnNode` are used identically across Tasks 2–4. Panel id `agColumnGroupsToolPanel` and shortcut `'columnGroups'` are consistent across T3 host.ts + cgrid.ts.
- **Open confirmations for the implementer (cheap greps, not blockers):** (a) exact `data-` attribute `settingsForm/form.ts` emits per field (Task 4 Step 3); (b) the kernel stylesheet file that hosts `.cg-settings-panel` (Task 3 Step 7); (c) the demo's E2E harness location (Task 5 Step 3).

---

## Task 6: Persist column-group structure across reload

**Provenance:** added 2026-07-03 after the Task 5 E2E proved that spec §5/§6's "persistence is free via the Phase 1 path" was WRONG. `columnDefs` is in `INITIAL_ONLY_OPTIONS`, and `updateGridOptions({columnDefs})` never feeds the persisted `GridState` — so group hierarchy + group `headerStyle` are lost on reload (leaf hide/order still persist via `columnState`). User decision (D-H) requires persistence; user chose to fix now.

**Approach (reuses Task 2's tested model):** persist a serializable flat **overlay** = the `flatten()` output with the `def` reference stripped (`SerializedNode = Omit<Node,'def'>`). On restore, rehydrate each `ColumnNode.def` by looking up the app's CURRENT base leaf defs by `colId`, then `project()` back to a `columnDefs` tree and apply it. This keeps functions out of the snapshot (defs come from live base defs, not the snapshot) and reuses the one tested projection.

**Files:**
- Modify: `packages/kernel/src/core/stateSnapshot.ts` (add `GridState.columnGroupDefs?`, add source method, include in `buildSnapshot`, bump `STATE_SCHEMA_VERSION`)
- Modify: `packages/kernel/src/core/stateUpdatedBus.ts` (map a columnDefs-changed event → `'columnGroupDefs'`)
- Modify: `packages/kernel/src/cgrid.ts` (implement the source; emit the dirty event on runtime `updateGridOptions({columnDefs})`; restore in the `setState` path via the internal columnDefs rebuild, suppressing a re-save)
- Modify: `packages/kernel/src/interaction/columnGroups/model.ts` (export a `SerializedNode` type + `rehydrate(overlay, baseDefs): Node[]` helper — pure, testable)
- Test: `packages/kernel/tests/columnGroupsPersist.test.ts`
- Modify: `apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts` (flip the `test.fixme` persistence test to a real passing test)

**Interfaces:**
- Consumes: `flatten`, `project`, `Node` (Task 2); `GridState`, `StateSnapshotSources`, `buildSnapshot`, `STATE_SCHEMA_VERSION` (stateSnapshot.ts); the `EVENT_TO_KEY` map (stateUpdatedBus.ts); `this.options.columnDefs`, the internal columnDefs rebuild path used by `updateGridOptions` (cgrid.ts).
- Produces:
  - `type SerializedNode = Omit<Node, 'def'>` (exported from model.ts).
  - `rehydrate(overlay: SerializedNode[], baseDefs: (CColDef|CColGroupDef)[]): Node[]` — reattaches each column node's `def` from `baseDefs` by `colId`; drops overlay column nodes whose `colId` is absent from `baseDefs`; appends any base leaf not present in the overlay as an ungrouped node (so columns added after the snapshot was saved still appear).
  - `GridState.columnGroupDefs?: SerializedNode[]`.
  - `StateSnapshotSources.getColumnGroupOverlay?(): SerializedNode[]`.

- [ ] **Step 1: Write the failing model test for `rehydrate`**

Add to `packages/kernel/tests/columnGroupsModel.test.ts`:

```ts
import { rehydrate, type SerializedNode } from '../src/interaction/columnGroups/model';

describe('rehydrate (persist overlay → nodes)', () => {
  const base: (CColDef | CColGroupDef)[] = [
    { colId: 'a', field: 'a', valueFormatter: () => 'X' }, // function survives
    { colId: 'b', field: 'b' },
    { colId: 'c', field: 'c' },
  ];
  it('reattaches def by colId and round-trips through project', () => {
    // overlay: group g wraps b+c, a stays ungrouped
    const overlay: SerializedNode[] = [
      { id: 'a', kind: 'column', parentId: null, order: 0, colId: 'a', headerName: 'a' },
      { id: 'g', kind: 'group', parentId: null, order: 1, headerName: 'G' },
      { id: 'b', kind: 'column', parentId: 'g', order: 0, colId: 'b', headerName: 'b' },
      { id: 'c', kind: 'column', parentId: 'g', order: 1, colId: 'c', headerName: 'c' },
    ];
    const defs = project(rehydrate(overlay, base));
    const g = defs.find((d): d is CColGroupDef => (d as any).groupId === 'g')!;
    expect(g.children.map((c) => (c as CColDef).colId)).toEqual(['b', 'c']);
    // the function-valued field on 'a' is preserved (came from baseDefs, not overlay)
    const a = defs.find((d) => (d as CColDef).colId === 'a') as CColDef;
    expect(typeof a.valueFormatter).toBe('function');
  });
  it('drops overlay entries whose colId no longer exists in base', () => {
    const overlay: SerializedNode[] = [
      { id: 'gone', kind: 'column', parentId: null, order: 0, colId: 'gone', headerName: 'gone' },
      { id: 'a', kind: 'column', parentId: null, order: 1, colId: 'a', headerName: 'a' },
    ];
    const defs = project(rehydrate(overlay, base));
    expect(defs.some((d) => (d as CColDef).colId === 'gone')).toBe(false);
  });
  it('appends base leaves missing from the overlay as ungrouped', () => {
    const overlay: SerializedNode[] = [
      { id: 'a', kind: 'column', parentId: null, order: 0, colId: 'a', headerName: 'a' },
    ]; // b, c missing
    const defs = project(rehydrate(overlay, base));
    expect(defs.some((d) => (d as CColDef).colId === 'b')).toBe(true);
    expect(defs.some((d) => (d as CColDef).colId === 'c')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/columnGroupsModel.test.ts --root packages/kernel`
Expected: FAIL — `rehydrate` / `SerializedNode` not exported.

- [ ] **Step 3: Implement `SerializedNode` + `rehydrate` in `model.ts`**

```ts
export type SerializedNode = Omit<Node, 'def'>;

/** Rebuild editable Nodes from a persisted overlay + the app's current
 *  base column defs. Column nodes get their `def` reattached by colId;
 *  overlay columns whose colId is gone are dropped; base leaves absent
 *  from the overlay are appended as ungrouped so newly-added columns
 *  still surface after a restore. Groups that end up empty are pruned by
 *  the caller via validate()/project() (project simply emits no children;
 *  a downstream prune drops childless groups — see below). */
export function rehydrate(overlay: SerializedNode[], baseDefs: (CColDef | CColGroupDef)[]): Node[] {
  const baseLeaves = flatten(baseDefs).filter((n): n is ColumnNode => n.kind === 'column');
  const defByColId = new Map(baseLeaves.map((n) => [n.colId, n.def]));
  const nodes: Node[] = [];
  const seen = new Set<string>();
  for (const s of overlay) {
    if (s.kind === 'group') { nodes.push({ ...s } as GroupNode); continue; }
    const def = defByColId.get(s.colId);
    if (!def) continue; // colId gone from base → drop
    seen.add(s.colId);
    nodes.push({ ...s, def } as ColumnNode);
  }
  // Append base leaves missing from the overlay, ungrouped, after existing top-level nodes.
  let tailOrder = nodes.filter((n) => n.parentId === null).length;
  for (const leaf of baseLeaves) {
    if (seen.has(leaf.colId)) continue;
    nodes.push({ ...leaf, parentId: null, order: tailOrder++ });
  }
  // Prune groups that reference no surviving children (e.g. all their columns were dropped).
  const hasChild = (id: string) => nodes.some((n) => n.parentId === id);
  return nodes.filter((n) => n.kind === 'column' || hasChild(n.id));
}
```

Note: the prune only removes leaf-empty groups one level; if a nested subgroup becomes empty its parent may also become empty — run the prune to a fixpoint (loop until no group is removed) to be safe. Implement the fixpoint loop.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/columnGroupsModel.test.ts --root packages/kernel`
Expected: PASS (all, including the 3 new).

- [ ] **Step 5: Wire GridState + snapshot source (kernel state layer)**

In `stateSnapshot.ts`:
- Add to `GridState`: `columnGroupDefs?: SerializedNode[];` (import the type from `../interaction/columnGroups/model`). Place it near `columnState` with a comment.
- Add to `StateSnapshotSources`: `getColumnGroupOverlay?(): SerializedNode[];`
- In `buildSnapshot`, after `columnState`: 
  ```ts
  const groupOverlay = sources.getColumnGroupOverlay?.();
  if (groupOverlay && groupOverlay.some((n) => n.kind === 'group')) snapshot.columnGroupDefs = groupOverlay;
  ```
  (Only persist when at least one GROUP exists — a purely flat grid writes nothing, keeping snapshots compact.)
- Bump `STATE_SCHEMA_VERSION` by 1. Leave `STATE_MIGRATIONS` empty (new optional field; old snapshots simply lack it).

- [ ] **Step 6: Dirty-bus mapping + emit on runtime columnDefs change**

- In `stateUpdatedBus.ts` `EVENT_TO_KEY`, add: `columnDefsChanged: 'columnGroupDefs',`.
- In `cgrid.ts` `updateGridOptions`, when `partial.columnDefs` is present (the branch at ~line 5358 that sets `this.options.columnDefs`), after the tree rebuild emit the event so the bus schedules a save: `this.events.emit({ type: 'columnDefsChanged' } as any);` (match the existing event-emit idiom in cgrid.ts; add `columnDefsChanged` to the event union if the codebase requires typed events — grep how `columnMoved` is declared/emitted and mirror it).

- [ ] **Step 7: Implement the source + restore in `cgrid.ts`**

- Source: add to the `StateSnapshotSources` object cgrid builds — `getColumnGroupOverlay: () => flatten(this.options.columnDefs ?? []).map(({ def, ...rest }) => rest)` (import `flatten` from `./interaction/columnGroups/model`). Stripping `def` yields `SerializedNode`.
- Restore: in the `setState` application path (grep for where `columnState`/`gridOptions` are consumed from the incoming snapshot), when `snapshot.columnGroupDefs` is present, compute `const defs = project(rehydrate(snapshot.columnGroupDefs, this.options.columnDefs ?? []))` and apply it through the SAME internal columnDefs rebuild `updateGridOptions({columnDefs})` uses — but WITHOUT re-triggering a persist save (restores run under the bus's `init` source; ensure the apply path doesn't emit a user `columnDefsChanged` that would immediately re-save, or emit it with the init source). Apply the group overlay BEFORE `columnState` restore so leaf width/hide/pinned from `columnState` settle on top of the restored structure. Verify ordering against how the existing restore sequences `gridOptions` (first) → `columnState`.

- [ ] **Step 8: Kernel persistence round-trip test**

Create `packages/kernel/tests/columnGroupsPersist.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CGrid } from '../src/cgrid';
import type { CColDef, CColGroupDef } from '../src/types';

// (mirror the Worker/canvas/getRowId mock setup used by runtimeOptions.test.ts)

function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div'); document.body.appendChild(el);
  return new CGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
}

describe('column-group structure persists through getState/setState', () => {
  const base: (CColDef | CColGroupDef)[] = [
    { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
  ];
  it('restores an edited group tree onto a fresh grid with the same base defs', () => {
    const g1 = mount(base);
    const api1 = (g1 as any).makeApi();
    // simulate a panel Apply: wrap b+c into group G with a header style
    api1.updateGridOptions({ columnDefs: [
      { colId: 'a', field: 'a' },
      { groupId: 'G', headerName: 'Grp', headerStyle: { bg: '#123456' }, children: [
        { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ] },
    ] });
    const snapshot = api1.getState();
    expect(snapshot.columnGroupDefs?.some((n: any) => n.kind === 'group')).toBe(true);

    const g2 = mount(base);            // fresh grid, SAME base defs (functions intact)
    const api2 = (g2 as any).makeApi();
    api2.setState(snapshot);
    const defs = api2.getColumnGroupDefs();
    const grp = defs.find((d: any) => d.groupId === 'G');
    expect(grp).toBeDefined();
    expect(grp.children.map((c: any) => c.colId)).toEqual(['b', 'c']);
    expect(grp.headerStyle.bg).toBe('#123456');
  });
});
```

Run: `npx vitest run tests/columnGroupsPersist.test.ts --root packages/kernel` → PASS. Then the FULL suite `npm test --workspace=@cgrid/kernel` → all green (state snapshot version bump must not break existing state tests; if a snapshot-version assertion exists, update it).

- [ ] **Step 9: Flip the Task 5 E2E `test.fixme` to a passing test**

In `apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts`, change the `test.fixme(...)` persistence case to `test(...)`, run `npm run test:e2e --workspace=apps/cgrid-customizer-demo`, confirm the create→Apply→reload→still-present journey now passes. If a selector/timing tweak is needed, make it.

- [ ] **Step 10: Commit**

```bash
git add packages/kernel/src/core/stateSnapshot.ts packages/kernel/src/core/stateUpdatedBus.ts packages/kernel/src/cgrid.ts packages/kernel/src/interaction/columnGroups/model.ts packages/kernel/tests/columnGroupsModel.test.ts packages/kernel/tests/columnGroupsPersist.test.ts apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts
git commit -m "feat(kernel): persist column-group structure overlay across reload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 6 self-review:** overlay carries NO functions (defs rehydrated from live base); reuses tested `flatten`/`project`; `rehydrate` handles dropped colIds + newly-added columns + empty-group prune to fixpoint; only persists when a group exists; schema version bumped; restore ordered before `columnState`; E2E fixme flipped.

---

## Task 7: Expose `columnGroupShow` per-column in the editor (expand/collapse visibility)

**Provenance:** added 2026-07-03 per user request — support ag-grid's column-group expand/collapse where "some columns are always visible" and others show only when the group is open/closed. **The engine already implements this**: `CColDef.columnGroupShow?: 'open' | 'closed' | null` exists (`types/column.ts:416`) and `resolveVisibleLeaves` (`core/columnGroupState.ts`) enforces the exact semantics — `null`/absent = always visible, `'open'` = visible only while every ancestor group is open, `'closed'` = visible only when the parent is collapsed (with cascading collapse). `openByDefault` is already editable (Task 4 Style band). This task is EDITOR-ONLY: expose the per-column `columnGroupShow` authoring control. No kernel change.

**UX (user chose BOTH):** an inline 3-state control on each column row that sits inside a group, AND the same control mirrored in the selected group's Style band as a "Children visibility" list. Ungrouped columns show no control. Both surfaces read/write the same `ColumnNode` field, so a `render()` after any edit keeps them in sync.

**Files:**
- Modify: `packages/kernel/src/interaction/columnGroups/model.ts` (add `columnGroupShow` to `ColumnNode`; `flatten` reads `d.columnGroupShow`; `project` writes it; add `setColumnGroupShow`)
- Modify: `packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts` (inline control on grouped column rows; children-visibility list in the Style band)
- Modify: `packages/kernel/tests/columnGroupsModel.test.ts` and `tests/columnGroupsToolPanel.test.ts`
- Modify: `apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts` (add a columnGroupShow journey)

**Interfaces:**
- `ColumnNode` gains `columnGroupShow?: 'open' | 'closed' | null`.
- `setColumnGroupShow(nodes: Node[], colId: string, value: 'open' | 'closed' | null): Node[]` — pure, returns a new array (mirrors `setHidden`).
- `flatten` copies `d.columnGroupShow` onto the ColumnNode; `project` writes `leaf.columnGroupShow` only when set (preserve round-trip identity — omit when `undefined`; a stored `null` means explicit "always", write it only if the base def had it).

- [ ] **Step 1: Model — failing test**

Add to `tests/columnGroupsModel.test.ts`:

```ts
import { setColumnGroupShow } from '../src/interaction/columnGroups/model';

describe('columnGroupShow round-trip + mutation', () => {
  const defs: (CColDef | CColGroupDef)[] = [
    { groupId: 'g', headerName: 'G', children: [
      { colId: 'a', field: 'a', columnGroupShow: 'open' },
      { colId: 'b', field: 'b' }, // absent = always visible
    ] },
  ];
  it('round-trips columnGroupShow through flatten/project', () => {
    expect(project(flatten(defs))).toEqual(defs);
  });
  it('flatten carries columnGroupShow onto the ColumnNode', () => {
    const a = flatten(defs).find((n) => n.kind === 'column' && (n as any).colId === 'a') as any;
    expect(a.columnGroupShow).toBe('open');
  });
  it('setColumnGroupShow updates one column and projects it', () => {
    const nodes = setColumnGroupShow(flatten(defs), 'b', 'closed');
    const g = project(nodes)[0] as CColGroupDef;
    const b = g.children.find((c) => (c as CColDef).colId === 'b') as CColDef;
    expect(b.columnGroupShow).toBe('closed');
  });
  it('setting back to null (always) is representable', () => {
    const nodes = setColumnGroupShow(flatten(defs), 'a', null);
    const g = project(nodes)[0] as CColGroupDef;
    const a = g.children.find((c) => (c as CColDef).colId === 'a') as CColDef;
    expect(a.columnGroupShow ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** — `npx vitest run tests/columnGroupsModel.test.ts --root packages/kernel` (missing `setColumnGroupShow` / field).

- [ ] **Step 3: Implement in `model.ts`**

- `ColumnNode`: add `columnGroupShow?: 'open' | 'closed' | null;`
- `flatten` leaf branch: add `columnGroupShow: d.columnGroupShow,` to the pushed ColumnNode.
- `project` leaf: after building `leaf`, `if (n.columnGroupShow !== undefined) leaf.columnGroupShow = n.columnGroupShow;` (mirrors the `hide` handling — omit when undefined so identity holds; write an explicit `null` since that is a meaningful "always" the base def carried).
- Add:
  ```ts
  export function setColumnGroupShow(
    nodes: Node[], colId: string, value: 'open' | 'closed' | null,
  ): Node[] {
    return nodes.map((n) => (n.kind === 'column' && n.colId === colId ? { ...n, columnGroupShow: value } : n));
  }
  ```
- Note the `SerializedNode`/`rehydrate`/`toSerializedNodes` path from Task 6: `columnGroupShow` is a plain-data field on `ColumnNode`, so it is INCLUDED in the persisted overlay automatically (it is not `def`, not a function) and survives `rehydrate` via the `{ ...s, def }` spread. Add one assertion to `tests/columnGroupsPersist.test.ts` that a column's `columnGroupShow` survives getState→setState onto a fresh grid.

- [ ] **Step 4: Run → pass** (model + persist suites).

- [ ] **Step 5: Panel — failing test**

Add to `tests/columnGroupsToolPanel.test.ts`: after init with a seeded group containing a column, assert an inline `columnGroupShow` control exists on a grouped column row (`[data-cg-node="<colId>"] [data-cg-groupshow]`) and NOT on an ungrouped column row; changing it (set the `<select>` value + dispatch `change`, or click the segmented control) dirties the model (Apply enables) and, after Apply, the projected def carries the chosen `columnGroupShow`. Add a second assertion that selecting the group renders a children-visibility list in `[data-cg-style]` (`[data-cg-child-show="<colId>"]`) whose control reflects/writes the same value.

- [ ] **Step 6: Implement in `columnGroupsPanel.ts`**

- **Inline control:** in the column-row builder, when the column's `parentId` is non-null (inside a group), append a compact 3-state control tagged `data-cg-groupshow` with options Always (`null`) / When open (`'open'`) / When collapsed (`'closed'`). Use a native `<select>` styled with existing tokens (reuse `.cg-settings-*` select styling) OR a small segmented button group consistent with the Style band toggles. On change → `this.mutate((ns) => setColumnGroupShow(ns, colId, value))`. Do NOT render it for `parentId === null` rows.
- **Style-band mirror:** in `renderStyle()` (Task 4), after the header fields, add a "Children visibility" section listing the selected group's direct + nested descendant columns, each with the same 3-state control tagged `data-cg-child-show="<colId>"`, wired to the same `setColumnGroupShow`. Keep it tokens-only; label copy: section "Children visibility", options "Always" / "When open" / "When collapsed".
- Keyboard-accessible + focus ring (same floor as Task 3/4). Both controls funnel through one helper so they never diverge.

- [ ] **Step 7: Run → pass** (panel suite). Also run full kernel suite `npm test --workspace=@cgrid/kernel`.

- [ ] **Step 8: CSS (tokens only)** — add any `.cg-colgroups-groupshow` / children-list rules to `theming/tokens.css`, reusing existing tokens; no literal colors.

- [ ] **Step 9: E2E journey**

In `apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts` add a test: open the tab, set a grouped column's inline control to "When collapsed", Apply, assert via `getColumnGroupDefs()` that the column's def has `columnGroupShow: 'closed'`; reload and assert it persisted. If the grid exposes a visible-columns/leaf API on `window.__cgapi`, additionally collapse the group (via `setColumnGroupState` or the header toggle) and assert the column's runtime visibility flips; otherwise the def+persist assertion suffices (runtime `resolveVisibleLeaves` semantics are already unit-covered in the kernel). Rebuild the kernel (`npm run build --workspace=@cgrid/kernel`) before running so the demo's `dist` sees the change. Run `npm run test:e2e --workspace=apps/cgrid-customizer-demo`.

- [ ] **Step 10: Commit**

```bash
git add packages/kernel/src/interaction/columnGroups/model.ts packages/kernel/src/interaction/toolPanels/columnGroupsPanel.ts packages/kernel/src/theming/tokens.css packages/kernel/tests/columnGroupsModel.test.ts packages/kernel/tests/columnGroupsToolPanel.test.ts packages/kernel/tests/columnGroupsPersist.test.ts apps/cgrid-customizer-demo/e2e/columnGroups.spec.ts
git commit -m "feat(kernel): edit columnGroupShow (always/open/closed) per column in Column Groups panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 7 self-review:** engine already enforces `columnGroupShow` (no kernel behavior change); model round-trips the field + persists via the Task 6 overlay automatically; BOTH UI surfaces (inline + Style band) write one shared helper; ungrouped rows omit the control; tokens-only, keyboard-accessible; E2E asserts def + persistence.
