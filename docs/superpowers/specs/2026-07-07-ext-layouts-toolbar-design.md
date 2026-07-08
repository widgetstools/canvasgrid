# CGridExt — Layout Management UI on the Title Bar

- **Status:** Approved design; ready for implementation planning.
- **Date:** 2026-07-07
- **Branch lineage:** builds on the ext title bar shipped on `cgridext/ribbon-density`
  (`packages/ext/src/toolbar/titleBar.ts`); implementation continues that lineage.
- **Wireframe:** user-supplied (three frames): a "Layout 1 ▾" trigger button in the
  title bar's right cluster with a disk button beside it; a dropdown panel headed
  `LAYOUTS` + count, a layout list (Default locked; active row = check + accent
  highlight; hover actions rename / duplicate / export / delete), a
  "New layout name / + Save" row, and an Export / Import footer.

## 1. Goal

Replace the Wave-0 placeholder profiles button and profile-save disk in the CGridExt
title bar with a full layout-management dropdown driven by the kernel's shipped Grid
Layouts API. Every affordance in the wireframe maps 1:1 onto existing public
`CGrid`/`CGridApi` methods — this feature is **UI only**; no kernel changes are in
scope.

**Decisions locked with the user:**

1. **Backing API = kernel Grid Layouts** (`getLayouts` / `saveLayout` / `loadLayout` /
   `renameLayout` / `duplicateLayout` / `deleteLayout` / `updateLayout` /
   `exportLayout` / `exportLayouts` / `importLayout` / `importLayouts` /
   `getActiveLayout`, `layoutChanged` event). The dropdown **replaces** the
   placeholder `profiles` toolbar item. `ProfilesController` and the `ProfileStore`
   plumbing stay untouched in `CgExtContext` for a future profiles wave.
2. **Disk button = `updateLayout()`** — recapture the current view into the active
   layout, dirty-aware. It replaces the Wave-0 profile-save disk.

## 2. Architecture

New file `packages/ext/src/toolbar/layoutsMenu.ts` exporting two `toolbar-item`
extensions for the `primary-right` slot:

| id | replaces | renders |
|---|---|---|
| `layouts` | `profiles` | avatar + active-layout name + caret; opens the panel |
| `layout-save` | `save` | disk icon; dirty-aware `updateLayout()` |

`titleBarExtensions()` composes these in place of `profilesItem()` / `saveItem()`.
The old `profilesItem`/`saveItem` factories are deleted from `titleBar.ts` (the
title bar is their only consumer; the underlying `ProfilesController` API is NOT
deleted). Consumers who removed `{ remove: 'profiles' }` by id are unaffected —
the demo removes `settings-launcher`/`save` only, and `save` keeps its slot
semantics under the new id `layout-save`, so the demo's `{ remove: 'save' }`
spec entry keeps working against the default-bundle `save` it targets today.

Plain DOM + injected CSS (Lit stays customizer-only per the 21i decision). Reuses
`titleBar.ts`'s exported `menu()` anchored-popup helper — `menu()` and `svg()`/
`iconButton()` become shared exports (module-internal `export`, not public API).
All state lives in the kernel; the UI re-reads `getLayouts()` /
`getActiveLayout()` on every open and re-syncs on every `layoutChanged`.

The extensions talk to `ctx.grid` (the kernel `CGrid`), same as every other title-bar
item. No new context surface is needed.

## 3. Trigger button (`layouts`)

Same chrome as the current profile button (avatar chip, 12.5px 550-weight name,
muted caret — the wireframe deliberately matches it). Content:

- Name = `getActiveLayout()?.name ?? 'Default'`. Re-rendered on `layoutChanged`
  (all sources, including `'restore'` — a persisted-state restore may change the
  active layout after mount).
- Click toggles the panel. `aria-haspopup="menu"`, `aria-expanded` synced.

## 4. Panel anatomy

Anchored under the trigger via `menu()`, right-aligned, fixed width ~300px, themed
entirely from `--cg-*` tokens with the title bar's neutral-dark fallbacks.

### 4.1 Header

`LAYOUTS` (11px, tracking +0.08em, muted) with a right-aligned count badge =
`getLayouts().length`. Count updates live after every mutation.

### 4.2 Layout list

Scrollable (`max-height: ~320px; overflow-y: auto`). One row per
`getLayouts()` entry, in kernel order. Row anatomy:

- **Active row** (id === `getActiveLayoutId()`): 2px accent left bar, accent
  check icon, `--cg-row-alt-bg`-tinted background, name in `--cg-fg-color`.
- **Inactive row:** small muted dot where the check sits; hover tints the row.
- **Row body click** → `loadLayout(id)`, then the panel **closes** (selection
  is a dismissal gesture, like a native select; clicking the already-active
  row also just closes). A failed load keeps the panel open so the error
  strip stays readable. Trigger name re-syncs via `layoutChanged`. Non-select
  actions (rename / duplicate / delete / save-new / import / export) keep the
  panel open.
- **Hover action cluster** (right-aligned, hidden until row hover or focus-within;
  always visible on the active row, matching the wireframe):
  - **Rename** (pencil): swaps the name label for an inline text input pre-filled
    with the current name. Enter → `renameLayout(id, value)`; Escape/blur →
    cancel. Kernel duplicate-name throw is caught → input gets an error state
    (accent-red border + `title` = error message) and stays open for correction.
  - **Duplicate** (copy): `duplicateLayout(id, uniquifiedName)` where
    `uniquifiedName` = `"<name> copy"`, then `"<name> copy 2"`, … against current
    layout names (case-insensitive, trimmed — mirroring kernel uniqueness rules).
  - **Export** (download): `exportLayout(id)` → pretty-printed JSON file download
    named `<slug(name)>.cgrid-layout.json`.
  - **Delete** (trash): `deleteLayout(id)`. No confirm dialog (kernel layouts are
    cheap to recreate; matches wireframe). Deleting the active layout falls back
    per kernel semantics; UI just re-syncs from `layoutChanged`.
- **Default row:** lock icon replaces rename + delete (kernel rejects
  `deleteLayout('default')`; the UI never offers it). Duplicate + export remain.
- **Overflow names** get `text-overflow: ellipsis` + a native `title` tooltip
  (the wireframe's "Layout 1" tooltip).

### 4.3 Save-new row

Text input (`placeholder="New layout name"`) + `+ Save` button, visually one
grouped control per the wireframe.

- Button disabled while the trimmed input is empty.
- Enter in the input = clicking Save.
- `saveLayout(name)` — kernel activates the new layout by default; the trigger
  re-labels via `layoutChanged`. Input clears on success.
- Kernel duplicate-name throw → same inline error treatment as rename.

### 4.4 Footer

Two equal-width buttons:

- **Export** — `exportLayouts()` → JSON download `<gridId or 'grid'>-layouts.json`
  (full `GridLayoutsBundle`).
- **Import** — hidden `<input type="file" accept="application/json,.json">`.
  On pick: parse, then shape-sniff — an object with a `layouts` array →
  `importLayouts(bundle, { mode: 'merge' })`; an object with `id`+`state` →
  `importLayout(layout)`; anything else → inline error. Kernel throws
  (newer bundle version, malformed state) surface the same way. Success
  re-renders the list; merge mode never clobbers the live view (kernel
  guarantee).

Inline errors render in a single slim message strip above the footer (13px,
`--cg-neg-color`), cleared on the next successful action or panel reopen.

## 5. Save button (`layout-save`) + dirty tracking

Disk icon button, `title` cycling between "Update layout '<name>'" (dirty) and
"Layout up to date" (clean); disabled when clean; amber `is-dirty` treatment
reused from the current save button.

Dirty lifecycle (UI-local flag; the kernel has no per-layout dirty signal):

- `stateUpdated` (kernel event) → dirty = true …
- … **except** programmatic applies and layout-op echoes, distinguished by the
  event payload itself (no timing window needed): `stateUpdated` is ignored
  when `source` is `'api'`/`'init'` (a `setState` — `loadLayout`'s apply, the
  persistence restore, construction) or when `changedKeys` is non-empty and
  contains only the virtual `'layouts'` key (the echo of a layout mutation).
  Only `source: 'ui'` view changes dirty the disk. Every `layoutChanged`
  clears dirty.
- Click → `updateLayout()` → kernel emits `layoutChanged {source:'update'}` →
  dirty clears via the normal path.

Note `persistState` still autosaves everything continuously (kernel Phase A5);
the disk is specifically "fold my current view into the active layout", not
"persist to storage".

## 6. Styling

- New CSS appended via `injectLayoutsMenuStyles()` (id-gated `<style>`, same
  pattern as `injectTitleBarStyles()`); class prefix `cgext-layouts-`.
- Tokens only: `--cg-popup-bg`, `--cg-border-color`, `--cg-fg-color`,
  `--cg-muted-fg-color`, `--cg-accent-color`, `--cg-row-alt-bg`,
  `--cg-control-bg`, `--cg-warning-color`, `--cg-neg-color` — with the same
  fallbacks the title bar uses, so light + dark themes both read correctly.
- 12px control type / 11px header type floor (ribbon precedent); 30px trigger
  height matching the existing right-cluster controls.
- `/frontend-design` is invoked at implementation time before the panel is
  built (standing UI-quality gate).

## 7. Testing

**Unit (vitest + happy-dom, `packages/ext/tests/layoutsMenu.test.ts`)** against a
stub grid surface (`getLayouts`/`getActiveLayoutId`/`loadLayout`/… as spies +
a tiny event emitter):

1. List renders all layouts; active row marked; count badge correct.
2. Default row: lock shown, no rename/delete buttons; duplicate/export present.
3. Row click calls `loadLayout`; `layoutChanged` re-labels the trigger.
4. Rename: commit calls `renameLayout`; Escape cancels; kernel throw → error
   state, no crash.
5. Duplicate name uniquification (`copy`, `copy 2`).
6. Save-new: disabled-empty, Enter commits, clears on success, error inline.
7. Import shape-sniffing: bundle → `importLayouts(merge)`, single →
   `importLayout`, garbage → inline error, kernel throw → inline error.
8. Dirty lifecycle incl. the post-`layoutChanged` suppression window.
9. Destroy: listeners unsubscribed, panel removed.

**E2E (Playwright, `apps/cgrid-ext-demo/e2e/layouts-toolbar.spec.ts`)** — the
demo already runs `persistState: true` + full engine wiring:

1. Save a new layout from the input → trigger shows its name → restyle a column
   via the ribbon → disk goes dirty → click disk → switch to Default and back →
   the restyle round-trips.
2. Rename + duplicate + delete flows through the panel.
3. Bundle export → import round-trip (download intercepted; re-import via
   `setInputFiles`).
4. Persistence: reload the page → active layout + list survive (kernel blob).

Full `cgrid-ext-demo` E2E suite green is the done-gate; the automation browser
is killed afterward.

## 8. Error handling

Every kernel throw is caught at the UI boundary and surfaced inline in the panel
(row-level input error or the footer message strip). No unhandled rejections, no
silent console-only failures. File-read/JSON-parse failures on import use the
same strip.

## 9. Out of scope

- Kernel changes of any kind (the API is complete).
- Profiles wave (ProfileController UI, multi-profile store management).
- Confirm dialogs / undo for delete.
- Drag-reordering of layouts (kernel keeps insertion order; wireframe shows none).
