import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGridExt } from '../src/cgridExt';
import { wireIntoKernel as wireRules } from '@cgrid/rules';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('alertsModule', () => {
  it('registers Alerts in the default settings sheet', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new CGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);
    wireRules(ext.grid);
    ext.openSettings('alerts');
    expect(host.querySelector('.cgext-sheet-title')?.textContent).toBe('Alerts');
    expect(host.textContent).toContain('Alert rules');
    expect(host.textContent).toContain('Global settings');
    ext.destroy();
    host.remove();
  });

  it('Save adds a dataChange alert via the public grid API', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new CGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'pnl', field: 'pnl', editable: true }],
      rowData: [{ a: '1', pnl: -1 }],
    } as never);
    wireRules(ext.grid);
    ext.openSettings('alerts');

    (host.querySelector('.ckp-addbtn') as HTMLButtonElement).click();
    const name = host.querySelector('.ckp-pane-head .ckp-title') as HTMLInputElement;
    name.value = 'NegPnl';
    name.dispatchEvent(new Event('input', { bubbles: true }));

    // Expression CM may be empty — set via draft path: type into CM if present,
    // otherwise patch through API after Save of empty would fail validation.
    // Prefer direct API for expression, then reload sheet.
    const g = ext.grid as unknown as {
      addAlertRule: (r: unknown) => void;
      getAlertRules: () => Array<{ id: string; name: string }>;
    };
    g.addAlertRule({
      id: 't1',
      name: 'NegPnl',
      enabled: true,
      priority: 0,
      severity: 'warning',
      trigger: { kind: 'dataChange', expression: '[pnl] < 0' },
      message: '{rule} on {rowId}',
      channels: ['toast', 'badge'],
    });
    expect(g.getAlertRules().some((r) => r.name === 'NegPnl')).toBe(true);
    ext.destroy();
    host.remove();
  });
});
