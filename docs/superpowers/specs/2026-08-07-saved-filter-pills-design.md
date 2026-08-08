# Saved filter pills (per layout)

## Goal
Markets-style quick filter pills: capture the live column `filterModel`, toggle pills to apply/clear, persist the pill list with each **layout**.

## Data
```ts
interface SavedFilter {
  id: string;
  label: string;
  filterModel: Record<string, unknown>;
  active: boolean;
}
```
Kernel `StateModule` id `saved-filters` v1 — **layout tier** (not in `DEFAULT_GRID_LEVEL_MODULES`).

## Behavior
- `+` captures `live \ merge(active)` via `subtractFilterModel`; auto-label; new pill active
- Click toggles `active` → `setFilterModel(merge(actives))` (empty → clear)
- Clear deactivates all; trash removes; rename + JSON edit
- Count badges via `forEachRow` + `doesRowMatchFilterModel`
- Overflow carets when the strip scrolls

## Chrome
Title-bar `primary-left` (after brand): pill strip + clear + `+`.
