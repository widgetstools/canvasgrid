import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('default bundle', () => {
  it('registers Grid Options + primary toolbar items out of the box', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
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
    // gridOptionsModule now mounts the kernel's GridOptionsToolPanel (the same
    // migration gridOptionsModule.test.ts covers) instead of a hand-built
    // panel — assert on the tool panel's root class as proof it mounted.
    expect(host.querySelector('.vgext-sheet .vg-settings-panel')).toBeTruthy();
    ext.destroy();
  });
});
