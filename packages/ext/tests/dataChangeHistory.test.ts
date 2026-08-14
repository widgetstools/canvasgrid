import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('dataChangeHistoryModule', () => {
  it('registers Edit History in the default settings sheet', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);

    wireEditIntoKernel(ext.grid);
    ext.openSettings('data-change-history');
    expect(host.querySelector('.vgext-sheet-title')?.textContent).toBe('Edit History');
    expect(host.querySelector('.ckp')).toBeTruthy();
    expect(host.textContent).toContain('Record Sources');
    expect(host.textContent).toContain('Monitor');
    ext.destroy();
    host.remove();
  });

  it('Done commits history settings through the edit handle', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);
    const edit = wireEditIntoKernel(ext.grid);

    ext.openSettings('data-change-history');
    const switches = host.querySelectorAll('.vg-checkbox');
    // Last record-source toggle is Stream (default off) — flip then Save.
    const streamSwitch = Array.from(switches).at(-1) as HTMLInputElement | undefined;
    expect(streamSwitch).toBeTruthy();
    streamSwitch!.click();
    const done = host.querySelector('[data-testid="vgext-sheet-done"]') as HTMLButtonElement;
    expect(done).toBeTruthy();
    done.click();
    expect(edit.getSettings().history.recordSources.stream).toBe(true);
    ext.destroy();
    host.remove();
  });

  it('Suspended toggle applies live without Save', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);
    const edit = wireEditIntoKernel(ext.grid);
    ext.openSettings('data-change-history');

    // Global band: Enabled (0), Suspended (1), …
    const suspended = host.querySelectorAll('.vg-checkbox')[1] as HTMLInputElement;
    suspended.click();
    expect(edit.getSettings().history.suspended).toBe(true);
    ext.destroy();
    host.remove();
  });
});

describe('VelocityGridExt.reapplyActiveProfile', () => {
  it('restores editSettings after wireEdit when profile was saved with non-defaults', async () => {
    const store = new LocalStorageProfileStore('reapply-test');

    // Session 1: wire edit, change settings, snapshot into the store.
    {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const ext = new VelocityGridExt(host, {
        getRowId: (r: { a: string }) => r.a,
        columnDefs: [{ colId: 'a', field: 'a' }],
        rowData: [{ a: '1' }],
        ext: { profiles: { store, initialId: 'default' } },
      } as never);
      const edit = wireEditIntoKernel(ext.grid);
      await ext.reapplyActiveProfile();
      edit.updateSettings({ history: { maxEntries: 17, recordSources: { stream: true } } });
      await store.save('default', {
        meta: { id: 'default', name: 'Default', updatedAt: Date.now() },
        gridState: ext.grid.getState(),
        ext: {},
      });
      ext.destroy();
      host.remove();
    }

    // Session 2: construct, wire late, reapply — non-default history returns.
    {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const ext = new VelocityGridExt(host, {
        getRowId: (r: { a: string }) => r.a,
        columnDefs: [{ colId: 'a', field: 'a' }],
        rowData: [{ a: '1' }],
        ext: { profiles: { store, initialId: 'default' } },
      } as never);
      const edit = wireEditIntoKernel(ext.grid);
      await ext.reapplyActiveProfile();
      expect(edit.getSettings().history.maxEntries).toBe(17);
      expect(edit.getSettings().history.recordSources.stream).toBe(true);
      ext.destroy();
      host.remove();
    }
  });
});
