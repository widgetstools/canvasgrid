import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGrid } from '@cgrid/kernel';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeGrid(): CGrid {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new CGrid(host, {
    getRowId: (r: any) => r.a,
    columnDefs: [{ colId: 'a', field: 'a' }],
    rowData: [],
  } as any);
}

describe('createExtContext + ProfilesController', () => {
  it('exposes grid pass-throughs and a dirty-tracking profiles controller', () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    const ctx = createExtContext(grid, profiles);

    expect(ctx.grid).toBe(grid);
    expect(typeof ctx.getState).toBe('function');

    const seen: boolean[] = [];
    ctx.profiles.onDirtyChange(d => seen.push(d));
    expect(ctx.profiles.isDirty()).toBe(false);
    ctx.profiles.markDirty();
    expect(ctx.profiles.isDirty()).toBe(true);
    expect(seen).toEqual([true]);
    grid.destroy();
  });

  it('save() persists a snapshot and clears dirty', async () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    profiles.markDirty();
    await profiles.save();
    expect(profiles.isDirty()).toBe(false);
    expect(await store.load('default')).not.toBeNull();
    grid.destroy();
  });

  it('switchTo(saved) applies the snapshot, clears dirty and moves activeId', async () => {
    const grid = makeGrid();
    // Record setState calls without pulling in vitest's `vi`; save() reads via
    // getState() so replacing setState with a recorder is safe here.
    const setStateCalls: unknown[] = [];
    (grid as any).setState = (s: unknown) => { setStateCalls.push(s); };

    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });

    const savedState = { version: 1, marker: 'saved' } as any;
    await store.save('saved', {
      meta: { id: 'saved', name: 'saved', updatedAt: 1 },
      gridState: savedState,
      ext: {},
    });

    profiles.markDirty();
    await profiles.switchTo('saved');

    expect(setStateCalls).toEqual([savedState]);
    expect(profiles.isDirty()).toBe(false);
    expect(profiles.activeId()).toBe('saved');
    grid.destroy();
  });

  it('switchTo(missing) is a no-op: id, dirty and grid state unchanged', async () => {
    const grid = makeGrid();
    const setStateCalls: unknown[] = [];
    (grid as any).setState = (s: unknown) => { setStateCalls.push(s); };

    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });

    profiles.markDirty();
    const idBefore = profiles.activeId();
    const dirtyBefore = profiles.isDirty();

    await profiles.switchTo('does-not-exist');

    expect(profiles.activeId()).toBe(idBefore);
    expect(profiles.isDirty()).toBe(dirtyBefore);
    expect(setStateCalls).toEqual([]);
    grid.destroy();
  });
});
