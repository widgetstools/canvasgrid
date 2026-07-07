# CGridExt — Foundation Design

**Date:** 2026-07-07
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `cgridext/foundation`
**Package:** `@cgrid/ext` (new)

---

## 1. Summary

`CGridExt` is cgrid's own **batteries-included, self-contained** grid product: a
vanilla wrapper that owns a `CGrid` instance and layers on **all the tooling to
configure it** — a two-tier toolbar, a settings sheet with the full module set,
and named profiles. It has **zero dependency on the StarUI React platform**;
the config/services StarUI used to provide are provided by `CGridExt` itself.

This document specs the **Foundation** sub-project: the package, the `CGridExt`
class + `<cgrid-ext>` element, the shell layout, the **plugin/extension contract
+ registry**, the two-tier toolbar, **all 17 fresh settings modules**, and
**profiles/layouts**. Data services are a **separate follow-on spec**; the
contract reserves a clean seam for them.

### Locked decisions (from brainstorm, 2026-07-07)

1. **Role:** self-contained bundle; StarUI services are provided by CGridExt.
2. **Form factor:** vanilla class + `<cgrid-ext>` custom element (framework-agnostic).
3. **Architecture:** plugin/extension **registry + thin composer** (not monolith, not config-driven).
4. **Build strategy:** **build fresh** for cgrid; StarUI screenshots are loose UX reference only, not a binding module set.
5. **Composition, not subclassing:** CGridExt *owns* a `CGrid` and drives it through the kernel's **public** API only. Any capability gap is fixed in the kernel (no retroactive layering).
6. **This spec's scope:** shell + contract + two-tier toolbar + **all 17 settings modules** + **profiles/layouts**.
7. **Out of scope (own specs):** **Data services**; and the engine-gated modules **Export**, **Pivot**, **Alerts** (reserved contract seams only).
8. **Sequencing:** one spec, but the plan ships modules in **category waves**, each wave complete and **E2E-gated** before the next.
9. **Toolbar:** **two tiers** — slim always-on primary toolbar + opt-in formatting/editing ribbon with per-section toggles.
10. **Columns/Filters:** available **both** as the kernel's right-edge tool-panel tabs **and** as settings modules.
11. **Demo:** new `apps/cgrid-ext-demo` with live STOMP.
12. **Profile storage:** localStorage-backed default + pluggable `ProfileStore` interface.

---

## 2. Package & form factor

New workspace package **`@cgrid/ext`**.

**Dependencies:** `@cgrid/kernel`, `@cgrid/customizer` (Lit chrome primitives),
`@cgrid/calc`, `@cgrid/format`, `@cgrid/rules`, `@cgrid/edit`, `@cgrid/renderers`.

**Exports:**

- **`CGridExt`** — vanilla class. `new CGridExt(container: HTMLElement, options: CGridExtOptions)`.
  - Internally constructs and **owns** a `CGrid` (composition). Exposes `.grid`
    (the kernel instance) as an escape hatch.
  - Re-surfaces common lifecycle as pass-throughs: `setRowData`, `getState`,
    `setState`, `addEventListener`/`on`, `destroy`.
- **`<cgrid-ext>`** — thin custom element over `CGridExt`. Attributes/properties →
  options; the class is the source of truth, the element is a shell.
- The extension contract types, the built-in extension bundle, and the
  `ProfileStore` interface (see below).

**`CGridExtOptions`** is a superset of `CGridOptions`:

```ts
interface CGridExtOptions extends CGridOptions {
  ext?: {
    extensions?: ExtensionSpec[];        // add / remove / replace built-ins
    toolbar?: ToolbarConfig;             // primary + ribbon config & visibility
    profiles?: { store?: ProfileStore; initialId?: string };
    modules?: Record<string, unknown>;   // per-module config, keyed by module id
    dataProvider?: DataProvider;         // reserved seam (typed, not implemented here)
  };
}
```

Everything the kernel accepts still flows straight through; `ext` is purely
additive.

---

## 3. Extension contract (the plugin model)

Every piece of tooling is an **Extension** implementing one small interface,
registered in CGridExt's registry.

```ts
type ExtensionKind = 'settings-module' | 'toolbar-item' | 'service';

interface CgExtension {
  id: string;                        // 'grid-options', 'columns', 'ribbon.format', …
  kind: ExtensionKind;
  init(ctx: CgExtContext): void;     // wire to grid; register state slice; subscribe
  dispose?(): void;
}

interface SettingsModule extends CgExtension {
  kind: 'settings-module';
  title: string;
  icon: string;
  category: ModuleCategory;          // groups it under the sheet's category menubar
  mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance;  // render its UI
}

interface ToolbarItem extends CgExtension {
  kind: 'toolbar-item';
  slot: 'primary-left' | 'primary-center' | 'primary-right' | `ribbon.${string}`;
  render(host: HTMLElement, ctx: CgExtContext): ToolbarItemInstance;
  toggleable?: boolean;              // ribbon sections are individually toggleable
}

interface CgExtContext {
  grid: CGrid;                       // kernel — public API only
  getState(): GridState;
  setState(s: Partial<GridState>): void;
  registerStateModule(id: string, slice: StateModuleSlice): void;  // module owns a named slice
  modal: ModalHost;                  // grid.getModal()
  events: { on(type, fn): Unsub; emit(evt): void };
  profiles: ProfileController;       // dirty-state, save, switch
}
```

- **Default bundle:** CGridExt registers all built-in extensions at construction.
  `options.ext.extensions` lets consumers add, remove (`{ remove: id }`), or
  replace (`{ id, factory }`) any of them.
- **State ownership:** each settings module registers a **named `GridState`
  slice** via the kernel's `registerStateModule`. This is the *single* mechanism
  — profiles and persistence ride the same `getState`/`setState`, so there is no
  parallel state plumbing anywhere in ext.
- **UI primitives:** module and toolbar UIs are built from the existing
  `@cgrid/customizer` **Lit chrome** (`cgc-band`, `cgc-field`, `cgc-switch`,
  `cgc-select`, `cgc-number`, and the `litToolPanel` adapter). One visual
  language; the sleek-UI bar is met by shared, already-styled controls rather
  than re-invented per module. New shared primitives that several modules need
  are added to `@cgrid/customizer`, not duplicated in ext.

---

## 4. Shell layout

The shell is a **vertical stack of DOM strips** wrapping the kernel canvas.
CGridExt introduces only four *new* surfaces; everything below the ribbon is
kernel-native chrome that CGridExt merely configures.

| Region | Owner | Mechanism |
|---|---|---|
| **App/title bar** | ext (new) | Hosts `toolbar-item` extensions in `primary-*` slots |
| **Formatting/editing ribbon** | ext (new) | Hosts grouped `ribbon.*` `toolbar-item` extensions; reserves vertical space; per-section toggle |
| Row-group panel | kernel | `rowGroupPanelShow` (already reserves space) |
| **Canvas** | kernel | `CGrid` mounts here |
| Tool-panel tabs (Columns/Filters) | kernel | existing `sideBar` + ToolPanel registry |
| Status bar | kernel | existing status bar |
| **Settings sheet (drawer)** | ext (new) | opened by the title-bar launcher; hosts `settings-module` extensions; rendered via `getModal()` / overlay |
| **Popout window** | ext (new) | detaches the ribbon or the settings sheet into an OS window |

The vertical strips reserve space above the canvas the same way the kernel's
`rowGroupPanel`/`statusBar` already do, so the canvas viewport shrinks correctly
and the kernel remains the sole owner of scroll/layout math.

### Visual reference

The target chrome matches the StarUI MarketsGrid screenshots supplied during
brainstorm (title bar cluster: search · profiles · save · notifications ·
settings launcher · overflow; multi-section formatting/editing ribbon;
right-edge Columns/Filters tabs; row-count status bar). Built **fresh** — the
screenshots define UX intent, not implementation.

---

## 5. Two-tier toolbar

- **Primary toolbar** (slim, always-on): grid name · collapse · inline-expanding
  search · **profile selector** · **save** (dirty-aware) · notifications ·
  density/view quick-toggles · **settings launcher** · overflow `⋮`.
- **Formatting/editing ribbon** (opt-in; each *section* toggled from the overflow
  menu): **History · Smart · Bulk · Scope · Type/B·I·U/align/font · Paint ·
  Format · Edit · Group · Templates**, plus a **popout** control.
- Each primary item and each ribbon section is a `toolbar-item` extension bound
  to a slot. Ribbon tools operate on the kernel's current **selection/scope**
  through the public selection API and the relevant engine
  (`format`/`edit`/`rules`/`calc`). Per-section visibility is ext chrome state,
  persisted with the active profile.

---

## 6. Settings module catalog (17, built fresh)

Grouped under the sheet's category menubar. Every module is backed by an engine
that exists today, so all are buildable in this spec.

**Layout & Columns**
1. **Grid Options** — density, row height, selection, scroll, misc kernel options *(kernel-native today; ext re-skins)*
2. **Columns** — visibility · order · pin · width · sort · per-column props *(also the right-edge tab)*
3. **Column Groups** — nested header groups *(kernel-native today)*
4. **Calculated Columns** — expression/AST columns via `@cgrid/calc`

**Data**
5. **Filters** — per-column filter models + saved filter sets *(also the right-edge tab)*
6. **Sorting** — multi-column sort model
7. **Grouping & Aggregation** — row-group-by + aggregation functions

**Format & Style**
8. **Cell Formatting** — `@cgrid/format` DSL (Excel codes, decimals, `1/32` fractions) per column
9. **Conditional Styles** — style rules via `@cgrid/rules`
10. **Cell Renderers** — assign `@cgrid/renderers` (bars, sparklines, tick-aware, badges…) per column
11. **Appearance** — theme / palette / token selection via kernel theming

**Editing**
12. **Editing** — editable columns + editor type per column via `@cgrid/edit`
13. **Smart Edit** — numeric ops on selection *(port existing `@cgrid/customizer` panel)*
14. **Bulk Update** — set value across selection *(port existing `@cgrid/customizer` panel)*
15. **Edit History** — undo/redo timeline

**Workspace**
16. **Templates** — save/apply formatting templates
17. **Keyboard Shortcuts** — shortcut bindings

**Reserved (engine-gated — NOT built here; contract reserves `id` + category slot):**
**Export** (`@cgrid/export` parked), **Pivot** (`@cgrid/excel-pivot` capstone),
**Alerts** (needs an alerts store that doesn't exist yet). They drop in when
their engines land — no retroactive layering.

---

## 7. Profiles / layouts

- A **profile** is a full snapshot: kernel `GridState` (columns, sort, filter,
  groups) **+** every module's registered state slice **+** ext chrome state
  (visible toolbars/sections, active theme). One serialize path — kernel
  `getState`/`setState` with `registerStateModule` slices.
- The primary-toolbar **profile selector** switches profiles (`setState`); the
  **save** button reflects a computed **dirty** state (current snapshot ≠ saved
  profile) and persists.
- **`ProfileStore` interface** abstracts persistence:

  ```ts
  interface ProfileStore {
    list(): Promise<ProfileMeta[]>;
    load(id: string): Promise<ProfileSnapshot>;
    save(id: string, snap: ProfileSnapshot): Promise<void>;
    remove(id: string): Promise<void>;
  }
  ```

  A **localStorage-backed default** ships out of the box; consumers can swap in
  server/IndexedDB stores.

---

## 8. State model & the data-service seam

- **Single source of truth:** kernel state + module slices. Ext adds exactly one
  `ext` slice (chrome + active-profile metadata). No shadow state anywhere.
- **Data-service seam (reserved, not built here):** CGridExt takes data through
  the kernel today (`setRowData`) and exposes a `dataProvider?` option typed as a
  minimal `DataProvider` interface, so the future Data-services spec slots a
  shared-connection provider in **without changing the CGridExt surface**.

  ```ts
  interface DataProvider {           // shape reserved; wiring is a later spec
    subscribe(sink: (rows: unknown[]) => void): Unsub;
    // shared-connection / cache-replay / ref-counting semantics land later
  }
  ```

---

## 9. Testing, demo & UI quality

- **Demo/testbed:** new **`apps/cgrid-ext-demo`** wired to the **live STOMP**
  feed (ws://localhost:8081 from `starui/apps/stomp-view-server`), instantiating
  `CGridExt` with the tooling under test. Zero feature code in the demo — if
  something can't be done through the public API, that's a kernel/ext gap to fix,
  never worked around in the demo.
- **Per module:** unit tests for state-slice + engine wiring.
- **E2E is the completion gate per wave:** canvas UI can't be verified by unit
  tests alone; a category wave is not "done" until its full E2E run passes.
- **UI quality:** invoke **`/frontend-design`** before building each new surface
  (title bar, ribbon, settings sheet, each module). Consult
  `docs/catalog/screenshots/` first; every surface meets the sleek/sophisticated
  bar — deliberate typography, spacing, and interaction states.

---

## 10. Build sequence (waves)

The implementation plan ships in category waves, each complete + E2E-gated:

0. **Spine** — `@cgrid/ext` package · `CGridExt` class + `<cgrid-ext>` element ·
   shell strips (title bar, ribbon host, settings-sheet host, modal/popout) ·
   extension contract + registry · **Grid Options** module end-to-end ·
   `apps/cgrid-ext-demo`. Proves composition top-to-bottom.
1. **Layout & Columns** — Columns, Column Groups, Calculated Columns.
2. **Data** — Filters, Sorting, Grouping & Aggregation.
3. **Format & Style** — Cell Formatting, Conditional Styles, Cell Renderers, Appearance.
4. **Editing** — Editing, Smart Edit, Bulk Update, Edit History.
5. **Workspace** — Templates, Keyboard Shortcuts.
6. **Profiles/layouts** — profile selector, save/dirty, `ProfileStore` default,
   full-snapshot serialize across all module slices + chrome state.

The two-tier toolbar is built incrementally alongside the waves whose tools it
surfaces (primary toolbar in wave 0; ribbon sections as their engines' modules land).

---

## 11. Out of scope (explicit)

- **Data services** (shared connection hub, cache replay, ref-counting) — own spec; seam reserved.
- **Export**, **Pivot**, **Alerts** modules — engine-gated; contract seams reserved.
- React/other framework wrappers — the vanilla class + custom element are the API; wrappers can come later.
