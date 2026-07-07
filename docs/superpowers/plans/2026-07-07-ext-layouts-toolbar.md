# CGridExt Layouts Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Wave-0 profiles button + profile-save disk in the CGridExt title bar with a full layout-management dropdown (list / switch / rename / duplicate / export / delete / save-new / bundle import-export) and a dirty-aware "update active layout" disk, driven entirely by the kernel's shipped Grid Layouts API.

**Architecture:** One new plain-DOM module `packages/ext/src/toolbar/layoutsMenu.ts` exports two `toolbar-item` extensions (`layouts`, `layout-save`) that `titleBarExtensions()` composes in place of the old `profiles`/`save` items. Shared popup/icon helpers move from `titleBar.ts` into a new `toolbar/ui.ts` (avoids a titleBar↔layoutsMenu import cycle). All UI state re-syncs from the kernel's `layoutChanged` event — the panel holds no model of its own.

**Tech Stack:** TypeScript, plain DOM + injected CSS (`--cg-*` theme tokens; Lit is customizer-only), vitest + happy-dom unit tests, Playwright E2E in `apps/cgrid-ext-demo`.

**Spec:** `docs/superpowers/specs/2026-07-07-ext-layouts-toolbar-design.md`

## Global Constraints

- **No kernel changes.** The layout API (`getLayouts`/`saveLayout`/`loadLayout`/`updateLayout`/`deleteLayout`/`renameLayout`/`duplicateLayout`/`exportLayout`/`exportLayouts`/`importLayout`/`importLayouts`, `layoutChanged`, `stateUpdated`) is complete and shipped.
- All colors from `--cg-*` tokens with the title bar's neutral-dark fallbacks; 12px control-type floor, 11px header-type floor; 30px trigger height.
- Class prefix `cgext-layouts-`; the trigger button reuses the existing `.cgext-profile*` classes (the wireframe deliberately matches that chrome) — do NOT delete that CSS.
- Every kernel throw is caught at the UI boundary and surfaced inline (row input error state or the panel error strip). No unhandled rejections.
- `ProfilesController` / `ProfileStore` / `ctx.profiles` are NOT touched or removed — only the two title-bar items that rendered them.
- Working branch: `cgridext/ribbon-density` (all ext code lives here, unmerged to main). Commit after every task.
- Unit tests: run from `packages/ext` with `npx vitest run tests/layoutsMenu.test.ts`. Full suite: `npx vitest run`.
- E2E: run from `apps/cgrid-ext-demo` with `npx playwright test` (dev server auto-starts on :5188). Kill any leftover automation browser and dev server when done.

---

### Task 1: Extract shared toolbar helpers into `toolbar/ui.ts`

Pure refactor — `menu()`, `svg()`, `iconButton()` move out of `titleBar.ts` so `layoutsMenu.ts` can import them without a cycle. `menu()` gains an optional `onOpenChange` callback (layoutsMenu needs it for `aria-expanded`; existing callers pass nothing).

**Files:**
- Create: `packages/ext/src/toolbar/ui.ts`
- Modify: `packages/ext/src/toolbar/titleBar.ts` (delete the three local definitions, import from `./ui`)

**Interfaces:**
- Produces: `svg(path: string, size?: number): string`; `iconButton(icon: string, label: string): HTMLButtonElement`; `menu(anchor: HTMLElement, build: (close: () => void) => HTMLElement, onOpenChange?: (open: boolean) => void): { toggle(): void; destroy(): void }` — all exported from `packages/ext/src/toolbar/ui.ts`.

- [ ] **Step 1: Create `packages/ext/src/toolbar/ui.ts`**

Move the bodies verbatim from `titleBar.ts` (`svg` at :58, `iconButton` at :72, `menu` at :134), adding the `onOpenChange` hook:

```ts
/**
 * Shared plain-DOM toolbar primitives for CGridExt chrome: inline Lucide-path
 * SVG, the 30px icon button, and the click-away anchored popup. Extracted from
 * titleBar.ts so sibling toolbar modules (layoutsMenu) reuse them without an
 * import cycle. Styling comes from the title-bar stylesheet (`.cgext-iconbtn`,
 * `.cgext-menu*`) — callers must have called `injectTitleBarStyles()`.
 */

export function svg(path: string, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function iconButton(icon: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cgext-iconbtn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(icon);
  return b;
}

/** Simple click-away popup menu anchored under `anchor`. */
export function menu(
  anchor: HTMLElement,
  build: (close: () => void) => HTMLElement,
  onOpenChange?: (open: boolean) => void,
): { toggle: () => void; destroy: () => void } {
  let panel: HTMLElement | null = null;
  const close = () => {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener('pointerdown', onDoc, true);
    onOpenChange?.(false);
  };
  const onDoc = (e: PointerEvent) => {
    if (panel && !panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const open = () => {
    panel = build(close);
    panel.classList.add('cgext-menu');
    document.body.appendChild(panel);
    const r = anchor.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 4)}px`;
    // right-align to the anchor
    panel.style.left = `${Math.round(r.right - panel.offsetWidth)}px`;
    document.addEventListener('pointerdown', onDoc, true);
    onOpenChange?.(true);
  };
  return { toggle: () => (panel ? close() : open()), destroy: close };
}
```

- [ ] **Step 2: Update `titleBar.ts` to import the helpers**

Delete the `svg` (:58-60), `iconButton` (:72-80), and `menu` (:133-155) definitions from `titleBar.ts` and add at the top (below the existing type import):

```ts
import { menu, svg, iconButton } from './ui';
```

- [ ] **Step 3: Verify the refactor is invariant**

Run: `cd packages/ext && npx vitest run && npx tsc --noEmit`
Expected: full suite passes (13 test files), typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ext/src/toolbar/ui.ts packages/ext/src/toolbar/titleBar.ts
git commit -m "refactor(ext): extract svg/iconButton/menu toolbar primitives into toolbar/ui"
```

---

### Task 2: `layoutsMenu.ts` — trigger button + panel skeleton + test harness

The `layouts` toolbar item: `.cgext-profile`-chrome trigger showing the active layout name, opening an anchored panel with the `LAYOUTS` header, count badge, and (for now) an empty list container plus all injected CSS. Also the reusable `FakeGrid` test harness every later task's tests build on.

**Files:**
- Create: `packages/ext/src/toolbar/layoutsMenu.ts`
- Create: `packages/ext/tests/layoutsMenuHarness.ts`
- Test: `packages/ext/tests/layoutsMenu.test.ts`

**Interfaces:**
- Consumes: `menu`, `svg` from `./ui` (Task 1).
- Produces: `layoutsItem(): ToolbarItem` (id `'layouts'`, slot `'primary-right'`); `injectLayoutsMenuStyles(): void`; internal `buildPanel(ctx): { el: HTMLElement; refresh: () => void }`. Test harness exports `FakeGrid` (layout API + event emitter + `emit()`) and `mountItem(item, grid?)` → `{ host, grid, inst, ctx }`.
- DOM contract (E2E + later tasks rely on these hooks): trigger = `[data-item-id="layouts"] button.cgext-profile`; panel root = `.cgext-menu.cgext-layouts`; header count = `.cgext-layouts-count`; list = `.cgext-layouts-list`; error strip = `.cgext-layouts-error`.

- [ ] **Step 1: Write the test harness `packages/ext/tests/layoutsMenuHarness.ts`**

```ts
import { vi } from 'vitest';
import type { CgExtContext, ToolbarItem, ToolbarItemInstance } from '../src/extension/types';

export interface FakeLayout { id: string; name: string; state: Record<string, unknown> }

/** Structural stand-in for the kernel layout API + event emitter. Mutators
 *  emit `layoutChanged` exactly like the real CGrid so the UI's single
 *  re-sync path is exercised. */
export class FakeGrid {
  layouts: FakeLayout[] = [{ id: 'default', name: 'Default', state: {} }];
  activeId = 'default';
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => { this.listeners.get(type)!.delete(fn); };
  }
  emit(e: { type: string; [k: string]: unknown }): void {
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e);
  }
  private emitLayoutChanged(source: string): void {
    this.emit({ type: 'layoutChanged', activeLayoutId: this.activeId, source });
  }

  getGridOption = vi.fn((_key: string) => 'fake-grid');
  getLayouts() { return this.layouts.map((l) => ({ ...l })); }
  getActiveLayoutId() { return this.activeId; }
  getActiveLayout() { return { ...this.layouts.find((l) => l.id === this.activeId)! }; }

  loadLayout = vi.fn((id: string) => { this.mustGet(id); this.activeId = id; this.emitLayoutChanged('load'); });
  saveLayout = vi.fn((name: string) => {
    this.assertUnique(name);
    const l = { id: `id-${name}`, name, state: {} };
    this.layouts.push(l); this.activeId = l.id; this.emitLayoutChanged('save'); return { ...l };
  });
  updateLayout = vi.fn(() => { this.emitLayoutChanged('update'); return this.getActiveLayout(); });
  deleteLayout = vi.fn((id: string) => {
    if (id === 'default') throw new Error("the Default layout can't be deleted");
    this.layouts = this.layouts.filter((l) => l.id !== id);
    if (this.activeId === id) this.activeId = 'default';
    this.emitLayoutChanged('delete');
  });
  renameLayout = vi.fn((id: string, name: string) => {
    this.assertUnique(name);
    const l = this.mustGet(id); l.name = name; this.emitLayoutChanged('rename'); return { ...l };
  });
  duplicateLayout = vi.fn((id: string, name: string) => {
    this.assertUnique(name);
    const l = { id: `id-${name}`, name, state: { ...this.mustGet(id).state } };
    this.layouts.push(l); this.emitLayoutChanged('duplicate'); return { ...l };
  });
  exportLayout = vi.fn((id: string) => ({ ...this.mustGet(id) }));
  exportLayouts = vi.fn(() => ({ version: 1, activeLayoutId: this.activeId, layouts: this.getLayouts(), grid: {} }));
  importLayout = vi.fn((l: FakeLayout) => { this.layouts.push({ ...l }); this.emitLayoutChanged('import'); return { ...l }; });
  importLayouts = vi.fn((b: { layouts: FakeLayout[] }) => {
    for (const l of b.layouts) if (!this.layouts.some((x) => x.id === l.id)) this.layouts.push({ ...l });
    this.emitLayoutChanged('import');
  });

  private mustGet(id: string): FakeLayout {
    const l = this.layouts.find((x) => x.id === id);
    if (!l) throw new Error(`unknown layout: ${id}`);
    return l;
  }
  private assertUnique(name: string): void {
    const n = name.trim().toLowerCase();
    if (this.layouts.some((l) => l.name.trim().toLowerCase() === n)) {
      throw new Error(`a layout named '${name}' already exists`);
    }
  }
}

/** Mounts a toolbar item over a FakeGrid; caller must clean the DOM
 *  (tests use afterEach(() => { document.body.replaceChildren(); })). */
export function mountItem(item: ToolbarItem, grid = new FakeGrid()): {
  host: HTMLElement; grid: FakeGrid; inst: ToolbarItemInstance; ctx: CgExtContext;
} {
  const host = document.createElement('div');
  host.dataset.itemId = item.id;
  document.body.appendChild(host);
  const ctx = { grid } as unknown as CgExtContext;
  const inst = item.render(host, ctx);
  return { host, grid, inst, ctx };
}
```

- [ ] **Step 2: Write the failing tests (`packages/ext/tests/layoutsMenu.test.ts`)**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { layoutsItem } from '../src/toolbar/layoutsMenu';
import { FakeGrid, mountItem } from './layoutsMenuHarness';

afterEach(() => { document.body.replaceChildren(); });

const openPanel = (host: HTMLElement) => {
  host.querySelector<HTMLButtonElement>('button.cgext-profile')!.click();
  return document.querySelector<HTMLElement>('.cgext-menu.cgext-layouts')!;
};

describe('layouts trigger button', () => {
  it('shows the active layout name and re-labels on layoutChanged', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutsItem(), grid);
    const name = () => host.querySelector('.cgext-profile-name')!.textContent;
    expect(name()).toBe('Default');
    grid.loadLayout('l1');
    expect(name()).toBe('Layout 1');
  });

  it('opens/closes the panel and syncs aria-expanded', () => {
    const { host } = mountItem(layoutsItem());
    const btn = host.querySelector<HTMLButtonElement>('button.cgext-profile')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(document.querySelector('.cgext-menu.cgext-layouts')).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(document.querySelector('.cgext-menu.cgext-layouts')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the LAYOUTS header with a live count badge', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    expect(panel.querySelector('.cgext-layouts-head')!.textContent).toContain('LAYOUTS');
    expect(panel.querySelector('.cgext-layouts-count')!.textContent).toBe('2');
    grid.saveLayout('Layout 2');
    expect(panel.querySelector('.cgext-layouts-count')!.textContent).toBe('3');
  });

  it('destroy unsubscribes and clears the host', () => {
    const { host, grid, inst } = mountItem(layoutsItem());
    inst.destroy();
    expect(host.childElementCount).toBe(0);
    grid.emit({ type: 'layoutChanged', activeLayoutId: 'default', source: 'load' }); // must not throw
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: FAIL — `Cannot find module '../src/toolbar/layoutsMenu'`.

- [ ] **Step 4: Design gate before writing the CSS**

If the `frontend-design` skill is available in your session, invoke it now (panel = a dense professional dropdown: deliberate type scale 11/12/12.5px, 4/6/8px spacing rhythm, hover/active/focus/error states). The CSS in Step 5 is the reviewed baseline — refine values per its guidance but do NOT change class names, DOM structure, or `data-*` hooks (tests and E2E depend on them). Also open `docs/catalog/screenshots/` theming references if present.

- [ ] **Step 5: Implement the skeleton (`packages/ext/src/toolbar/layoutsMenu.ts`)**

```ts
/**
 * Layout management for the CGridExt title bar — a dropdown listing the
 * kernel's named Grid Layouts (switch / rename / duplicate / export /
 * delete / save-new / bundle import-export) plus a dirty-aware
 * "update active layout" disk button.
 *
 * All state lives in the kernel: every mutation goes through the public
 * layout API and the UI re-syncs from the `layoutChanged` event — the
 * panel re-renders its list, the trigger re-labels, the disk clears.
 * Kernel throws (duplicate name, bad import, newer bundle version) are
 * caught at this boundary and surfaced inline.
 */
import type { ToolbarItem, CgExtContext } from '../extension/types';
import { menu, svg, iconButton } from './ui';

/** Kernel layout surface this module drives — structural subset of CGridApi
 *  so the module stays testable against a stub. */
interface LayoutGridSurface {
  getGridOption(key: string): unknown;
  getLayouts(): { id: string; name: string }[];
  getActiveLayoutId(): string;
  getActiveLayout(): { id: string; name: string };
  loadLayout(id: string): unknown;
  saveLayout(name: string, opts?: { activate?: boolean }): unknown;
  updateLayout(id?: string): unknown;
  deleteLayout(id: string): void;
  renameLayout(id: string, name: string): unknown;
  duplicateLayout(id: string, name: string, opts?: { activate?: boolean }): unknown;
  exportLayout(id: string): unknown;
  exportLayouts(): unknown;
  importLayout(layout: unknown, opts?: { overwrite?: boolean; activate?: boolean }): unknown;
  importLayouts(bundle: unknown, opts?: { mode?: 'replace' | 'merge'; overwrite?: boolean }): void;
  addEventListener(type: string, fn: (e: never) => void): () => void;
}
const surface = (ctx: CgExtContext): LayoutGridSurface => ctx.grid as unknown as LayoutGridSurface;

const DEFAULT_ID = 'default';

const I = {
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── trigger + panel ────────────────────────────────────────────────────────

export function layoutsItem(): ToolbarItem {
  return {
    id: 'layouts', kind: 'toolbar-item', slot: 'primary-right',
    init() {},
    render(host, ctx) {
      injectLayoutsMenuStyles();
      const grid = surface(ctx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cgext-profile';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML =
        `<span class="cgext-profile-avatar">${svg(I.user, 13)}</span>` +
        `<span class="cgext-profile-name"></span>` +
        `<span class="cgext-profile-caret">${svg(I.chevronDown, 13)}</span>`;
      const nameEl = btn.querySelector('.cgext-profile-name')!;
      const paint = () => {
        let name = 'Default';
        try { name = grid.getActiveLayout().name; } catch { /* pre-init grid */ }
        nameEl.textContent = name;
        btn.title = `Layout: ${name}`;
      };
      paint();

      let refreshOpenPanel: (() => void) | null = null;
      const m = menu(
        btn,
        () => {
          const { el, refresh } = buildPanel(ctx);
          refreshOpenPanel = refresh;
          return el;
        },
        (open) => {
          btn.setAttribute('aria-expanded', String(open));
          if (!open) refreshOpenPanel = null;
        },
      );
      btn.addEventListener('click', () => m.toggle());

      const off = grid.addEventListener('layoutChanged', () => {
        paint();
        refreshOpenPanel?.();
      });

      host.appendChild(btn);
      return { destroy() { off(); m.destroy(); host.replaceChildren(); } };
    },
  };
}

/** The dropdown panel. `refresh` re-renders the list + count and hides the
 *  error strip; the save-new input is left alone so typing survives
 *  unrelated layout events. */
function buildPanel(ctx: CgExtContext): { el: HTMLElement; refresh: () => void } {
  const grid = surface(ctx);
  const el = document.createElement('div');
  el.className = 'cgext-layouts';
  el.innerHTML =
    `<div class="cgext-layouts-head"><span>LAYOUTS</span><span class="cgext-layouts-count"></span></div>` +
    `<div class="cgext-layouts-list" role="menu"></div>` +
    `<div class="cgext-layouts-error" hidden></div>`;
  const listEl = el.querySelector<HTMLElement>('.cgext-layouts-list')!;
  const countEl = el.querySelector<HTMLElement>('.cgext-layouts-count')!;
  const errorEl = el.querySelector<HTMLElement>('.cgext-layouts-error')!;

  const showError = (message: string) => { errorEl.textContent = message; errorEl.hidden = false; };
  const refresh = () => {
    errorEl.hidden = true;
    countEl.textContent = String(grid.getLayouts().length);
    listEl.replaceChildren(); // rows land in Task 3
    void showError; // referenced by Task 3/4 row + footer handlers
  };
  refresh();
  return { el, refresh };
}

// ── styles ─────────────────────────────────────────────────────────────────

export function injectLayoutsMenuStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cgext-layouts-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgext-layouts-styles';
  style.textContent = LAYOUTS_CSS;
  document.head.appendChild(style);
}

const LAYOUTS_CSS = `
.cgext-menu.cgext-layouts { width: 300px; padding: 0; }
.cgext-layouts-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px 8px;
  font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--cg-muted-fg-color, #9aa4b6);
  border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-layouts-count { font-weight: 500; font-variant-numeric: tabular-nums; }
.cgext-layouts-list {
  max-height: 320px; overflow-y: auto;
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
}
.cgext-layouts-row {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 7px; cursor: pointer;
  color: var(--cg-fg-color, #e5e9f0); font-size: 12.5px;
}
.cgext-layouts-row:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.06)); }
.cgext-layouts-row.is-active { background: color-mix(in srgb, var(--cg-accent-color, #4f9cf9) 14%, transparent); }
.cgext-layouts-row.is-active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
  border-radius: 2px; background: var(--cg-accent-color, #4f9cf9);
}
.cgext-layouts-mark { width: 16px; display: inline-flex; justify-content: center; color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--cg-muted-fg-color, #9aa4b6); opacity: 0.6; }
.cgext-layouts-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.cgext-layouts-actions { display: none; align-items: center; gap: 2px; }
.cgext-layouts-row:hover .cgext-layouts-actions,
.cgext-layouts-row.is-active .cgext-layouts-actions,
.cgext-layouts-row:focus-within .cgext-layouts-actions { display: inline-flex; }
.cgext-layouts-act {
  appearance: none; border: none; background: transparent;
  width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--cg-muted-fg-color, #9aa4b6); cursor: pointer;
}
.cgext-layouts-act:hover { background: var(--cg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--cg-fg-color, #e5e9f0); }
.cgext-layouts-act:focus-visible { outline: 2px solid var(--cg-accent-color, #4f9cf9); outline-offset: 1px; }
.cgext-layouts-lock { width: 24px; display: inline-flex; justify-content: center; color: var(--cg-muted-fg-color, #9aa4b6); opacity: 0.7; }
.cgext-layouts-rename {
  flex: 1 1 auto; min-width: 0; height: 26px; padding: 0 8px;
  border: 1px solid var(--cg-accent-color, #4f9cf9); border-radius: 6px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-layouts-rename:focus { outline: none; }
.cgext-layouts-rename.is-error, .cgext-layouts-new input.is-error { border-color: var(--cg-neg-color, #e2606c); }
.cgext-layouts-error { margin: 6px 12px 0; font-size: 12px; color: var(--cg-neg-color, #e2606c); }
.cgext-layouts-new {
  display: flex; gap: 6px; padding: 10px 12px;
  border-top: 1px solid var(--cg-border-color, #2a3140); margin-top: 6px;
}
.cgext-layouts-new input {
  flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 9px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(0,0,0,0.25));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.cgext-layouts-new input:focus { outline: none; border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-savenew {
  height: 28px; padding: 0 12px; white-space: nowrap;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.cgext-layouts-savenew:hover:not(:disabled) { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-savenew:disabled { opacity: 0.45; cursor: default; }
.cgext-layouts-foot { display: flex; gap: 8px; padding: 0 12px 12px; }
.cgext-layouts-foot button {
  flex: 1; height: 28px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--cg-border-color, #2a3140); border-radius: 7px;
  background: var(--cg-control-bg, rgba(255,255,255,0.04));
  color: var(--cg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.cgext-layouts-foot button:hover { border-color: var(--cg-accent-color, #4f9cf9); }
.cgext-layouts-foot button svg { color: var(--cg-muted-fg-color, #9aa4b6); }
`;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: 4 pass.

- [ ] **Step 7: Commit**

```bash
git add packages/ext/src/toolbar/layoutsMenu.ts packages/ext/tests/layoutsMenuHarness.ts packages/ext/tests/layoutsMenu.test.ts
git commit -m "feat(ext): layouts dropdown trigger + panel skeleton over the kernel layout API"
```

---

### Task 3: Layout list rows — switch, rename, duplicate, export, delete, Default lock

**Files:**
- Modify: `packages/ext/src/toolbar/layoutsMenu.ts`
- Test: `packages/ext/tests/layoutsMenu.test.ts` (append a describe block)

**Interfaces:**
- Consumes: Task 2's `buildPanel` internals (`listEl`, `showError`, `refresh`), `FakeGrid`/`mountItem`/`openPanel` from the harness.
- Produces: exported helpers `uniqueCopyName(base: string, existing: string[]): string` and `fileIO: { download(filename: string, data: unknown): void }` (test seam). DOM hooks: rows = `.cgext-layouts-row[data-layout-id]`, action buttons = `.cgext-layouts-act[data-act="rename"|"duplicate"|"export"|"delete"]`, Default lock = `.cgext-layouts-lock`, rename input = `input.cgext-layouts-rename`.

- [ ] **Step 1: Write the failing tests (append to `layoutsMenu.test.ts`)**

```ts
import { vi } from 'vitest';
import { uniqueCopyName, fileIO } from '../src/toolbar/layoutsMenu';

const twoLayouts = () => {
  const grid = new FakeGrid();
  grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
  grid.activeId = 'l1';
  return grid;
};
const row = (panel: HTMLElement, id: string) =>
  panel.querySelector<HTMLElement>(`.cgext-layouts-row[data-layout-id="${id}"]`)!;

describe('layout list', () => {
  it('renders one row per layout, marks the active row, dots the rest', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    expect(panel.querySelectorAll('.cgext-layouts-row')).toHaveLength(2);
    expect(row(panel, 'l1').classList.contains('is-active')).toBe(true);
    expect(row(panel, 'l1').querySelector('.cgext-layouts-mark svg')).toBeTruthy(); // check icon
    expect(row(panel, 'default').querySelector('.cgext-layouts-dot')).toBeTruthy();
    expect(row(panel, 'default').querySelector('.cgext-layouts-name')!.getAttribute('title')).toBe('Default');
  });

  it('locks Default (no rename/delete; duplicate/export present) and offers all four elsewhere', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    const acts = (id: string) =>
      [...row(panel, id).querySelectorAll<HTMLElement>('.cgext-layouts-act')].map((b) => b.dataset.act);
    expect(acts('default')).toEqual(['duplicate', 'export']);
    expect(row(panel, 'default').querySelector('.cgext-layouts-lock')).toBeTruthy();
    expect(acts('l1')).toEqual(['rename', 'duplicate', 'export', 'delete']);
    expect(row(panel, 'l1').querySelector('.cgext-layouts-lock')).toBeNull();
  });

  it('row click loads the layout; active marking and trigger follow', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'default').click();
    expect(grid.loadLayout).toHaveBeenCalledWith('default');
    expect(row(panel, 'default').classList.contains('is-active')).toBe(true);
    expect(host.querySelector('.cgext-profile-name')!.textContent).toBe('Default');
  });

  it('rename: Enter commits, Escape cancels, kernel throw shows inline error', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    const startRename = () =>
      row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="rename"]')!.click();
    const input = () => panel.querySelector<HTMLInputElement>('input.cgext-layouts-rename')!;

    startRename();
    input().value = 'Blotter';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.renameLayout).toHaveBeenCalledWith('l1', 'Blotter');
    expect(row(panel, 'l1').querySelector('.cgext-layouts-name')!.textContent).toBe('Blotter');

    startRename();
    input().value = 'Ignored';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.querySelector('input.cgext-layouts-rename')).toBeNull();
    expect(row(panel, 'l1').querySelector('.cgext-layouts-name')!.textContent).toBe('Blotter');

    startRename();
    input().value = 'Default'; // collides (case-insensitive in FakeGrid, like the kernel)
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input().classList.contains('is-error')).toBe(true); // stays open for correction
  });

  it('duplicate uniquifies: "copy", then "copy 2"', () => {
    expect(uniqueCopyName('Layout 1', ['Default', 'Layout 1'])).toBe('Layout 1 copy');
    expect(uniqueCopyName('Layout 1', ['Default', 'Layout 1', 'layout 1 COPY'])).toBe('Layout 1 copy 2');

    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="duplicate"]')!.click();
    expect(grid.duplicateLayout).toHaveBeenCalledWith('l1', 'Layout 1 copy');
    expect(panel.querySelectorAll('.cgext-layouts-row')).toHaveLength(3);
  });

  it('row export downloads the layout JSON with a slugged filename', () => {
    const dl = vi.spyOn(fileIO, 'download').mockImplementation(() => {});
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="export"]')!.click();
    expect(grid.exportLayout).toHaveBeenCalledWith('l1');
    expect(dl).toHaveBeenCalledWith('layout-1.cgrid-layout.json', expect.objectContaining({ id: 'l1' }));
    dl.mockRestore();
  });

  it('delete removes the row; deleting the active layout falls back to Default', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    expect(grid.deleteLayout).toHaveBeenCalledWith('l1');
    expect(panel.querySelectorAll('.cgext-layouts-row')).toHaveLength(1);
    expect(host.querySelector('.cgext-profile-name')!.textContent).toBe('Default');
  });
});
```

Also add the two new imports (`vi`, and `uniqueCopyName`/`fileIO`) to the existing import lines at the top of the file rather than duplicating import statements.

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: Task 2's 4 still pass; the 7 new tests FAIL (`uniqueCopyName` not exported / no rows rendered).

- [ ] **Step 3: Implement rows + helpers in `layoutsMenu.ts`**

Add the exported helpers (below `errText`):

```ts
/** "<base> copy", "<base> copy 2", … — first name not taken (kernel
 *  uniqueness is trimmed + case-insensitive; mirror it). */
export function uniqueCopyName(base: string, existing: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set(existing.map(norm));
  let candidate = `${base} copy`;
  for (let i = 2; taken.has(norm(candidate)); i++) candidate = `${base} copy ${i}`;
  return candidate;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'layout';
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/** Indirection so unit tests can intercept file downloads. */
export const fileIO = { download: downloadJson };
```

In `buildPanel`, replace the `refresh` body's `listEl.replaceChildren();` + `void showError;` lines with:

```ts
    const layouts = grid.getLayouts();
    const activeId = grid.getActiveLayoutId();
    listEl.replaceChildren(...layouts.map((l) => layoutRow(grid, l, l.id === activeId, layouts, showError)));
```

Add the row builder below `buildPanel`:

```ts
function layoutRow(
  grid: LayoutGridSurface,
  l: { id: string; name: string },
  active: boolean,
  layouts: { id: string; name: string }[],
  showError: (message: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cgext-layouts-row' + (active ? ' is-active' : '');
  row.dataset.layoutId = l.id;
  row.innerHTML =
    `<span class="cgext-layouts-mark">${active ? svg(I.check, 13) : '<i class="cgext-layouts-dot"></i>'}</span>` +
    `<span class="cgext-layouts-name"></span>` +
    `<span class="cgext-layouts-actions"></span>`;
  const nameEl = row.querySelector<HTMLElement>('.cgext-layouts-name')!;
  nameEl.textContent = l.name;                 // textContent + setAttribute — names are user input
  nameEl.setAttribute('title', l.name);

  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.cgext-layouts-actions, .cgext-layouts-rename')) return;
    if (l.id === grid.getActiveLayoutId()) return;
    try { grid.loadLayout(l.id); } catch (err) { showError(errText(err)); }
  });

  const actions = row.querySelector<HTMLElement>('.cgext-layouts-actions')!;
  const act = (kind: string, icon: string, label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cgext-layouts-act';
    b.dataset.act = kind;
    b.title = label;
    b.setAttribute('aria-label', `${label} layout '${l.name}'`);
    b.innerHTML = svg(icon, 13);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    actions.appendChild(b);
  };

  const locked = l.id === DEFAULT_ID;
  if (!locked) act('rename', I.pencil, 'Rename', () => startRename(grid, row, l));
  act('duplicate', I.copy, 'Duplicate', () => {
    try { grid.duplicateLayout(l.id, uniqueCopyName(l.name, layouts.map((x) => x.name))); }
    catch (err) { showError(errText(err)); }
  });
  act('export', I.download, 'Export', () => {
    try { fileIO.download(`${slug(l.name)}.cgrid-layout.json`, grid.exportLayout(l.id)); }
    catch (err) { showError(errText(err)); }
  });
  if (!locked) act('delete', I.trash, 'Delete', () => {
    try { grid.deleteLayout(l.id); } catch (err) { showError(errText(err)); }
  });
  else {
    const lock = document.createElement('span');
    lock.className = 'cgext-layouts-lock';
    lock.title = 'Built-in layout';
    lock.innerHTML = svg(I.lock, 13);
    actions.appendChild(lock);
  }
  return row;
}

/** Swap the name label for an inline rename input. Enter commits (success
 *  re-renders via layoutChanged; a kernel throw marks the input and keeps it
 *  open), Escape/blur cancels back to the label. */
function startRename(grid: LayoutGridSurface, row: HTMLElement, l: { id: string; name: string }): void {
  const nameEl = row.querySelector<HTMLElement>('.cgext-layouts-name')!;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cgext-layouts-rename';
  input.value = l.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const cancel = () => { if (!done) { done = true; input.replaceWith(nameEl); } };
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', cancel);
  input.addEventListener('input', () => { input.classList.remove('is-error'); input.title = ''; });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter') {
      try { grid.renameLayout(l.id, input.value); done = true; } // layoutChanged re-renders the list
      catch (err) { input.classList.add('is-error'); input.title = errText(err); }
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: 11 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/layoutsMenu.ts packages/ext/tests/layoutsMenu.test.ts
git commit -m "feat(ext): layouts panel rows — switch, inline rename, duplicate, export, delete, Default lock"
```

---

### Task 4: Save-new row + footer bundle export/import + error strip

**Files:**
- Modify: `packages/ext/src/toolbar/layoutsMenu.ts`
- Test: `packages/ext/tests/layoutsMenu.test.ts` (append a describe block)

**Interfaces:**
- Consumes: Task 2/3 panel internals, `fileIO`.
- Produces: exported `sniffImport(json: unknown): 'bundle' | 'layout' | null` and `handleImportText(grid, text: string, showError): void` (test seam — happy-dom lacks reliable `DataTransfer`). DOM hooks: `.cgext-layouts-new input`, `.cgext-layouts-savenew`, `.cgext-layouts-export`, `.cgext-layouts-import`, `.cgext-layouts-foot input[type=file]`.

- [ ] **Step 1: Write the failing tests (append to `layoutsMenu.test.ts`)**

```ts
import { sniffImport, handleImportText } from '../src/toolbar/layoutsMenu';

describe('save-new + import/export', () => {
  const newInput = (panel: HTMLElement) => panel.querySelector<HTMLInputElement>('.cgext-layouts-new input')!;
  const saveBtn = (panel: HTMLElement) => panel.querySelector<HTMLButtonElement>('.cgext-layouts-savenew')!;

  it('save-new: disabled while blank, Enter commits, clears on success, error inline on duplicate', () => {
    const grid = new FakeGrid();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    expect(saveBtn(panel).disabled).toBe(true);
    newInput(panel).value = 'Layout 1';
    newInput(panel).dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveBtn(panel).disabled).toBe(false);
    newInput(panel).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.saveLayout).toHaveBeenCalledWith('Layout 1');
    expect(newInput(panel).value).toBe('');
    expect(host.querySelector('.cgext-profile-name')!.textContent).toBe('Layout 1'); // kernel activates

    newInput(panel).value = 'layout 1'; // duplicate, case-insensitive
    newInput(panel).dispatchEvent(new Event('input', { bubbles: true }));
    saveBtn(panel).click();
    expect(newInput(panel).classList.contains('is-error')).toBe(true);
    expect(newInput(panel).value).toBe('layout 1'); // kept for correction
  });

  it('footer export downloads the full bundle named after the gridId', () => {
    const dl = vi.spyOn(fileIO, 'download').mockImplementation(() => {});
    const grid = new FakeGrid();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    panel.querySelector<HTMLButtonElement>('.cgext-layouts-export')!.click();
    expect(grid.exportLayouts).toHaveBeenCalled();
    expect(dl).toHaveBeenCalledWith('fake-grid-layouts.json', expect.objectContaining({ version: 1 }));
    dl.mockRestore();
  });

  it('sniffImport classifies bundle / single layout / garbage', () => {
    expect(sniffImport({ version: 1, layouts: [], activeLayoutId: 'default', grid: {} })).toBe('bundle');
    expect(sniffImport({ id: 'x', name: 'X', state: {} })).toBe('layout');
    expect(sniffImport({ hello: 'world' })).toBeNull();
    expect(sniffImport('nope')).toBeNull();
    expect(sniffImport(null)).toBeNull();
  });

  it('handleImportText routes bundle→importLayouts(merge), layout→importLayout, and reports errors inline', () => {
    const grid = new FakeGrid();
    const errors: string[] = [];
    const showError = (m: string) => errors.push(m);

    handleImportText(grid as never, JSON.stringify({ version: 1, activeLayoutId: 'default', layouts: [{ id: 'b1', name: 'B1', state: {} }], grid: {} }), showError);
    expect(grid.importLayouts).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), { mode: 'merge' });

    handleImportText(grid as never, JSON.stringify({ id: 's1', name: 'S1', state: {} }), showError);
    expect(grid.importLayout).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(errors).toHaveLength(0);

    handleImportText(grid as never, 'not json {', showError);
    handleImportText(grid as never, JSON.stringify({ nothing: true }), showError);
    grid.importLayouts.mockImplementationOnce(() => { throw new Error('bundle version 99 is newer'); });
    handleImportText(grid as never, JSON.stringify({ version: 99, activeLayoutId: 'default', layouts: [], grid: {} }), showError);
    expect(errors).toHaveLength(3);
    expect(errors[2]).toContain('newer');
  });

  it('a failed action shows the error strip; the next layout change clears it', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    grid.loadLayout.mockImplementationOnce(() => { throw new Error('boom'); });
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    panel.querySelector<HTMLElement>('.cgext-layouts-row[data-layout-id="l1"]')!.click();
    const strip = panel.querySelector<HTMLElement>('.cgext-layouts-error')!;
    expect(strip.hidden).toBe(false);
    expect(strip.textContent).toContain('boom');
    grid.saveLayout('Fresh');
    expect(strip.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: prior 11 pass; new 5 FAIL (`sniffImport` not exported / no `.cgext-layouts-new` in the panel).

- [ ] **Step 3: Implement in `layoutsMenu.ts`**

Exported helpers (below `fileIO`):

```ts
/** Shape-sniff parsed import JSON: a GridLayoutsBundle has a `layouts`
 *  array; a single GridLayout has string `id` + object `state`. */
export function sniffImport(json: unknown): 'bundle' | 'layout' | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.layouts)) return 'bundle';
  if (typeof o.id === 'string' && !!o.state && typeof o.state === 'object') return 'layout';
  return null;
}

/** Parse + route an imported file's text. Separated from the file-input
 *  handler so unit tests can drive it without DataTransfer support. */
export function handleImportText(
  grid: LayoutGridSurface,
  text: string,
  showError: (message: string) => void,
): void {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { showError('Import failed: the file is not valid JSON.'); return; }
  try {
    const kind = sniffImport(parsed);
    if (kind === 'bundle') grid.importLayouts(parsed, { mode: 'merge' });
    else if (kind === 'layout') grid.importLayout(parsed);
    else showError('Import failed: not a cgrid layout or layouts bundle.');
  } catch (err) { showError(`Import failed: ${errText(err)}`); }
}
```

In `buildPanel`, extend `el.innerHTML` (after the error-strip div):

```ts
    `<div class="cgext-layouts-new">` +
      `<input type="text" placeholder="New layout name" aria-label="New layout name" />` +
      `<button type="button" class="cgext-layouts-savenew" disabled>+ Save</button>` +
    `</div>` +
    `<div class="cgext-layouts-foot">` +
      `<button type="button" class="cgext-layouts-export">${svg(I.download, 14)}<span>Export</span></button>` +
      `<button type="button" class="cgext-layouts-import">${svg(I.upload, 14)}<span>Import</span></button>` +
      `<input type="file" accept="application/json,.json" hidden />` +
    `</div>`;
```

And wire them (after `refresh();`, before `return`):

```ts
  const newInput = el.querySelector<HTMLInputElement>('.cgext-layouts-new input')!;
  const saveNewBtn = el.querySelector<HTMLButtonElement>('.cgext-layouts-savenew')!;
  newInput.addEventListener('input', () => {
    newInput.classList.remove('is-error');
    newInput.title = '';
    saveNewBtn.disabled = !newInput.value.trim();
  });
  const commitNew = () => {
    const name = newInput.value.trim();
    if (!name) return;
    try {
      grid.saveLayout(name);            // activates by default; layoutChanged refreshes
      newInput.value = '';
      saveNewBtn.disabled = true;
    } catch (err) {
      newInput.classList.add('is-error');
      newInput.title = errText(err);
    }
  };
  saveNewBtn.addEventListener('click', commitNew);
  newInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commitNew(); });

  el.querySelector<HTMLButtonElement>('.cgext-layouts-export')!.addEventListener('click', () => {
    try {
      let gid = 'grid';
      try { gid = String(grid.getGridOption('gridId') || 'grid'); } catch { /* keep fallback */ }
      fileIO.download(`${slug(gid)}-layouts.json`, grid.exportLayouts());
    } catch (err) { showError(errText(err)); }
  });
  const fileInput = el.querySelector<HTMLInputElement>('.cgext-layouts-foot input[type=file]')!;
  el.querySelector<HTMLButtonElement>('.cgext-layouts-import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    void file.text().then(
      (text) => handleImportText(grid, text, showError),
      () => showError('Import failed: the file could not be read.'),
    );
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: 16 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ext/src/toolbar/layoutsMenu.ts packages/ext/tests/layoutsMenu.test.ts
git commit -m "feat(ext): layouts panel save-new row + bundle export/import with inline errors"
```

---

### Task 5: `layout-save` disk item with source-based dirty tracking

The dirty rule uses the kernel `stateUpdated` payload's `source` discriminator instead of the spec's provisional timing window — cleaner and race-free:
- `stateUpdated` with `source: 'ui'` (user interaction, runtime option swap, drag) → **dirty**, UNLESS `changedKeys` is non-empty and contains only `'layouts'` (that's the echo of a layout mutation, not a view change).
- `stateUpdated` with `source: 'api' | 'init'` (a `setState` — e.g. `loadLayout`'s apply or the persistence restore) → **ignored**.
- `layoutChanged` (any source: save/update/load/restore/…) → **clean**.

This task also amends spec §5 to record the final rule.

**Files:**
- Modify: `packages/ext/src/toolbar/layoutsMenu.ts`
- Modify: `docs/superpowers/specs/2026-07-07-ext-layouts-toolbar-design.md` (§5, second bullet)
- Test: `packages/ext/tests/layoutsMenu.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `iconButton` from `./ui`, `I.save`, `surface()`.
- Produces: `layoutSaveItem(): ToolbarItem` (id `'layout-save'`, slot `'primary-right'`). DOM: `[data-item-id="layout-save"] button.cgext-save`, dirty = class `is-dirty` + enabled.

- [ ] **Step 1: Write the failing tests (append to `layoutsMenu.test.ts`)**

```ts
import { layoutSaveItem } from '../src/toolbar/layoutsMenu';

describe('layout-save disk', () => {
  const stateUpdated = (source: string, changedKeys: string[]) =>
    ({ type: 'stateUpdated', state: {}, changedKeys, source });

  it('starts clean/disabled; a ui state change dirties it; click updates the active layout and cleans', () => {
    const grid = new FakeGrid();
    const { host } = mountItem(layoutSaveItem(), grid);
    const btn = host.querySelector<HTMLButtonElement>('button.cgext-save')!;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('is-dirty')).toBe(false);

    grid.emit(stateUpdated('ui', ['columnState']));
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('is-dirty')).toBe(true);
    expect(btn.title).toContain('Default');

    btn.click();
    expect(grid.updateLayout).toHaveBeenCalled();
    expect(btn.disabled).toBe(true); // updateLayout emitted layoutChanged → clean
  });

  it("ignores non-'ui' sources and layouts-only echoes; loading a layout never re-dirties", () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutSaveItem(), grid);
    const btn = host.querySelector<HTMLButtonElement>('button.cgext-save')!;

    grid.emit(stateUpdated('init', ['columnState']));       // constructor initialState
    grid.emit(stateUpdated('api', ['columnState', 'sort'])); // setState (restore / loadLayout apply)
    grid.emit(stateUpdated('ui', ['layouts']));              // layout-mutation echo
    expect(btn.disabled).toBe(true);

    grid.emit(stateUpdated('ui', ['columnState']));
    expect(btn.disabled).toBe(false);

    // realistic loadLayout order: layoutChanged first, then the applied state's stateUpdated('api')
    grid.loadLayout('l1');
    grid.emit(stateUpdated('api', ['columnState', 'filter']));
    expect(btn.disabled).toBe(true); // clean after a load, despite the state echo
  });

  it('destroy unsubscribes both listeners', () => {
    const grid = new FakeGrid();
    const { host, inst } = mountItem(layoutSaveItem(), grid);
    inst.destroy();
    expect(host.childElementCount).toBe(0);
    grid.emit(stateUpdated('ui', ['columnState'])); // must not throw
    grid.emit({ type: 'layoutChanged', activeLayoutId: 'default', source: 'update' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: prior 16 pass; new 3 FAIL (`layoutSaveItem` not exported).

- [ ] **Step 3: Implement `layoutSaveItem` in `layoutsMenu.ts`**

```ts
/** Dirty-aware "fold my current view into the active layout" disk. Dirty is
 *  a UI-local flag: the kernel has no per-layout dirty signal, but its
 *  `stateUpdated.source` discriminator separates user-driven view changes
 *  ('ui') from programmatic applies ('api'/'init' — loadLayout, persistence
 *  restore), and layout-mutation echoes report `changedKeys: ['layouts']`.
 *  Any `layoutChanged` (save/update/load/restore/…) means view === layout
 *  again, so it clears. Note kernel `persistState` autosaves continuously
 *  regardless — this button is about the layout, not storage. */
export function layoutSaveItem(): ToolbarItem {
  return {
    id: 'layout-save', kind: 'toolbar-item', slot: 'primary-right',
    init() {},
    render(host, ctx) {
      const grid = surface(ctx);
      const btn = iconButton(I.save, 'Layout up to date');
      btn.classList.add('cgext-save');
      let dirty = false;
      const sync = () => {
        btn.classList.toggle('is-dirty', dirty);
        btn.disabled = !dirty;
        let name = 'Default';
        try { name = grid.getActiveLayout().name; } catch { /* pre-init grid */ }
        btn.title = dirty ? `Update layout '${name}' (unsaved view changes)` : 'Layout up to date';
      };
      sync();
      const offState = grid.addEventListener('stateUpdated', (e: never) => {
        const ev = e as { source: string; changedKeys: string[] };
        if (ev.source !== 'ui') return;
        if (ev.changedKeys.length > 0 && ev.changedKeys.every((k) => k === 'layouts')) return;
        if (!dirty) { dirty = true; sync(); }
      });
      const offLayout = grid.addEventListener('layoutChanged', () => { dirty = false; sync(); });
      btn.addEventListener('click', () => {
        try { grid.updateLayout(); } catch { /* nothing user-fixable; stays dirty */ }
      });
      host.appendChild(btn);
      return { destroy() { offState(); offLayout(); host.replaceChildren(); } };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ext && npx vitest run tests/layoutsMenu.test.ts`
Expected: 19 pass.

- [ ] **Step 5: Amend spec §5 to record the final dirty rule**

In `docs/superpowers/specs/2026-07-07-ext-layouts-toolbar-design.md`, replace the second bullet of §5 (the one beginning "… **except** state echoes of a layout operation:" and describing the macrotask/animation-frame suppression window) with:

```markdown
- … **except** programmatic applies and layout-op echoes, distinguished by the
  event payload itself (no timing window needed): `stateUpdated` is ignored
  when `source` is `'api'`/`'init'` (a `setState` — `loadLayout`'s apply, the
  persistence restore, construction) or when `changedKeys` is non-empty and
  contains only the virtual `'layouts'` key (the echo of a layout mutation).
  Only `source: 'ui'` view changes dirty the disk. Every `layoutChanged`
  clears dirty.
```

- [ ] **Step 6: Commit**

```bash
git add packages/ext/src/toolbar/layoutsMenu.ts packages/ext/tests/layoutsMenu.test.ts docs/superpowers/specs/2026-07-07-ext-layouts-toolbar-design.md
git commit -m "feat(ext): dirty-aware layout-save disk — source-discriminated stateUpdated dirty rule"
```

---

### Task 6: Wire into `titleBarExtensions`, retire the Wave-0 items, update the spine E2E

**Files:**
- Modify: `packages/ext/src/toolbar/titleBar.ts`
- Modify: `apps/cgrid-ext-demo/e2e/spine.spec.ts`

**Interfaces:**
- Consumes: `layoutsItem`, `layoutSaveItem` from `./layoutsMenu`.
- Produces: `titleBarExtensions()` now returns items with ids `brand, search, notifications, layouts, layout-save, date, settings-launcher, overflow` (the ids `profiles` and `save` no longer appear in the title-bar set; the default bundle's separate `save` item is untouched). Public export surface of `@cgrid/ext` is unchanged.

- [ ] **Step 1: Swap the items in `titleBar.ts`**

Add the import:

```ts
import { layoutsItem, layoutSaveItem } from './layoutsMenu';
```

In `titleBarExtensions()` replace the two lines `profilesItem(),` / `saveItem(),` with:

```ts
    layoutsItem(),
    layoutSaveItem(),
```

Delete the entire `profilesItem()` function (:157-193) and `saveItem()` function (:195-210). Delete the now-unused `user`, `chevronDown`, and `save` entries from `ICON` (layoutsMenu owns its own copies). Keep ALL CSS — `.cgext-profile*` styles the new trigger and `.cgext-save.is-dirty` styles the new disk. Update the file's doc header (line ~5): "profile selector, dirty-aware save" → "layout switcher, dirty-aware layout-update save".

- [ ] **Step 2: Verify no dangling references**

Run: `cd packages/ext && grep -rn "profilesItem\|saveItem" src/ ; npx tsc --noEmit`
Expected: grep finds nothing; typecheck clean. (`ProfilesController`, `ctx.profiles`, and the default bundle's own `save` item intentionally remain — `ribbon.ts`/`gridOptions.ts` still call `ctx.profiles.markDirty()`, which is now UI-inert but keeps the Wave-0 controller contract alive for the future profiles wave.)

- [ ] **Step 3: Run the full ext unit suite**

Run: `cd packages/ext && npx vitest run`
Expected: all files pass (no unit test references the removed items — verified: `shell.test.ts`/`registry.test.ts` use synthetic items).

- [ ] **Step 4: Update `apps/cgrid-ext-demo/e2e/spine.spec.ts`**

In the first test, replace the final assertion block

```ts
  // Save button becomes enabled (profile marked dirty by the change).
  await expect(page.locator('[data-item-id="save"] button')).toBeEnabled();
```

with:

```ts
  // The layout-save disk becomes enabled (rowHeight is a 'ui'-source state
  // change, so the active layout is now dirty).
  await expect(page.locator('[data-item-id="layout-save"] button')).toBeEnabled();
```

- [ ] **Step 5: Run the spine E2E to verify the swap end-to-end**

Run: `cd apps/cgrid-ext-demo && npx playwright test e2e/spine.spec.ts`
Expected: PASS (both tests). If a stale dev server occupies :5188, kill it first (`lsof -ti :5188 | xargs kill`).

- [ ] **Step 6: Commit**

```bash
git add packages/ext/src/toolbar/titleBar.ts apps/cgrid-ext-demo/e2e/spine.spec.ts
git commit -m "feat(ext): title bar swaps Wave-0 profiles/save for the layouts dropdown + layout-save disk"
```

---

### Task 7: E2E — layouts toolbar in the ext demo

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/layoutsToolbar.spec.ts` (camelCase matches `iconRibbon.spec.ts`)

**Interfaces:**
- Consumes: the demo's `window.__ext` handle (`CGridExt`; `__ext.grid` = kernel), `persistState: true` under `gridId: 'ext-demo'`, and Task 2-6's DOM hooks.

- [ ] **Step 1: Write the E2E spec**

```ts
import { test, expect, type Page } from '@playwright/test';

// Layouts toolbar E2E — drives the title-bar dropdown against the real
// kernel layout engine with persistState on. Each test boots storage-clean:
// goto → clear localStorage → reload (an addInitScript clear would also wipe
// storage on in-test reloads, breaking the persistence test).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
});

const trigger = (page: Page) => page.locator('[data-item-id="layouts"] button.cgext-profile');
const panel = (page: Page) => page.locator('.cgext-menu.cgext-layouts');
const row = (page: Page, id: string) => panel(page).locator(`.cgext-layouts-row[data-layout-id="${id}"]`);
const disk = (page: Page) => page.locator('[data-item-id="layout-save"] button');

async function saveNewLayout(page: Page, name: string): Promise<void> {
  await panel(page).locator('.cgext-layouts-new input').fill(name);
  await panel(page).locator('.cgext-layouts-savenew').click();
  await expect(trigger(page)).toContainText(name);
}

/** The saved-layout row's kernel-minted id (the non-default active row). */
async function activeLayoutId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__ext.grid.getActiveLayoutId());
}

test('save new layout; ui change dirties the disk; update + switch round-trips the view', async ({ page }) => {
  const baseRowHeight = await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'));

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('1');
  await saveNewLayout(page, 'Layout 1');
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
  const l1 = await activeLayoutId(page);
  await expect(row(page, l1)).toHaveClass(/is-active/);

  // A runtime option swap is a 'ui'-source stateUpdated → disk dirties.
  await expect(disk(page)).toBeDisabled();
  await page.evaluate(() => (window as any).__ext.grid.setGridOption('rowHeight', 44));
  await expect(disk(page)).toBeEnabled();
  await disk(page).click(); // outside the panel — also closes it
  await expect(disk(page)).toBeDisabled();

  // Switch to Default → baseline height; back → the layout's 44 returns.
  await trigger(page).click();
  await row(page, 'default').click();
  expect(await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'))).toBe(baseRowHeight);
  await expect(disk(page)).toBeDisabled(); // loadLayout's state apply must not re-dirty
  await row(page, l1).click();
  expect(await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'))).toBe(44);
  await expect(trigger(page)).toContainText('Layout 1');
});

test('rename, duplicate, delete; Default is locked', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Alpha');
  const alpha = await activeLayoutId(page);

  // Rename the active row (actions are always visible on it).
  await row(page, alpha).locator('[data-act="rename"]').click();
  const rename = panel(page).locator('input.cgext-layouts-rename');
  await rename.fill('Beta');
  await rename.press('Enter');
  await expect(row(page, alpha).locator('.cgext-layouts-name')).toHaveText('Beta');
  await expect(trigger(page)).toContainText('Beta');

  // Duplicate → "Beta copy" appears, NOT active (kernel duplicate doesn't activate).
  await row(page, alpha).locator('[data-act="duplicate"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('3');
  const copyRow = panel(page).locator('.cgext-layouts-row', { hasText: 'Beta copy' });
  await expect(copyRow).toBeVisible();
  await expect(copyRow).not.toHaveClass(/is-active/);
  await expect(trigger(page)).toContainText('Beta');

  // Delete the copy (hover reveals its actions).
  await copyRow.hover();
  await copyRow.locator('[data-act="delete"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');

  // Default: locked — no rename/delete, lock badge present.
  await row(page, 'default').hover();
  await expect(row(page, 'default').locator('.cgext-layouts-lock')).toBeVisible();
  await expect(row(page, 'default').locator('[data-act="rename"]')).toHaveCount(0);
  await expect(row(page, 'default').locator('[data-act="delete"]')).toHaveCount(0);
});

test('bundle export → delete → import restores the layout', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Keeper');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).locator('.cgext-layouts-export').click(),
  ]);
  // 'ext-demo-layouts.json' when getGridOption('gridId') resolves; the
  // 'grid-layouts.json' fallback is also acceptable — assert the stable suffix.
  expect(download.suggestedFilename()).toMatch(/-layouts\.json$/);
  const bundlePath = await download.path();

  const keeper = await activeLayoutId(page);
  await row(page, keeper).locator('[data-act="delete"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('1');

  await panel(page).locator('.cgext-layouts-foot input[type=file]').setInputFiles(bundlePath!);
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
  await expect(panel(page).locator('.cgext-layouts-row', { hasText: 'Keeper' })).toBeVisible();
});

test('layouts persist across reload', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Persist');
  // Kernel autosave is debounced — wait for the blob to actually carry the layout.
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('Persist')));
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await expect(trigger(page)).toContainText('Persist'); // layoutChanged 'restore' repainted the trigger
  await trigger(page).click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
});
```

- [ ] **Step 2: Run the new E2E spec**

Run: `cd apps/cgrid-ext-demo && npx playwright test e2e/layoutsToolbar.spec.ts`
Expected: 4 pass. Debug notes if not: kill stale :5188 servers first (Playwright's `reuseExistingServer` latches onto them); no kernel rebuild is needed (this feature touches only `@cgrid/ext`, which is source-direct) — but if the demo behaves as if the feature is missing, clear `node_modules/.vite` and restart.

- [ ] **Step 3: Run the FULL demo E2E suite (done-gate)**

Run: `cd apps/cgrid-ext-demo && npx playwright test`
Expected: all specs pass (spine, iconRibbon, layoutsToolbar).

- [ ] **Step 4: Kill the automation browser and dev server**

Run: `pkill -f "chromium.*--remote-debugging" ; lsof -ti :5188 | xargs -r kill`
(Playwright normally cleans up after itself; this guards leftovers — a standing requirement.)

- [ ] **Step 5: Commit**

```bash
git add apps/cgrid-ext-demo/e2e/layoutsToolbar.spec.ts
git commit -m "test(e2e): layouts toolbar — save/switch round-trip, row actions, bundle round-trip, reload persistence"
```

---

## Batch closeout (after all 7 tasks)

Per the standing batch-review rule: ONE closeout review over Tasks 1-7 together + a single fix wave — no per-task reviewers. Verification before claiming done: `cd packages/ext && npx vitest run && npx tsc --noEmit`, then the full demo E2E run, then a manual browser pass of the panel in light AND dark theme (open the demo, flip the overflow-menu Dark theme toggle, eyeball the panel) — kill the browser after.
