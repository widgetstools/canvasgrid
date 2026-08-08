/**
 * Cycle 21i / Phase 1 (T2) — native grid-state persistence.
 *
 * A grid constructed with `gridId` + `persistState` automatically restores
 * its full `GridState` snapshot on construction and autosaves it (debounced)
 * on every coalesced `stateUpdated` emit. The storage backend is pluggable:
 * the default adapter writes `localStorage` under `velocity-grid:state:<gridId>`;
 * container apps swap in their own `StateStorageAdapter` to persist through
 * a config service (REST / IndexedDB / host ConfigManager) without touching
 * anything else.
 *
 * Concurrency is deliberately last-write-wins — multi-tab coordination and
 * optimistic locking are host-adapter territory (per the platform docs'
 * "host owns storage" principle).
 */

import type { GridState } from './stateSnapshot';

/** Pluggable storage backend for persisted grid state. Methods may be
 *  synchronous or return promises — the controller awaits either. */
export interface StateStorageAdapter {
  load(gridId: string): GridState | null | Promise<GridState | null>;
  save(gridId: string, state: GridState): void | Promise<void>;
  clear(gridId: string): void | Promise<void>;
}

/** Object form of `VelocityGridOptions.persistState`. */
export interface PersistStateOptions {
  /** Storage backend. Defaults to the localStorage adapter. */
  adapter?: StateStorageAdapter;
  /** Debounce for autosave writes, in ms. Default 500. */
  debounceMs?: number;
}

export const DEFAULT_PERSIST_DEBOUNCE_MS = 500;

const STORAGE_KEY_PREFIX = 'velocity-grid:state:';

export function persistenceStorageKey(gridId: string): string {
  return `${STORAGE_KEY_PREFIX}${gridId}`;
}

/** Default adapter — window.localStorage, JSON round-trip. Quota or parse
 *  failures degrade to warnings; persistence must never take the grid down. */
export class LocalStorageStateAdapter implements StateStorageAdapter {
  load(gridId: string): GridState | null {
    try {
      const raw = globalThis.localStorage?.getItem(persistenceStorageKey(gridId));
      if (!raw) return null;
      return JSON.parse(raw) as GridState;
    } catch (err) {
      console.warn('[velocity-grid] persistState: failed to load saved state', err);
      return null;
    }
  }

  save(gridId: string, state: GridState): void {
    try {
      globalThis.localStorage?.setItem(persistenceStorageKey(gridId), JSON.stringify(state));
    } catch (err) {
      console.warn('[velocity-grid] persistState: failed to save state', err);
    }
  }

  clear(gridId: string): void {
    try {
      globalThis.localStorage?.removeItem(persistenceStorageKey(gridId));
    } catch {
      /* removing a missing key can't meaningfully fail */
    }
  }
}

export interface StatePersistenceHooks {
  /** Apply a restored snapshot (the grid's ordered `setState`). */
  applyState(state: GridState): void;
  /** Subscribe to the coalesced `stateUpdated` emit; returns unsubscribe.
   *  The controller only needs the snapshot payload. */
  onStateUpdated(fn: (state: GridState) => void): () => void;
}

/**
 * Orchestrates restore-then-autosave for one grid instance.
 *
 * Lifecycle: `restore()` (await the adapter, apply if found) → autosave
 * subscription arms only AFTER restore resolves, so construction-time
 * `stateUpdated` emits can never clobber the saved snapshot with the
 * pre-restore state.
 */
export class StatePersistenceController {
  private readonly adapter: StateStorageAdapter;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: GridState | null = null;
  private unsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly gridId: string,
    opts: PersistStateOptions,
    private readonly hooks: StatePersistenceHooks,
  ) {
    this.adapter = opts.adapter ?? new LocalStorageStateAdapter();
    this.debounceMs = opts.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
  }

  /** Load + apply the saved snapshot (if any), then arm autosave. */
  async restore(): Promise<void> {
    let saved: GridState | null = null;
    try {
      saved = await this.adapter.load(this.gridId);
    } catch (err) {
      console.warn('[velocity-grid] persistState: adapter.load failed', err);
    }
    if (this.destroyed) return;
    if (saved) {
      try {
        this.hooks.applyState(saved);
      } catch (err) {
        console.warn('[velocity-grid] persistState: failed to apply saved state', err);
      }
    }
    this.unsubscribe = this.hooks.onStateUpdated((state) => this.scheduleSave(state));
  }

  private scheduleSave(state: GridState): void {
    if (this.destroyed) return;
    this.pending = state;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /** Write the pending snapshot now (debounce bypass; used on destroy). */
  flush(): void {
    if (this.pending === null) return;
    const state = this.pending;
    this.pending = null;
    try {
      void this.adapter.save(this.gridId, state);
    } catch (err) {
      console.warn('[velocity-grid] persistState: adapter.save failed', err);
    }
  }

  /** Remove the persisted snapshot (does not touch live grid state). */
  clear(): void {
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      void this.adapter.clear(this.gridId);
    } catch (err) {
      console.warn('[velocity-grid] persistState: adapter.clear failed', err);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Persist whatever was pending so a page unload right after a change
    // doesn't lose the last edit.
    this.flush();
  }
}
