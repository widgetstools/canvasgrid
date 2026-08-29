import { describe, it, expect } from 'vitest';
import { decorateHeader } from '../src/renderer/painters/byRows';
import { applyRuntimeOption, type RuntimeOptionTarget } from '../src/core/runtimeOptions';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { VelocityGridOptions } from '../src/types';

// Cycle 14 / Task 4 — `suppressAggFuncInHeader` behaviour test suite.
//
// The unit-of-behaviour is the PURE DECORATOR (column def + grid-level
// flag → header text) and the RUNTIME OPTION HOOK (the
// `suppressAggFuncInHeader` setGridOption path triggers a repaint via
// `refreshLayout`, so the next frame reads the new label). The full
// header-paint cycle gets pixel coverage in visual matrix cell 19.

/** Tiny factory: build a ResolvedColDef shaped just enough for the
 *  decorator's `aggFunc` / `suppressAggFuncInHeader` / `headerName`
 *  read path. The rest of the resolved-col-def surface is irrelevant
 *  to the decorator and gets `undefined` / safe defaults that match
 *  the production path. */
function col(
  headerName: string,
  aggFunc?: string | string[],
  suppressAggFuncInHeader?: boolean,
): ResolvedColDef {
  return {
    colId: headerName.toLowerCase(),
    headerName,
    minWidth: 30,
    maxWidth: Infinity,
    cellDataType: 'number',
    cellRenderer: 'number',
    suppressFloatingFilterButton: false,
    aggFunc,
    suppressAggFuncInHeader,
    sortable: true,
    resizable: true,
    editable: false,
    columnGroupShow: null,
    lockPosition: null,
    hide: false,
    lockVisible: false,
    lockPinned: false,
    suppressSizeToFit: false,
    suppressAutoSize: false,
  };
}

describe('decorateHeader — pure decorator', () => {
  // CASE 1 — Default (grid `suppressAggFuncInHeader: false`, column has
  // `aggFunc: 'sum'`): the decoration renders as `SUM Notional` per
  // the design plan (decision 1 — same weight, same color, lowercase
  // verb, parens). This is the canonical canvasgrid default — the
  // trader sees the synthesis cue on every column with an aggFunc.
  // 2026-08 look-and-feel — the aggregate PREFIXES the name rather than
  // wrapping it. Wrapping meant a narrow column cut the name and lost the
  // closing bracket with it ("sum(Notional Am"), so the header read as
  // broken syntax; prefixing puts the fixed-width part first and lets the
  // ellipsis land at the end of the name where it belongs. The toggle
  // semantics under test here — grid default, per-column override, both
  // directions — are unchanged.
  it('case 1 — default off: aggFunc-declared column renders as `SUM Notional`', () => {
    const def = col('Notional', 'sum');
    expect(decorateHeader(def, /*gridSuppress*/ false)).toBe('SUM Notional');
  });

  // CASE 2 — Grid-level `suppressAggFuncInHeader: true`: every leaf
  // column (regardless of `aggFunc`) reads its raw `headerName`. The
  // aggregated context lives only in the totals row at the bottom.
  // The decorator returns headerName WITHOUT the prefix even though
  // the column has an `aggFunc` declared.
  it('case 2 — grid suppress: aggFunc-declared column renders raw `Notional`', () => {
    const def = col('Notional', 'sum');
    expect(decorateHeader(def, /*gridSuppress*/ true)).toBe('Notional');
  });

  // CASE 3 — Per-column `suppressAggFuncInHeader: true` (with grid
  // OFF): the per-column override wins over the (default) grid-level
  // flag. The column reads raw `Notional` while sibling columns (with
  // no per-column flag set) still decorate normally. Mirrors the
  // standard cgrid override pattern (per-column wins over grid).
  it('case 3 — per-column override on: aggFunc column renders raw despite grid off', () => {
    const def = col('Notional', 'sum', /*colSuppress*/ true);
    expect(decorateHeader(def, /*gridSuppress*/ false)).toBe('Notional');
  });

  // CASE 4 — Per-column `suppressAggFuncInHeader: false` (with grid
  // ON): the per-column override wins both directions — explicit
  // `false` opts a column back IN to the decoration even when the
  // grid-level flag suppresses every other column. Used by apps that
  // want one canonical "P&L" column visibly aggregated while the rest
  // of the headers stay clean.
  it('case 4 — per-column override off: decoration shows despite grid on', () => {
    const def = col('Notional', 'sum', /*colSuppress*/ false);
    expect(decorateHeader(def, /*gridSuppress*/ true)).toBe('SUM Notional');
  });

  // CASE 5 — Column WITHOUT `aggFunc`: the decoration is a no-op
  // regardless of the suppress flag. Mirror this for both grid states
  // so a future refactor that accidentally added a prefix to non-agg
  // columns (e.g. `(Position ID)`) gets caught. The fallback string
  // is the column's raw `headerName`.
  it('case 5 — no aggFunc: raw header text returned regardless of suppress state', () => {
    const def = col('Position ID');
    expect(decorateHeader(def, /*gridSuppress*/ false)).toBe('Position ID');
    expect(decorateHeader(def, /*gridSuppress*/ true)).toBe('Position ID');
  });
});

describe('suppressAggFuncInHeader — runtime option wiring', () => {
  // CASE 6 — Runtime option flip: setGridOption('suppressAggFuncInHeader',
  // …) routes through `applyRuntimeOption` which fires `refreshLayout`
  // on the target. The velocityGrid.ts adapter's `refreshLayout`
  // (recomputeViewport + requestRepaint) is what actually re-runs the
  // painter and lights up the new header text; this test guards the
  // bridge. We exercise the runtime-options module directly (no
  // VelocityGrid + worker spin-up) because the bridge IS the unit-of-behaviour
  // — the integration round-trip gets pixel coverage in visual matrix
  // cell 19, which baselines both `?suppressAggHeader=1` AND the
  // default (decoration on) snapshots.
  it('case 6 — setGridOption flip re-paints via refreshLayout (both directions)', () => {
    const options: VelocityGridOptions = { columnDefs: [] };
    let refreshCount = 0;
    let rebuildCount = 0;
    const target: RuntimeOptionTarget = {
      options,
      setTheme: () => {},
      rebuildColumns: () => {},
      refreshLayout: () => { refreshCount++; },
      setSelectionMode: () => {},
      applyRowData: () => {},
      applyQuickFilter: () => {},
      forwardEnableCellChangeFlash: () => {},
      rebuildSubgrids: () => { rebuildCount++; },
      forwardAggFuncs: () => {},
    };
    // Storage is the CALLER's job (velocityGrid.ts mutates `options[key]`
    // before invoking applyRuntimeOption); mirror that here so the
    // assertion mirrors the live path.
    options.suppressAggFuncInHeader = true;
    applyRuntimeOption(target, 'suppressAggFuncInHeader', true);
    expect(refreshCount).toBe(1);
    expect(rebuildCount).toBe(0); // refreshLayout is enough — no column tree rebuild

    // Flipping back off triggers the same hook — the decoration is
    // restored on the next paint.
    options.suppressAggFuncInHeader = false;
    applyRuntimeOption(target, 'suppressAggFuncInHeader', false);
    expect(refreshCount).toBe(2);
  });
});
