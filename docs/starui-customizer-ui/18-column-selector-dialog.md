# 18 — Column Selector Dialog

> Modal dialog for column visibility + reorder. Two-pane Available / Visible with drag-to-reorder in the Visible pane.

Engine module: [column-customization](../starui-customizer/05-column-customization.md) (visibility specifically); reads/writes grid directly.

## Purpose

Modal dialog for bidirectional column visibility management. Move columns between Available (hidden) and Visible (shown) lists. Drag-reorder within the Visible pane. Search both lists independently. Apply on confirm.

## Invocation

User clicks a "Select Columns" or column-gear button on the grid toolbar. The dialog is managed by the host and receives `open`, `onOpenChange`, and `api` props.

## Layout

```
┌─ Dialog Chrome ───────────────────────────────────────┐
│ Select columns                                        │
│ Move columns between Available and Visible, and drag  │
│ to reorder the visible columns.                       │
├───────────────────────────────────────────────────────┤
│ Available         │       │   Visible (sortable)      │
│ [Search box]      │       │   [Search box]            │
│ Price       [  ]  │ [→]   │   Price          [▶▼]    │
│ Volume      [ ✓]  │ [⇒]   │   Symbol         [▶▼]    │
│ Symbol      [  ]  │ [←]   │   Volume         [▶▼]    │
│ Currency    [  ]  │ [⇐]   │   PnL            [▶▼]    │
│ PnL         [ ✓]  │       │                          │
│ (scrollable)      │       │ (scrollable, drag handle) │
├───────────────────────────────────────────────────────┤
│                                  [Cancel]  [Apply]   │
└───────────────────────────────────────────────────────┘
```

Three columns: Available list (left), transfer buttons (center, vertical), Visible list (right).

## Component tree

- **ColumnSelectorDialog**
  - **Dialog** + **DialogContent** (modal chrome)
    - **DialogHeader** (title + instructions, border-bottom)
    - Body flex container
      - **ColumnList** (title="Available", sortable=false)
        - Header: "AVAILABLE" + count
        - Search: IconInput + search icon
        - ScrollArea → ColumnListItem × N (multi-select)
      - Transfer button cluster (center column)
        - TransferButton (→) — Add selected
        - TransferButton (⇒) — Add all
        - TransferButton (←) — Remove selected
        - TransferButton (⇐) — Remove all
      - **ColumnList** (title="Visible", sortable=true, onReorder)
        - Header: "VISIBLE" + count
        - Search: IconInput + search icon
        - **DndContext** + **SortableContext** (dnd-kit)
          - SortableRow × N → ColumnListItem with drag handle
    - **DialogFooter** (border-top)
      - Button (ghost) "Cancel"
      - Button (primary) "Apply"

## Props

```ts
interface ColumnSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: GridApi | null;
}
```

## Internal state (`useColumnSelectorState`)

```ts
{
  state: { visible: ColumnItem[], available: ColumnItem[] }
  availableSel: Set<string>  // multi-select in available pane
  visibleSel: Set<string>    // multi-select in visible pane
  availableQuery: string     // search in available pane
  visibleQuery: string       // search in visible pane
  availableAnchor: RefObject<string>  // for shift-click range selection
  visibleAnchor: RefObject<string>
}
```

## Interaction flows

**Dialog opens:**
```
open prop becomes true → seed state from live grid via readGridColumns(api) →
  splits columns into visible (currently shown) and available (hidden)
```

**Search:**
```
type in a pane's search box → setQuery(text) → filtered list re-renders → filterItems(query)
```

**Multi-select with shift-click:**
```
click an item → resolve selection set:
  - plain click → replace selection with this one
  - cmd/ctrl-click → toggle this in selection
  - shift-click → range from anchor to this
→ setSel(newSet)
```

**Add selected:**
```
[→] → addSelected() → moveToVisible(state, availableSel) → setState(newState) →
  selected columns shift from available to visible
```

**Drag to reorder:**
```
drag handle in Visible pane → dnd-kit DragEndEvent → reorder(activeColId, overColId) →
  reorderVisible(state, activeColId, overColId) → setState
```

**Apply:**
```
[Apply] → applyColumnSelection(api, state) → calls api.setColumnVisible() per column +
  api.moveColumn() for reorder → onOpenChange(false) → dialog closes
```

**Cancel:**
```
[Cancel] → onOpenChange(false) without applying → grid stays unchanged
```

## Engine wiring

- **No engine state.** This dialog reads/writes the grid API directly:
  - **Read**: `readGridColumns(api)` → extracts colId, headerName, visible state from `api.getColumns()`
  - **Write**: `applyColumnSelection(api, state)` → `api.setColumnVisible()` + `api.moveColumn()`
- Profile persistence happens via the grid-state module (column order/visibility is part of `gridState`)

## Shared primitives used

- Dialog primitives (DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter)
- Button, Input, ScrollArea
- TransferButton (local — small icon button)
- ColumnList, ColumnListItem (local — reusable list pane with search + selection)
- @dnd-kit/core + @dnd-kit/sortable (DndContext, SortableContext) — drag-to-reorder

## Design decisions worth copying

1. **Two independent search queries.** Available and Visible panes have separate search boxes. Filtering one doesn't affect the other.

2. **Drag disabled when Visible search is active.** Reorder during search would be confusing — search returns a subset, drag target unclear. Shown as a hint.

3. **Transfer buttons in center with clear semantics.** Four buttons (→, ⇒, ←, ⇐) with disabled state when the action is meaningless (no selection in source, all already on one side).

4. **dnd-kit with pointer + keyboard sensors.** Drag works on mouse, touch, and keyboard. Locked columns (system: row-number, checkbox) are not draggable.

5. **Design-system tokens through portals.** All colors via `--ds-*` CSS variables — renders correctly in both light/dark themes inside the portal.

6. **Live commit on Apply.** No draft mode at this level — Apply commits to the grid immediately and closes. Cancel discards without applying. Simple semantics.

## cgrid translation

1. **`<cgrid-column-selector-dialog>`** as a Lit element wrapping `<wa-dialog>`.
2. **`<cgrid-column-list>`** + **`<cgrid-column-list-item>`** as reusable list components.
3. **Drag-reorder**: use [SortableJS](https://sortablejs.github.io/Sortable/) (~9 KB, framework-agnostic) instead of dnd-kit. Same DOM model: drag handle + reorder events.
4. **Engine wiring**: cgrid has equivalents — `grid.setColumnVisible(colId, visible)` and `grid.moveColumn(colId, toIndex)`. If missing, add them.
5. **CSS variables for theming** — port the `--ds-*` scheme so the dialog renders correctly in any theme.

Build in Phase 2 — a standalone editor, doesn't depend on the master-detail substrate.
