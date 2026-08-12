/**
 * Cycle 18 / Task 6 — PivotPanelHost unit tests.
 *
 * PivotPanelHost mounts a horizontal DOM strip ABOVE the column header
 * row (and ABOVE the row group panel when both are present — pivot is
 * the "matrix definition" layer that wraps the row dimension). Renders
 * one pill per `pivotColumns[i]` in pivot-order with a `›` separator
 * between adjacent pills. In the empty state (with `pivotPanelShow:
 * 'always'`) it shows a dashed placeholder reading "Drag here to set
 * column labels" — verbatim from the columns tool panel's plz zone for
 * vocabulary continuity.
 *
 * The host is framework-agnostic: it talks to the grid via a thin
 * `PivotPanelGridContext` (header-name lookup, enablePivot lookup,
 * already-pivoted check, append/remove/move dispatch, the reserved-
 * space callback, and an active-state lookup so `'onlyWhenPivoting'`
 * mode can suppress paint when no pivot is active).
 *
 * These tests pin the visible-vs-hidden behaviour for every value of
 * `pivotPanelShow`, pill-strip ordering, the drop-verdict gating
 * (enablePivot + already-pivoted rejection), destroy idempotency,
 * the runtime `setShowMode` swap, AND the `'onlyWhenPivoting'`
 * pre-reserved-but-paint-suppressed mode (a Task 6 invariant the row
 * group panel does NOT have — `'onlyWhenGrouping'` collapses
 * reservation to 0 when empty, whereas `'onlyWhenPivoting'` keeps the
 * height reserved at construction so a later `setPivotMode(true)`
 * doesn't trigger a layout reflow).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PivotPanelHost,
  normalizePivotPanelShow,
  type PivotPanelGridContext,
} from '../src/interaction/pivotPanel/host';

interface RecordingContext extends PivotPanelGridContext {
  reserveCalls: Array<{ side: 'top'; height: number }>;
  appendCalls: string[];
  removeCalls: string[];
  moveCalls: Array<{ from: number; to: number }>;
  enabledCols: Set<string>;
  headerNames: Map<string, string>;
  pivotActive: boolean;
}

function makeContext(): RecordingContext {
  const reserveCalls: Array<{ side: 'top'; height: number }> = [];
  const appendCalls: string[] = [];
  const removeCalls: string[] = [];
  const moveCalls: Array<{ from: number; to: number }> = [];
  const enabledCols = new Set<string>(['sector', 'region', 'desk', 'currency']);
  const headerNames = new Map<string, string>([
    ['sector', 'Sector'],
    ['region', 'Region'],
    ['desk', 'Desk'],
    ['currency', 'Currency'],
    ['notional', 'Notional'],
  ]);
  const ctx: RecordingContext = {
    reserveCalls,
    appendCalls,
    removeCalls,
    moveCalls,
    enabledCols,
    headerNames,
    pivotActive: true,
    setReservedSpace(side, height) {
      reserveCalls.push({ side, height });
    },
    getHeaderName(colId) {
      return headerNames.get(colId);
    },
    isColumnPivotEnabled(colId) {
      return enabledCols.has(colId);
    },
    addPivotColumn(colId) {
      appendCalls.push(colId);
    },
    removePivotColumn(colId) {
      removeCalls.push(colId);
    },
    movePivotColumn(from, to) {
      moveCalls.push({ from, to });
    },
    isPivotActive() {
      return ctx.pivotActive;
    },
  };
  return ctx;
}

describe('PivotPanelHost', () => {
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

  it('mounts a .vg-pivot-panel inside root with a pill for each pivotColumns entry', () => {
    // Regression: the constructor must add the panel DOM and one pill
    // per `pivotColumns[i]`. The order must match the array order — that
    // order IS the pivot-group nesting order the user sees.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector', 'region']);
    const panel = root.querySelector('.vg-pivot-panel') as HTMLElement | null;
    expect(panel).not.toBeNull();
    const pills = panel!.querySelectorAll('.vg-pivot-panel-pill');
    expect(pills).toHaveLength(2);
    expect((pills[0] as HTMLElement).dataset.colId).toBe('sector');
    expect((pills[1] as HTMLElement).dataset.colId).toBe('region');
    host.destroy();
  });

  it('hides the panel when pivotPanelShow resolves to "never" via normalize helper', () => {
    // Regression: `'never'` (and `undefined`) must collapse to a null
    // mount decision so the construction-time check in cgrid is a
    // single null compare. Anything else passes through unchanged.
    expect(normalizePivotPanelShow('never')).toBeNull();
    expect(normalizePivotPanelShow(undefined)).toBeNull();
    expect(normalizePivotPanelShow('always')).toBe('always');
    expect(normalizePivotPanelShow('onlyWhenPivoting')).toBe('onlyWhenPivoting');
  });

  it('"always" mounts the empty-state placeholder when pivotColumns is empty', () => {
    // Regression: `'always'` keeps the strip visible even with no
    // pills; the dashed-border placeholder reads with vocabulary
    // continuity from the tool panel's plz zone.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', []);
    expect(host.isVisible()).toBe(true);
    const empty = root.querySelector('.vg-pivot-panel-empty') as HTMLElement | null;
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Drag here to set column labels');
    host.destroy();
  });

  it('"onlyWhenPivoting" fully hides the strip when pivot is inactive (no reservation)', () => {
    // Contract: `'onlyWhenPivoting'` releases the strip entirely when
    // pivot is off — the empty drop band is clutter for a feature the
    // user isn't using, and the data area should reclaim the band.
    // (Earlier the strip pre-reserved height to avoid a reflow on
    // setPivotMode(true); the user feedback prefers the cleaner
    // off-state and accepts a one-time reflow.)
    const ctx = makeContext();
    ctx.pivotActive = false;
    const host = new PivotPanelHost(root, ctx, 'onlyWhenPivoting', []);
    expect(host.isVisible()).toBe(false);
    expect(host.getReservedHeight()).toBe(0);
    const panel = root.querySelector('.vg-pivot-panel') as HTMLElement;
    expect(getComputedStyle(panel).display).toBe('none');
    host.destroy();
  });

  it('"onlyWhenPivoting" paints the empty-state placeholder when pivot activates', () => {
    // Regression: flipping pivot active mid-flight via the
    // `setPivotActive` API must paint the empty-placeholder if the
    // pivot columns list is still empty.
    const ctx = makeContext();
    ctx.pivotActive = false;
    const host = new PivotPanelHost(root, ctx, 'onlyWhenPivoting', []);
    expect(root.querySelector('.vg-pivot-panel-empty')).toBeNull();
    ctx.pivotActive = true;
    host.setPivotActive(true);
    const empty = root.querySelector('.vg-pivot-panel-empty') as HTMLElement | null;
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Drag here to set column labels');
    const panel = root.querySelector('.vg-pivot-panel') as HTMLElement;
    expect(panel.dataset.active).toBe('true');
    host.destroy();
  });

  it('"onlyWhenPivoting" hides even when pivotColumns is non-empty if pivot is inactive', () => {
    // Contract: under the new "fully hide" semantics, retained pivot
    // configuration is irrelevant — the strip is gone until pivot
    // mode turns on. The config survives in PivotState; the pills
    // re-paint when setPivotActive(true) lands.
    const ctx = makeContext();
    ctx.pivotActive = false;
    const host = new PivotPanelHost(root, ctx, 'onlyWhenPivoting', ['sector']);
    expect(host.isVisible()).toBe(false);
    expect(root.querySelector('.vg-pivot-panel-pill')).toBeNull();
    // Flipping pivot active paints the pills.
    ctx.pivotActive = true;
    host.setPivotActive(true);
    const pill = root.querySelector('.vg-pivot-panel-pill') as HTMLElement | null;
    expect(pill).not.toBeNull();
    expect(pill!.dataset.colId).toBe('sector');
    host.destroy();
  });

  it('pill × click removes the column via ctx.removePivotColumn', () => {
    // Regression: the pill's remove-button click must dispatch the
    // colId through `ctx.removePivotColumn` so the grid can update
    // PivotState.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector', 'region']);
    const pills = root.querySelectorAll('.vg-pivot-panel-pill');
    const removeBtn = (pills[0] as HTMLElement).querySelector(
      '.vg-pivot-panel-pill-remove',
    ) as HTMLButtonElement;
    removeBtn.click();
    expect(ctx.removeCalls).toEqual(['sector']);
    host.destroy();
  });

  it('handleColumnDrop appends an enablePivot column and dispatches via ctx.addPivotColumn', () => {
    // Regression: a column with `enablePivot: true` AND not in
    // `pivotColumns` must drop successfully.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', []);
    const accepted = host.handleColumnDrop('sector');
    expect(accepted).toBe(true);
    expect(ctx.appendCalls).toEqual(['sector']);
    host.destroy();
  });

  it('handleColumnDrop rejects a column with enablePivot: false', () => {
    // Regression: a column lacking the `enablePivot` opt-in is refused
    // at the drop boundary. `ctx.addPivotColumn` is NOT called; the
    // host returns `false` so the drag source can keep the column.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', []);
    const accepted = host.handleColumnDrop('notional'); // not in enabledCols
    expect(accepted).toBe(false);
    expect(ctx.appendCalls).toEqual([]);
    host.destroy();
  });

  it('handleColumnDrop rejects an already-pivoted column', () => {
    // Regression: a column already in `pivotColumns` is a duplicate
    // drop. The host short-circuits regardless of `enablePivot`.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector']);
    const accepted = host.handleColumnDrop('sector');
    expect(accepted).toBe(false);
    expect(ctx.appendCalls).toEqual([]);
    host.destroy();
  });

  it('pill order reflects pivotColumns order after setPivotColumns', () => {
    // Regression: re-ordering the model must re-render pills so the
    // visible order matches. The user reads pill order as pivot-group
    // nesting order; a stale render would mislead.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector']);
    host.setPivotColumns(['region', 'sector', 'desk']);
    const pills = root.querySelectorAll('.vg-pivot-panel-pill');
    const ids = Array.from(pills).map((p) => (p as HTMLElement).dataset.colId);
    expect(ids).toEqual(['region', 'sector', 'desk']);
    host.destroy();
  });

  it('pill label reads through ctx.getHeaderName with fallback to colId', () => {
    // Regression: pill text comes from the column's `headerName`. When
    // the header name is missing (unknown id), the host falls back to
    // the raw colId so the user still sees something useful.
    const ctx = makeContext();
    ctx.headerNames.delete('sector'); // force fallback
    const host = new PivotPanelHost(root, ctx, 'always', ['region', 'sector']);
    const labels = Array.from(
      root.querySelectorAll('.vg-pivot-panel-pill-label'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['Region', 'sector']);
    host.destroy();
  });

  it('destroy unmounts the panel + releases the top inset to 0', () => {
    // Regression: destroy must remove the DOM and inform the grid the
    // reservation is gone so the canvas reflows. Subsequent calls are
    // idempotent — the grid is allowed to defensively destroy twice.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector']);
    host.destroy();
    expect(root.querySelector('.vg-pivot-panel')).toBeNull();
    const lastCall = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastCall.height).toBe(0);
    // Second destroy is a no-op (no exception, no extra reserve call).
    const reserveCountBefore = ctx.reserveCalls.length;
    host.destroy();
    expect(ctx.reserveCalls).toHaveLength(reserveCountBefore);
  });

  it('setShowMode flips visibility mid-flight without re-construction', () => {
    // Regression: the runtime `setGridOption('pivotPanelShow', …)`
    // path delegates to `setShowMode`. A swap from `'always'` to
    // `'never'` would unmount; here we test `'always'` → `'onlyWhenPivoting'`
    // with pivot inactive (paint suppressed) and back.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', []);
    expect(host.isVisible()).toBe(true);
    // Empty placeholder paints under 'always'.
    expect(root.querySelector('.vg-pivot-panel-empty')).not.toBeNull();
    ctx.pivotActive = false;
    host.setShowMode('onlyWhenPivoting');
    // Strip is still mounted but content is paint-suppressed.
    const panel = root.querySelector('.vg-pivot-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.dataset.active).toBe('false');
    expect(panel.querySelector('.vg-pivot-panel-empty')).toBeNull();
    // Swap back to `'always'` — the empty-state placeholder must re-render.
    host.setShowMode('always');
    expect(root.querySelector('.vg-pivot-panel-empty')).not.toBeNull();
    host.destroy();
  });

  it('pills render CSS dot-grid handle (no text glyph) + ✕ remove glyph', () => {
    // The handle is purely CSS (radial-gradient dot-grid; shared with
    // tool-panel plz pills); textContent must be ''. The remove glyph
    // stays '✕' for vocabulary continuity with the row group panel chip.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector']);
    const handle = root.querySelector('.vg-pivot-panel-pill-handle') as HTMLElement;
    const remove = root.querySelector('.vg-pivot-panel-pill-remove') as HTMLElement;
    expect(handle.textContent).toBe('');
    expect(remove.textContent).toBe('✕');
    host.destroy();
  });

  it('pill-to-pill separator renders › between adjacent pills, never at the ends', () => {
    // Regression: the `›` separator must appear N-1 times for N pills
    // (one between each adjacent pair). No leading or trailing
    // separator — the pills themselves are the tokens, the separators
    // are the punctuation. Matches the row group panel chip-strip idiom.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector', 'region', 'desk']);
    const seps = root.querySelectorAll('.vg-pivot-panel-separator');
    expect(seps).toHaveLength(2);
    seps.forEach((sep) => expect(sep.textContent).toBe('›'));
    host.destroy();
  });

  it('reuses the row-group panel chip classes so both top-of-grid strips share one vocabulary', () => {
    // Regression: the top-of-grid pivot panel and row-group panel
    // ride the same vertical strip and need to look identical — same
    // 22px height, fully-rounded ends, same drag ghost. The pivot
    // pill carries `.vg-row-group-panel-chip*` classes so the shared
    // CSS hits both. Per-panel `.vg-pivot-panel-pill*` classes stay
    // for JS targeting + per-panel hooks.
    const ctx = makeContext();
    const host = new PivotPanelHost(root, ctx, 'always', ['sector']);
    const pill = root.querySelector('.vg-pivot-panel-pill') as HTMLElement;
    expect(pill.classList.contains('vg-row-group-panel-chip')).toBe(true);
    const handle = pill.querySelector('.vg-pivot-panel-pill-handle') as HTMLElement;
    expect(handle.classList.contains('vg-row-group-panel-chip-handle')).toBe(true);
    const label = pill.querySelector('.vg-pivot-panel-pill-label') as HTMLElement;
    expect(label.classList.contains('vg-row-group-panel-chip-label')).toBe(true);
    const remove = pill.querySelector('.vg-pivot-panel-pill-remove') as HTMLElement;
    expect(remove.classList.contains('vg-row-group-panel-chip-remove')).toBe(true);
    host.destroy();
  });

  it('isPointInPanel returns false in onlyWhenPivoting + pivot inactive (drop suppression)', () => {
    // Regression: 'onlyWhenPivoting' mode pre-reserves the strip's
    // height, but when pivot is INACTIVE the strip must NOT accept
    // external drops — `isPointInPanel` returns false so the drag
    // source falls through to other drop targets.
    const ctx = makeContext();
    ctx.pivotActive = false;
    const host = new PivotPanelHost(root, ctx, 'onlyWhenPivoting', []);
    // Even at a coordinate that would land inside the panel layout-
    // wise, drops are refused when pivot is inactive.
    expect(host.isPointInPanel(50, 5)).toBe(false);
    host.destroy();
  });
});
