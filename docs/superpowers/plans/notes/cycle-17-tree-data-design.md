# Cycle 17 — Tree data — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 17
**FM coverage:** Area 14 — ~16 of 18 rows
**Depends on:** Cycle 15 (auto-group column + expand/collapse + group cell renderer all REUSED — tree data is just group rows fed from a different bucketing pass)

---

## Mental model: tree IS grouping with a different bucketing pass

Cycle 15 shipped `GroupPass` that buckets leaves by `rowGroupCols`.
Cycle 17 ships `TreePass` that buckets leaves by `getDataPath(row)`.
The OUTPUT of both passes is identical: a tree of `GroupNode { key,
value, depth, childCount, childIndices, childGroups }`. Every
downstream system — viewport slicer, chunk format, auto-group column,
`'group'` cell renderer, expand/collapse, tri-state selection,
group-aware sort — is UNCHANGED.

**The architectural bet:** tree-data ≠ a new feature surface. It is
a second producer of `GroupPassOutput`. By reusing the data shape,
Cycle 15's hardened code path (viewport slicer, chevron painter,
keyboard nav, ARIA) carries forward unchanged.

```
┌─ rowData ─────┐    ┌─ GroupPass ───┐
│ flat rows     │ ─→ │ bucket by cols │ ─┐
└───────────────┘    └────────────────┘  │
                                          ├→ GroupPassOutput
┌─ rowData ─────┐    ┌─ TreePass ────┐    │     (one shape)
│ rows w/ paths │ ─→ │ bucket by path │ ─┘
└───────────────┘    └────────────────┘
```

---

## Task 1 — `getDataPath` callback + `TreePass`

**Goal:** New worker pipeline stage replacing `GroupPass` when
`treeData: true`. Reads `getDataPath(row): string[]` for every row;
each row's path is its position in the tree (e.g.
`['Engineering', 'Frontend', 'Alice']`).

**Algorithm (one pass over leaves):**

```typescript
function treePass(rows: TRow[], getDataPath: (r: TRow) => string[]): GroupPassOutput {
  const root = makeNode([], 0);
  for (let i = 0; i < rows.length; i++) {
    const path = getDataPath(rows[i]);
    let node = root;
    for (let d = 0; d < path.length; d++) {
      node = node.childGroups[path[d]] ?? createChild(node, path[d], d + 1);
    }
    node.childIndices.push(i); // leaf is the row itself
  }
  return flatten(root);
}
```

**Key difference from `GroupPass`:** in grouping, a `GroupNode` at
the deepest level contains data-row indices (the leaves of the
TREE are DATA ROWS). In tree-data, the same node may have BOTH a
data row of its own (the path's terminal row, if any) AND
descendant nodes — a "filler" path that has no terminal row
synthesizes an empty leaf cell.

**Worker file:** `worker/passes/treePass.ts` (new). Pipeline order
in `worker/dataPipeline.ts`: `FilterPass → TreePass (if treeData) ⊕
GroupPass (else) → SortPass → AggPass`.

---

## Task 2 — Tree auto-group column reuse

**Goal:** No new column type — the SAME auto-group column synthesized
by Cycle 15 (`'ag-Grid-AutoColumn'`) renders tree rows. The cell
renderer reads `groupDepth` from the chunk and paints the same
chevron + indent + group value.

**Subtle difference:** `(count)` suffix semantics differ between
grouping (count of DESCENDANT LEAVES) and tree (count of IMMEDIATE
CHILDREN). The renderer reads a new chunk field `groupChildSemantics:
'leaves' | 'children'` (one byte per pass, identical for the whole
chunk) and picks the count source accordingly. Tokens
(`--cg-group-count-color`) and styling are IDENTICAL — only the
NUMBER changes.

---

## Task 3 — Tree expand/collapse + `isGroupOpenByDefault`

**Goal:** Same expand/collapse API as Cycle 15
(`setRowGroupExpanded(rowId, expanded)`, `expandAll()`,
`collapseAll()`). Tree-specific addition:
`isGroupOpenByDefault(params): boolean` — callback invoked at
TreePass time per-node; lets apps pre-expand specific subtrees
(e.g., "auto-expand any node whose path includes the user's
current desk").

**Worker integration:** `TreePass` consults
`isGroupOpenByDefault(node)` while flattening — equivalent to
`expandedKeys.add(node.key)` before viewport slicer runs.

---

## Task 4 — Tree filter

**Goal:** When the user types in a quick filter or sets a column
filter, the tree shows **ancestors** of matching leaves so the
match isn't visually orphaned.

**Two modes (parity with ag-grid):**

| Mode | Behaviour |
|---|---|
| Default (`excludeChildrenWhenTreeDataFiltering: false`) | Filter matches a leaf → ALL ancestors of that leaf stay visible; siblings stay visible if THEY match or have matching descendants. |
| Exclude children (`excludeChildrenWhenTreeDataFiltering: true`) | Filter matches a leaf → only the leaf and its ancestors stay; sibling subtrees vanish even if matching. |

**Worker integration:** `FilterPass` runs FIRST (over flat rows);
its output is a `Set<number>` of surviving row indices. `TreePass`
then walks paths and emits only nodes whose subtree contains a
surviving leaf. The ancestor-visibility set is computed in one
upward walk from each surviving leaf.

---

## Task 5 — Tree sort

**Goal:** Sort sorts within siblings; tree structure is preserved.
Sorting by a column → siblings at every depth reorder according to
the column's comparator; ancestors and descendants stay
structurally intact.

**Worker integration:** `SortPass` is replaced with `TreeSortPass`
when `treeData: true`. It walks the tree top-down and sorts each
node's `childGroups` AND `childIndices` (data leaves) by the active
sort comparator.

**Multi-sort:** Identical to Cycle 8 — Shift+click appends; sort
order indicator on header.

---

## Task 6 — Tree data event

`rowGroupOpened` event is REUSED with `{ rowId, expanded, source,
treeNode: true }`. Tree data does NOT introduce
`rowTreeOpened` — one event for all hierarchy expand/collapse so
app handlers stay simple.

---

## Visual chrome: tree shares grouping's tokens

NO new tokens. Tree rows render with:

| Token | Source | Why |
|---|---|---|
| `--cg-group-chevron-color` | Cycle 15 | Same chevron color across grouping + tree |
| `--cg-group-count-color` | Cycle 15 | Same `(N)` suffix color |
| `--cg-group-indent` | Cycle 15 | Same per-level indent |

The bet: when the user enables `treeData: true` over previously
grouped data, the visual continuity reads as "I switched the data
shape, not the grid's vocabulary."

---

## Mutual exclusivity

`treeData: true` is incompatible with `rowGroupCols.length > 0`.
Setting `rowGroupCols` while `treeData: true` THROWS in dev (TS),
warns in prod. The grid options resolver enforces this in
`propertyChain.ts`.

---

## Performance gates

- 100k-node tree (10-deep, branching factor 4) — initial build
  ≤ 250 ms.
- Expanding a single node ≤ 16 ms (one frame).
- Tree filter over 100k nodes ≤ 100 ms.
- Tree sort over 100k nodes ≤ 100 ms.

---

## Exit criteria recap

- FM Area 14 = 100 % ✅.
- Demo: `apps/cgrid-positions` adds a tree-data tab showing
  trades grouped by `[region/desk/trader]` path.
- Tree expand/collapse keyboard nav works (ArrowRight/Left,
  Enter/Space) inherited from Cycle 15.
- Tree filter with both `excludeChildrenWhenTreeDataFiltering`
  modes E2E-tested.
