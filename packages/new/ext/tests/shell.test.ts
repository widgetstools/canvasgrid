import { describe, expect, it, vi } from 'vitest';
import { VelocityGridExtShell } from '../src/shell/shell';
import type { VelocityGridApi } from '@wellsfargo-starui/vg-new-grid';

function fakeApi(): VelocityGridApi {
  return {
    setColumnDefs: vi.fn(),
    getColumnState: () => [
      { colId: 'pnl', width: 100, headerName: 'PnL' },
      { colId: 'desk', width: 90, headerName: 'Desk' },
    ],
    applyColumnState: vi.fn(),
    setRowData: vi.fn(),
    applyTransaction: vi.fn(),
    applyTransactionAsync: vi.fn(),
    flushAsyncTransactions: vi.fn(),
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
    setExpanded: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    setGroupSelected: vi.fn(),
    getGroupSelectionState: () => 'none',
    getStickyAncestors: () => [],
    setPivotMode: vi.fn(),
    isPivotMode: () => false,
    ensureFullyHydrated: async () => true,
    refillServerSideColumnKeys: vi.fn(),
    getSelectedRows: () => [],
    deselectAll: vi.fn(),
    sizeColumnsToFit: vi.fn(),
    getRowCount: () => 0,
    applyFormatPatch: vi.fn(),
    undoFormat: () => false,
    redoFormat: () => false,
    clearFormat: vi.fn(),
    setStyleRules: vi.fn(),
    setCalcColumns: vi.fn(),
    setAlertRules: vi.fn(),
    applyEditOp: vi.fn(),
    undoEdit: () => false,
    redoEdit: () => false,
    getUnreadAlertCount: () => 0,
    getEngines: () => ({}),
    destroy: vi.fn(),
  };
}

describe('VelocityGridExtShell', () => {
  it('mounts title bar, ribbons, drawer rail, filter pills', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = fakeApi();
    let ready = false;
    const shell = new VelocityGridExtShell(host, {
      gridId: 'test-shell',
      title: 'Demo',
      getGridApi: () => {
        if (!ready) throw new Error('grid not ready');
        return api;
      },
      asOfLabel: 'As-of 2026-08-12',
    });
    // Construct must succeed before the host attaches the grid.
    ready = true;

    expect(host.querySelector('.vgn-titlebar__brand')?.textContent).toContain('Demo');
    expect(host.querySelectorAll('.vgn-ribbon')).toHaveLength(2);
    expect(host.querySelector('[data-slot="grid"]')).toBeTruthy();
    expect(host.querySelector('.vgn-rail')).toBeTruthy();
    expect(host.querySelector('[data-slot="filter-pills"] .vgn-pill')).toBeTruthy();

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

  it('opens calculated-columns with Validate/Apply footer', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = fakeApi();
    const shell = new VelocityGridExtShell(host, {
      gridId: 'test-shell-calc',
      getGridApi: () => api,
    });
    shell.openCustomize('calculated-columns');
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Validate', 'Apply', 'Reset']));
    shell.destroy();
  });
});
