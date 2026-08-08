import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeGrid(): VelocityGrid {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new VelocityGrid(host, {
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

  it('bootstrap seeds a default profile when the store is empty', async () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    const listEvents: number[] = [];
    profiles.onListChange(() => listEvents.push(1));

    await profiles.bootstrap();

    expect(profiles.activeId()).toBe('default');
    expect(profiles.isDirty()).toBe(false);
    const loaded = await store.load('default');
    expect(loaded?.meta.name).toBe('Default');
    expect(listEvents.length).toBeGreaterThanOrEqual(1);
    grid.destroy();
  });

  it('saveAs creates a new id, activates it, and rejects duplicates', async () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    await profiles.bootstrap();

    const id = await profiles.saveAs('Desk Alpha');
    expect(id).toBe('desk-alpha');
    expect(profiles.activeId()).toBe('desk-alpha');
    expect((await store.load('desk-alpha'))?.meta.name).toBe('Desk Alpha');

    await expect(profiles.saveAs('Desk Alpha')).rejects.toThrow(/already exists/);
    grid.destroy();
  });

  it('rename updates meta; remove refuses the active profile', async () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    await profiles.bootstrap();
    await profiles.saveAs('Keep');
    await profiles.saveAs('Drop');
    // saveAs activates the new profile — switch away before delete.
    await profiles.switchTo('keep');

    await profiles.rename('keep', 'Keeper');
    expect((await store.load('keep'))?.meta.name).toBe('Keeper');

    await expect(profiles.remove('drop')).resolves.toBeUndefined();
    expect(await store.load('drop')).toBeNull();
    await expect(profiles.remove(profiles.activeId())).rejects.toThrow(/active profile/);
    grid.destroy();
  });
});
