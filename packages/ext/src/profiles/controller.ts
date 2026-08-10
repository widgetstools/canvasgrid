import type { VelocityGrid, GridState, GridLayoutsBundle } from '@wellsfargo-starui/velocity-grid';
import type {
  ProfileController, ProfileStore, ProfileMeta, Unsub,
} from '../extension/types';
import { isConfigSession, type WorkspaceConfig } from './configSession';

export interface ProfilesOptions { initialId?: string; extState?: () => Record<string, unknown> }

/** Wave-0 profiles: dirty tracking + snapshot save/load/switch through a
 *  `ProfileStore`. Title-bar UI (`profilesMenu`) drives this controller. */
export class ProfilesController implements ProfileController {
  private id: string;
  private dirty = false;
  private listeners = new Set<(d: boolean) => void>();
  private metaListeners = new Set<() => void>();
  /** Coalesces concurrent / repeat `bootstrap()` calls (ctor fire-and-forget
   *  + host `reapplyActiveProfile` after late-wired state modules). */
  private bootPromise: Promise<void> | null = null;

  constructor(
    private grid: VelocityGrid,
    private store: ProfileStore,
    private opts: ProfilesOptions = {},
  ) {
    this.id = opts.initialId ?? 'default';
  }

  activeId(): string { return this.id; }
  isDirty(): boolean { return this.dirty; }

  markDirty(): void { this.setDirty(true); }
  private setDirty(v: boolean): void {
    if (this.dirty === v) return;
    this.dirty = v;
    for (const fn of this.listeners) fn(v);
  }
  onDirtyChange(fn: (d: boolean) => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onListChange(fn: () => void): Unsub {
    this.metaListeners.add(fn);
    return () => this.metaListeners.delete(fn);
  }
  private notifyList(): void {
    for (const fn of this.metaListeners) fn();
  }

  private snapshot(id: string, name?: string): {
    meta: ProfileMeta;
    gridState: GridState;
    ext: Record<string, unknown>;
  } {
    return {
      meta: { id, name: name ?? id, updatedAt: Date.now() },
      gridState: this.grid.getState(),
      ext: this.opts.extState?.() ?? {},
    };
  }

  async save(): Promise<void> {
    // ConfigSession: persist the full workspace (view state + layouts) in one
    // flat document — not a profiles[] slot that omits layouts.
    if (isConfigSession(this.store)) {
      const layouts = typeof this.grid.exportLayouts === 'function'
        ? this.grid.exportLayouts()
        : undefined;
      const config: WorkspaceConfig = {
        ...this.grid.getState(),
        ...(layouts ? { layouts: layouts as GridLayoutsBundle } : {}),
      };
      await this.store.saveWorkspace(config);
      await this.syncActivePointer();
      this.setDirty(false);
      this.notifyList();
      return;
    }
    const existing = await this.store.load(this.id);
    const name = existing?.meta.name ?? this.id;
    await this.store.save(this.id, this.snapshot(this.id, name));
    await this.syncActivePointer();
    this.setDirty(false);
    this.notifyList();
  }

  /** Revert the grid to the last saved snapshot of the active profile. */
  async discard(): Promise<void> {
    await this.switchTo(this.id);
  }

  async saveAs(name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Profile name is required');
    const id = slugId(trimmed);
    const list = await this.store.list();
    if (list.some((m) => m.id === id)) {
      throw new Error(`Profile '${trimmed}' already exists`);
    }
    await this.store.save(id, this.snapshot(id, trimmed));
    this.id = id;
    await this.syncActivePointer();
    this.setDirty(false);
    this.notifyList();
    return id;
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Profile name is required');
    const snap = await this.store.load(id);
    if (!snap) throw new Error(`Profile '${id}' not found`);
    snap.meta = { ...snap.meta, name: trimmed, updatedAt: Date.now() };
    await this.store.save(id, snap);
    this.notifyList();
  }

  async remove(id: string): Promise<void> {
    if (id === this.id) throw new Error('Cannot delete the active profile');
    await this.store.remove(id);
    this.notifyList();
  }

  async switchTo(id: string): Promise<void> {
    // "Switch to a SAVED profile" — a missing id is a no-op. Load FIRST and
    // only adopt the new id / apply state / clear dirty when the snapshot
    // actually exists; otherwise the active pointer, dirty flag and grid
    // state are all left untouched.
    if (isConfigSession(this.store)) {
      const snap = await this.store.load(id);
      if (!snap) return;
      const ws = await this.store.loadWorkspace();
      if (!ws) return;
      this.id = id;
      this.applyWorkspace(ws);
      await this.syncActivePointer();
      this.setDirty(false);
      this.notifyList();
      return;
    }
    const snap = await this.store.load(id);
    if (!snap) return;
    this.id = id;
    this.grid.setState(snap.gridState);
    await this.syncActivePointer();
    this.setDirty(false);
    this.notifyList();
  }

  /** Load `initialId` if it exists; otherwise seed a 'default' snapshot
   *  from the current grid so the switcher is never empty. Idempotent —
   *  concurrent callers share one in-flight promise. */
  async bootstrap(): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = this.runBootstrap();
    try {
      await this.bootPromise;
    } finally {
      // Allow a later explicit re-bootstrap only via switchTo / discard;
      // keep the settled promise so repeat bootstrap() is a cheap no-op
      // that still awaits completion for late callers.
    }
    return this.bootPromise;
  }

  /**
   * Restore ConfigSession workspace the same way as `VelocityGridExt.loadConfig`:
   * layouts registry (incl. `activeLayoutId`) first, then view state.
   * Uses `apply: false` so replace does not loadLayout + emit persistable
   * `import` before grid-tier modules (data-provider) are restored.
   */
  private applyWorkspace(ws: WorkspaceConfig): void {
    const { layouts, ...viewState } = ws;
    if (layouts && typeof this.grid.importLayouts === 'function') {
      this.grid.importLayouts(layouts, { mode: 'replace', overwrite: true, apply: false });
    }
    this.grid.setState(viewState as GridState, { exhaustive: true });
  }

  private async runBootstrap(): Promise<void> {
    if (isConfigSession(this.store)) {
      const ws = await this.store.loadWorkspace();
      if (ws) {
        this.applyWorkspace(ws);
        await this.syncActivePointer();
        this.setDirty(false);
        this.notifyList();
        return;
      }
      // Seed the flat workspace (view + layouts/activeLayoutId), not a profile slot.
      await this.save();
      await this.syncActivePointer();
      this.setDirty(false);
      this.notifyList();
      return;
    }
    const existing = await this.store.load(this.id);
    if (existing) {
      this.grid.setState(existing.gridState);
      await this.syncActivePointer();
      this.setDirty(false);
      this.notifyList();
      return;
    }
    await this.store.save(this.id, this.snapshot(this.id, this.id === 'default' ? 'Default' : this.id));
    await this.syncActivePointer();
    this.setDirty(false);
    this.notifyList();
  }

  list(): Promise<ProfileMeta[]> { return this.store.list(); }

  /** Keep ConfigSession facade meta.id aligned with the controller pointer. */
  private async syncActivePointer(): Promise<void> {
    if (isConfigSession(this.store)) {
      await this.store.setActiveProfileId(this.id);
    }
  }
}

function slugId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  return base.slice(0, 48);
}
