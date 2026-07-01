/**
 * Cycle 15 / Task 6 — RowGroupPanelHost unit tests.
 *
 * RowGroupPanelHost owns the DOM strip that mounts ABOVE the column
 * header row. It renders one chip per `rowGroupCols[i]` plus a `›`
 * separator between adjacent chips; in the empty state it shows a
 * dashed placeholder reading "Drag here to set row groups". The host
 * is framework-agnostic: it talks to the grid via a thin
 * `RowGroupPanelGridContext` (header-name lookup, enableRowGroup
 * lookup, append/remove dispatch, and the reserved-space callback).
 *
 * These tests pin the visible-vs-hidden behaviour for every value of
 * `rowGroupPanelShow`, chip-strip ordering, the drop-verdict gating
 * (enableRowGroup + already-grouped + auto-group-column rejection),
 * destroy idempotency, and the runtime `setShowMode` swap.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RowGroupPanelHost,
  normalizeRowGroupPanelShow,
  type RowGroupPanelGridContext,
} from '../src/interaction/rowGroupPanel/host';

interface RecordingContext extends RowGroupPanelGridContext {
  reserveCalls: Array<{ side: 'top'; height: number }>;
  appendCalls: string[];
  removeCalls: string[];
  moveCalls: Array<{ from: number; to: number }>;
  sortCalls: Array<{ colId: string; direction: 'asc' | 'desc' | null }>;
  enabledCols: Set<string>;
  headerNames: Map<string, string>;
}

function makeContext(): RecordingContext {
  const reserveCalls: Array<{ side: 'top'; height: number }> = [];
  const appendCalls: string[] = [];
  const removeCalls: string[] = [];
  const moveCalls: Array<{ from: number; to: number }> = [];
  const sortCalls: Array<{ colId: string; direction: 'asc' | 'desc' | null }> = [];
  const enabledCols = new Set<string>(['ticker', 'sector', 'region', 'desk']);
  const headerNames = new Map<string, string>([
    ['ticker', 'Ticker'],
    ['sector', 'Sector'],
    ['region', 'Region'],
    ['desk', 'Desk'],
    ['price', 'Price'],
  ]);
  return {
    reserveCalls,
    appendCalls,
    removeCalls,
    moveCalls,
    sortCalls,
    enabledCols,
    headerNames,
    setReservedSpace(side, height) {
      reserveCalls.push({ side, height });
    },
    getHeaderName(colId) {
      return headerNames.get(colId);
    },
    isColumnRowGroupEnabled(colId) {
      return enabledCols.has(colId);
    },
    addRowGroupColumn(colId) {
      appendCalls.push(colId);
    },
    removeRowGroupColumn(colId) {
      removeCalls.push(colId);
    },
    moveRowGroupColumn(from, to) {
      moveCalls.push({ from, to });
    },
    setRowGroupColumnSort(colId, direction) {
      sortCalls.push({ colId, direction });
    },
  };
}

describe('RowGroupPanelHost', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    Object.assign(root.style, {
      width: '800px',
      height: '600px',
      position: 'relative',
    });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.parentElement?.removeChild(root);
  });

  it('mounts a .cg-row-group-panel inside root with chips for each rowGroupCols entry', () => {
    // Regression: the constructor must add the panel DOM and one chip
    // per `rowGroupCols[i]`. The chip order must match the array
    // order — that order IS the nesting order the user sees.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['desk', 'region', 'ticker']);
    const panel = root.querySelector('.cg-row-group-panel') as HTMLElement | null;
    expect(panel).not.toBeNull();
    const chips = panel!.querySelectorAll('.cg-row-group-panel-chip');
    expect(chips).toHaveLength(3);
    expect((chips[0] as HTMLElement).dataset.colId).toBe('desk');
    expect((chips[1] as HTMLElement).dataset.colId).toBe('region');
    expect((chips[2] as HTMLElement).dataset.colId).toBe('ticker');
    host.destroy();
  });

  it('hides the panel when rowGroupPanelShow resolves to "never" via normalize helper', () => {
    // Regression: `'never'` (and `undefined`) must collapse to a null
    // mount decision so the construction-time check in cgrid is a
    // single null compare. Anything else passes through unchanged.
    expect(normalizeRowGroupPanelShow('never')).toBeNull();
    expect(normalizeRowGroupPanelShow(undefined)).toBeNull();
    expect(normalizeRowGroupPanelShow('always')).toBe('always');
    expect(normalizeRowGroupPanelShow('onlyWhenGrouping')).toBe('onlyWhenGrouping');
  });

  it('"onlyWhenGrouping" hides on mount when rowGroupCols is empty', () => {
    // Regression: empty `rowGroupCols` + `'onlyWhenGrouping'` reads as
    // hidden (no reservation, no DOM children). The strip mounts to
    // the root but its `display` is `none` so the canvas doesn't
    // shrink for an invisible strip.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'onlyWhenGrouping', []);
    expect(host.isVisible()).toBe(false);
    expect(host.getReservedHeight()).toBe(0);
    const lastCall = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastCall.height).toBe(0);
    host.destroy();
  });

  it('"onlyWhenGrouping" mounts the strip on the first chip add', () => {
    // Regression: transitioning from 0 → 1 chip in `'onlyWhenGrouping'`
    // mode must light the strip up + reserve height. The reservation
    // call sequence covers both the construction-time empty reservation
    // and the post-add nonzero reservation.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'onlyWhenGrouping', []);
    host.setRowGroupCols(['ticker']);
    expect(host.isVisible()).toBe(true);
    const chip = root.querySelector('.cg-row-group-panel-chip') as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip!.dataset.colId).toBe('ticker');
    host.destroy();
  });

  it('"onlyWhenGrouping" unmounts the strip when the last chip is removed', () => {
    // Regression: 1 → 0 chip in `'onlyWhenGrouping'` mode must hide
    // the strip and release the top inset back to 0.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'onlyWhenGrouping', ['ticker']);
    host.setRowGroupCols([]);
    expect(host.isVisible()).toBe(false);
    const panel = root.querySelector('.cg-row-group-panel') as HTMLElement;
    expect(panel.style.display).toBe('none');
    const lastCall = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastCall.height).toBe(0);
    host.destroy();
  });

  it('"always" mounts the empty-state placeholder when rowGroupCols is empty', () => {
    // Regression: `'always'` keeps the strip visible even with no
    // chips; the dashed-border placeholder reads with vocabulary
    // continuity from the sidebar Columns panel.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', []);
    expect(host.isVisible()).toBe(true);
    const empty = root.querySelector('.cg-row-group-panel-empty') as HTMLElement | null;
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Drag here to set row groups');
    host.destroy();
  });

  it('chip × click removes the column via ctx.removeRowGroup', () => {
    // Regression: the chip's remove-button click must dispatch the
    // colId through `ctx.removeRowGroup` so the grid can update its
    // groupModel.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['desk', 'region']);
    const chips = root.querySelectorAll('.cg-row-group-panel-chip');
    const removeBtn = (chips[0] as HTMLElement).querySelector(
      '.cg-row-group-panel-chip-remove',
    ) as HTMLButtonElement;
    removeBtn.click();
    expect(ctx.removeCalls).toEqual(['desk']);
    host.destroy();
  });

  it('handleColumnDrop appends an enableRowGroup column and dispatches via ctx.appendRowGroup', () => {
    // Regression: a column with `enableRowGroup: true` AND not in
    // `rowGroupCols` must drop successfully.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', []);
    const accepted = host.handleColumnDrop('ticker');
    expect(accepted).toBe(true);
    expect(ctx.appendCalls).toEqual(['ticker']);
    host.destroy();
  });

  it('handleColumnDrop rejects a column with enableRowGroup: false', () => {
    // Regression: a column lacking the `enableRowGroup` opt-in is
    // refused at the drop boundary. `ctx.appendRowGroup` is NOT
    // called; the host returns `false` so the drag feature can keep
    // the column in the header band.
    const ctx = makeContext();
    ctx.enabledCols.delete('price'); // not in default set anyway
    const host = new RowGroupPanelHost(root, ctx, 'always', []);
    const accepted = host.handleColumnDrop('price');
    expect(accepted).toBe(false);
    expect(ctx.appendCalls).toEqual([]);
    host.destroy();
  });

  it('handleColumnDrop rejects an already-grouped column', () => {
    // Regression: a column already in `rowGroupCols` is a duplicate
    // drop. The host short-circuits regardless of `enableRowGroup`.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['ticker']);
    const accepted = host.handleColumnDrop('ticker');
    expect(accepted).toBe(false);
    expect(ctx.appendCalls).toEqual([]);
    host.destroy();
  });

  it('handleColumnDrop rejects the auto-group column id', () => {
    // Regression: the synthesized auto-group column (`ag-Grid-AutoColumn*`)
    // must never be added to `rowGroupCols` — that would synthesize
    // a column on itself recursively.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['ticker']);
    const accepted = host.handleColumnDrop('ag-Grid-AutoColumn');
    expect(accepted).toBe(false);
    expect(ctx.appendCalls).toEqual([]);
    host.destroy();
  });

  it('chip order reflects rowGroupCols order after setRowGroupCols', () => {
    // Regression: re-ordering the model must re-render chips so the
    // visible order matches. The user reads chip order as nesting
    // order; a stale render here would mislead.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['desk']);
    host.setRowGroupCols(['ticker', 'region', 'desk']);
    const chips = root.querySelectorAll('.cg-row-group-panel-chip');
    const ids = Array.from(chips).map((c) => (c as HTMLElement).dataset.colId);
    expect(ids).toEqual(['ticker', 'region', 'desk']);
    host.destroy();
  });

  it('chip label reads through ctx.getHeaderName with fallback to colId', () => {
    // Regression: chip text comes from the column's `headerName`. When
    // the header name is missing (unknown id), the host falls back to
    // the raw colId so the user still sees something useful.
    const ctx = makeContext();
    ctx.headerNames.delete('ticker'); // force fallback
    const host = new RowGroupPanelHost(root, ctx, 'always', ['region', 'ticker']);
    const labels = Array.from(
      root.querySelectorAll('.cg-row-group-panel-chip-label'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['Region', 'ticker']);
    host.destroy();
  });

  it('destroy unmounts the panel + releases the top inset to 0', () => {
    // Regression: destroy must remove the DOM and inform the grid the
    // reservation is gone so the canvas reflows. Subsequent calls are
    // idempotent — the grid is allowed to defensively destroy twice.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['ticker']);
    host.destroy();
    expect(root.querySelector('.cg-row-group-panel')).toBeNull();
    const lastCall = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastCall.height).toBe(0);
    // Second destroy is a no-op (no exception, no extra reserve call).
    const reserveCountBefore = ctx.reserveCalls.length;
    host.destroy();
    expect(ctx.reserveCalls).toHaveLength(reserveCountBefore);
  });

  it('setShowMode flips visibility mid-flight without re-construction', () => {
    // Regression: the runtime `setGridOption('rowGroupPanelShow', …)`
    // path delegates to `setShowMode`. A swap from `'always'` to
    // `'onlyWhenGrouping'` with no chips must hide the panel and
    // release the reservation in one call.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', []);
    expect(host.isVisible()).toBe(true);
    host.setShowMode('onlyWhenGrouping');
    expect(host.isVisible()).toBe(false);
    const lastCall = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastCall.height).toBe(0);
    // Swap back to `'always'` — the empty-state placeholder must
    // re-render.
    host.setShowMode('always');
    expect(host.isVisible()).toBe(true);
    const empty = root.querySelector('.cg-row-group-panel-empty');
    expect(empty).not.toBeNull();
    host.destroy();
  });

  it('chips render CSS dot-grid handle (no text glyph) + ✕ remove glyph', () => {
    // The handle is purely CSS (radial-gradient dot-grid); DRAG_HANDLE_GLYPH
    // is empty string so textContent must be ''. The remove affordance stays '✕'.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['ticker']);
    const handle = root.querySelector('.cg-row-group-panel-chip-handle') as HTMLElement;
    const remove = root.querySelector('.cg-row-group-panel-chip-remove') as HTMLElement;
    expect(handle.textContent).toBe('');
    expect(remove.textContent).toBe('✕');
    host.destroy();
  });

  it('chip-to-chip separator renders › between adjacent chips, never at the ends', () => {
    // Regression: the `›` separator must appear N-1 times for N chips
    // (one between each adjacent pair). No leading or trailing
    // separator — the chips themselves are the tokens, the separators
    // are the punctuation.
    const ctx = makeContext();
    const host = new RowGroupPanelHost(root, ctx, 'always', ['desk', 'region', 'ticker']);
    const seps = root.querySelectorAll('.cg-row-group-panel-separator');
    expect(seps).toHaveLength(2);
    seps.forEach((sep) => expect(sep.textContent).toBe('›'));
    host.destroy();
  });
});
