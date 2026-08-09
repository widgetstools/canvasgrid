/**
 * Layout management for the VelocityGridExt title bar — a dropdown listing the
 * kernel's named Grid Layouts (switch / rename / duplicate / per-layout export /
 * delete / save-new) plus footer full-config Export/Import (same shape as
 * `VelocityGridExt.getConfig` / `loadConfig`; Import also accepts a layouts
 * bundle or a single layout) and a dirty-aware "update active layout" disk.
 *
 * All state lives in the kernel: every mutation goes through the public
 * layout API and the UI re-syncs from the `layoutChanged` event — the
 * panel re-renders its list, the trigger re-labels, the disk clears.
 * Kernel throws (duplicate name, bad import, newer bundle version) are
 * caught at this boundary and surfaced inline.
 */
import type { ToolbarItem, VelocityGridExtContext } from '../extension/types';
import type {
  VelocityGridEvent as VelocityGridExtGridEvent,
  GridState,
} from '@wellsfargo-starui/velocity-grid';
import { menu, svg, iconButton } from './ui';
import { saveConfigToLocalStorage } from '../configStorage';

/** Kernel layout surface this module drives — structural subset of VelocityGridApi
 *  so the module stays testable against a stub. Exported (but NOT re-exported
 *  from the package's public `index.ts`) purely so the unit test file can
 *  assert `VelocityGridApi` structurally satisfies it — a kernel layout-API rename
 *  then fails typecheck instead of surfacing only at E2E time. */
export interface LayoutGridSurface {
  getGridOption(key: string): unknown;
  getState(): GridState;
  setState(state: GridState, opts?: { exhaustive?: boolean }): void;
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
  addEventListener<K extends VelocityGridExtGridEvent['type']>(
    type: K,
    fn: (event: Extract<VelocityGridExtGridEvent, { type: K }>) => void,
  ): () => void;
}
const surface = (ctx: VelocityGridExtContext): LayoutGridSurface => ctx.grid as unknown as LayoutGridSurface;

const DEFAULT_ID = 'default';

const I = {
  /** Layout / view lens — distinct from the profiles user avatar. */
  layout: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
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

/** "<base> copy", "<base> copy 2", … — first name not taken (kernel
 *  uniqueness is trimmed + case-insensitive; mirror it). */
export function uniqueCopyName(base: string, existing: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set(existing.map(norm));
  let candidate = `${base} copy`;
  for (let i = 2; taken.has(norm(candidate)); i++) candidate = `${base} copy ${i}`;
  return candidate;
}

/** Dirty-aware save disk: fold the view into the active layout, then
 *  persist the full grid config (view + layouts) through ConfigSession
 *  (`velocity-grid:instance:<gridId>`). Requires a construction `gridId`. */
export function layoutSaveItem(): ToolbarItem {
  return {
    id: 'layout-save', kind: 'toolbar-item', slot: 'primary-right',
    init() {},
    render(host, ctx) {
      const grid = surface(ctx);
      const btn = iconButton(I.save, 'Config up to date');
      btn.classList.add('vgext-save');
      let dirty = false;
      const sync = () => {
        btn.classList.toggle('is-dirty', dirty);
        btn.disabled = !dirty;
        let name = 'Default';
        try { name = grid.getActiveLayout().name; } catch { /* pre-init grid */ }
        btn.title = dirty
          ? `Save layout '${name}' + grid config`
          : 'Config up to date';
      };
      sync();
      const offState = grid.addEventListener('stateUpdated', (e) => {
        const ev = e as unknown as { source: string; changedKeys: string[] };
        if (ev.source !== 'ui') return;
        // KNOWN LIMITATION (accepted, cosmetic): rAF frame-coalescing can
        // bundle 'layouts' with another changedKey landing in the same
        // frame as a layout op (e.g. importLayouts merge with unknown
        // templates → saveTemplate → templatesChanged → 'modules' coalesces
        // with 'layouts'), so this every()-check misses and the disk
        // re-dirties even though updateLayout already captured the change.
        // Disk writes are idempotent, so the worst case is one harmless
        // extra click — not worth the added complexity to fix here.
        if (ev.changedKeys.length > 0 && ev.changedKeys.every((k) => k === 'layouts')) return;
        if (!dirty) { dirty = true; sync(); }
      });
      const offLayout = grid.addEventListener('layoutChanged', () => { dirty = false; sync(); });
      btn.addEventListener('click', () => {
        try {
          grid.updateLayout();
          const gid = String(grid.getGridOption('gridId') ?? '');
          if (!gid) {
            console.warn('[cgext] layout-save: set options.gridId to persist config via ConfigSession');
          } else {
            saveConfigToLocalStorage(gid, captureGridConfig(grid));
          }
        } catch (err) {
          console.warn('[cgext] save failed:', err);
          /* stays dirty so the user can retry */
          return;
        }
      });
      host.appendChild(btn);
      return { destroy() { offState(); offLayout(); host.replaceChildren(); } };
    },
  };
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

/** Full workspace blob — same shape as `VelocityGridExt.getConfig()`. */
export function captureGridConfig(grid: LayoutGridSurface): GridState & { layouts: unknown } {
  return {
    ...grid.getState(),
    layouts: grid.exportLayouts(),
  };
}

/** Restore a `captureGridConfig` / `getConfig` blob (layouts replace + view). */
export function applyGridConfig(
  grid: LayoutGridSurface,
  config: GridState & { layouts?: unknown },
): void {
  const { layouts, ...viewState } = config;
  if (layouts && typeof layouts === 'object' && !Array.isArray(layouts)) {
    grid.importLayouts(layouts, { mode: 'replace', overwrite: true });
  }
  grid.setState(viewState as GridState, { exhaustive: true });
}

/** Shape-sniff parsed import JSON:
 *  - `config` — full workspace (`getConfig` / footer Export): nested layouts bundle
 *  - `bundle` — layouts-only (`exportLayouts`): top-level `layouts` array
 *  - `layout` — single layout (`exportLayout`): `id` + `state` */
export function sniffImport(json: unknown): 'config' | 'bundle' | 'layout' | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.layouts && typeof o.layouts === 'object' && !Array.isArray(o.layouts)) {
    const nested = o.layouts as Record<string, unknown>;
    if (Array.isArray(nested.layouts)) return 'config';
  }
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
    if (kind === 'config') applyGridConfig(grid, parsed as GridState & { layouts?: unknown });
    else if (kind === 'bundle') grid.importLayouts(parsed, { mode: 'merge' });
    else if (kind === 'layout') grid.importLayout(parsed);
    else showError('Import failed: not a grid config, layouts bundle, or layout.');
  } catch (err) { showError(`Import failed: ${errText(err)}`); }
}

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
      btn.className = 'vgext-pill vgext-layouts-trigger';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML =
        `<span class="vgext-pill-icon">${svg(I.layout, 13)}</span>` +
        `<span class="vgext-pill-name"></span>` +
        `<span class="vgext-pill-caret">${svg(I.chevronDown, 13)}</span>`;
      const nameEl = btn.querySelector('.vgext-pill-name')!;
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
        (close) => {
          const { el, refresh } = buildPanel(ctx, close);
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
 *  unrelated layout events. `close` is the `menu()`-supplied click-away
 *  closer — wired to Escape here so the panel is keyboard-dismissable too;
 *  the rename/save-new inputs stop keydown propagation for their OWN Escape
 *  (cancel-rename) / Enter (commit) handling, so this listener only ever
 *  sees Escape bubbling from the list rows or the panel chrome. */
function buildPanel(ctx: VelocityGridExtContext, close: () => void): { el: HTMLElement; refresh: () => void } {
  const grid = surface(ctx);
  const el = document.createElement('div');
  el.className = 'vgext-layouts';
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  el.innerHTML =
    `<div class="vgext-layouts-head"><span>LAYOUTS</span><span class="vgext-layouts-count"></span></div>` +
    `<div class="vgext-layouts-list" role="menu"></div>` +
    `<div class="vgext-layouts-error" hidden></div>` +
    `<div class="vgext-layouts-new">` +
      `<input type="text" placeholder="New layout name" aria-label="New layout name" />` +
      `<button type="button" class="vgext-layouts-savenew" disabled>+ Save</button>` +
    `</div>` +
    `<div class="vgext-layouts-foot">` +
      `<button type="button" class="vgext-layouts-export" title="Export full grid config (view + all layouts)">${svg(I.download, 14)}<span>Export</span></button>` +
      `<button type="button" class="vgext-layouts-import" title="Import full config, layouts bundle, or a single layout">${svg(I.upload, 14)}<span>Import</span></button>` +
      `<input type="file" accept="application/json,.json" hidden />` +
    `</div>`;
  const listEl = el.querySelector<HTMLElement>('.vgext-layouts-list')!;
  const countEl = el.querySelector<HTMLElement>('.vgext-layouts-count')!;
  const errorEl = el.querySelector<HTMLElement>('.vgext-layouts-error')!;

  const showError = (message: string) => { errorEl.textContent = message; errorEl.hidden = false; };
  const refresh = () => {
    errorEl.hidden = true;
    const layouts = grid.getLayouts();
    const activeId = grid.getActiveLayoutId();
    countEl.textContent = String(layouts.length);
    listEl.replaceChildren(...layouts.map((l) => layoutRow(grid, l, l.id === activeId, layouts, showError, close)));
  };
  refresh();

  const newInput = el.querySelector<HTMLInputElement>('.vgext-layouts-new input')!;
  const saveNewBtn = el.querySelector<HTMLButtonElement>('.vgext-layouts-savenew')!;
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

  el.querySelector<HTMLButtonElement>('.vgext-layouts-export')!.addEventListener('click', () => {
    try {
      let gid = 'grid';
      try { gid = String(grid.getGridOption('gridId') || 'grid'); } catch { /* keep fallback */ }
      fileIO.download(`${slug(gid)}-config.json`, captureGridConfig(grid));
    } catch (err) { showError(errText(err)); }
  });
  const fileInput = el.querySelector<HTMLInputElement>('.vgext-layouts-foot input[type=file]')!;
  el.querySelector<HTMLButtonElement>('.vgext-layouts-import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    void file.text().then(
      (text) => handleImportText(grid, text, showError),
      () => showError('Import failed: the file could not be read.'),
    );
  });

  return { el, refresh };
}

function layoutRow(
  grid: LayoutGridSurface,
  l: { id: string; name: string },
  active: boolean,
  layouts: { id: string; name: string }[],
  showError: (message: string) => void,
  close: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vgext-layouts-row' + (active ? ' is-active' : '');
  row.dataset.layoutId = l.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'menuitem');
  row.innerHTML =
    `<span class="vgext-layouts-mark">${active ? svg(I.check, 13) : '<i class="vgext-layouts-dot"></i>'}</span>` +
    `<span class="vgext-layouts-name"></span>` +
    `<span class="vgext-layouts-actions"></span>`;
  const nameEl = row.querySelector<HTMLElement>('.vgext-layouts-name')!;
  nameEl.textContent = l.name;                 // textContent + setAttribute — names are user input
  nameEl.setAttribute('title', l.name);

  // Selecting a layout is a dismissal gesture (like a native select): load
  // it and close the panel. Clicking the already-active row just closes; a
  // failed load keeps the panel open so the error strip stays readable.
  const activateRow = () => {
    if (l.id !== grid.getActiveLayoutId()) {
      try { grid.loadLayout(l.id); } catch (err) { showError(errText(err)); return; }
    }
    close();
  };
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.vgext-layouts-actions, .vgext-layouts-rename')) return;
    activateRow();
  });
  // Enter/Space activates the row exactly like a click (keyboard parity —
  // the action-cluster buttons/rename input handle their own Enter/Space
  // natively and are excluded the same way the click handler excludes them).
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('.vgext-layouts-actions, .vgext-layouts-rename')) return;
    e.preventDefault();
    activateRow();
  });

  const actions = row.querySelector<HTMLElement>('.vgext-layouts-actions')!;
  const act = (kind: string, icon: string, label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vgext-layouts-act';
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
    lock.className = 'vgext-layouts-lock';
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
  const nameEl = row.querySelector<HTMLElement>('.vgext-layouts-name')!;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'vgext-layouts-rename';
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

// ── styles ─────────────────────────────────────────────────────────────────

export function injectLayoutsMenuStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('vgext-layouts-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-layouts-styles';
    document.head.appendChild(style);
  }
  style.textContent = LAYOUTS_CSS;
}

const LAYOUTS_CSS = `
.vgext-menu.vgext-layouts { width: 300px; padding: 0; }
.vgext-layouts-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px 8px;
  font-size: 11px; font-weight: 650; letter-spacing: 0.08em;
  color: var(--vg-muted-fg-color, #9aa4b6);
  border-bottom: 1px solid var(--vg-border-color, #2a3140);
}
.vgext-layouts-count { font-weight: 500; font-variant-numeric: tabular-nums; }
.vgext-layouts-list {
  max-height: 320px; overflow-y: auto;
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
}
.vgext-layouts-row {
  position: relative; display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: var(--vg-radius, 7px); cursor: pointer;
  color: var(--vg-fg-color, #e5e9f0); font-size: 12.5px;
}
.vgext-layouts-row:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.06)); }
.vgext-layouts-row.is-active { background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 14%, transparent); }
.vgext-layouts-row.is-active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
  border-radius: var(--vg-radius, 2px); background: var(--vg-accent-color, #4f9cf9);
}
.vgext-layouts-mark { width: 16px; display: inline-flex; justify-content: center; color: var(--vg-accent-color, #4f9cf9); }
.vgext-layouts-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--vg-muted-fg-color, #9aa4b6); opacity: 0.6; }
.vgext-layouts-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.vgext-layouts-row:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: -2px; }
/* visibility+opacity (not display:none) — the buttons must stay in the DOM
   flow and tabbable-when-visible so Tab can reach them once :focus-within
   reveals them (a display:none button can never receive focus at all). */
.vgext-layouts-actions {
  display: inline-flex; align-items: center; gap: 2px;
  visibility: hidden; opacity: 0; transition: opacity 120ms ease;
}
.vgext-layouts-row:hover .vgext-layouts-actions,
.vgext-layouts-row.is-active .vgext-layouts-actions,
.vgext-layouts-row:focus-within .vgext-layouts-actions { visibility: visible; opacity: 1; }
.vgext-layouts-act {
  appearance: none; border: none; background: transparent;
  width: 24px; height: 24px; border-radius: var(--vg-radius, 6px);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--vg-muted-fg-color, #9aa4b6); cursor: pointer;
}
.vgext-layouts-act:hover { background: var(--vg-row-alt-bg, rgba(255,255,255,0.08)); color: var(--vg-fg-color, #e5e9f0); }
.vgext-layouts-act:focus-visible { outline: 2px solid var(--vg-accent-color, #4f9cf9); outline-offset: 1px; }
.vgext-layouts-lock { width: 24px; display: inline-flex; justify-content: center; color: var(--vg-muted-fg-color, #9aa4b6); opacity: 0.7; }
.vgext-layouts-rename {
  flex: 1 1 auto; min-width: 0; height: 26px; padding: 0 8px;
  border: 1px solid var(--vg-accent-color, #4f9cf9); border-radius: var(--vg-radius, 2px);
  background: var(--vg-control-bg, rgba(0,0,0,0.25));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.vgext-layouts-rename:focus { outline: none; }
.vgext-layouts-rename.is-error, .vgext-layouts-new input.is-error { border-color: var(--vg-neg-color, #e2606c); }
.vgext-layouts-error { margin: 6px 12px 0; font-size: 12px; color: var(--vg-neg-color, #e2606c); }
.vgext-layouts-new {
  display: flex; gap: 6px; padding: 10px 12px;
  border-top: 1px solid var(--vg-border-color, #2a3140); margin-top: 6px;
}
.vgext-layouts-new input {
  flex: 1 1 auto; min-width: 0; height: 28px; padding: 0 9px;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  background: var(--vg-control-bg, rgba(0,0,0,0.25));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px;
}
.vgext-layouts-new input:focus { outline: none; border-color: var(--vg-accent-color, #4f9cf9); }
.vgext-layouts-savenew {
  height: 28px; padding: 0 12px; white-space: nowrap;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 7px);
  background: var(--vg-control-bg, rgba(255,255,255,0.04));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.vgext-layouts-savenew:hover:not(:disabled) { border-color: var(--vg-accent-color, #4f9cf9); }
.vgext-layouts-savenew:disabled { opacity: 0.45; cursor: default; }
.vgext-layouts-foot { display: flex; gap: 8px; padding: 0 12px 12px; }
.vgext-layouts-foot button {
  flex: 1; height: 28px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 7px);
  background: var(--vg-control-bg, rgba(255,255,255,0.04));
  color: var(--vg-fg-color, #e5e9f0); font: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; transition: border-color 120ms ease;
}
.vgext-layouts-foot button:hover { border-color: var(--vg-accent-color, #4f9cf9); }
.vgext-layouts-foot button svg { color: var(--vg-muted-fg-color, #9aa4b6); }
`;
