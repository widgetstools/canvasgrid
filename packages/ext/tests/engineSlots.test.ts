/**
 * D-F8 — engine DI slots.
 *
 * The property that drives the whole design: engine registration is
 * POST-CONSTRUCTION and is the NORMAL case, so the slots must resolve at USE
 * time. The plan's suggested bridge ("the ctx reads the current dunder
 * markers ONCE at context creation") is pinned as broken here — `edit` is
 * wired by the HOST after `new VelocityGridExt(...)` returns, so a
 * creation-time snapshot would be `null` for its whole life.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';
import { createEngineSlots } from '../src/extension/engines';
import { VelocityGridExt } from '../src/velocityGridExt';
import { editHandle } from '../src/modules/editHandle';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeGrid(): VelocityGrid {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new VelocityGrid(host, {
    getRowId: (r: any) => r.a,
    columnDefs: [{ colId: 'a', field: 'a', editable: true }],
    rowData: [{ a: '1' }],
  } as any);
}

function makeCtx(grid: VelocityGrid) {
  const profiles = new ProfilesController(grid, new LocalStorageProfileStore('t'), { initialId: 'default' });
  return createExtContext(grid, profiles);
}

describe('createEngineSlots', () => {
  it('answers null for every engine on a bare grid', () => {
    const slots = createEngineSlots({});
    expect(slots.get('edit')).toBeNull();
    expect(slots.get('calc')).toBeNull();
    expect(slots.get('rules')).toBeNull();
    expect(slots.get('alerts')).toBeNull();
  });

  it('resolves an engine wired AFTER the slots were built', () => {
    const grid = makeGrid();
    const slots = createEngineSlots(grid);
    expect(slots.get('edit')).toBeNull();

    const handle = wireEditIntoKernel(grid);

    // The whole point: no re-creation, no re-subscription, no snapshot.
    expect(slots.get('edit')).toBe(handle);
    grid.destroy();
  });

  it('resolves rules AND alerts from the single rules wire', () => {
    const grid = makeGrid();
    const slots = createEngineSlots(grid);
    const wired = wireRules(grid);
    expect(slots.get('rules')).toBe(wired.rules);
    expect(slots.get('alerts')).toBe(wired.alerts);
    grid.destroy();
  });

  it('resolves calc from the calc wire', () => {
    const grid = makeGrid();
    const slots = createEngineSlots(grid);
    expect(slots.get('calc')).toBeNull();
    const wired = wireCalc(grid);
    expect(slots.get('calc')).toBe(wired.calc);
    grid.destroy();
  });

  it('an explicitly registered engine wins over the grid marker', () => {
    const grid = makeGrid();
    const slots = createEngineSlots(grid);
    const wired = wireEditIntoKernel(grid);
    expect(slots.get('edit')).toBe(wired);

    const injected = { injected: true } as never;
    slots.register('edit', injected);
    expect(slots.get('edit')).toBe(injected);
    grid.destroy();
  });

  it('attributes engines PER GRID — one grid\'s wire never leaks to another', () => {
    // The kernel's own `core/ruleEngineSlot.ts` keeps its injected engine in a
    // module-level `let` (module-GLOBAL, last writer wins). ext does NOT read
    // that slot: the three `__*BridgeWired` markers are own properties of the
    // grid instance, which is what makes a use-time probe correctly
    // attributable even with several grids alive.
    const a = makeGrid();
    const b = makeGrid();
    const slotsA = createEngineSlots(a);
    const slotsB = createEngineSlots(b);

    const wiredA = wireRules(a);
    expect(slotsA.get('rules')).toBe(wiredA.rules);
    expect(slotsB.get('rules')).toBeNull();

    const wiredB = wireRules(b);
    expect(slotsB.get('rules')).toBe(wiredB.rules);
    expect(wiredB.rules).not.toBe(wiredA.rules);
    // A's answer is unchanged by B's later wire.
    expect(slotsA.get('rules')).toBe(wiredA.rules);

    a.destroy();
    b.destroy();
  });

  it('registrations are per-context, not shared between grids', () => {
    const a = makeGrid();
    const b = makeGrid();
    const slotsA = createEngineSlots(a);
    const slotsB = createEngineSlots(b);
    slotsA.register('calc', { tag: 'A' } as never);
    expect(slotsB.get('calc')).toBeNull();
    a.destroy();
    b.destroy();
  });
});

describe('VelocityGridExtContext.engines', () => {
  it('is present on the context and bound to that context\'s grid', () => {
    const grid = makeGrid();
    const ctx = makeCtx(grid);
    expect(typeof ctx.engines.get).toBe('function');
    expect(typeof ctx.engines.register).toBe('function');
    expect(ctx.engines.get('edit')).toBeNull();
    const handle = wireEditIntoKernel(grid);
    expect(ctx.engines.get('edit')).toBe(handle);
    grid.destroy();
  });

  it('rides through the shell\'s derived module context', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let seen: unknown = 'not-mounted';
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
      ext: {
        extensions: [{
          id: 'engine-probe',
          kind: 'settings-module',
          title: 'Probe',
          icon: 'bug',
          category: 'workspace',
          init() {},
          mount(paneHost: HTMLElement, ctx: never) {
            seen = editHandle(ctx);
            return { destroy() { paneHost.replaceChildren(); } };
          },
        }],
      },
    } as never);

    // Exactly the documented host order: wire AFTER construction (the ctx was
    // built inside the ctor above). A creation-time snapshot in
    // `createExtContext` would have missed this and pinned `null` forever.
    const handle = wireEditIntoKernel(ext.grid);

    ext.openSettings('engine-probe');
    expect(seen).toBe(handle);

    ext.destroy();
    host.remove();
  });
});

describe('editHandle', () => {
  it('reads through ctx.engines rather than the grid expando', () => {
    const grid = makeGrid();
    const ctx = makeCtx(grid);
    expect(editHandle(ctx)).toBeNull();

    // No marker on the grid at all — a pure DI injection must still resolve,
    // which the old `(grid as {__editBridgeWired}).__editBridgeWired` read
    // could never do.
    const injected = { injected: true } as never;
    ctx.engines.register('edit', injected);
    expect(editHandle(ctx)).toBe(injected);
    expect((grid as unknown as Record<string, unknown>).__editBridgeWired).toBeUndefined();
    grid.destroy();
  });
});

describe('modules surface a missing engine instead of no-opping', () => {
  it('Alerts renders the shared engine-missing state when rules cannot wire', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a' }],
      rowData: [{ a: '1' }],
    } as never);

    // Force the lazy wire to fail the way a missing/broken bridge would.
    const grid = ext.grid as unknown as { registerStateModule?: unknown; registerRuleEngine: unknown };
    const boom = () => { throw new Error('bridge unavailable'); };
    const original = grid.registerRuleEngine;
    grid.registerRuleEngine = boom;
    try {
      ext.openSettings('alerts');
      const notice = host.querySelector('.ckp-empty[data-engine="alerts"]');
      expect(notice).toBeTruthy();
      expect(notice!.textContent).toContain('Alerts engine not wired');
      expect(warn).toHaveBeenCalled();
    } finally {
      grid.registerRuleEngine = original;
      ext.destroy();
      host.remove();
      warn.mockRestore();
    }
  });
});
