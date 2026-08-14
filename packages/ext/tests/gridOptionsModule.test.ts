import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { gridOptionsModule } from '../src/modules/gridOptions';
import { columnGroupsModule } from '../src/modules/columnGroups';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeCtx(opts: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new VelocityGrid(host, {
    columnDefs: [
      { colId: 'a', field: 'a' },
      { colId: 'b', field: 'b' },
    ],
    rowData: [],
    getRowId: (r: any) => r.a,
    ...opts,
  } as any);
  const profiles = new ProfilesController(grid, new LocalStorageProfileStore('t'), {});
  return { grid, ctx: createExtContext(grid, profiles), profiles };
}

describe('gridOptionsModule', () => {
  it('mounts the kernel Options panel and writes through setGridOption', () => {
    const { grid, ctx, profiles } = makeCtx();
    const setOpt = vi.spyOn(grid, 'setGridOption');
    const mod = gridOptionsModule();
    const panel = document.createElement('div');
    mod.init(ctx);
    const inst = mod.mount(panel, ctx);

    expect(panel.querySelector('.vg-settings-panel')).toBeTruthy();
    expect(panel.querySelector('.vg-settings-search')).toBeTruthy();

    const toggle = panel.querySelector<HTMLInputElement>('input.vg-checkbox.vg-settings-checkbox');
    expect(toggle).toBeTruthy();
    toggle!.checked = !toggle!.checked;
    toggle!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setOpt).toHaveBeenCalled();
    expect(profiles.isDirty()).toBe(true);

    inst.destroy();
    expect(panel.querySelector('.vg-settings-panel')).toBeNull();
    grid.destroy();
  });
});

describe('columnGroupsModule', () => {
  it('mounts the kernel Column Groups panel with formatter style chrome', () => {
    const { grid, ctx } = makeCtx({
      columnDefs: [
        {
          groupId: 'g1',
          headerName: 'Group',
          children: [
            { colId: 'a', field: 'a' },
            { colId: 'b', field: 'b' },
          ],
        },
      ],
    });
    const mod = columnGroupsModule();
    const panel = document.createElement('div');
    mod.init(ctx);
    const inst = mod.mount(panel, ctx);

    expect(panel.querySelector('.vg-colgroups-panel')).toBeTruthy();
    expect(panel.classList.contains('vgext-sheet-toolpanel')).toBe(true);
    expect(panel.querySelector('[data-vg-style] .vgext-style-chrome')).toBeTruthy();
    expect(panel.querySelector('[data-vg-style] .vgext-rb-grp-name')?.textContent).toMatch(/Font/i);
    expect(panel.querySelector('[data-vg-field="marryChildren"]')).toBeTruthy();

    inst.destroy();
    expect(panel.querySelector('.vg-colgroups-panel')).toBeNull();
    grid.destroy();
  });
});
