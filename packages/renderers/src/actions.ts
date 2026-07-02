// @cgrid/renderers — category 8: Action. Catalog §3.8.
// Skeleton painters (final signatures; Phase B/C tasks fill in `paint`).
// Params types: see types.ts (IconActionClusterParams, RowMenuCellParams, …).
//
// Hit-region registry: action painters register the same bounds math they
// paint with, so the bridge's click router (bridge.ts) can map a `cellClicked`
// event to the params-declared `onAction`/`onOpen` callback without
// re-deriving layout math at click time.

import type { CellPainter } from '@cgrid/kernel';

/** Catalog §3.8 IconActionCluster — params: `IconActionClusterParams`. */
export const iconActionCluster: CellPainter = {
  paint() {
    throw new Error('not implemented: icon-action-cluster');
  },
};

/** Catalog §3.8 RowMenuCell — params: `RowMenuCellParams`. */
export const rowMenuCell: CellPainter = {
  paint() {
    throw new Error('not implemented: row-menu');
  },
};

/** A single clickable region an action painter registered during its last paint. */
export interface HitRegion {
  rowId: string | number;
  colId: string;
  bounds: { x: number; y: number; w: number; h: number };
  actionIndex: number;
}

/**
 * Tracks per-cell hit regions for `icon-action-cluster` / `row-menu` so the
 * bridge's click router can resolve a `cellClicked` event to the params
 * callback that owns the clicked pixel. One instance per grid (bridge.ts owns
 * the lifecycle); painters register regions, the router consumes them.
 */
export class HitRegionRegistry {
  constructor() {
    throw new Error('not-yet-implemented: HitRegionRegistry ships in a later cycle-21f task');
  }
  register(_region: HitRegion): void {
    throw new Error('not-yet-implemented: HitRegionRegistry.register ships in a later cycle-21f task');
  }
  resolve(_rowId: string | number, _colId: string, _x: number, _y: number): HitRegion | undefined {
    throw new Error('not-yet-implemented: HitRegionRegistry.resolve ships in a later cycle-21f task');
  }
  clear(_rowId: string | number, _colId: string): void {
    throw new Error('not-yet-implemented: HitRegionRegistry.clear ships in a later cycle-21f task');
  }
}
