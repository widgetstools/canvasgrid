/**
 * Cycle 21 / Task 3 — sparkline tooltip overlay.
 *
 * Hover-anchored tooltip showing the closest data point under the
 * pointer. A single DOM element is pooled at the grid's overlay host —
 * NO per-cell DOM. Positioning is plain `left` / `top` inline styles so
 * tracking the pointer is a pure DOM update; the canvas is NOT
 * repainted while the tooltip moves.
 *
 * The feature asks the grid via `getSparklineData(rowIndex, colId)`
 * whether the column under the cursor uses the `'sparkline'` cell
 * renderer. A non-null array activates the tooltip; `null` hides it.
 * That hook keeps the feature out of column-def resolution and lets
 * the grid stay the single source of truth for "is this cell a
 * sparkline?".
 */
import { Feature, type CGridEventCtx } from '../feature';

const VERTICAL_OFFSET = 24;

export class SparklineTooltip extends Feature {
  private tooltipEl: HTMLElement | null = null;

  override handleMouseMove(ctx: CGridEventCtx): void {
    this.updateTooltip(ctx);
    super.handleMouseMove(ctx);
  }

  private updateTooltip(ctx: CGridEventCtx): void {
    const hit = ctx.hit;
    if (hit.kind !== 'cell') {
      this.hide();
      return;
    }

    const data = ctx.grid.getSparklineData(hit.rowIndex, hit.colId);
    if (!data || data.length === 0) {
      this.hide();
      return;
    }

    const raw = ctx.raw as MouseEvent;
    const cellLeft = ctx.grid.columnLeftOf(hit.colId);
    const cellWidth = ctx.grid.columnWidthOf(hit.colId);
    if (cellLeft === null || cellWidth === null) {
      this.hide();
      return;
    }

    // Match the painter's 2px inner padding so the leftmost data point
    // anchors at the very edge of the cell's painted band, not at the
    // raw column edge. With N=1 there's nothing to interpolate — the
    // single point IS the nearest at every x.
    const innerLeft = cellLeft + 2;
    const innerWidth = Math.max(1, cellWidth - 4);
    const ratio = data.length > 1
      ? clamp((raw.offsetX - innerLeft) / innerWidth, 0, 1)
      : 0;
    const index = data.length > 1
      ? Math.round(ratio * (data.length - 1))
      : 0;
    const value = data[index]!;

    const el = this.ensureEl(ctx);
    el.textContent = `${index}: ${formatValue(value)}`;
    el.style.left = `${raw.clientX}px`;
    el.style.top = `${raw.clientY - VERTICAL_OFFSET}px`;
    el.style.display = '';
  }

  private ensureEl(ctx: CGridEventCtx): HTMLElement {
    if (this.tooltipEl) return this.tooltipEl;
    const host = ctx.grid.getOverlayHost();
    const el = document.createElement('div');
    el.className = 'cg-sparkline-tooltip';
    el.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:9999',
      'padding:4px 8px',
      'font: 12px Inter, system-ui, sans-serif',
      'background:var(--cg-tooltip-bg, rgba(17,24,39,0.92))',
      'color:var(--cg-tooltip-fg, #fff)',
      'border-radius:4px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
      'white-space:nowrap',
      'transform:translateX(-50%)',
    ].join(';');
    host.appendChild(el);
    this.tooltipEl = el;
    return el;
  }

  private hide(): void {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Numeric values render with up to 2 decimal places (price-style);
 *  non-numeric values fall back to `String(...)`. Tooltip space is
 *  small so trimming trailing zeros keeps the readout compact. */
function formatValue(v: unknown): string {
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2).replace(/\.?0+$/, '');
}
