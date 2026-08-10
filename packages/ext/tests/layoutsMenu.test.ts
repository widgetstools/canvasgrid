import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  layoutsItem,
  uniqueCopyName,
  fileIO,
  sniffImport,
  handleImportText,
  layoutSaveItem,
  captureGridConfig,
} from '../src/toolbar/layoutsMenu';
import type { LayoutGridSurface } from '../src/toolbar/layoutsMenu';
import type { VelocityGridApi } from '@wellsfargo-starui/velocity-grid';
import { FakeGrid, mountItem } from './layoutsMenuHarness';
import { saveConfigToLocalStorage } from '../src/configStorage';

// Type-only compile-time tie to the kernel API (closeout finding #5): if a
// kernel layout-method rename ever makes VelocityGridApi stop structurally
// satisfying LayoutGridSurface, THIS fails typecheck (`tsc --noEmit` /
// `npm run typecheck`) instead of only surfacing much later at E2E.
type _LayoutSurfaceCheck = VelocityGridApi extends LayoutGridSurface ? true : never;
// Assigning `true` only typechecks when _LayoutSurfaceCheck is `true` — if
// the conditional resolved to `never` (surface mismatch) this line itself
// fails to compile, which is the point. No runtime effect.
const _layoutSurfaceCheck: _LayoutSurfaceCheck = true;
void _layoutSurfaceCheck;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const openPanel = (host: HTMLElement) => {
  host.querySelector<HTMLButtonElement>('button.vgext-layouts-trigger')!.click();
  return document.querySelector<HTMLElement>('.vgext-menu.vgext-layouts')!;
};

describe('layouts trigger button', () => {
  it('shows the active layout name and re-labels on layoutChanged', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutsItem(), grid);
    const name = () => host.querySelector('.vgext-pill-name')!.textContent;
    expect(name()).toBe('Default');
    grid.loadLayout('l1');
    expect(name()).toBe('Layout 1');
  });

  it('opens/closes the panel and syncs aria-expanded', () => {
    const { host } = mountItem(layoutsItem());
    const btn = host.querySelector<HTMLButtonElement>('button.vgext-layouts-trigger')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the LAYOUTS header with a live count badge', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    expect(panel.querySelector('.vgext-layouts-head')!.textContent).toContain('LAYOUTS');
    expect(panel.querySelector('.vgext-layouts-count')!.textContent).toBe('2');
    grid.saveLayout('Layout 2');
    expect(panel.querySelector('.vgext-layouts-count')!.textContent).toBe('3');
  });

  it('destroy unsubscribes and clears the host', () => {
    const { host, grid, inst } = mountItem(layoutsItem());
    inst.destroy();
    expect(host.childElementCount).toBe(0);
    grid.emit({ type: 'layoutChanged', activeLayoutId: 'default', source: 'load' }); // must not throw
  });
});

const twoLayouts = () => {
  const grid = new FakeGrid();
  grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
  grid.activeId = 'l1';
  return grid;
};
const row = (panel: HTMLElement, id: string) =>
  panel.querySelector<HTMLElement>(`.vgext-layouts-row[data-layout-id="${id}"]`)!;

describe('layout list', () => {
  it('renders one row per layout, marks the active row, dots the rest', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    expect(panel.querySelectorAll('.vgext-layouts-row')).toHaveLength(2);
    expect(row(panel, 'l1').classList.contains('is-active')).toBe(true);
    expect(row(panel, 'l1').querySelector('.vgext-layouts-mark svg')).toBeTruthy(); // check icon
    expect(row(panel, 'default').querySelector('.vgext-layouts-dot')).toBeTruthy();
    expect(row(panel, 'default').querySelector('.vgext-layouts-name')!.getAttribute('title')).toBe('Default');
  });

  it('locks Default (no rename/delete; duplicate/export present) and offers all four elsewhere', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    const acts = (id: string) =>
      Array.from(row(panel, id).querySelectorAll<HTMLElement>('.vgext-layouts-act')).map((b) => b.dataset.act);
    expect(acts('default')).toEqual(['duplicate', 'export']);
    expect(row(panel, 'default').querySelector('.vgext-layouts-lock')).toBeTruthy();
    expect(acts('l1')).toEqual(['rename', 'duplicate', 'export', 'delete']);
    expect(row(panel, 'l1').querySelector('.vgext-layouts-lock')).toBeNull();
  });

  it('row click loads the layout, re-labels the trigger, and closes the panel', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'default').click();
    expect(grid.loadLayout).toHaveBeenCalledWith('default');
    expect(host.querySelector('.vgext-pill-name')!.textContent).toBe('Default');
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeNull(); // selection dismisses
    expect(host.querySelector('button.vgext-layouts-trigger')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the already-active row closes without loading; a failed load keeps the panel open', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    let panel = openPanel(host);
    row(panel, 'l1').click(); // l1 is active
    expect(grid.loadLayout).not.toHaveBeenCalled();
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeNull();

    grid.loadLayout.mockImplementationOnce(() => { throw new Error('boom'); });
    panel = openPanel(host);
    row(panel, 'default').click();
    expect(document.querySelector('.vgext-menu.vgext-layouts')).not.toBeNull(); // error → stays open
    expect(panel.querySelector<HTMLElement>('.vgext-layouts-error')!.hidden).toBe(false);
  });

  it('rename: Enter commits, Escape cancels, kernel throw shows inline error', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    const startRename = () =>
      row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="rename"]')!.click();
    const input = () => panel.querySelector<HTMLInputElement>('input.vgext-layouts-rename')!;

    startRename();
    input().value = 'Blotter';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.renameLayout).toHaveBeenCalledWith('l1', 'Blotter');
    expect(row(panel, 'l1').querySelector('.vgext-layouts-name')!.textContent).toBe('Blotter');

    startRename();
    input().value = 'Ignored';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.querySelector('input.vgext-layouts-rename')).toBeNull();
    expect(row(panel, 'l1').querySelector('.vgext-layouts-name')!.textContent).toBe('Blotter');

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
    expect(panel.querySelectorAll('.vgext-layouts-row')).toHaveLength(3);
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
    expect(panel.querySelectorAll('.vgext-layouts-row')).toHaveLength(1);
    expect(host.querySelector('.vgext-pill-name')!.textContent).toBe('Default');
  });
});

describe('layout list — keyboard operability', () => {
  it('rows are focusable menuitems; Enter on a focused inactive row loads it', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    const defaultRow = row(panel, 'default');
    expect(defaultRow.tabIndex).toBe(0);
    expect(defaultRow.getAttribute('role')).toBe('menuitem');

    defaultRow.focus();
    defaultRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.loadLayout).toHaveBeenCalledWith('default');
  });

  it('Space on a focused row also activates it', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    row(panel, 'default').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(grid.loadLayout).toHaveBeenCalledWith('default');
  });

  it('Enter targeting an action button does not also trigger loadLayout on the row', () => {
    const grid = twoLayouts();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    const dup = row(panel, 'default').querySelector<HTMLButtonElement>('[data-act="duplicate"]')!;
    dup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.loadLayout).not.toHaveBeenCalled();
  });

  it('action buttons are reachable via Tab — real <button>s, not display:none, no explicit tabindex removal', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    const dup = row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="duplicate"]')!;
    expect(dup.tagName).toBe('BUTTON'); // natively focusable/tabbable, no display:none ancestor gate
    expect(dup.hidden).toBe(false);
    expect(dup.hasAttribute('tabindex')).toBe(false); // never opted OUT of the default tab order
    dup.focus();
    expect(document.activeElement).toBe(dup);
  });

  it('Escape closes the panel', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeTruthy();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeNull();
  });

  it('Escape while renaming cancels the rename instead of closing the panel', () => {
    const { host } = mountItem(layoutsItem(), twoLayouts());
    const panel = openPanel(host);
    row(panel, 'l1').querySelector<HTMLButtonElement>('[data-act="rename"]')!.click();
    const input = panel.querySelector<HTMLInputElement>('input.vgext-layouts-rename')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vgext-menu.vgext-layouts')).toBeTruthy(); // still open
    expect(panel.querySelector('input.vgext-layouts-rename')).toBeNull(); // rename cancelled
  });
});

describe('save-new + import/export', () => {
  const newInput = (panel: HTMLElement) => panel.querySelector<HTMLInputElement>('.vgext-layouts-new input')!;
  const saveBtn = (panel: HTMLElement) => panel.querySelector<HTMLButtonElement>('.vgext-layouts-savenew')!;

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
    expect(host.querySelector('.vgext-pill-name')!.textContent).toBe('Layout 1'); // kernel activates

    newInput(panel).value = 'layout 1'; // duplicate, case-insensitive
    newInput(panel).dispatchEvent(new Event('input', { bubbles: true }));
    saveBtn(panel).click();
    expect(newInput(panel).classList.contains('is-error')).toBe(true);
    expect(newInput(panel).value).toBe('layout 1'); // kept for correction
  });

  it('footer export downloads the full config (view + layouts) named after the gridId', () => {
    const dl = vi.spyOn(fileIO, 'download').mockImplementation(() => {});
    const grid = new FakeGrid();
    const { host } = mountItem(layoutsItem(), grid);
    const panel = openPanel(host);
    panel.querySelector<HTMLButtonElement>('.vgext-layouts-export')!.click();
    expect(grid.getState).toHaveBeenCalled();
    expect(grid.exportLayouts).toHaveBeenCalled();
    expect(dl).toHaveBeenCalledWith(
      'fake-grid-config.json',
      expect.objectContaining({
        version: 4,
        layouts: expect.objectContaining({ version: 1, layouts: expect.any(Array) }),
      }),
    );
    dl.mockRestore();
  });

  it('sniffImport classifies config / bundle / single layout / garbage', () => {
    expect(sniffImport({
      version: 4,
      layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} },
    })).toBe('config');
    expect(sniffImport({ version: 1, layouts: [], activeLayoutId: 'default', grid: {} })).toBe('bundle');
    expect(sniffImport({ id: 'x', name: 'X', state: {} })).toBe('layout');
    expect(sniffImport({ hello: 'world' })).toBeNull();
    expect(sniffImport('nope')).toBeNull();
    expect(sniffImport(null)).toBeNull();
  });

  it('handleImportText routes config / bundle / layout and reports errors inline', () => {
    const grid = new FakeGrid();
    const errors: string[] = [];
    const showError = (m: string) => errors.push(m);

    handleImportText(grid as never, JSON.stringify({
      version: 4,
      filterModel: { a: 1 },
      layouts: { version: 1, activeLayoutId: 'default', layouts: [{ id: 'c1', name: 'C1', state: {} }], grid: {} },
    }), showError);
    expect(grid.importLayouts).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      { mode: 'replace', overwrite: true, apply: false },
    );
    expect(grid.setState).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4, filterModel: { a: 1 } }),
      { exhaustive: true },
    );

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
    panel.querySelector<HTMLElement>('.vgext-layouts-row[data-layout-id="l1"]')!.click();
    const strip = panel.querySelector<HTMLElement>('.vgext-layouts-error')!;
    expect(strip.hidden).toBe(false);
    expect(strip.textContent).toContain('boom');
    grid.saveLayout('Fresh');
    expect(strip.hidden).toBe(true);
  });
});

describe('layout-save disk', () => {
  const stateUpdated = (source: string, changedKeys: string[]) =>
    ({ type: 'stateUpdated', state: {}, changedKeys, source });

  it('starts clean/disabled; a ui state change dirties it; click updates layout + persists config', () => {
    const grid = new FakeGrid();
    const { host } = mountItem(layoutSaveItem(), grid);
    const btn = host.querySelector<HTMLButtonElement>('button.vgext-save')!;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('is-dirty')).toBe(false);

    grid.emit(stateUpdated('ui', ['columnState']));
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('is-dirty')).toBe(true);
    expect(btn.title).toContain('Default');

    btn.click();
    expect(grid.updateLayout).toHaveBeenCalled();
    expect(btn.disabled).toBe(true); // updateLayout emitted layoutChanged → clean
    const raw = localStorage.getItem('velocity-grid:instance:fake-grid');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).layouts).toBeTruthy();
  });

  it("ignores non-'ui' sources and layouts-only echoes; loading a layout never re-dirties", () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    const { host } = mountItem(layoutSaveItem(), grid);
    const btn = host.querySelector<HTMLButtonElement>('button.vgext-save')!;

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

  it('does not persist on layoutChanged(import) — protects activeProviderId during restore', () => {
    const grid = new FakeGrid();
    grid.viewState = {
      version: 4,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'stomp-ssrm' } } },
    };
    mountItem(layoutSaveItem(), grid);

    // Seed a good workspace first (as Apply would).
    saveConfigToLocalStorage('fake-grid', captureGridConfig(grid as never));
    expect(JSON.parse(localStorage.getItem('velocity-grid:instance:fake-grid')!).gridLevelData.activeProviderId)
      .toBe('stomp-ssrm');

    // Simulate cold restore: controller still null, import fires before setState.
    grid.viewState = { version: 4 };
    grid.emit({ type: 'layoutChanged', activeLayoutId: 'default', source: 'import' });

    const raw = JSON.parse(localStorage.getItem('velocity-grid:instance:fake-grid')!);
    expect(raw.gridLevelData.activeProviderId).toBe('stomp-ssrm');
  });

  it('persists layouts.activeLayoutId when the layout selector loads a layout', () => {
    const grid = new FakeGrid();
    grid.layouts.push({ id: 'l1', name: 'Layout 1', state: {} });
    mountItem(layoutSaveItem(), grid);

    grid.loadLayout('l1');

    const raw = JSON.parse(localStorage.getItem('velocity-grid:instance:fake-grid')!);
    expect(raw.layouts.activeLayoutId).toBe('l1');
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
