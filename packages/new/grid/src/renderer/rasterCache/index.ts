/**
 * RasterCache core (Cycle 22 / Task 1) — keys, shared byte budget, epochs,
 * and the two pure bitmap stores. Consumed by the later integration tasks:
 * Tier 1 (`CellBitmapCache` + `cellStyleSignature`/`cellCacheBypass`) at
 * the byRows cell-paint seam, Tier 2 (`RowStripCache`) in the retained
 * paint-cache layer's band raster. Both tiers charge the ONE
 * `RasterBudget`, so eviction is a single global LRU across cell bitmaps
 * AND row strips. `surfacePool.ts` (canvas recycling) is internal — not
 * re-exported here.
 */

export { RasterBudget, type RasterLedgerEntry, type RasterLedgerToken } from './budget';
export { cellStyleSignature, cellCacheBypass, CellBitmapCache } from './cellCache';
export { RowStripCache, type StripKey } from './stripCache';
