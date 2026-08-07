import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGridExt } from '../src/cgridExt';
import { wireEditIntoKernel } from '@cgrid/edit';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function mountExt() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ext = new CGridExt(host, {
    getRowId: (r: { a: string }) => r.a,
    columnDefs: [
      { colId: 'a', field: 'a', editable: true },
      { colId: 'qty', field: 'qty', cellDataType: 'number', editable: true },
    ],
    rowData: [{ a: '1', qty: 10 }],
  } as never);
  const edit = wireEditIntoKernel(ext.grid);
  return { host, ext, edit };
}

describe('editing settings modules', () => {
  it('registers Smart Edit / Bulk Update / Plus Minus / Shortcuts tabs', () => {
    const { host, ext } = mountExt();
    for (const [id, title] of [
      ['smart-edit', 'Smart Edit'],
      ['bulk-update', 'Bulk Update'],
      ['plus-minus', 'Plus / Minus'],
      ['shortcuts', 'Shortcuts'],
    ] as const) {
      ext.openSettings(id);
      expect(host.querySelector('.cgext-sheet-title')?.textContent).toBe(title);
    }
    ext.destroy();
    host.remove();
  });

  it('Smart Edit Save writes settings and syncs history.recordSources.smartEdit', () => {
    const { host, ext, edit } = mountExt();
    ext.openSettings('smart-edit');
    // Toggle Record history off (last switch in Safety band) then Save.
    const switches = Array.from(host.querySelectorAll('.ckp-switch'));
    const record = switches.at(-1) as HTMLButtonElement;
    expect(edit.getSettings().smartEdit.recordHistory).toBe(true);
    record.click();
    const save = Array.from(host.querySelectorAll('.ckp-actbtn')).find((b) =>
      b.textContent?.includes('Save'),
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    expect(edit.getSettings().smartEdit.recordHistory).toBe(false);
    expect(edit.getSettings().history.recordSources.smartEdit).toBe(false);
    ext.destroy();
    host.remove();
  });

  it('Plus / Minus can add a nudge via Save', () => {
    const { host, ext, edit } = mountExt();
    ext.openSettings('plus-minus');
    (host.querySelector('.ckp-addbtn') as HTMLButtonElement).click();
    const name = host.querySelector('.ckp-pane .ckp-input') as HTMLInputElement;
    // First text input in nudge band is Name
    name.value = 'Qty step';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const save = Array.from(host.querySelectorAll('.ckp-actbtn')).find((b) =>
      b.textContent?.includes('Save'),
    ) as HTMLButtonElement;
    save.click();
    expect(edit.getNudges().some((n) => n.name === 'Qty step' || n.name === 'New nudge')).toBe(true);
    ext.destroy();
    host.remove();
  });

  it('Shortcuts can add a letter binding via Save', () => {
    const { host, ext, edit } = mountExt();
    ext.openSettings('shortcuts');
    (host.querySelector('.ckp-addbtn') as HTMLButtonElement).click();
    const save = Array.from(host.querySelectorAll('.ckp-actbtn')).find((b) =>
      b.textContent?.includes('Save'),
    ) as HTMLButtonElement;
    save.click();
    expect(edit.getShortcuts().length).toBeGreaterThan(0);
    expect(edit.getShortcuts()[0]!.shortcutKey).toMatch(/^[a-z]$/);
    ext.destroy();
    host.remove();
  });
});
