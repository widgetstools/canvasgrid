/**
 * A profile restored before the columns exist.
 *
 * A saved profile's `columnState` names columns by id, so applying it to a
 * grid that has none matches nothing and is dropped. That is the NORMAL case
 * for a DataProvider app: the host passes `columnDefs: []` and the provider
 * supplies the real columns once its catalog entry binds — well after the
 * constructor fires `profiles.bootstrap()`.
 *
 * The saved widths, order, visibility and sort were read back from storage
 * correctly every time and then thrown away for want of anything to apply
 * them to, so both provider demos came up with the provider's defaults on
 * every reload. It looked like the grid was not SAVING its state.
 *
 * `reapplyActiveProfile` already closes this gap for late-wired state modules
 * (`wireRules` / `wireCalc` / `wireEdit`); columns just arrive on a different
 * clock.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import type { ConfigSession, WorkspaceConfig } from '../src/profiles/configSession';
import type { ProfileSnapshot } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

/** Minimal in-memory session seeded with a layout the grid cannot yet apply. */
class SeededSession implements ConfigSession {
  constructor(readonly gridId: string, private doc: WorkspaceConfig | null) {}
  async loadBundle() { return { docVersion: 1, gridLevelData: {} } as never; }
  async saveBundle() {}
  async loadWorkspace(): Promise<WorkspaceConfig | null> { return this.doc; }
  async saveWorkspace(config: WorkspaceConfig): Promise<void> { this.doc = config; }
  async clearWorkspace(): Promise<void> { this.doc = null; }
  async hasWorkspace(): Promise<boolean> { return this.doc !== null; }
  async getActiveProfileId(): Promise<string> { return 'default'; }
  async setActiveProfileId(): Promise<void> {}
  async list(): Promise<ProfileSnapshot['meta'][]> { return [{ id: 'default', name: 'Default', updatedAt: 0 }]; }
  async load(id: string): Promise<ProfileSnapshot | null> {
    // `switchTo` (which `reapplyActiveProfile` calls) reads through here —
    // returning null made the fixture, not the code, the thing under test.
    if (!this.doc || id !== 'default') return null;
    return { meta: { id, name: 'Default', updatedAt: 0 }, gridState: this.doc as never, ext: {} };
  }
  async save(): Promise<void> {}
  async remove(): Promise<void> {}
}

/** The layout a user saved: b before a, a widened, c hidden. */
const savedWorkspace = (): WorkspaceConfig => ({
  version: 1,
  columnState: [
    { colId: 'b', width: 140, hide: false },
    { colId: 'a', width: 321, hide: false },
    { colId: 'c', width: 100, hide: true },
  ],
} as unknown as WorkspaceConfig);

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The re-apply awaits `bootstrap()` then `switchTo()`, each a store
 *  round-trip, so a couple of microtasks is not enough to see its effect. */
const settle = async () => { for (let i = 0; i < 40; i++) await flush(); };

function mount(columnDefs: unknown[], doc: WorkspaceConfig | null) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ext = new VelocityGridExt(host, {
    getRowId: (r: { a: string }) => r.a,
    columnDefs,
    rowData: [],
    ext: { profiles: { store: new SeededSession('late-cols', doc) } },
  } as never);
  return { ext, host };
}

const state = (ext: VelocityGridExt) => {
  const cs = ext.grid.getColumnState();
  return {
    order: cs.map((c) => c.colId),
    aWidth: cs.find((c) => c.colId === 'a')?.width,
    cHidden: cs.find((c) => c.colId === 'c')?.hide,
  };
};

describe('a profile whose columns arrive after the restore', () => {
  it('applies once the provider supplies them', async () => {
    // The provider-app shape: no columns at construction.
    const { ext } = mount([], savedWorkspace());
    await settle();
    // Nothing to restore onto yet — this is the state that used to persist.
    expect(ext.grid.getColumnState()).toHaveLength(0);

    // The provider binds and installs its columns.
    ext.grid.updateGridOptions({
      columnDefs: [
        { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ],
    } as never);
    await settle();

    expect(state(ext)).toEqual({ order: ['b', 'a', 'c'], aWidth: 321, cHidden: true });
    ext.destroy();
  });

  it('leaves a grid that already had columns alone', async () => {
    // Armed only when the bootstrap restore had nothing to apply to, so an
    // ordinary grid keeps the single restore it always had.
    const { ext } = mount(
      [{ colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' }],
      savedWorkspace(),
    );
    await settle();
    expect(state(ext)).toEqual({ order: ['b', 'a', 'c'], aWidth: 321, cHidden: true });
    ext.destroy();
  });

  it('does not fight a later column change', async () => {
    // One shot: after it fires, the columns a provider installs are the
    // user's own choice and must not be overwritten by the old profile.
    const { ext } = mount([], savedWorkspace());
    await settle();
    ext.grid.updateGridOptions({
      columnDefs: [
        { colId: 'a', field: 'a' }, { colId: 'b', field: 'b' }, { colId: 'c', field: 'c' },
      ],
    } as never);
    await settle();
    // Guard against a false pass: the re-apply must have happened first,
    // otherwise this test proves nothing about it not firing twice.
    expect(state(ext).aWidth).toBe(321);

    ext.grid.applyColumnState({ state: [{ colId: 'a', width: 55 }] });
    ext.grid.setColumnsVisible(['c'], true);
    await settle();

    expect(state(ext).aWidth).toBe(55);
    expect(state(ext).cHidden).toBe(false);
    ext.destroy();
  });
});
