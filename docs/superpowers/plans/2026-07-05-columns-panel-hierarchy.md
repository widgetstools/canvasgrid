# Columns Tool Panel — Hierarchical Groups + ag-grid-parity Drag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cgrid's columns side panel render the live column-group tree hierarchically (groups as expandable rows with tri-state checkboxes, indented children) and support ag-grid-parity drag: reorder columns/groups and re-parent columns into/out of groups.

**Architecture:** A pure group-membership mutation core (`core/columnGroupMutation.ts`) transforms the `columnDefs` tree; two thin `CGridApi` methods apply it while preserving runtime column state. The columns `visibilityPanel` renders by walking `getColumnGroupDefs()` and its drag orchestrator calls the new API on drop.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (kernel unit + integration), Playwright (demo E2E). No new deps. Canvas grid; tool panels are DOM.

**Spec (source of truth):** `docs/superpowers/specs/2026-07-05-columns-panel-hierarchy-design.md`. Read it first.

## Global Constraints

- CSP-safe, no `eval`/`new Function`. Pure JSON discipline in the mutation core (plain clones, no class instances leaking into defs).
- The mutation core is **pure** — no `Date.now()`/`Math.random()` (they're banned in some contexts and unnecessary); auto-`groupId` is NOT minted here (top-level = `null`; no group creation this cycle — spec §5.1/§10).
- Follow existing tool-panel patterns: DOM built imperatively, listeners cleaned up in `destroy()`, `data-col-id`/`data-group-id` on rows, classes prefixed `cg-columns-panel-*`.
- `marryChildren` groups: re-parent into/out of is REJECTED (no-op); reorder-within + move-group-as-unit allowed (spec §5.1).
- Verification gate every task: `cd packages/kernel && npx tsc --noEmit && npm run build && npx vitest run` all green before commit. Kernel perf tests are CPU-flaky under load — re-run a lone red standalone before trusting it.
- Branch `feature/columns-panel-hierarchy` (already created off main). Commit per task. NO per-task reviewer — SINGLE closeout review at T4.

**Key existing symbols (verified):**
- `packages/kernel/src/core/columnTree.ts`: `isColGroupDef(def)`, `resolveColumnTree(defs, defaultColDef?, columnTypes?)` (throws on empty children / duplicate groupId / duplicate colId), `ResolvedColGroupDef` (`kind:'group'`, `groupId`, `headerName`, `marryChildren`, `depth`, `children`, `leafColIds`), `ResolvedColLeaf` (`kind:'leaf'`, `colDef`, `depth`, `groupPath`), `ColumnTree` (`roots`, `leaves`, `leafById`, `groupById`, `maxDepth`).
- `packages/kernel/src/types/column.ts`: `CColGroupDef` = `{ groupId?, headerName?, children: (CColDef|CColGroupDef)[], openByDefault?, marryChildren?, columnGroupShow? }`; `CColDef` has `colId`/`field`, `columnGroupShow?`, `hide?`, `width?`, `pinned?`.
- `CGridApi`: `getColumnGroupDefs()`, `getColumnGroupState()`, `setColumnGroupState(state)`, `getColumnState(): CColumnState[]`, `applyColumnState?`/`setColumnsVisible(keys, visible)`, `moveColumns(keys, toIndex)`, `updateGridOptions(partial)`.
- `packages/kernel/src/cgrid.ts`: `rebuildColumnDefsByLeafOrder(defs, newLeafOrder)` (module-private helper — reorders a defs tree to a leaf order, pulling groups with their leaves), `applyColumnStateInternal`, `this.columnTree`.
- `visibilityPanel.ts`: `buildRows()` (flat walk of `getColumnState()`), `buildRow(entry)`, `computeRowChecked`, `handleRowCheckboxClick`, `syncRows(state)`, `applySearchFilter`, `beginRowDrag(e, colId)` (drag orchestrator; step 4 = in-panel reorder via `moveColumns`).

---

### Task 1: Group-membership mutation core + `CGridApi` methods

**Files:**
- Create: `packages/kernel/src/core/columnGroupMutation.ts`
- Create: `packages/kernel/tests/columnGroupMutation.test.ts`
- Modify: `packages/kernel/src/cgrid.ts` (add `moveColumnToGroup` / `moveColumnGroup` class methods + `makeApi` entries; add a private `applyColumnDefsPreservingState`)
- Modify: `packages/kernel/src/types/api.ts` (2 method signatures)
- Create: `packages/kernel/tests/columnGroupMutationApi.integration.test.ts`

**Interfaces:**
- Produces (pure module):
  ```ts
  export type ColDefsTree = (CColDef | CColGroupDef)[];
  export interface MutationResult { defs: ColDefsTree; leafOrder: string[]; }
  /** null result = rejected / no-op (marryChildren, unknown target, into-self, no change). */
  export function moveColumnToGroup(defs: ColDefsTree, colId: string, targetGroupId: string | null, beforeColId?: string): MutationResult | null;
  export function moveColumnGroup(defs: ColDefsTree, groupId: string, targetParentGroupId: string | null, beforeId?: string): MutationResult | null;
  ```
- Produces (`CGridApi`): `moveColumnToGroup(colId, targetGroupId, beforeColId?): void`, `moveColumnGroup(groupId, targetParentGroupId, beforeId?): void`.
- Consumes: `isColGroupDef`, `resolveColumnTree` (validation), `CColDef`/`CColGroupDef`.

- [ ] **Step 1: Write failing tests for the pure `moveColumnToGroup` transform**

Create `packages/kernel/tests/columnGroupMutation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { moveColumnToGroup, moveColumnGroup } from '../src/core/columnGroupMutation';
import { resolveColumnTree } from '../src/core/columnTree';
import type { CColDef, CColGroupDef } from '../src/types';

const leaf = (colId: string, extra: Partial<CColDef> = {}): CColDef => ({ colId, field: colId, ...extra });
const grp = (groupId: string, children: (CColDef | CColGroupDef)[], extra: Partial<CColGroupDef> = {}): CColGroupDef =>
  ({ groupId, headerName: groupId, children, ...extra });

// a: [ A, grp G1[ B, C ], grp G2[ D ] ]
const base = (): (CColDef | CColGroupDef)[] => [leaf('A'), grp('G1', [leaf('B'), leaf('C')]), grp('G2', [leaf('D')])];

/** flat leaf order from a defs tree (declaration order). */
const order = (defs: (CColDef | CColGroupDef)[]): string[] => resolveColumnTree(defs).leaves.map((l) => l.colId);
/** groupId a leaf sits under (or null). */
const parentOf = (defs: (CColDef | CColGroupDef)[], colId: string): string | null => {
  const t = resolveColumnTree(defs); const leaf = t.leafById.get(colId);
  const path = t.leaves.length ? undefined : undefined; // path via ResolvedColLeaf.groupPath
  // resolve via roots walk:
  let found: string | null = null;
  const walk = (nodes: any[], parent: string | null) => { for (const n of nodes) {
    if (n.kind === 'group') walk(n.children, n.groupId);
    else if (n.colDef.colId === colId) found = parent;
  }};
  walk(t.roots, null); return found;
};

describe('moveColumnToGroup (pure)', () => {
  it('moves a top-level leaf INTO a group at the end', () => {
    const r = moveColumnToGroup(base(), 'A', 'G1')!;
    expect(parentOf(r.defs, 'A')).toBe('G1');
    expect(order(r.defs)).toEqual(['B', 'C', 'A', 'D']); // A joins G1 after its leaves
  });
  it('moves a leaf INTO a group before a sibling', () => {
    const r = moveColumnToGroup(base(), 'A', 'G1', 'C')!;
    expect(order(r.defs)).toEqual(['B', 'A', 'C', 'D']);
    expect(parentOf(r.defs, 'A')).toBe('G1');
  });
  it('moves a grouped leaf OUT to top level (before a top-level ref)', () => {
    const r = moveColumnToGroup(base(), 'B', null, 'A')!;
    expect(parentOf(r.defs, 'B')).toBeNull();
    expect(order(r.defs)).toEqual(['B', 'A', 'C', 'D']);
  });
  it('cleans up a group emptied by the move (recursively)', () => {
    const r = moveColumnToGroup(base(), 'D', null)!; // empties G2
    expect(resolveColumnTree(r.defs).groupById.has('G2')).toBe(false);
  });
  it('preserves the leaf colDef fields (columnGroupShow, width)', () => {
    const defs = [leaf('A', { width: 111, columnGroupShow: 'open' }), grp('G1', [leaf('B')])];
    const r = moveColumnToGroup(defs, 'A', 'G1')!;
    const moved = resolveColumnTree(r.defs).leafById.get('A')!;
    expect(moved.width).toBe(111);
  });
  it('reorder WITHIN the same group is allowed (not a re-parent)', () => {
    const r = moveColumnToGroup(base(), 'C', 'G1', 'B')!; // C before B
    expect(order(r.defs)).toEqual(['A', 'C', 'B', 'D']);
  });
  it('rejects re-parent INTO a marryChildren group', () => {
    const defs = [leaf('A'), grp('G1', [leaf('B')], { marryChildren: true })];
    expect(moveColumnToGroup(defs, 'A', 'G1')).toBeNull();
  });
  it('rejects re-parent OUT of a marryChildren group', () => {
    const defs = [leaf('A'), grp('G1', [leaf('B'), leaf('C')], { marryChildren: true })];
    expect(moveColumnToGroup(defs, 'B', null)).toBeNull();
  });
  it('no-op returns null (unknown col, unknown target, already-there same position)', () => {
    expect(moveColumnToGroup(base(), 'ZZ', 'G1')).toBeNull();
    expect(moveColumnToGroup(base(), 'A', 'NOPE')).toBeNull();
  });
});

describe('moveColumnGroup (pure)', () => {
  it('moves a whole group to top level before a ref', () => {
    // nested: [ A, grp G1[ B, grp G2[ C ] ] ] → move G2 to top before A
    const defs = [leaf('A'), grp('G1', [leaf('B'), grp('G2', [leaf('C')])])];
    const r = moveColumnGroup(defs, 'G2', null, 'A')!;
    expect(order(r.defs)).toEqual(['C', 'A', 'B']);
    expect(resolveColumnTree(r.defs).groupById.get('G2')!.depth).toBe(0);
  });
  it('rejects moving a group into itself or a descendant', () => {
    const defs = [grp('G1', [grp('G2', [leaf('C')])])];
    expect(moveColumnGroup(defs, 'G1', 'G2')).toBeNull();
    expect(moveColumnGroup(defs, 'G1', 'G1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail** — Run: `cd packages/kernel && npx vitest run tests/columnGroupMutation.test.ts` — Expected: FAIL ("moveColumnToGroup is not a function" / module not found).

- [ ] **Step 3: Implement `columnGroupMutation.ts`**

Create `packages/kernel/src/core/columnGroupMutation.ts`. Implement with a deep clone of the defs, a recursive locate-and-remove, marryChildren guards, insert-at-position, recursive empty-group cleanup, then a validity check via `resolveColumnTree` (return `null` if it throws), returning `{ defs, leafOrder }` where `leafOrder = resolveColumnTree(defs).leaves.map(l => l.colId)`.

Structure (write the full module — key logic):
```ts
import type { CColDef, CColGroupDef } from '../types';
import { isColGroupDef, resolveColumnTree } from './columnTree';

export type ColDefsTree = (CColDef | CColGroupDef)[];
export interface MutationResult { defs: ColDefsTree; leafOrder: string[]; }

const clone = <T>(x: T): T => structuredClone(x);
const leafId = (d: CColDef): string => (d.colId ?? d.field) as string;

/** Walk to find a leaf's parent-group marryChildren + parent children array. */
// helpers: findLeaf(defs, colId) → { node, parentChildren, parentGroup|null };
//          findGroup(defs, groupId) → { node, parentChildren, parentGroup|null };
//          removeEmptyGroups(defs) recursively drops CColGroupDef with [] children;
//          isMarried(group) => group.marryChildren === true;
//          insertBefore(arr, node, beforeId?) inserts node before the entry whose
//            leaf/group id === beforeId (else pushes to end).

export function moveColumnToGroup(defsIn: ColDefsTree, colId: string, targetGroupId: string | null, beforeColId?: string): MutationResult | null {
  const defs = clone(defsIn);
  const found = findLeaf(defs, colId);            // null if unknown
  if (!found) return null;
  const target = targetGroupId === null ? { children: defs, group: null } : findGroupChildren(defs, targetGroupId);
  if (targetGroupId !== null && !target) return null; // unknown target
  const sourceGroupId = found.parentGroup?.groupId ?? null;
  const isReparent = sourceGroupId !== targetGroupId;
  if (isReparent && (found.parentGroup?.marryChildren === true || (target!.group?.marryChildren === true))) return null;
  // remove
  const idx = found.parentChildren.indexOf(found.node);
  found.parentChildren.splice(idx, 1);
  // insert
  insertBefore(target!.children, found.node, beforeColId);
  removeEmptyGroups(defs);
  // validate + no-op check
  let leafOrder: string[];
  try { leafOrder = resolveColumnTree(defs).leaves.map(leafId); } catch { return null; }
  if (sameShape(defsIn, defs)) return null; // no change → no-op
  return { defs, leafOrder };
}
// moveColumnGroup: analogous; reject target that is groupId itself or a descendant (walk the moving subtree's groupIds).
```
(`sameShape` = deep-equal on the cloned trees; `findGroupChildren` returns the target group node's `children` + the group node for the marryChildren check.)

- [ ] **Step 4: Run the pure tests, verify they pass** — Run: `cd packages/kernel && npx vitest run tests/columnGroupMutation.test.ts` — Expected: PASS (all).

- [ ] **Step 5: Write a failing integration test — the API preserves runtime column state**

Create `packages/kernel/tests/columnGroupMutationApi.integration.test.ts` (mount a real `CGrid` with the fake worker+canvas harness — copy the `beforeAll` stub block from `tests/rulesApiKernel.integration.test.ts`). Grid with `columnDefs: [ {field:'a'}, {groupId:'G',headerName:'G',children:[{field:'b'},{field:'c'}]} ]`.
```ts
it('moveColumnToGroup re-parents a leaf INTO a group and preserves its runtime width + hidden state', async () => {
  const grid = await mount(); // helper mounting the CGrid + flushing the ready message
  grid.setColumnWidth?.('a', 222);          // or applyColumnState to set width
  grid.setColumnsVisible(['a'], false);     // runtime hide
  grid.moveColumnToGroup('a', 'G');
  const defs = grid.getColumnGroupDefs();
  // 'a' now sits under G:
  const G = defs.find((d: any) => d.groupId === 'G') as any;
  expect(G.children.map((c: any) => c.colId ?? c.field)).toContain('a');
  // runtime state survived the columnDefs rebuild:
  const st = grid.getColumnState().find((s) => s.colId === 'a')!;
  expect(st.hide).toBe(true);
  expect(st.width).toBe(222);
  grid.destroy();
});
it('moveColumnToGroup fires columnDefsChanged; an invalid move fires nothing', async () => {
  const grid = await mount();
  const evs: string[] = [];
  grid.addEventListener('columnDefsChanged', () => evs.push('c'));
  grid.moveColumnToGroup('a', 'NOPE');   // invalid → no-op
  expect(evs).toEqual([]);
  grid.moveColumnToGroup('a', 'G');       // valid
  expect(evs.length).toBeGreaterThan(0);
  grid.destroy();
});
```

- [ ] **Step 6: Run it, verify it fails** — Run: `cd packages/kernel && npx vitest run tests/columnGroupMutationApi.integration.test.ts` — Expected: FAIL (`grid.moveColumnToGroup is not a function`).

- [ ] **Step 7: Implement the `CGridApi` methods with state preservation**

In `cgrid.ts`: add a private `applyColumnDefsPreservingState(defs, leafOrder)`:
```ts
private applyColumnDefsPreservingState(defs: (CColDef<TRow>|CColGroupDef<TRow>)[], leafOrder: string[]): void {
  const prevState = this.getColumnState();                 // capture width/hide/pinned/etc.
  this.updateGridOptions({ columnDefs: rebuildColumnDefsByLeafOrder(defs, leafOrder) });
  this.applyColumnState({ state: prevState });             // re-apply runtime state (NOT applyOrder — order came from the tree)
}
```
Then the two methods (mirror the `moveColumns` style at cgrid.ts:8842):
```ts
moveColumnToGroup(colId: string, targetGroupId: string | null, beforeColId?: string): void {
  const res = moveColumnToGroup(this.getColumnGroupDefs(), colId, targetGroupId, beforeColId);
  if (!res) return;
  this.applyColumnDefsPreservingState(res.defs, res.leafOrder);
}
moveColumnGroup(groupId: string, targetParentGroupId: string | null, beforeId?: string): void {
  const res = moveColumnGroup(this.getColumnGroupDefs(), groupId, targetParentGroupId, beforeId);
  if (!res) return;
  this.applyColumnDefsPreservingState(res.defs, res.leafOrder);
}
```
Add both to `makeApi` (near the `moveColumns` entry ~cgrid.ts:6320). Add the two signatures to `types/api.ts` (after `moveColumns`, with JSDoc from spec §5.1). Import `moveColumnToGroup`/`moveColumnGroup` from `./core/columnGroupMutation`. **During execution, verify `applyColumnState`'s exact param shape against `cgrid.ts` — if `updateGridOptions({columnDefs})` already preserves runtime state (check the columnDefsMap merge at cgrid.ts:1054-1082), the re-apply may be a no-op or need `applyOrder:false`; the integration test in Step 5 is the gate.**

- [ ] **Step 8: Run both test files + full kernel suite, verify green**

Run: `cd packages/kernel && npx vitest run tests/columnGroupMutation.test.ts tests/columnGroupMutationApi.integration.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — Expected: PASS; suite green.

- [ ] **Step 9: Commit**

```bash
git add packages/kernel/src/core/columnGroupMutation.ts packages/kernel/tests/columnGroupMutation.test.ts packages/kernel/tests/columnGroupMutationApi.integration.test.ts packages/kernel/src/cgrid.ts packages/kernel/src/types/api.ts
git commit -m "feat(kernel): group-membership mutation core + moveColumnToGroup/moveColumnGroup (T1)"
```

---

### Task 2: Hierarchical rendering in `visibilityPanel`

**Files:**
- Modify: `packages/kernel/src/interaction/toolPanels/columns/visibilityPanel.ts`
- Modify: `packages/kernel/src/interaction/toolPanels/columns/shared.ts` (add tri-state helper if useful) — optional
- Modify: the columns-panel CSS (find via `grep -rn "cg-columns-panel-row" packages/kernel/src` → the `.css`/`theming` file) — add `--group`, `--indent`, caret, indeterminate styles
- Create: `packages/kernel/tests/columnsPanelHierarchy.integration.test.ts`

**Interfaces:**
- Consumes: `api.getColumnGroupDefs()`, `api.getColumnState()`, `api.setColumnsVisible(ids, on)`, `isColGroupDef`.
- Produces (internal): a recursive `buildTreeRows(nodes, depth)` replacing `buildRows()`; a `PanelRow` union gaining a `kind: 'group'|'leaf'`, `groupId?`, `depth`, and (groups) `descendantLeafIds`.

- [ ] **Step 1: Write a failing integration test for hierarchical rendering + tri-state**

Create `packages/kernel/tests/columnsPanelHierarchy.integration.test.ts` (real CGrid + sideBar `{ toolPanels: ['columns'] }`; open the panel; query its DOM). Assert:
```ts
it('renders group rows with indented children', async () => {
  const grid = await mountWithPanel([{field:'a'},{groupId:'G',headerName:'Grp',children:[{field:'b'},{field:'c'}]}]);
  const panel = document.querySelector('.cg-columns-panel')!;
  const groupRow = panel.querySelector('[data-group-id="G"]')!;
  expect(groupRow).toBeTruthy();
  expect(groupRow.querySelector('.cg-columns-panel-row-caret')).toBeTruthy();
  const b = panel.querySelector('[data-col-id="b"]') as HTMLElement;
  // child indented deeper than the top-level 'a'
  const a = panel.querySelector('[data-col-id="a"]') as HTMLElement;
  expect(parseInt(b.style.getPropertyValue('--cg-indent') || '0')).toBeGreaterThan(parseInt(a.style.getPropertyValue('--cg-indent') || '0'));
  grid.destroy();
});
it('group checkbox is tri-state and toggles all descendants', async () => {
  const grid = await mountWithPanel([{groupId:'G',headerName:'Grp',children:[{field:'b'},{field:'c'}]}]);
  const cb = document.querySelector('[data-group-id="G"] input[type=checkbox]') as HTMLInputElement;
  expect(cb.checked).toBe(true);
  grid.setColumnsVisible(['b'], false);           // mixed → indeterminate
  // (panel refresh happens on the event; flush a tick)
  await Promise.resolve();
  expect(cb.indeterminate).toBe(true);
  cb.click();                                      // toggles all off (or on) 
  await Promise.resolve();
  expect(grid.getColumnState().filter(s=>['b','c'].includes(s.colId)).every(s=>s.hide===cb.checked?false:true)).toBe(true);
  grid.destroy();
});
```
(Write `mountWithPanel` in the test — mount CGrid, dispatch ready, click the `columns` side button, return grid. Mirror `apps/colgroups` DOM structure expectations to `.cg-columns-panel`.)

- [ ] **Step 2: Run it, verify it fails** — Run: `cd packages/kernel && npx vitest run tests/columnsPanelHierarchy.integration.test.ts` — Expected: FAIL (no `[data-group-id]` rows; flat list only).

- [ ] **Step 3: Replace `buildRows()` with a recursive tree walk**

In `visibilityPanel.ts`:
1. Widen `PanelRow`: `{ el; kind:'leaf'; checkbox; label } | { el; kind:'group'; groupId; caret; checkbox; label; descendantLeafIds: string[] }`. Keep `this.rows: Map<string, PanelRow>` keyed by colId for leaves and `groupId` for groups (namespace groups as `grp:${groupId}` to avoid colId collisions).
2. Add `private collapsed = new Set<string>()` (panel-local expand state; empty = all expanded).
3. Replace `buildRows()`:
   ```ts
   private buildRows(): void {
     const defs = this.deps.api.getColumnGroupDefs();
     this.walkDefs(defs, 0);
   }
   private walkDefs(nodes: (CColDef|CColGroupDef)[], depth: number): void {
     for (const node of nodes) {
       if (isColGroupDef(node)) {
         const row = this.buildGroupRow(node, depth);
         this.rows.set(`grp:${node.groupId ?? row.groupId}`, row);
         this.listEl.appendChild(row.el);
         const hidden = this.collapsed.has(row.groupId);
         // children rendered but hidden when collapsed
         this.walkDefsChildren(node.children, depth + 1, hidden);
       } else {
         const entry = this.stateFor(node);          // CColumnState for this leaf
         const row = this.buildRow(entry, depth);
         this.rows.set(entry.colId, row);
         this.listEl.appendChild(row.el);
       }
     }
   }
   ```
   (Compute `descendantLeafIds` from `resolveColumnTree` OR a local recursive collect over `node.children`.)
4. `buildGroupRow(node, depth)`: DOM `caret` (▸/▾) + tri-state checkbox + drag handle + label; `el.dataset.groupId = groupId`; `el.style.setProperty('--cg-indent', String(depth))`. Caret click toggles `this.collapsed` + re-renders (or toggles child rows' `display`). Checkbox click → `setColumnsVisible(descendantLeafIds, checked)`.
5. `buildRow(entry, depth)`: add `el.style.setProperty('--cg-indent', String(depth))` to the existing leaf builder; everything else unchanged.
6. Add `computeGroupChecked(descendantLeafIds)`: read `getColumnState()`; return `'all' | 'none' | 'mixed'`; set `checkbox.checked`/`checkbox.indeterminate` accordingly.
7. Subscribe to `columnDefsChanged` → full rebuild (`this.listEl.replaceChildren()`, `this.rows.clear()`, `buildRows()`), plus keep the existing `columnRowGroupChanged`/visibility refresh. Extend `refreshRowChecks()`/`syncRows` to also update group tri-state.
8. `applySearchFilter`: a group row shows if any descendant leaf matches; when searching, force-expand.

- [ ] **Step 4: Add CSS** — in the columns-panel stylesheet add: `.cg-columns-panel-row { padding-left: calc(8px + var(--cg-indent, 0) * 16px); }`, `.cg-columns-panel-row-caret` (rotates ▸→▾), and indeterminate checkbox styling. Match `apps/colgroups` visual (indent unit ~16px, caret before checkbox).

- [ ] **Step 5: Run the test + suite, verify green** — Run: `cd packages/kernel && npx vitest run tests/columnsPanelHierarchy.integration.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — Expected: PASS; suite green (existing flat-panel tests updated if any assert flat structure — grep `columnsPanel`/`visibilityPanel` tests and fix expectations).

- [ ] **Step 6: Commit**
```bash
git add packages/kernel/src/interaction/toolPanels/columns/visibilityPanel.ts packages/kernel/tests/columnsPanelHierarchy.integration.test.ts <css file>
git commit -m "feat(kernel): hierarchical columns tool panel — group rows, carets, tri-state (T2)"
```

---

### Task 3: Group-aware drag (reorder + re-parent) + drop indicators

**Files:**
- Modify: `packages/kernel/src/interaction/toolPanels/columns/visibilityPanel.ts` (the `beginRowDrag` orchestrator — step 4 in-panel reorder becomes group-aware; add group-row drag)
- Modify: columns-panel CSS (insertion line + target-group highlight classes)
- Create: `packages/kernel/tests/columnsPanelDrag.integration.test.ts`

**Interfaces:**
- Consumes: T1 `api.moveColumnToGroup(colId, targetGroupId, beforeColId?)`, `api.moveColumnGroup(groupId, targetParentGroupId, beforeId?)`; T2's rendered rows carrying `data-group-id`/`data-col-id`/`--cg-indent`.
- Produces: a `resolveDrop(clientY) → { kind:'col'|'group', movingId, targetGroupId: string|null, beforeId?: string }` computing target group + insertion from pointer + row geometry.

- [ ] **Step 1: Write a failing integration test — a drop re-parents via the T1 API**

Create `packages/kernel/tests/columnsPanelDrag.integration.test.ts`. Since real mouse drag is hard in jsdom, test the **drop-resolution + commit** seam: expose (or test via a small internal) `resolveDrop`, then assert it calls `moveColumnToGroup`. Prefer wiring the orchestrator so the drop commit is a single method `commitDrop(resolved)` you can call:
```ts
it('dropping a top-level column onto a group re-parents it via moveColumnToGroup', async () => {
  const grid = await mountWithPanel([{field:'a'},{groupId:'G',headerName:'Grp',children:[{field:'b'}]}]);
  const spy = vi.spyOn(grid, 'moveColumnToGroup');
  const panel = getPanelInstance(grid);        // test hook OR simulate mousedown+move+up over the group row
  panel.commitDrop({ kind:'col', movingId:'a', targetGroupId:'G', beforeId: undefined });
  expect(spy).toHaveBeenCalledWith('a', 'G', undefined);
  grid.destroy();
});
it('dropping a grouped column into the top-level gap moves it out', async () => { /* targetGroupId: null */ });
it('dragging a group row moves the whole group via moveColumnGroup', async () => { /* kind:'group' → moveColumnGroup */ });
```
(If no test hook exists, add a minimal `__columnsPanelForTests` accessor on the panel or drive via synthetic `MouseEvent`s on the handle → move over `[data-group-id]` → mouseup, asserting the spy.)

- [ ] **Step 2: Run it, verify it fails** — Expected: FAIL (`commitDrop`/group-aware drop not implemented; spy not called or called with `moveColumns`).

- [ ] **Step 3: Make the drag group-aware**

In `beginRowDrag`:
1. Allow starting a drag on a **group** row's handle (`beginRowDrag(e, id, kind)`); the ghost shows the group label + `(n)` child count.
2. Replace step-4 "optimistic list reorder" with `resolveDrop(clientY)`:
   - Find the row under Y (`document.elementFromPoint` or geometry over `listEl.children`).
   - If it's a **group row** body (upper half) → drop INTO that group at start; lower half or between its children → into the group before the next child.
   - If it's a **leaf row** → reorder before/after it within that leaf's parent group (targetGroupId = that leaf's parent, or null at top level).
   - Top-level gap (below all, or a top-level leaf) → targetGroupId `null`.
   - Return `{ kind, movingId, targetGroupId, beforeId }`.
3. Render indicators during move: an insertion line element between rows + a `.cg-columns-panel-row--drop-target` highlight on the target group row. Reuse the ghost + `setZoneDropState` vocabulary.
4. On mouseup (`commitDrop`): `kind==='group' ? api.moveColumnGroup(movingId, targetGroupId, beforeId) : api.moveColumnToGroup(movingId, targetGroupId, beforeId)`. Then the `columnDefsChanged` subscription (T2) rebuilds the panel.
5. **Preserve** the external routes (steps 1–3 of the orchestrator: row-group/pivot header strips, column-header band, in-panel zones) unchanged — only step 4 changes.
6. marryChildren: `moveColumnToGroup` already rejects invalid re-parents (no-op); optionally reflect a `reject` cursor when hovering an invalid target (compute from the target group's `marryChildren`).

- [ ] **Step 4: Add CSS** — `.cg-columns-panel-drop-line` (2px accent line) + `.cg-columns-panel-row--drop-target` (group highlight). Match `apps/colgroups`.

- [ ] **Step 5: Run tests + suite, verify green** — Run: `cd packages/kernel && npx vitest run tests/columnsPanelDrag.integration.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — Expected: PASS; suite green (existing drag/reorder tests updated to the group-aware path).

- [ ] **Step 6: Commit**
```bash
git add packages/kernel/src/interaction/toolPanels/columns/visibilityPanel.ts packages/kernel/tests/columnsPanelDrag.integration.test.ts <css file>
git commit -m "feat(kernel): group-aware columns-panel drag — reorder + re-parent + indicators (T3)"
```

---

### Task 4: Demo + browser-verify + E2E + closeout review + merge

**Files:**
- Modify: `apps/cgrid-customizer-demo/*` only if needed (the `columns` tool panel is already in its `sideBar.toolPanels`, and the demo already seeds nested groups — Trade/Valuation/Risk — so the hierarchy shows with no code change). Add a runtime "create a group" affordance only if the existing Column Groups tab doesn't already exercise it.
- Create: `apps/cgrid-customizer-demo/e2e/columnsPanelHierarchy.spec.ts`

- [ ] **Step 1: Browser-verify against the reference.** Run the demo (`CGRID_DEMO_PORT=5187 npm run dev` in `apps/cgrid-customizer-demo`; rebuild kernel first — the demo consumes `@cgrid/kernel` dist). Open the Columns tool panel; confirm light + dark: nested groups render hierarchically with carets + tri-state group checkboxes + indentation, matching `apps/colgroups` (run it on :5175 side by side). Drag a column into a group → grid header reflects it; drag it out; move a group. **Reset saved state first; kill the automation browser + dev server(s) when done.**

- [ ] **Step 2: Write E2E** `apps/cgrid-customizer-demo/e2e/columnsPanelHierarchy.spec.ts` (mirror `e2e/columnGroups.spec.ts` harness — `waitForGridReady`, `__cgapi`): open the columns panel; assert a group row + indented children exist; toggle a group checkbox → descendants hide (assert via `__cgapi.getColumnState()`); simulate a drag of a column onto a group → `getColumnGroupDefs()` shows it re-parented; drag out → back to top level. Reset persisted state per test.

- [ ] **Step 3: Run E2E** — Run: `cd apps/cgrid-customizer-demo && npx playwright test e2e/columnsPanelHierarchy.spec.ts` (+ full suite to catch regressions). Expected: all green. Kill the spawned server after.

- [ ] **Step 4: SINGLE closeout review (fable) over T1–T4** + one fix wave. Dispatch a reviewer over `git diff main..HEAD -- packages apps`, focus: the mutation core edge cases (marryChildren, empty-group cleanup, order/state preservation), the render refresh correctness (no stale rows / leaked listeners on `columnDefsChanged` rebuild), the drag drop-resolution (correct target group + insertion, external routes intact), a11y (caret/checkbox roles). Apply the fix wave; re-run all gates.

- [ ] **Step 5: Verify + merge.** Kernel typecheck + build + full suite green; demo typecheck + E2E green. Then per the user's standing preference: sync `main` ff-only, local squash-merge (Phase-B style) if the tree is clean else a PR; push; delete the branch.

---

## Self-review notes (author)

- **Spec coverage:** §5.1 mutation core → T1; §5.2 render (carets/tri-state/indent/panel-expand/`columnDefsChanged` refresh) → T2; §5.3 drag + indicators + external routes → T3; §7 testing → per-task tests; §9 delivery → T1–T4; §8 marryChildren/order-contiguity/perf-on-drop → T1 tests + notes; §10 out-of-scope (no group creation from panel; top-level=null) → T1 Step 3 (`targetGroupId:null`, no minted groupId).
- **Open exec-time confirmations (flagged inline, gated by tests):** T1 Step 7 — exact `applyColumnState` param shape + whether `updateGridOptions({columnDefs})` already preserves runtime state (Step-5 test is the gate). T3 Step 1 — test seam for drag (add a `commitDrop`/test hook if synthetic mouse events are impractical in jsdom).
- **Type consistency:** `moveColumnToGroup(colId, targetGroupId, beforeColId?)` / `moveColumnGroup(groupId, targetParentGroupId, beforeId?)` identical names/params across T1 (pure + API), T3 (drag calls), T4 (E2E). `MutationResult { defs, leafOrder }` consumed only inside cgrid's apply. `--cg-indent` CSS var consistent T2/T3.
