// @cgrid/renderers — category 8: Action. Catalog §3.8.
// Hit-region registry for bridge Task 13 click routing (cellClicked event).

import type { CellPaintConfig, CellPainter } from '@cgrid/kernel';
import { withAlpha } from './paintUtils';
import type { IconActionClusterParams, RowMenuCellParams } from './types';

type Gc = Parameters<CellPainter['paint']>[0];

const ICON_HIT = 24;
const KEBAB_SIZE = 20;

/** A single clickable region an action painter registered during its last paint. */
export interface HitRegion {
  rowId: string | number;
  colId: string;
  bounds: { x: number; y: number; w: number; h: number };
  actionIndex: number;
}

function cellKey(rowId: string | number, colId: string): string {
  return `${String(rowId)}\0${colId}`;
}

/**
 * Tracks per-cell hit regions for `icon-action-cluster` / `row-menu` so the
 * bridge's click router can resolve a `cellClicked` event to the params
 * callback that owns the clicked pixel.
 */
export class HitRegionRegistry {
  private readonly byCell = new Map<string, HitRegion[]>();

  register(region: HitRegion): void {
    const key = cellKey(region.rowId, region.colId);
    let list = this.byCell.get(key);
    if (!list) {
      list = [];
      this.byCell.set(key, list);
    }
    const idx = list.findIndex((r) => r.actionIndex === region.actionIndex);
    if (idx >= 0) list[idx] = region;
    else list.push(region);
  }

  resolve(
    rowId: string | number,
    colId: string,
    x: number,
    y: number,
  ): HitRegion | undefined {
    const list = this.byCell.get(cellKey(rowId, colId));
    if (!list) return undefined;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i]!;
      if (x >= r.bounds.x && x <= r.bounds.x + r.bounds.w
        && y >= r.bounds.y && y <= r.bounds.y + r.bounds.h) {
        return r;
      }
    }
    return undefined;
  }

  clear(rowId: string | number, colId: string): void {
    this.byCell.delete(cellKey(rowId, colId));
  }

  clearAll(): void {
    this.byCell.clear();
  }

  /** Evicts every region registered for `rowId` (any colId). Bridge Task 13's
   *  `rowsChanged` handler calls this per removed rowId (F3) — without it a
   *  removed row's regions stay resolvable forever (module-global registry,
   *  never otherwise evicted). */
  clearForRow(rowId: string | number): void {
    const prefix = `${String(rowId)}\0`;
    for (const key of this.byCell.keys()) {
      if (key.startsWith(prefix)) this.byCell.delete(key);
    }
  }
}

/** Shared registry instance; bridge Task 13 wires cellClicked → resolve(). */
export const defaultHitRegionRegistry = new HitRegionRegistry();

/** Evicts every hit region registered for `rowId` on the default registry.
 *  Per-bridge registry instances (rather than one module-global) are a
 *  logged follow-up (F3). */
export function clearRegionsForRow(rowId: string | number): void {
  defaultHitRegionRegistry.clearForRow(rowId);
}

function paintKebab(gc: Gc, cx: number, cy: number, color: string): void {
  const r = 1.5;
  const gap = 4;
  gc.cache.fillStyle = color;
  for (let i = -1; i <= 1; i++) {
    gc.beginPath();
    gc.arc(cx, cy + i * gap, r, 0, Math.PI * 2);
    gc.fill();
  }
}

/**
 * B2 — module-level Lucide icon resolver, set by the kernel bridge
 * (`bridge.ts`'s `wireRenderersIntoKernel`) using the grid's ALREADY-PUBLIC
 * `resolveIcon(name, setHint)` method (`CGridApi.resolveIcon`, populated by
 * `@cgrid/format`'s `wireIntoKernel` registering the Lucide bundle under the
 * `'lucide'` set — see `packages/format/src/bridge.ts`). This is a ZERO
 * kernel-diff path: renderers imports kernel TYPE-only, so resolution can't
 * go through a new `CellPaintConfig` channel; instead the bridge (which
 * already holds the live grid instance) pushes a resolver function in here.
 * Unset (`null`) in unit tests that exercise the painter directly without a
 * wired bridge — `paintActionIcon` falls back to the letter badge below.
 */
type ActionIconResolver = (name: string, setHint?: string) => Path2D | null;
let iconResolver: ActionIconResolver | null = null;

/** @internal Called by `wireRenderersIntoKernel` (wire) / `destroy` (unwire). */
export function setActionIconResolver(resolver: ActionIconResolver | null): void {
  iconResolver = resolver;
}

const ICON_SIZE = 14;

function paintActionIcon(
  gc: Gc,
  cx: number,
  cy: number,
  icon: string | undefined,
  label: string,
  color: string,
  font: string,
): void {
  gc.cache.strokeStyle = withAlpha(color, 0.35);
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.arc(cx, cy, ICON_HIT / 2 - 2, 0, Math.PI * 2);
  gc.stroke();

  const path = icon ? iconResolver?.(icon, 'lucide') ?? null : null;
  if (path) {
    // Catalog §2.2 — Path2D glyph centered in the hit circle, stroke-style,
    // 1.5px, tinted with the cell's fg. Lucide viewBox is 24×24 (mirrors
    // kernel composite.ts's icon-fragment paint precedent).
    const scale = ICON_SIZE / 24;
    gc.cache.save();
    gc.translate(cx - ICON_SIZE / 2, cy - ICON_SIZE / 2);
    gc.scale(scale, scale);
    gc.cache.strokeStyle = color;
    gc.cache.lineWidth = 1.5 / scale;
    gc.cache.lineCap = 'round';
    gc.cache.lineJoin = 'round';
    gc.stroke(path);
    gc.cache.restore();
    return;
  }

  // Fallback: letter-in-circle, ONLY when the icon name doesn't resolve
  // (e.g. bridge not wired, or an unknown/typo'd Lucide name).
  gc.cache.fillStyle = color;
  gc.cache.textAlign = 'center';
  gc.cache.textBaseline = 'alphabetic';
  gc.cache.font = `600 10px ${font.match(/(\d+px\s+.+)$/)?.[1] ?? 'sans-serif'}`;
  gc.fillText(label.charAt(0).toUpperCase(), cx, cy + 3);
}

/**
 * Catalog §3.8 IconActionCluster — hover-revealed right-aligned icon cluster.
 *
 * See the `IconActionClusterParams.revealOnHover` doc comment (types.ts) —
 * the kernel doesn't thread live hover state, so gating on `p.isHovered`
 * unconditionally would make this painter unreachable. Only gates on
 * `p.isHovered` when the column opts in via `revealOnHover: true`.
 */
export const iconActionCluster: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as IconActionClusterParams;
    if (!params.actions?.length) return;
    if (params.revealOnHover === true && !p.isHovered) return;
    const rowId = p.rowId ?? '';
    const colId = p.colId ?? '';
    if (rowId !== '' && colId !== '') defaultHitRegionRegistry.clear(rowId, colId);
    const count = params.actions.length;
    const totalW = count * ICON_HIT + (count - 1) * 4;
    let x = p.bounds.x + p.bounds.w - totalW - (p.padding?.right ?? 6);
    const cy = p.bounds.y + p.bounds.h / 2;
    for (let i = 0; i < count; i++) {
      const action = params.actions[i]!;
      const cx = x + ICON_HIT / 2;
      paintActionIcon(gc, cx, cy, action.icon, action.label, p.fg, p.font);
      if (rowId !== '' && colId !== '') {
        defaultHitRegionRegistry.register({
          rowId,
          colId,
          actionIndex: i,
          bounds: { x, y: cy - ICON_HIT / 2, w: ICON_HIT, h: ICON_HIT },
        });
      }
      x += ICON_HIT + 4;
    }
  },
};

/** Catalog §3.8 RowMenuCell — 20×20 kebab; host opens context menu on click. */
export const rowMenuCell: CellPainter = {
  paint(gc, p) {
    const params = (p.params ?? {}) as RowMenuCellParams;
    void params;
    const rowId = p.rowId ?? '';
    const colId = p.colId ?? '';
    const x = p.bounds.x + p.bounds.w - KEBAB_SIZE - (p.padding?.right ?? 6);
    const y = p.bounds.y + (p.bounds.h - KEBAB_SIZE) / 2;
    paintKebab(gc, x + KEBAB_SIZE / 2, y + KEBAB_SIZE / 2, withAlpha(p.fg, 0.75));
    if (rowId !== '' && colId !== '') {
      defaultHitRegionRegistry.clear(rowId, colId);
      defaultHitRegionRegistry.register({
        rowId,
        colId,
        actionIndex: 0,
        bounds: { x, y, w: KEBAB_SIZE, h: KEBAB_SIZE },
      });
    }
  },
};

/**
 * Resolves a canvas click to a registered hit region.
 * Bridge Task 13 maps this to IconActionSpec.onAction / RowMenuCellParams.onOpen.
 * Kernel event: `{ type: 'cellClicked', rowId, colId, value, mouse }`.
 * Context menu host API: `grid.openContextMenu(items, x, y, hit)`.
 */
export function resolveHitRegion(
  rowId: string | number,
  colId: string,
  x: number,
  y: number,
  registry: HitRegionRegistry = defaultHitRegionRegistry,
): HitRegion | undefined {
  return registry.resolve(rowId, colId, x, y);
}
