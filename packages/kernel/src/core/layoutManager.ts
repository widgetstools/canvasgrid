/**
 * Grid Layouts — Phase A / Unit A1: the LayoutManager.
 *
 * Owns the layouts registry, the active layout id, the construction
 * baseline (retained so `resetLayout` can restore a layout to the view
 * the grid was built with), and the Default-layout invariants.
 *
 * DESIGN — pure engine, injected host. The manager never touches a real
 * grid: every coupling point is a callback on {@link LayoutManagerHost}
 * (`captureState`/`applyState`/`newId`/`now`). This is what lets A1 be
 * unit-tested in isolation with mock accessors, and lets A3 wire the real
 * grid in through thin accessors without reshaping this file. Two things
 * are DELIBERATELY out of A1 and land later:
 *  - `overrides` (grid-option / editing deltas) — captured in A2; the A1
 *    engine only carries the field through, it never fills it.
 *  - persistence + events — A5 / A3.
 *
 * INVARIANTS this file guarantees:
 *  - A Default layout ({@link DEFAULT_LAYOUT_ID}) always exists and is
 *    undeletable; its id is fixed but its display name is editable (§9).
 *  - `activeLayoutId` always names a live layout; deleting the active
 *    layout falls back to Default and re-applies Default's view (§12).
 *  - Layout display names are unique grid-wide (trimmed, case-insensitive).
 *
 * Reference: docs/superpowers/specs/2026-07-05-grid-layouts-design.md §§8–9, §12.
 */

import type { GridLayout, LayoutState } from '../types/layout';
import { DEFAULT_LAYOUT_ID } from '../types/layout';

/** The grid coupling the manager needs, injected so the engine stays
 *  pure and testable. A3 supplies the real implementations; A1 tests
 *  supply mocks. */
export interface LayoutManagerHost {
  /** Snapshot the current live view as a LayoutState. The tier filtering
   *  that decides WHAT this includes is A2's concern; the manager treats
   *  the result as an opaque, JSON-serializable snapshot. */
  captureState(): LayoutState;
  /** Apply a LayoutState to the live grid (used on load / active-delete
   *  fallback / active-reset). */
  applyState(state: LayoutState): void;
  /** Mint a fresh, unique id for a newly created (non-default) layout. */
  newId(): string;
  /** Monotonic wall-clock (ms) for `updatedAt` stamps — injected so the
   *  engine never reads the system clock itself (mirrors calc's
   *  host-stamped timestamps). */
  now(): number;
}

/** Construction inputs. */
export interface LayoutManagerInit {
  /** The construction baseline view — seeds a synthesized Default and
   *  backs `resetLayout`. Retained verbatim (deep-cloned) for the
   *  manager's lifetime. */
  baseline: LayoutState;
  /** Seed layouts (from construction options or, later, a persisted
   *  bundle). A Default is synthesized and prepended when none is
   *  present; a supplied Default is kept as-is. */
  layouts?: GridLayout[];
  /** Initial active layout. Ignored (falls back to Default) when it does
   *  not name a supplied layout. */
  activeLayoutId?: string;
}

/** Options common to the layout-creating operations. */
export interface SaveLayoutOptions {
  /** Make the new layout active. Defaults documented per method:
   *  `saveLayout` activates (the capture equals the current view, so it
   *  is a metadata switch); `duplicateLayout` does not (the copy's view
   *  may differ from what's on screen). */
  activate?: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Normalize a display name for uniqueness comparison + storage. */
function normName(name: string): string {
  return name.trim();
}
function nameKey(name: string): string {
  return normName(name).toLowerCase();
}

export class LayoutManager {
  private readonly host: LayoutManagerHost;
  /** The construction baseline, retained for `resetLayout`. */
  private readonly baseline: LayoutState;
  /** Ordered registry. Default is guaranteed present; order otherwise
   *  follows insertion / the supplied order. */
  private layouts: GridLayout[];
  private activeId: string;

  constructor(host: LayoutManagerHost, init: LayoutManagerInit) {
    this.host = host;
    this.baseline = clone(init.baseline);

    // Adopt supplied layouts (deep-cloned so external mutation can't leak
    // into the registry), then guarantee a Default exists.
    this.layouts = (init.layouts ?? []).map((l) => clone(l));
    if (!this.layouts.some((l) => l.id === DEFAULT_LAYOUT_ID)) {
      this.layouts.unshift({
        id: DEFAULT_LAYOUT_ID,
        name: 'Default',
        state: clone(this.baseline),
      });
    }

    // Active id must name a live layout; otherwise fall back to Default.
    this.activeId =
      init.activeLayoutId && this.has(init.activeLayoutId)
        ? init.activeLayoutId
        : DEFAULT_LAYOUT_ID;
  }

  // ── reads ────────────────────────────────────────────────────────────

  /** All layouts, as defensive clones (Default always included). */
  getLayouts(): GridLayout[] {
    return this.layouts.map((l) => clone(l));
  }

  getActiveLayoutId(): string {
    return this.activeId;
  }

  /** The active layout, as a defensive clone. Always valid (invariant). */
  getActiveLayout(): GridLayout {
    return clone(this.require(this.activeId));
  }

  // ── mutations ────────────────────────────────────────────────────────

  /** Create a NEW layout capturing the current view. Activates it by
   *  default (the capture equals the live view, so no re-apply needed). */
  saveLayout(name: string, opts?: SaveLayoutOptions): GridLayout {
    const clean = this.assertUsableName(name);
    const layout: GridLayout = {
      id: this.host.newId(),
      name: clean,
      state: this.host.captureState(),
      updatedAt: this.host.now(),
    };
    this.layouts.push(layout);
    if (opts?.activate !== false) {
      // The captured state IS the live view — activate without re-applying.
      this.activeId = layout.id;
    }
    return clone(layout);
  }

  /** Recapture the current view into an existing layout (default: the
   *  active one). Does not change which layout is active. */
  updateLayout(id?: string): GridLayout {
    const layout = this.require(id ?? this.activeId);
    layout.state = this.host.captureState();
    layout.updatedAt = this.host.now();
    return clone(layout);
  }

  /** Make `id` active and apply its stored view to the grid. */
  loadLayout(id: string): GridLayout {
    const layout = this.require(id);
    this.activeId = layout.id;
    this.host.applyState(clone(layout.state));
    return clone(layout);
  }

  /** Delete a layout. Default is undeletable; deleting the active layout
   *  falls back to Default and re-applies Default's view. */
  deleteLayout(id: string): void {
    if (id === DEFAULT_LAYOUT_ID) {
      throw new Error('[cgrid] the Default layout cannot be deleted');
    }
    const idx = this.indexOf(id); // throws on unknown
    this.layouts.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = DEFAULT_LAYOUT_ID;
      this.host.applyState(clone(this.require(DEFAULT_LAYOUT_ID).state));
    }
  }

  /** Rename a layout's display name (unique, non-empty). The Default's
   *  display name is editable — only its id is fixed (§9). */
  renameLayout(id: string, name: string): GridLayout {
    const layout = this.require(id);
    const clean = this.assertUsableName(name, id);
    layout.name = clean;
    layout.updatedAt = this.host.now();
    return clone(layout);
  }

  /** Clone an existing layout under a fresh id + unique name. Does NOT
   *  activate by default (the copy may differ from the on-screen view);
   *  pass `{ activate: true }` to switch to it. */
  duplicateLayout(id: string, name: string, opts?: SaveLayoutOptions): GridLayout {
    const source = this.require(id);
    const clean = this.assertUsableName(name);
    const dup: GridLayout = {
      ...clone(source),
      id: this.host.newId(),
      name: clean,
      updatedAt: this.host.now(),
    };
    this.layouts.push(dup);
    if (opts?.activate === true) {
      this.activeId = dup.id;
      this.host.applyState(clone(dup.state));
    }
    return clone(dup);
  }

  /** Reset a layout (default: the active one) to the construction
   *  baseline. Re-applies the baseline view when the reset layout is
   *  active. */
  resetLayout(id?: string): GridLayout {
    const layout = this.require(id ?? this.activeId);
    layout.state = clone(this.baseline);
    layout.overrides = undefined;
    layout.updatedAt = this.host.now();
    if (layout.id === this.activeId) {
      this.host.applyState(clone(this.baseline));
    }
    return clone(layout);
  }

  // ── internals ────────────────────────────────────────────────────────

  private has(id: string): boolean {
    return this.layouts.some((l) => l.id === id);
  }

  private indexOf(id: string): number {
    const idx = this.layouts.findIndex((l) => l.id === id);
    if (idx === -1) throw new Error(`[cgrid] unknown layout id '${id}'`);
    return idx;
  }

  private require(id: string): GridLayout {
    const layout = this.layouts.find((l) => l.id === id);
    if (!layout) throw new Error(`[cgrid] unknown layout id '${id}'`);
    return layout;
  }

  /** Validate a display name: non-empty after trimming, and unique
   *  grid-wide (case-insensitive) excluding `exceptId`. Returns the
   *  trimmed name to store. */
  private assertUsableName(name: string, exceptId?: string): string {
    const clean = normName(name);
    if (clean.length === 0) {
      throw new Error('[cgrid] a layout name cannot be empty');
    }
    const key = nameKey(clean);
    const clash = this.layouts.some((l) => l.id !== exceptId && nameKey(l.name) === key);
    if (clash) {
      throw new Error(`[cgrid] a layout named '${clean}' already exists`);
    }
    return clean;
  }
}
