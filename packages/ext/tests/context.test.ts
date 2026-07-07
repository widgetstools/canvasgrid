import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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
});
