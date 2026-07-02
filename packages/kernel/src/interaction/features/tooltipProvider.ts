// Cycle 21c / Task 14 — per-column tooltip provider hook.
//
// Apps (or @cgrid/format's bridge) register a provider per colId via
// `grid.registerTooltipProvider(colId, fn)`. The provider returns
// `{ plain }` or `{ html }` (or null for "no tooltip on this cell").
// The TooltipProvider feature debounces hover 500ms, invokes the
// provider for the hovered cell, and shows a single pooled DOM
// tooltip. Re-hovering a different cell resets the timer; leaving a
// cell (or the grid) cancels the pending debounce and hides.
//
// Sits in the feature chain right after SparklineTooltip (which is the
// specialized sibling for sparkline columns) — both forward via
// `super.handleMouseMove` so neither claims the move.

import { Feature, type CGridEventCtx } from '../feature';

export interface TooltipParams {
  row: unknown;
  colId: string;
  /** Anchor rect in CLIENT (viewport) coordinates. The default
   *  tooltip renders at `(x + w, y)`. */
  rect: { x: number; y: number; w: number; h: number };
}
export type TooltipPayload = { plain: string } | { html: string };
export type TooltipProviderFn = (params: TooltipParams) => TooltipPayload | null;

const DEBOUNCE_MS = 500;
const TOOLTIP_ID = 'cgrid-tooltip-provider';

const providers = new Map<string, TooltipProviderFn>();

export function registerTooltipProvider(colId: string, fn: TooltipProviderFn): void {
  providers.set(colId, fn);
}

export function unregisterTooltipProvider(colId: string): void {
  providers.delete(colId);
}

export function getTooltipProvider(colId: string): TooltipProviderFn | undefined {
  return providers.get(colId);
}

/** Test-only helper. */
export function _resetTooltipProviders_forTests(): void {
  providers.clear();
}

// ─── Feature-chain integration ──────────────────────────────────────

export class TooltipProvider extends Feature {
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCell: TooltipParams | null = null;
  /** Cell identity of the last hover tick — avoids restarting the
   *  debounce while the pointer moves WITHIN the same cell. */
  private lastCellKey: string | null = null;

  override handleMouseMove(ctx: CGridEventCtx): void {
    const hit = ctx.hit;
    if (hit.kind === 'cell' && providers.has(hit.colId)) {
      const key = `${hit.rowIndex}:${hit.colId}`;
      if (key !== this.lastCellKey) {
        this.lastCellKey = key;
        const raw = ctx.raw as MouseEvent;
        this.onCellHover({
          row: ctx.grid.getRowDataAt(hit.rowIndex),
          colId: hit.colId,
          rect: {
            x: raw.clientX ?? 0,
            y: raw.clientY ?? 0,
            w: 12,
            h: 0,
          },
        });
      }
    } else {
      this.lastCellKey = null;
      this.onCellLeave();
    }
    super.handleMouseMove(ctx);
  }

  /** Debounced hover entry point. Public so tests (and custom chains)
   *  can drive the feature without synthesizing DOM events. */
  onCellHover(params: TooltipParams): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.lastCell = params;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (!this.lastCell) return;
      const fn = providers.get(this.lastCell.colId);
      if (!fn) return;
      const payload = fn({
        row: this.lastCell.row,
        colId: this.lastCell.colId,
        rect: this.lastCell.rect,
      });
      if (!payload) return;
      this.showTooltip(payload, this.lastCell.rect);
    }, DEBOUNCE_MS);
  }

  onCellLeave(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.lastCell = null;
    this.hideTooltip();
  }

  /** Overridable — default DOM tooltip using the kernel's tooltip
   *  chrome tokens (`--cg-tooltip-bg/fg/border`). A single element is
   *  pooled on document.body; `{ plain }` renders via textContent,
   *  `{ html }` via innerHTML. */
  showTooltip(payload: TooltipPayload, rect: TooltipParams['rect']): void {
    if (typeof document === 'undefined') return;
    let el = document.getElementById(TOOLTIP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOOLTIP_ID;
      el.style.cssText = [
        'position:fixed',
        'z-index:9999',
        'pointer-events:none',
        'padding:4px 8px',
        'font:12px Inter, system-ui, sans-serif',
        'background:var(--cg-tooltip-bg, rgba(17,24,39,0.92))',
        'color:var(--cg-tooltip-fg, #fff)',
        'border:1px solid var(--cg-tooltip-border, transparent)',
        'border-radius:4px',
        'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(el);
    }
    if ('plain' in payload) {
      el.textContent = payload.plain;
    } else {
      el.innerHTML = payload.html;
    }
    el.style.left = `${rect.x + rect.w}px`;
    el.style.top = `${rect.y}px`;
    el.style.display = 'block';
  }

  hideTooltip(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(TOOLTIP_ID);
    if (el) el.style.display = 'none';
  }
}
