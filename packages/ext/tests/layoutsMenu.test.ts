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
