import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGrid } from '@cgrid/kernel';
import { gridOptionsModule } from '../src/modules/gridOptions';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeCtx() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new CGrid(host, {
    columnDefs: [{ colId: 'a', field: 'a' }],
    rowData: [],
    getRowId: (r: any) => r.a,
  } as any);
  const profiles = new ProfilesController(grid, new LocalStorageProfileStore('t'), {});
  return { grid, ctx: createExtContext(grid, profiles), profiles };
}

describe('gridOptionsModule', () => {
  it('renders controls and writes row height through the kernel', () => {
    const { grid, ctx, profiles } = makeCtx();
    const setOpt = vi.spyOn(grid, 'setGridOption');
    const mod = gridOptionsModule();
    const panel = document.createElement('div');
    mod.init(ctx);
    const inst = mod.mount(panel, ctx);

    const rowHeight = panel.querySelector<HTMLElement>('[data-opt="rowHeight"]')!;
    expect(rowHeight).toBeTruthy();
    // Each control is wrapped in a cgc-field carrying the visible label, and
    // the control itself carries a matching aria-label for a11y.
    expect(panel.querySelector('cgc-field[label="Row height"]')).toBeTruthy();
    expect(rowHeight.getAttribute('aria-label')).toBe('Row height');
    // Simulate the chrome control emitting a change to 40.
    rowHeight.dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 40 }, bubbles: true }));
    expect(setOpt).toHaveBeenCalledWith('rowHeight', 40);
    expect(profiles.isDirty()).toBe(true);

    inst.destroy();
    grid.destroy();
  });

  it('registers a grid-options state slice that round-trips', () => {
    const { grid, ctx } = makeCtx();
    const mod = gridOptionsModule();
    mod.init(ctx);
    const panel = document.createElement('div');
    const inst = mod.mount(panel, ctx);
    panel.querySelector<HTMLElement>('[data-opt="rowHeight"]')!
      .dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 32 }, bubbles: true }));

    const state = grid.getState();
    expect((state.modules?.['grid-options'] as any)?.data?.rowHeight).toBe(32);
    inst.destroy();
    grid.destroy();
  });

  it('seeds the rowHeight control from live kernel state on mount, and the slice reads live values', () => {
    const { grid, ctx } = makeCtx();
    // Set the option directly on the kernel before the module ever mounts —
    // there is no other path (no shadow copy) that could put this value in.
    grid.setGridOption('rowHeight' as any, 40 as any);

    const mod = gridOptionsModule();
    mod.init(ctx);
    const panel = document.createElement('div');
    const inst = mod.mount(panel, ctx);

    const rowHeight = panel.querySelector<HTMLElement>('[data-opt="rowHeight"]')!;
    expect((rowHeight as unknown as { value: number }).value).toBe(40);

    // The slice's `get()` must read the same live value straight off the
    // kernel — not a mount-time snapshot — proving there's no shadow copy.
    grid.setGridOption('rowHeight' as any, 55 as any);
    const state = grid.getState();
    expect((state.modules?.['grid-options'] as any)?.data?.rowHeight).toBe(55);

    inst.destroy();
    grid.destroy();
  });
});
