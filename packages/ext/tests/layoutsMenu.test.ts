import { describe, it, expect, afterEach, vi } from 'vitest';
import { layoutsItem, uniqueCopyName, fileIO } from '../src/toolbar/layoutsMenu';
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
      Array.from(row(panel, id).querySelectorAll<HTMLElement>('.cgext-layouts-act')).map((b) => b.dataset.act);
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
