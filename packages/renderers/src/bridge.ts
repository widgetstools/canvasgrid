// @cgrid/renderers — the kernel bridge. §2.5.
//
// `wireRenderersIntoKernel(grid, opts?)` will register every painter in the
// RENDERER_NAMES table (types.ts) onto a CGrid instance via kernel's PUBLIC
// registration API (`registerCellRenderer`), mirroring
// packages/calc/src/bridge.ts / packages/format/src/bridge.ts / packages/rules/src/bridge.ts:
// structural surface only, zero static kernel value import. It will also:
//   - instantiate ColumnStats/TickHistory LAZILY (only when a `colDef()`
//     builder needs them),
//   - wire the gated 1s repaint interval ONLY when AgeCell/RelativeTimeCell
//     are registered on a column, cleared on destroy,
//   - install the action-click router (HitRegionRegistry, actions.ts) that
//     maps `cellClicked` events to params-declared `onAction`/`onOpen`
//     callbacks.
// Idempotent per grid instance via a `__renderersBridgeWired` marker that
// stores — and re-returns — the SAME handle object.
//
// Registration + the colDef builder namespace ship in a later cycle-21f
// task; this task only reserves the final exported shape.

import { ColumnStats } from './columnStats';
import { TickHistory } from './tickHistory';

/** Structural surface of the CGrid instance (or CGridApi) the bridge
 *  registers against. Type-only — no runtime kernel import. */
interface KernelGridSurface {
  registerCellRenderer(name: string, painter: unknown): void;
  __renderersBridgeWired?: RenderersBridgeHandle;
}

export interface RenderersBridgeOptions {
  /** Columns to opt into ColumnStats tracking (HeatCell/BidirectionalBarCell/VolumeBar). */
  statsColumns?: string[];
  /** Columns to opt into TickHistory tracking (sparkline family, SpreadBarCell), with an
   *  optional per-column ring-buffer window override. */
  historyColumns?: Record<string, { window?: number }>;
}

/** Typed builder namespace — `colDef.price('px')`, `colDef.priceQuote({bid,ask,mid})`, … —
 *  returning ready ColDef objects. Ships in a later cycle-21f task. */
export type RenderersColDefBuilders = Record<string, (...args: never[]) => Record<string, unknown>>;

export interface RenderersBridgeHandle {
  stats: ColumnStats;
  history: TickHistory;
  colDef: RenderersColDefBuilders;
}

/**
 * Wire `@cgrid/renderers` into a CGrid instance. Idempotent — re-calling on
 * an already-wired grid returns the SAME handle.
 */
export function wireRenderersIntoKernel(
  grid: unknown,
  _opts?: RenderersBridgeOptions,
): RenderersBridgeHandle {
  const g = grid as KernelGridSurface;
  if (g.__renderersBridgeWired) return g.__renderersBridgeWired;
  throw new Error('not-yet-implemented: wireRenderersIntoKernel ships in a later cycle-21f task');
}
