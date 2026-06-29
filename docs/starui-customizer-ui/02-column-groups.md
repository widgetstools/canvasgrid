# 02 — Column Groups

> Compose flat columns into hierarchical named groups with per-group header styling, visibility cycling, and tree operations.

Engine module: [column-groups](../starui-customizer/06-column-groups.md)

## Purpose

Author column hierarchies on top of developer-authored columns. Drag/select columns into groups, nest groups (up to 3 levels deep), style group headers, control per-child visibility (always / open / closed).

## Invocation

Settings Sheet → Columns → Column Groups.

## Layout

```
┌────────────────────────┬──────────────────────────────────────────┐
│ GROUPS: 04 [+]         │ [Group name input] [↑][↓] [Reset][Save] │
│────────────────────────│──────────────────────────────────────────│
│   Root Group           │ Sticky meta strip:                       │
│ ✓ ├─ Subgroup 1 (LED)  │ [ON/OFF chip] [MARRY] [DEPTH] [CHILDREN] │
│   ├─ Subgroup 2        │──────────────────────────────────────────│
│   └─ Another nested    │ Toggles: openByDefault, marryChildren    │
│   Standalone Group     │ 01 COLUMNS                              │
│                        │   [chip: col1 ▽] [chip: col2 🔒]        │
│                        │   [chip: col3 👁] [+COLUMN][+SUBGROUP]   │
│                        │ (each chip: name + show-mode icon + [×]) │
│                        │ STYLE                                    │
│                        │   <StyleEditor: text, color, border>    │
└────────────────────────┴──────────────────────────────────────────┘
```

Flat list of groups (indented by depth via left padding). Single-theme header style only — not dark/light split.

## Component tree

- **ColumnGroupsList** (left rail; exports `ListPane`)
  - Header with count + `[+]` add button
  - CockpitList showing flat-traversal (DFS) of group tree
  - Per-row: name + depth indent + trash icon (hover reveal)
- **ColumnGroupsEditor** (right pane; exports `EditorPane`)
  - **GroupEditor** (memoized per groupId)
    - ObjectTitleRow (group name input + ↑/↓ move siblings + Save/Reset)
    - Sticky meta bar (openByDefault chip, marryChildren chip, depth, child counts)
    - Toggles: openByDefault, marryChildren
    - Band 01 COLUMNS:
      - Chip list of assigned children (col + subgroup chips)
      - Each col chip: name + show-mode cycle icon + [×] remove
      - `[+COLUMN…]` select dropdown (unassigned eligible columns)
      - `[+SUBGROUP]` button (disabled at depth ≥ 2)
    - StyleEditor (header styling only: text + color + border, no format section)

## Props

- `ListPane`: `{ selectedId: string | null; onSelect: (id) => void }`
- `EditorPane`: `{ selectedId: string | null }`

## Internal state

- Selected groupId
- Draft group node (headerName, headerStyle, children, openByDefault, marryChildren)
- Unassigned column IDs (computed from tree traversal)
- Tree path to selected group (for structural ops)

## Interaction flows

**Add group:**
```
[+] → generate groupId → create { groupId, headerName: 'New Group', children: [],
  openByDefault: true } → select → focus name input
```

**Move group up/down:**
```
↑/↓ on selected group → moveGroupAtPath() swaps with sibling → tree persists immediately (no draft)
```

**Add child column:**
```
select from [+COLUMN…] → appends { kind: 'col', colId } to children → auto-saves to tree
```

**Cycle column visibility:**
```
click eye/lock/eye-off icon on column chip →
  cycles always (eye) → open-only (eye-off) → closed-only (lock) → repeat
```

**Add subgroup (nesting):**
```
[+SUBGROUP] (disabled at depth 2) → generate groupId → nested node →
  appends { kind: 'group', group: newNode } to current group's children
```

**Delete group:**
```
trash → deleteGroupAtPath() → auto-select next sibling (or previous if last)
```

## Engine wiring

- **Reads**: `column-groups.groups` (nested tree), `column-groups.openGroupIds` (runtime state)
- **Tree ops**: `flattenGroups`, `findGroupByPath`, `updateGroupAtPath`, `moveGroupAtPath`, `deleteGroupAtPath`
- **Helper**: `collectAssignedColIds` computes the unassigned set (all colIds - assigned colIds)
- **Note**: structural mutations (add/move/delete) apply directly to state; the draft only covers field-level edits on the selected node (name, style, flags)

## Shared primitives used

- CockpitList, Band, ObjectTitleRow, SummaryChip
- StyleEditor (header styling: text + color + border sections only)
- NativeOptionsSelect (column picker)
- ChromeButton, GhostIconButton

## Design decisions worth copying

1. **Tree mutations apply directly, field edits via draft.** Structural ops (move, add, delete) bypass the draft for clarity — moving a group should commit immediately, not require a Save. Field edits (name, style) go through the draft for Save/Reset semantics.

2. **Three-state visibility cycle on column chips.** Eye → eye-off → lock → repeat. Single tap to cycle. Icon and color change per state (positive for open, warning for closed, muted for always).

3. **Chip-per-column design.** Each assigned column is a chip with show-mode toggle + remove inline. No separate modal; everything in-place.

4. **Unassigned set pre-computed.** Feeds the `[+COLUMN…]` dropdown so users don't see columns that are already in groups.

5. **Hard depth cap (3 levels).** `[+SUBGROUP]` disabled with tooltip at depth 2. AG-Grid handles deeper nesting poorly; design constraint encourages flatter hierarchies.

6. **Single-theme header style.** Groups are typically static decoration. Skip the dark/light dual slot to simplify the editor.

## cgrid translation

cgrid already supports nested groups via `columnTree`. The editor maps cleanly:

- **Tree ops as Lit reactive functions.** Pure helpers (flatten, findByPath, etc.) work identically — port directly.
- **Show-mode cycle button.** Custom element `<cgrid-show-mode-toggle>` with an attribute that cycles on click. CSS picks the right icon per state.
- **`<cgrid-chip>`** — generic chip with optional trailing button slot. Used here for columns and elsewhere.
- **StyleEditor** — sections prop limits to `['text', 'color', 'border']`. Built once in Phase 3, reused here.
- **`[+SUBGROUP]` enforcement.** Add a `disabled` attribute computed from `depth >= 2`. Tooltip via `<wa-tooltip>`.

Build after column-customization is working (depends on the same StyleEditor + CockpitList primitives).
