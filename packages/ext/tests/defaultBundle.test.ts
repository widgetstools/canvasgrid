import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGridExt } from '../src/cgridExt';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('default bundle', () => {
  it('registers Grid Options + primary toolbar items out of the box', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new CGridExt(host, {
      getRowId: (r: any) => r.a,
      columnDefs: [{ colId: 'a', field: 'a' }],
      rowData: [],
    } as any);

    // Settings launcher present in the title bar.
    const launcher = host.querySelector('[data-item-id="settings-launcher"]');
    expect(launcher).toBeTruthy();
    // Save button present.
    expect(host.querySelector('[data-item-id="save"]')).toBeTruthy();

    // Clicking the launcher opens the Grid Options sheet.
    (launcher!.querySelector('button') as HTMLButtonElement).click();
    // gridOptionsModule's controls are Lit custom elements that render into
    // shadow DOM (and `cgc-number` doesn't reflect its `label` attribute
    // into visible text at all), so `.textContent` on the sheet can't see
    // "Row height" — assert on the mounted control's light-DOM host instead,
    // which is an equally strong proof the Grid Options module was mounted.
    expect(host.querySelector('.cgext-sheet [data-opt="rowHeight"]')).toBeTruthy();
    ext.destroy();
  });
});
