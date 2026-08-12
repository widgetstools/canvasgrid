import { describe, expect, it, vi } from 'vitest';
import { VelocityGridExtShell } from '../src/shell/shell';
import type { VelocityGridApi } from '@wellsfargo-starui/vg-new-grid';

function fakeApi(): VelocityGridApi {
  return {
    setRowData: vi.fn(),
    applyTransaction: vi.fn(),
    applyServerSideTransaction: vi.fn(),
    refreshServerSide: vi.fn(),
    setSortModel: vi.fn(),
    getSortModel: () => [],
    setFilterModel: vi.fn(),
    getFilterModel: () => ({}),
    setQuickFilterText: vi.fn(),
    getQuickFilterText: () => '',
    setRowGroupColumns: vi.fn(),
    getRowGroupColumns: () => [],
    setPivotMode: vi.fn(),
    isPivotMode: () => false,
    getSelectedRows: () => [],
    deselectAll: vi.fn(),
    sizeColumnsToFit: vi.fn(),
    getRowCount: () => 0,
    destroy: vi.fn(),
  };
}

describe('VelocityGridExtShell', () => {
  it('mounts title bar, ribbons, drawer rail', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = fakeApi();
    const shell = new VelocityGridExtShell(host, {
      gridId: 'test-shell',
      title: 'Demo',
      getGridApi: () => api,
      asOfLabel: 'As-of 2026-08-12',
    });

    expect(host.querySelector('.vgn-titlebar__brand')?.textContent).toContain('Demo');
    expect(host.querySelectorAll('.vgn-ribbon')).toHaveLength(2);
    expect(host.querySelector('[data-slot="grid"]')).toBeTruthy();
    expect(host.querySelector('.vgn-rail')).toBeTruthy();

    shell.openCustomize('column-settings');
    expect(host.querySelector('.vgn-drawer')?.getAttribute('data-open')).toBe('true');
    expect(host.querySelector('.vgn-shell-scrim')?.getAttribute('data-open')).toBe('true');

    shell.setAlertCount(3);
    expect(host.querySelector('.vgn-badge')?.textContent).toBe('3');
    expect((host.querySelector('.vgn-badge') as HTMLElement).hidden).toBe(false);

    shell.closeCustomize();
    expect(host.querySelector('.vgn-drawer')?.getAttribute('data-open')).toBe('false');

    shell.destroy();
    expect(host.childNodes.length).toBe(0);
  });
});
