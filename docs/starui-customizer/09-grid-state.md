# 09 — grid-state

> Capture & restore native grid state (sort, filter, column order/visibility/width, scroll position, viewport anchor, quick filter). Independent of other modules.

## Purpose

When a user clicks "Save" on the toolbar, freeze the grid's current configuration — including sort/filter state that's not part of column-customization — so the next load restores their exact view. Survives the difference between *configured* state (what column-customization defines) and *interaction* state (where they scrolled, what they sorted by today).

## Config schema

```ts
interface GridStateState {
  saved: SavedGridState | null;
}

interface SavedGridState {
  schemaVersion: number;        // currently 3
  savedAt: string;              // ISO timestamp
  gridState: GridState;         // AG-Grid's native GridState payload
  viewportAnchor: {
    firstRowIndex: number;      // top-of-viewport row
    leftColId: string | null;   // left-of-viewport column
    horizontalPixel: number;    // scroll position within the left col
  };
  quickFilter?: string;
}
```

`GridState` (from AG-Grid) covers: column order, visibility, width, sort, filter, pagination, selection, sidebar focus.

## Runtime behavior

### Capture

```ts
function captureGridState(api, quickFilter?): SavedGridState {
  return {
    schemaVersion: 3,
    savedAt: new Date().toISOString(),
    gridState: api.getState(),
    viewportAnchor: {
      firstRowIndex: api.getFirstDisplayedRow(),
      leftColId: api.getFirstDisplayedColumn()?.getColId() ?? null,
      horizontalPixel: api.getHorizontalPixelRange().left,
    },
    quickFilter: quickFilter ?? api.getQuickFilter(),
  };
}
```

### Sanitization

Before persisting, `sanitizeGridState(state)` strips malformed filter entries that would crash AG-Grid's `SetFilterHandler.validateModel()` on restore. Specifically: set-filter `values` that aren't arrays. Logs which colId was problematic so the user sees why a filter was dropped, but the rest of the profile restores cleanly.

### Apply

```ts
function applyGridState(api, saved: SavedGridState) {
  api.setState(sanitizeGridState(saved.gridState));
  if (saved.viewportAnchor.leftColId) {
    api.ensureColumnVisible(saved.viewportAnchor.leftColId, 'start');
  }
  api.ensureIndexVisible(saved.viewportAnchor.firstRowIndex, 'top');
  if (saved.quickFilter) api.setQuickFilter(saved.quickFilter);
}
```

### Schema versioning

V3 is current. Older snapshots are migrated by the module's deserialize hook (additive — new fields filled with defaults).

## UI surface

None in engine. Host wires:
- Toolbar "Save" button → `captureGridState()` → store in profile slot
- Grid-ready lifecycle → if profile has a saved state → `applyGridState()`

## Persistence

Single slot per profile. Last-capture-wins. `null` until first save.

## Dependencies

None — fully self-contained.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/grid-state/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/grid-state/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/grid-state/helpers.ts](../../../starui/packages/shared/engine/src/customizer/modules/grid-state/helpers.ts)

## Design decisions worth copying

- **Defensive sanitization on restore.** A single bad filter entry must not block the entire profile. Drop, log, restore the rest.
- **Viewport anchor instead of scroll pixels.** Storing `firstRowIndex` + `leftColId` is more stable than raw scroll pixels. If rows/cols are inserted/removed before restore, the anchor still finds the right place.
- **Explicit save, not auto-save.** Differs from column-customization which auto-persists on every state change. Grid state is interaction-state; users can discard unwanted scroll/sort/filter by not clicking Save. Encourages deliberate "snapshot this view" UX.

## cgrid translation

cgrid needs an equivalent `getState() / setState()` serialization layer. Map:

| AG-Grid GridState field | cgrid equivalent |
|---|---|
| column order/visibility/width | `columnOrder`, `columnLayout`, `columnHidden` |
| sort | `sortModel` (worker-side) |
| filter | `filterModel` (worker-side per-column) |
| pagination | `paginationState` |
| selection | `selectionModel.serialize()` |
| sidebar focus | sidebar host state |
| group expansion | `columnGroupState` |
| viewport scroll | `scrollLeft`, `scrollTop` |

Things to build:
1. **`grid.getState()`** — collect all the above into one JSON blob.
2. **`grid.setState(state)`** — apply in dependency order: columns first, then sort/filter, then selection, then scroll.
3. **Sanitization step** — once filter/sort are formal types, add a validator that drops malformed entries and logs which colId.
4. **Viewport anchor**: cgrid already exposes `getFirstDisplayedRow()`-equivalent through the viewport. Capture row index + leftmost column ID, not pixel scroll.

Schema versioning matters here because grid state is the most volatile module across releases — bump the version whenever you add/remove a field and write a migration hook.
