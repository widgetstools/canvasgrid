import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  AUTO_GROUP_COLUMN_ID,
  AUTO_GROUP_DEFAULT_HEADER_NAME,
  AUTO_GROUP_DEFAULT_WIDTH,
  AUTO_GROUP_MULTIPLE_DEFAULT_WIDTH,
  autoGroupColumnIdForDepth,
  autoGroupColumnDepthFromId,
  isAutoGroupColumnId,
  isGroupRowStripMode,
  resolveGroupDisplayType,
  synthesizeAutoGroupColumns,
} from '../src/core/autoGroupColumn';
import { groupCell, type GroupCellValue } from '../src/renderer/cellRenderers/group';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

/**
 * Cycle 15 / Task 5 — `groupDisplayType` variants
 * (`'multipleColumns' | 'groupRows' | 'custom'`).
 *
 * Reference: `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
 * § Task 5.
 *
 * The 9 cases below cover the leaf decisions:
 *   1. Default resolution + the `isGroupRowStripMode` predicate that the
 *      cgrid layer reads to decide whether to wire the full-row strip
 *      lookup vs. insert auto-group columns.
 *   2. `multipleColumns` synthesizes one column per `rowGroupCols`, each
 *      with a unique colId + its own `groupColumnDepth` param.
 *   3. The renderer's own-depth filter paints chrome ONLY when the
 *      row's depth matches the column's slot (multipleColumns).
 *   4. The renderer's own-depth filter pins indent to 0 in
 *      multipleColumns (each column owns one depth — no per-cell
 *      indent inside the column).
 *   5. `multipleColumns` honours `autoGroupColumnDef` overrides
 *      uniformly across every synthesized column, but does NOT let an
 *      `override.colId` poison the canonical per-level ids.
 *   6. `multipleColumns` `headerNames` falls back per slot when
 *      undefined / missing.
 *   7. `'groupRows'` and `'custom'` synthesize ZERO auto-group columns
 *      and stamp `fullRowStrip: true` so the cgrid layer routes to the
 *      body painter's strip code path.
 *   8. The renderer's groupRows path (no `params.groupColumnDepth`)
 *      paints depth-scaled indent for nested groups inside the strip.
 *   9. `autoGroupColumnIdForDepth` ↔ `autoGroupColumnDepthFromId`
 *      round-trip + `isAutoGroupColumnId` recognizes both the
 *      singleColumn id and per-level ids.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

function makeGc(): CachedContext2D {
  const ctx: Record<string, unknown> = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    translate: vi.fn(),
    scale: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return (t as Record<string | symbol, unknown>)[k as string]; },
    set(t, k, v) { (t as Record<string | symbol, unknown>)[k as string] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as unknown as CachedContext2D;
}

function makeGroupValue(over: Partial<GroupCellValue> = {}): GroupCellValue {
  return {
    kind: 'group',
    rowKind: 1,
    depth: 0,
    valueFormatted: 'AAPL',
    childCount: 5,
    isExpanded: true,
    ...over,
  };
}

function baseParams(over: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: makeGroupValue(),
    valueFormatted: 'AAPL',
    bounds: { x: 0, y: 0, w: 200, h: 32 },
    font: '13px JetBrains Mono',
    fg: '#1a1f24',
    bg: '#ffffff',
    borderColor: '#eceff2',
    halign: 'left',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    groupChevronColor: '#475569',
    groupCountColor: '#475569',
    groupIndent: 14,
    ...over,
  };
}

describe('groupDisplayType — resolution + strip mode', () => {
  it('resolveGroupDisplayType defaults to singleColumn; isGroupRowStripMode flags only groupRows + custom', () => {
    // The cgrid layer's first branch on every rebuild: resolve the mode,
    // then decide between "insert auto-group columns" (singleColumn /
    // multipleColumns) and "wire the full-row strip" (groupRows /
    // custom). A regression that flips either side would break the
    // routing in `rebuildAutoGroupColumn`.
    expect(resolveGroupDisplayType(undefined)).toBe('singleColumn');
    expect(isGroupRowStripMode('singleColumn')).toBe(false);
    expect(isGroupRowStripMode('multipleColumns')).toBe(false);
    expect(isGroupRowStripMode('groupRows')).toBe(true);
    expect(isGroupRowStripMode('custom')).toBe(true);
  });

  it('synthesizeAutoGroupColumns multipleColumns produces one column per rowGroupCols with unique colId + groupColumnDepth params', () => {
    // The leaf invariant: a 3-level grouping yields three synthesized
    // columns whose colIds (a) match the canonical prefix, (b) are
    // unique (a stale colId on every column would collapse them to
    // one entry in columnDefsMap and only the last would survive), and
    // (c) carry a per-column groupColumnDepth param so the renderer's
    // own-depth filter can activate.
    const synth = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker', 'sector', 'subSector'] },
      groupDisplayType: 'multipleColumns',
    });
    expect(synth.columns.length).toBe(3);
    expect(synth.fullRowStrip).toBe(false);
    const ids = synth.columns.map((c) => c.colId);
    expect(ids).toEqual([
      autoGroupColumnIdForDepth(0),
      autoGroupColumnIdForDepth(1),
      autoGroupColumnIdForDepth(2),
    ]);
    // Each column carries a depth tag in `cellRendererParams`.
    for (let depth = 0; depth < synth.columns.length; depth++) {
      const params = synth.columns[depth]!.cellRendererParams as { groupColumnDepth: number };
      expect(params.groupColumnDepth).toBe(depth);
    }
    // Default width per column is the multipleColumns default (smaller
    // than singleColumn — each column owns one depth).
    for (const col of synth.columns) {
      expect(col.width).toBe(AUTO_GROUP_MULTIPLE_DEFAULT_WIDTH);
    }
  });

  it('groupCell paints chrome ONLY when params.groupColumnDepth matches row.depth (multipleColumns own-depth filter)', () => {
    // The runtime guard for the own-depth rule. depth=1 row paints
    // chrome in the column owning depth=1 and STAYS BLANK in the
    // column owning depth=0 (the row belongs to a different bucket
    // for that level). Cells in deeper columns (depth=2) for a
    // depth=1 row are likewise blank — the depth-2 column owns rows
    // at depth=2 only.
    const gcMatch = makeGc();
    groupCell.paint(gcMatch, baseParams({
      value: makeGroupValue({ depth: 1, valueFormatted: 'Tech' }),
      params: { groupColumnDepth: 1 },
    }));
    expect((gcMatch.fillText as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((gcMatch.stroke as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    const gcMismatchShallower = makeGc();
    groupCell.paint(gcMismatchShallower, baseParams({
      value: makeGroupValue({ depth: 1, valueFormatted: 'Tech' }),
      params: { groupColumnDepth: 0 },
    }));
    expect((gcMismatchShallower.fillText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((gcMismatchShallower.stroke as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const gcMismatchDeeper = makeGc();
    groupCell.paint(gcMismatchDeeper, baseParams({
      value: makeGroupValue({ depth: 1, valueFormatted: 'Tech' }),
      params: { groupColumnDepth: 2 },
    }));
    expect((gcMismatchDeeper.fillText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('groupCell indent is 0 in multipleColumns mode (column owns the depth — chevron flush left)', () => {
    // The design rule: each multipleColumns column owns exactly one
    // depth, so depth-scaled indent would degrade to uniform per-column
    // padding. The chevron must sit at PADDING (6px) regardless of the
    // row's depth. Compared with singleColumn (Task 4 test asserts
    // 6+12+6 + depth*14 for the text x), the multipleColumns path
    // produces 6+12+6 with NO depth scaling.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ depth: 2, valueFormatted: 'Software' }),
      params: { groupColumnDepth: 2 },
    }));
    const textX = ((gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(textX).toBe(6 + 12 + 6); // PADDING + CHEVRON_SIZE + CHEVRON_GAP, no depth scaling
  });

  it('multipleColumns honours autoGroupColumnDef overrides uniformly; an override.colId is ignored per level', () => {
    // Apps tune via the override (wider, pinned, custom header) and
    // the patch lands on EVERY synthesized column. A stray
    // `override.colId` would otherwise collapse multiple columns to
    // the same id (only the last entry in columnDefsMap survives).
    // The forced per-level id keeps the columns distinct.
    const synth = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker', 'sector'] },
      groupDisplayType: 'multipleColumns',
      override: {
        width: 220,
        pinned: 'left',
        colId: 'sneaky',
        cellRendererParams: { showCount: false },
      },
    });
    expect(synth.columns.length).toBe(2);
    for (let i = 0; i < synth.columns.length; i++) {
      const col = synth.columns[i]!;
      expect(col.colId).toBe(autoGroupColumnIdForDepth(i));
      expect(col.width).toBe(220);
      expect(col.pinned).toBe('left');
      const params = col.cellRendererParams as { showCount: boolean; groupColumnDepth: number };
      // Override fields layer onto the params, AND the depth tag wins
      // last so it can't be accidentally over-written.
      expect(params.showCount).toBe(false);
      expect(params.groupColumnDepth).toBe(i);
    }
  });

  it('multipleColumns headerNames falls back per slot when the array is undefined OR a slot is missing', () => {
    // Apps pass the source columns' `headerName` (typically). When the
    // array is shorter than rowGroupCols, missing slots fall back to
    // the override OR the canonical 'Group' default — the synthesis
    // never crashes on out-of-range access.
    const synthFull = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker', 'sector', 'subSector'] },
      groupDisplayType: 'multipleColumns',
      headerNames: ['Ticker', 'Sector', undefined],
    });
    expect(synthFull.columns.map((c) => c.headerName)).toEqual(['Ticker', 'Sector', AUTO_GROUP_DEFAULT_HEADER_NAME]);

    const synthShort = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker', 'sector', 'subSector'] },
      groupDisplayType: 'multipleColumns',
      headerNames: ['Ticker'],
    });
    expect(synthShort.columns.map((c) => c.headerName)).toEqual(['Ticker', AUTO_GROUP_DEFAULT_HEADER_NAME, AUTO_GROUP_DEFAULT_HEADER_NAME]);

    const synthNone = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker', 'sector'] },
      groupDisplayType: 'multipleColumns',
    });
    expect(synthNone.columns.map((c) => c.headerName)).toEqual([AUTO_GROUP_DEFAULT_HEADER_NAME, AUTO_GROUP_DEFAULT_HEADER_NAME]);
  });

  it('groupRows + custom modes synthesize zero auto-group columns and stamp fullRowStrip: true', () => {
    // The cgrid layer reads `fullRowStrip` to decide whether to wire
    // the body painter's strip lookup. A regression that flipped the
    // flag would either leak a phantom auto-group column or stop the
    // strip from painting at all.
    const gr = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker'] },
      groupDisplayType: 'groupRows',
    });
    expect(gr.columns.length).toBe(0);
    expect(gr.fullRowStrip).toBe(true);

    const custom = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker'] },
      groupDisplayType: 'custom',
    });
    expect(custom.columns.length).toBe(0);
    expect(custom.fullRowStrip).toBe(true);

    // Bypassed grouping (no rowGroupCols) returns empty even for
    // groupRows / custom — there's nothing to paint.
    const bypassed = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: [] },
      groupDisplayType: 'groupRows',
    });
    expect(bypassed.columns.length).toBe(0);
    expect(bypassed.fullRowStrip).toBe(false);
  });

  it('groupCell groupRows path (no params.groupColumnDepth) paints depth-scaled indent inside the strip', () => {
    // The strip path uses the singleColumn vocabulary: depth*indent
    // from the strip's left edge. Without depth scaling a nested
    // group's chevron would sit at the same x as a top-level group,
    // erasing the visual nesting. The own-depth filter (params.groupColumnDepth)
    // is the ONLY switch that pins indent to 0; without it the renderer
    // falls through to the Task 4 depth-scaled rule.
    const gc0 = makeGc();
    groupCell.paint(gc0, baseParams({
      value: makeGroupValue({ depth: 0 }),
      bounds: { x: 0, y: 0, w: 1200, h: 32 },
    }));
    const x0 = ((gc0.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x0).toBe(6 + 12 + 6); // PADDING + chevron + gap

    const gc2 = makeGc();
    groupCell.paint(gc2, baseParams({
      value: makeGroupValue({ depth: 2 }),
      bounds: { x: 0, y: 0, w: 1200, h: 32 },
    }));
    const x2 = ((gc2.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x2).toBe(x0 + 14 * 2); // +2 levels of indent
  });

  it('autoGroupColumnIdForDepth ↔ depthFromId round-trip; isAutoGroupColumnId recognizes singleColumn + per-level ids', () => {
    // The cellAt route reads `isAutoGroupColumnId(colId)` to decide
    // whether to return a GroupCellValue payload OR the standard
    // numeric/text reader. Misclassifying a per-level id as "not an
    // auto-group column" would leave every multipleColumns cell
    // empty; misclassifying a user column as "is" would shadow real
    // values with the group payload.
    expect(isAutoGroupColumnId(AUTO_GROUP_COLUMN_ID)).toBe(true);
    expect(isAutoGroupColumnId(autoGroupColumnIdForDepth(0))).toBe(true);
    expect(isAutoGroupColumnId(autoGroupColumnIdForDepth(5))).toBe(true);
    expect(isAutoGroupColumnId('ticker')).toBe(false);
    // Substring of the canonical id without the dash separator must NOT
    // be classified as auto-group.
    expect(isAutoGroupColumnId('ag-Grid-AutoColumnNot')).toBe(false);

    // Round-trip the depth extractor on per-level ids.
    expect(autoGroupColumnDepthFromId(autoGroupColumnIdForDepth(0))).toBe(0);
    expect(autoGroupColumnDepthFromId(autoGroupColumnIdForDepth(7))).toBe(7);
    // The canonical singleColumn id has no depth suffix → null.
    expect(autoGroupColumnDepthFromId(AUTO_GROUP_COLUMN_ID)).toBe(null);
    // Non-auto colIds → null.
    expect(autoGroupColumnDepthFromId('ticker')).toBe(null);

    // Sanity: singleColumn synthesizes the canonical default width
    // (singleColumn !== multipleColumns).
    const single = synthesizeAutoGroupColumns({
      groupModel: { rowGroupCols: ['ticker'] },
      groupDisplayType: 'singleColumn',
    });
    expect(single.columns.length).toBe(1);
    expect(single.columns[0]!.colId).toBe(AUTO_GROUP_COLUMN_ID);
    expect(single.columns[0]!.width).toBe(AUTO_GROUP_DEFAULT_WIDTH);
    expect(single.fullRowStrip).toBe(false);
  });
});
