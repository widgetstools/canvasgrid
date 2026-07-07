import type { CGrid } from '@cgrid/kernel';
import type {
  ProfileController, ProfileStore, ProfileMeta, Unsub,
} from '../extension/types';

export interface ProfilesOptions { initialId?: string; extState?: () => Record<string, unknown> }

/** Wave-0 profiles: tracks dirty state (drives the save button) and does a
 *  full-snapshot save/load through a `ProfileStore`. A profile snapshot is
 *  just `grid.getState()` (which already folds in every registered module
 *  slice) plus ext chrome state. Richer switching UI lands in the Profiles
 *  wave against this same class. */
export class ProfilesController implements ProfileController {
  private id: string;
  private dirty = false;
  private listeners = new Set<(d: boolean) => void>();

  constructor(
    private grid: CGrid,
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

  async save(): Promise<void> {
    await this.store.save(this.id, {
      meta: { id: this.id, name: this.id, updatedAt: nowStamp() },
      gridState: this.grid.getState(),
      ext: this.opts.extState?.() ?? {},
    });
    this.setDirty(false);
  }

  async switchTo(id: string): Promise<void> {
    // "Switch to a SAVED profile" — a missing id is a no-op. Load FIRST and
    // only adopt the new id / apply state / clear dirty when the snapshot
    // actually exists; otherwise the active pointer, dirty flag and grid
    // state are all left untouched. (Adopting an unknown id and clearing
    // dirty would silently lose the user's current state pointer.)
    const snap = await this.store.load(id);
    if (!snap) return;
    this.id = id;
    this.grid.setState(snap.gridState);
    this.setDirty(false);
  }

  list(): Promise<ProfileMeta[]> { return this.store.list(); }
}

/** Stamp helper isolated so tests can tolerate happy-dom; avoids importing
 *  Date at module top for clarity. */
function nowStamp(): number { return Date.now(); }
