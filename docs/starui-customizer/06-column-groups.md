# 06 — column-groups

> Compose flat columns into nested named groups with expand/collapse memory and per-child visibility rules.

## Purpose

Take the developer's flat `columnDefs` and let users author header hierarchies on top. Example: 6 OHLC columns become a "Price" group with 4 children, while volume columns stay flat. Groups can nest arbitrarily deep, and individual children can be marked `show: 'open' | 'closed' | 'always'` to toggle visibility with group state.

## Config schema

```ts
interface ColumnGroupsState {
  groups: ColumnGroupNode[];            // top-level (nesting via children)
  openGroupIds: { [groupId: string]: boolean };  // runtime expand/collapse overrides
}

interface ColumnGroupNode {
  groupId: string;                      // stable across re-renders; required by grid for state
  headerName: string;
  children: ColumnGroupChild[];
  openByDefault?: boolean;              // initial state (overridden by openGroupIds at runtime)
  marryChildren?: boolean;              // prevent drag-out
  headerStyle?: GroupHeaderStyle;       // typography, colors, borders (single theme, not themed)
}

type ColumnGroupChild =
  | { kind: 'col'; colId: string; show?: 'always' | 'open' | 'closed' }
  | { kind: 'group'; group: ColumnGroupNode };
```

## Runtime behavior

### Tree composition

`composeGroups(baseColDefs, state)` produces the grid-ready def tree:

1. Flatten base defs into a `Map<colId, ColDef>` for O(1) lookup
2. Walk authored groups recursively; for each leaf child, pull from the map
3. Insert groups at their first-leaf's position in base order — keeps ungrouped columns anchored, prevents the grid's diff algorithm from splitting groups apart on re-render
4. Columns mentioned in ANY group are removed from the ungrouped output
5. Within a group, children are materialized in **author-declared** order, not base order

### Open/collapse memory

`openGroupIds[groupId]` overrides static `openByDefault` when present. On the grid's `columnGroupOpened` event, update `openGroupIds` and persist.

### Empty-group safety

If all of a group's children are hidden/deleted, drop the group silently. Avoids grid warnings and renders cleanly.

### Column deduplication

First occurrence wins. If a colId appears in two groups (user error in profile), it goes in the first one and is skipped in the second. Logs a warning.

### CSS injection

Per-group header styles emitted as `.ds-hdr-grp-{groupId}` rules when style object has any defined facet. Single-theme (not dark/light split) — groups are usually static decoration.

## Tree operations (`treeOps.ts`)

Immutable operations for the editor UI:

```ts
flattenGroups(groups): { node, path: number[] }[]            // DFS for list rail
findGroupByPath(groups, path): ColumnGroupNode | null
updateGroupAtPath(groups, path, fn): ColumnGroupNode[]
moveGroupAtPath(groups, fromPath, toPath): ColumnGroupNode[]
deleteGroupAtPath(groups, path): ColumnGroupNode[]
```

Paths are depth-addressed index trails that skip non-group siblings, so the flat list rail's DFS iteration and editor lookups share the same coordinate system.

## UI surface

None in engine. Host renders:
- Group editor: drag-drop builder with collapsible group nodes
- Chip picker for ungrouped columns (drop into a group)
- List rail using `flattenGroups()`
- Header styling panel per group (typography, colors, borders)

## Persistence

```ts
{
  groups: ColumnGroupNode[],
  openGroupIds: { [groupId]: boolean }
}
```

Pruning logic strips stale `openGroupIds` entries when a group is deleted.

## Dependencies

Borrows `cssEscapeColId()` from [column-customization](05-column-customization.md) for groupId encoding (defense-in-depth for snapshots from older paths).

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/column-groups/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-groups/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-groups/composeGroups.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-groups/composeGroups.ts)
- [../starui/packages/shared/engine/src/customizer/modules/column-groups/treeOps.ts](../../../starui/packages/shared/engine/src/customizer/modules/column-groups/treeOps.ts)

## Design decisions worth copying

- **First-leaf positioning.** Groups inserted where their first child appears in base order, not at the end. Keeps ungrouped columns anchored. Prevents the grid's re-diff from splitting groups when ungrouped columns appear between grouped ones.
- **Path-based addressing.** Tree mutations addressed by index trails that match DFS iteration. Editor UI and engine share one coordinate system.
- **GroupId stability.** Required by AG-Grid v35 for expand/collapse state preservation across `columnDefs` updates. Same will apply to cgrid — generate stable IDs (UUID or content hash), never derive from index.
- **Degenerate-tree tolerance.** Unknown groupIds skipped; missing colIds skipped; empty groups dropped. Profile from an older schema never crashes the current build.
- **Single-theme header style.** Pragmatic call — groups are static decoration, per-column overrides handle theme variance.

## cgrid translation

cgrid already supports nested column groups in `columnTree`. Mapping:

| Concern | cgrid surface |
|---|---|
| Group node | `ColumnGroup` in `columnTree` |
| Header rendering | `subgrids[]` group-header layer |
| Expand/collapse state | `columnGroupState` (already tracked) |
| `columnGroupOpened` event | header click handler |
| Group header style | Group header painter — needs hook for per-group style overrides |

What's already there: cgrid composes nested headers, tracks group-open state, supports drag/resize within groups. What needs adding:
- **Stable groupId field.** Verify cgrid uses content-stable IDs (not array indices) for group state preservation.
- **Per-group style override hook.** The group header painter currently uses theme defaults; needs a "lookup style by groupId" extension point.
- **`marryChildren` enforcement.** If cgrid doesn't already prevent dragging children out of marry-children groups, add the guard in the column drag feature.
