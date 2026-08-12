import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  AUTO_GROUP_COLUMN_ID,
  AUTO_GROUP_DEFAULT_HEADER_NAME,
  AUTO_GROUP_DEFAULT_WIDTH,
  AUTO_GROUP_RENDERER,
  buildAutoGroupColumn,
  resolveGroupDisplayType,
  shouldInsertAutoGroupColumn,
} from '../src/core/autoGroupColumn';
import { groupCell, type GroupCellValue } from '../src/renderer/cellRenderers/group';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

/**
 * Cycle 15 / Task 4 — auto-group column synthesis + `'group'` cell
 * renderer.
 *
 * The 12 cases below cover the leaf decisions in
 * `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 4:
 *   - column insertion (when grouping active, when bypassed)
 *   - autoGroupColumnDef override merge order
 *   - chevron glyph swap on isExpanded
 *   - indent unit × depth
 *   - count suffix formatting (locale + zero-count omission)
 *   - empty-value em-dash placeholder
 *   - cellClassRules opt-in via the standard resolveColDef chain
 *   - focus / selection inheritance (column ID matches the
 *     auto-group constant so the focus ring + cellSelection lands
 *     identically to any other column)
 */

// happy-dom doesn't include Path2D; the renderer calls drawIcon which
// constructs a `new Path2D(...)`. Stub it so the tests run without a
// real canvas implementation.
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

describe('autoGroupColumn — synthesis', () => {
  it('shouldInsertAutoGroupColumn returns true when grouping is active AND singleColumn', () => {
    // The cgrid layer's column-order resolution gate. Without grouping
    // (rowGroupCols.length === 0) the auto-group column must NOT
    // insert — otherwise an ungrouped grid would gain a phantom
    // leftmost column with no value to display.
    expect(
      shouldInsertAutoGroupColumn({ rowGroupCols: ['ticker'] }, 'singleColumn'),
    ).toBe(true);
    expect(
      shouldInsertAutoGroupColumn({ rowGroupCols: [] }, 'singleColumn'),
    ).toBe(false);
  });

  it('shouldInsertAutoGroupColumn returns false for multipleColumns / groupRows / custom (Task 5)', () => {
    // Task 5 ships the multi-column / full-row variants; Task 4's
    // single-column insertion path must NOT activate for them.
    // Otherwise apps that pre-author groupDisplayType: 'multipleColumns'
    // would get a stray singleColumn rendered before Task 5 lands.
    expect(
      shouldInsertAutoGroupColumn({ rowGroupCols: ['ticker'] }, 'multipleColumns'),
    ).toBe(false);
    expect(
      shouldInsertAutoGroupColumn({ rowGroupCols: ['ticker'] }, 'groupRows'),
    ).toBe(false);
    expect(
      shouldInsertAutoGroupColumn({ rowGroupCols: ['ticker'] }, 'custom'),
    ).toBe(false);
  });

  it('resolveGroupDisplayType defaults to singleColumn when unset', () => {
    // Apps opting into grouping via just `setGroupModel(...)` (no
    // groupDisplayType in options) get the default surface. ag-grid's
    // default is the same; preserving the convention keeps the docs
    // accurate and the migration path trivial.
    expect(resolveGroupDisplayType(undefined)).toBe('singleColumn');
    expect(resolveGroupDisplayType('multipleColumns')).toBe('multipleColumns');
    expect(resolveGroupDisplayType('groupRows')).toBe('groupRows');
    expect(resolveGroupDisplayType('custom')).toBe('custom');
  });

  it('buildAutoGroupColumn synthesizes the canonical default def', () => {
    // The minimal call (no override) returns the as-designed
    // defaults: the canonical colId, the 'group' renderer, the
    // 'Group' header, a sensible width, sortable: false. Apps
    // override via autoGroupColumnDef; the constructor never has to
    // know the defaults — they're shipped here.
    const def = buildAutoGroupColumn();
    expect(def.colId).toBe(AUTO_GROUP_COLUMN_ID);
    expect(def.headerName).toBe(AUTO_GROUP_DEFAULT_HEADER_NAME);
    expect(def.width).toBe(AUTO_GROUP_DEFAULT_WIDTH);
    expect(def.cellRenderer).toBe(AUTO_GROUP_RENDERER);
    expect(def.sortable).toBe(false);
    expect(def.resizable).toBe(true);
    expect(def.cellDataType).toBe('text');
    // The visible-leaf order builder re-prepends the auto-group
    // column on every recompute, so a UI drag could never stick.
    // Default to suppressMovable: true so the header cursor doesn't
    // suggest a drag the engine ignores.
    expect(def.suppressMovable).toBe(true);
    // Pin to the left by default so the Group column is visually the
    // first column even when the app has pinned other columns (e.g.
    // an ID column). Without this, [pinnedId | Group | …] reads as
    // "ID before Group" which contradicts the auto-group's role as
    // the row's anchor.
    expect(def.pinned).toBe('left');
  });

  it('autoGroupColumnDef can opt back into a draggable header via suppressMovable: false', () => {
    // The fixed position is enforced by computeVisibleColumnOrder
    // regardless of suppressMovable, but apps that prefer the AG-Grid
    // drag affordance (even when the drop doesn't persist) can flip
    // the flag through the override.
    const def = buildAutoGroupColumn({ override: { suppressMovable: false } });
    expect(def.suppressMovable).toBe(false);
  });

  it('autoGroupColumnDef can opt out of the default pinned: "left"', () => {
    // Apps that want the Group column to sit in the center band
    // (e.g. so the user can scroll past it horizontally) pass
    // `pinned: null` through the override. `resolveColDef`'s `??`
    // chain treats null as "no value here" and the resolved slot
    // ends up undefined, which the painter reads as the center
    // band.
    const def = buildAutoGroupColumn({ override: { pinned: null as any } });
    expect(def.pinned).toBeUndefined();
  });

  it('autoGroupColumnDef override merges onto defaults; colId is always forced', () => {
    // Apps tune the column without re-implementing the synthesis:
    // wider, pinned, custom header. The forced colId guarantees
    // the cgrid layer can still find the column via
    // AUTO_GROUP_COLUMN_ID — a stray override colId would break
    // every interaction feature that looks the column up by name.
    const def = buildAutoGroupColumn({
      override: {
        headerName: 'Bucket',
        width: 280,
        pinned: 'left',
        colId: 'sneaky',
        cellRendererParams: { showCount: false },
      },
    });
    expect(def.colId).toBe(AUTO_GROUP_COLUMN_ID);     // forced
    expect(def.headerName).toBe('Bucket');
    expect(def.width).toBe(280);
    expect(def.pinned).toBe('left');
    expect(def.cellRendererParams).toEqual({ showCount: false });
  });

  it('autoGroupColumnDef can override cellRenderer for fully-custom group cells', () => {
    // The synthesized def ships `'group'` as the default renderer, but
    // an app that wants to paint the auto-group cells via its own
    // registered painter (e.g. a hierarchy-with-icons variant) must
    // be able to override. The resolver must NOT lock down the
    // renderer slot.
    const def = buildAutoGroupColumn({
      override: { cellRenderer: 'customGroupRenderer' },
    });
    expect(def.cellRenderer).toBe('customGroupRenderer');
  });
});

describe('groupCell renderer — chrome painting', () => {
  it('paints chevron-down (Lucide path) when the group is expanded', () => {
    // Expanded groups read with the down-pointing chevron — same
    // glyph as the sort-desc indicator vocabulary. The painter must
    // call ctx.stroke at least once (drawIcon's terminating call)
    // and the chevron path scale step must run via translate + scale.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ isExpanded: true, depth: 0 }),
    }));
    expect((gc.translate as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((gc.stroke as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('paints chevron-right when the group is collapsed', () => {
    // Collapsed groups read with the right-pointing chevron — the
    // chevron-right Lucide path. The translation + scale + stroke
    // calls fire identically to the expanded case; the difference
    // is the path identity. Since happy-dom can't introspect the
    // Path2D, we assert the call shape and rely on visual baselines
    // for pixel-level glyph verification.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ isExpanded: false, depth: 0 }),
    }));
    expect((gc.stroke as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    // The text still paints — chevron-only renders would leave the
    // group nameless on screen.
    expect((gc.fillText as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('indent scales with depth (one indent unit per level)', () => {
    // depth=0 paints text at PADDING (6) + CHEVRON_SIZE (12) + CHEVRON_GAP (6) = 24.
    // depth=1 paints at 24 + indent (14) = 38.
    // depth=2 paints at 24 + indent*2 (28) = 52.
    // The design plan locks indent at one chevron-width per depth so the
    // chevrons "stack" cleanly under nested groups; this assertion is the
    // pixel guard for that decision.
    const gcDepth0 = makeGc();
    groupCell.paint(gcDepth0, baseParams({
      value: makeGroupValue({ depth: 0 }),
    }));
    const x0 = ((gcDepth0.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x0).toBe(6 + 12 + 6); // PADDING + CHEVRON_SIZE + CHEVRON_GAP

    const gcDepth1 = makeGc();
    groupCell.paint(gcDepth1, baseParams({
      value: makeGroupValue({ depth: 1 }),
    }));
    const x1 = ((gcDepth1.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x1).toBe(x0 + 14);

    const gcDepth2 = makeGc();
    groupCell.paint(gcDepth2, baseParams({
      value: makeGroupValue({ depth: 2 }),
    }));
    const x2 = ((gcDepth2.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x2).toBe(x0 + 28);
  });

  it('paints a (count) suffix formatted via toLocaleString when childCount > 0', () => {
    // The count suffix uses Intl number formatting so 1,234 reads
    // correctly across locales. The format string is "(N)" — no
    // leading space inside the parens, one COUNT_GAP between the
    // value and the open paren. Zero count omits the suffix entirely
    // (covered by the next case).
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ childCount: 1234, valueFormatted: 'Tech' }),
    }));
    const calls = (gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]![0]).toBe('Tech');
    expect(calls[1]![0]).toBe(`(${(1234).toLocaleString()})`);
  });

  it('omits the (count) suffix when childCount === 0 (empty groups should not read as "(0)")', () => {
    // Per the design plan: a group with zero children should never
    // paint "(0)" — that suffix would read as "I am asserting my
    // emptiness" instead of letting the chevron + indent speak for
    // it. Worth a dedicated case because the predicate is easy to
    // flip to `>= 0` in a refactor and the diff would silently ship.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ childCount: 0, valueFormatted: 'EmptyBucket' }),
    }));
    const calls = (gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);          // value only, no count
    expect(calls[0]![0]).toBe('EmptyBucket');
  });

  it('paints empty string (no glyph) for empty / null group value', () => {
    // Empty group keys render as blank — no em-dash sentinel. The cell
    // chrome (chevron, count) still paints; only the value text is empty.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ valueFormatted: '' }),
    }));
    const calls = (gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe('');
  });

  it('paints NO chrome for a data row (rowKind === 0) with empty valueFormatted — only background', () => {
    // Architecture rule: the auto-group column's data-row cells stay
    // blank by default. The chunk's group-context payload for a data
    // row carries `rowKind: 0` AND an empty `valueFormatted` (the
    // worker only populates the value for data rows when
    // `showOpenedGroup: true` lands — Cycle 15 / Task 10); the
    // renderer's short-circuit must leave the cell empty so the user
    // reads the grouped page as "tree spine + data," not "tree spine
    // + invisible chrome leaking into data."
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ rowKind: 0, valueFormatted: '' }),
    }));
    expect((gc.fillText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((gc.stroke as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('Task 10 / showOpenedGroup — data row with valueFormatted paints muted parent-group echo at leaf indent', () => {
    // When `showOpenedGroup: true` is on, the worker populates the
    // data row's `chunk.groupValue[i]` slot with its leaf-parent
    // group's formatted value. The renderer keys off "rowKind 0 +
    // non-empty valueFormatted" and paints a muted echo at the leaf
    // group's indent (`(depth - 1) × indentUnit`) — no chevron, no
    // count, no checkbox. The depth on the payload mirrors the
    // chunk's `groupDepth[i]` for data rows (= `rowGroupCols.length`),
    // so subtracting one lands at the leaf group's depth.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ rowKind: 0, depth: 2, valueFormatted: 'Swap' }),
    }));
    const calls = (gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls;
    // Only ONE fillText — value, no count suffix.
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe('Swap');
    // x = PADDING(6) + (depth - 1) × indentUnit(14) = 6 + 14 = 20.
    // Sits at the leaf group's indent — one chevron-width earlier
    // than a data row would land at its own depth.
    expect(calls[0]![1]).toBe(6 + 14);
    // No chevron — `stroke` (drawIcon's terminating call) must not
    // fire. Data rows aren't toggle targets; painting a chevron
    // would falsely suggest interactivity.
    expect((gc.stroke as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('paints NO chrome for a non-group-shaped value (defensive — null / wrong-shape)', () => {
    // A misconfigured cellAt could ship a plain string or null where
    // a GroupCellValue was expected. The renderer's downcast must
    // refuse to paint chrome — otherwise the painter would crash on
    // `null.depth` and the whole frame would skip.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({ value: null, valueFormatted: '' }));
    expect((gc.fillText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((gc.stroke as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const gc2 = makeGc();
    groupCell.paint(gc2, baseParams({ value: 'AAPL', valueFormatted: 'AAPL' }));
    expect((gc2.fillText as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('falls back to fg + 14px indent when theme tokens are unset (defensive)', () => {
    // The renderer must produce a legible cell even when invoked
    // outside the standard pipeline — a stand-alone paint call from
    // a test, a non-cgrid harness, or a future refactor that drops
    // a theme assignment somewhere. The defaults match the shipped
    // tokens.
    const gc = makeGc();
    groupCell.paint(gc, baseParams({
      value: makeGroupValue({ depth: 1 }),
      groupChevronColor: undefined,
      groupCountColor: undefined,
      groupIndent: undefined,
      fg: '#000000',
    }));
    const x = ((gc.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!)[1] as number;
    expect(x).toBe(6 + 12 + 6 + 14); // PADDING + CHEVRON_SIZE + CHEVRON_GAP + default indent (14)
  });
});
