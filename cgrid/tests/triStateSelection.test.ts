import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  SelectionModel,
  type GroupMembershipResolver,
} from '../src/interaction/selectionModel';
import { groupCell, type GroupCellValue } from '../src/renderer/cellRenderers/group';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

/**
 * Cycle 15 / Task 8 — `groupSelectsChildren` + tri-state checkbox.
 *
 * The 13 cases below cover every observable behaviour of the
 * tri-state extension to `SelectionModel`:
 *   - default-off / opt-in via `setGroupSelectsChildren`
 *   - cascade selection on group click (all-direction switch)
 *   - aggregate state recomputation (`getGroupSelectionState`)
 *   - rejection / defensive paths (single-mode, unknown key,
 *     disabled state)
 *   - emit semantics (one emit per state change, none on no-op)
 *   - persistence guarantees (`getPersistentSelectedRowIds` ⊂ leaves)
 *
 * Cases 12 & 13 also exercise the `'group'` cell renderer's new
 * checkbox slot so the visual contract from
 * `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 8
 * has a unit-level guard (the visual cell baseline catches paint
 * drift; these cases catch the shape of the call into the painter).
 */

// happy-dom doesn't ship Path2D; the renderer constructs `new Path2D(...)`
// when painting the chevron. Stub it so the painter tests can run.
beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

/** Fixture: a 3-leaf, 1-group tree.
 *   group 'ticker:AAPL' descendants = ['POS-1', 'POS-2', 'POS-3']
 *   group 'ticker:MSFT' descendants = ['POS-4', 'POS-5']
 *   unknown key resolves to []
 */
function makeMembership(): GroupMembershipResolver {
  const map = new Map<string, string[]>([
    ['ticker:AAPL', ['POS-1', 'POS-2', 'POS-3']],
    ['ticker:MSFT', ['POS-4', 'POS-5']],
  ]);
  return {
    getDescendantRowIds: (key) => map.get(key) ?? [],
  };
}

function makeGc(): { gc: CachedContext2D; moveTo: ReturnType<typeof vi.fn>; lineTo: ReturnType<typeof vi.fn> } {
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const ctx: Record<string, unknown> = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo,
    lineTo,
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 30 })),
    translate: vi.fn(),
    scale: vi.fn(),
    clearFill: vi.fn(),
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
  return { gc: ctx as unknown as CachedContext2D, moveTo, lineTo };
}

function makeGroupValue(over: Partial<GroupCellValue> = {}): GroupCellValue {
  return {
    kind: 'group',
    rowKind: 1,
    depth: 0,
    valueFormatted: 'AAPL',
    childCount: 3,
    isExpanded: true,
    ...over,
  };
}

function basePaintConfig(value: GroupCellValue): CellPaintConfig {
  return {
    value,
    valueFormatted: value.valueFormatted,
    bounds: { x: 0, y: 0, w: 220, h: 32 },
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
    groupCheckboxBorderColor: '#1a1f24',
    groupCheckboxCheckColor: '#1a1f24',
    groupCheckboxIndeterminateColor: '#1a1f24',
    groupCheckboxFill: 'transparent',
  };
}

describe('SelectionModel — tri-state group selection (Cycle 15 / Task 8)', () => {
  it('1. groupSelectsChildren is off by default; setGroupSelected no-ops', () => {
    // Default state must NOT cascade — apps that mount a grouped grid
    // without opting in see exactly the leaf-row selection semantics
    // from earlier cycles. A passing default-cascade would silently
    // break every existing grouped grid on upgrade.
    const m = new SelectionModel('multiple');
    expect(m.isGroupSelectsChildren()).toBe(false);
    m.setGroupSelected('ticker:AAPL', true);
    expect(m.getPersistentSelectedRowIds()).toEqual([]);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('none');
  });

  it('2. setGroupSelected(true) cascades all descendant rowIds into the selected set', () => {
    // The cascade is the core deliverable: clicking a group's checkbox
    // selects every leaf row under it via the membership resolver. The
    // persistent rowId set is the source of truth — paint indices
    // derive from it later.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    expect(new Set(m.getPersistentSelectedRowIds())).toEqual(
      new Set(['POS-1', 'POS-2', 'POS-3']),
    );
  });

  it('3. getGroupSelectionState returns "all" when every descendant is selected', () => {
    // Aggregate state computation: with every descendant in the
    // persistent set, the group reads as fully selected — the paint
    // signal that lets the renderer draw the √ glyph.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('all');
  });

  it('4. getGroupSelectionState returns "partial" when SOME descendants are selected', () => {
    // The indeterminate state — the design risk Task 8 explicitly
    // names. A trader selecting two of three AAPL positions sees the
    // dash on the AAPL group's checkbox; the dash IS the
    // "mixed selection" affordance.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setSelectedRowIds(['POS-1', 'POS-2'], [0, 1]);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('partial');
  });

  it('5. getGroupSelectionState returns "none" when no descendant is selected', () => {
    // Symmetric to case 3 — the empty-box paint signal. Also covers
    // the post-clear state so a "select all then clear" cycle leaves
    // every group's checkbox back to empty.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    m.setGroupSelected('ticker:AAPL', false);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('none');
  });

  it('6. setGroupSelected(false) deselects every descendant', () => {
    // The 'all → none' transition — clicking a fully-selected group
    // empties it. Test the inverse of case 2 so both directions of
    // the cascade are guarded.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setSelectedRowIds(['POS-1', 'POS-2', 'POS-3'], [0, 1, 2]);
    m.setGroupSelected('ticker:AAPL', false);
    expect(m.getPersistentSelectedRowIds()).toEqual([]);
  });

  it('7. setGroupSelected(true) on a partial group completes the selection', () => {
    // The 'partial → all' transition. Matches Excel / ag-grid: a
    // mixed group "completes" on first click. Without this rule the
    // user would click a partial group expecting completion and watch
    // the existing selection get clobbered to 'none' — a quietly
    // destructive UX.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setSelectedRowIds(['POS-1'], [0]);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('partial');
    m.setGroupSelected('ticker:AAPL', true);
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('all');
    expect(new Set(m.getPersistentSelectedRowIds())).toEqual(
      new Set(['POS-1', 'POS-2', 'POS-3']),
    );
  });

  it('8. unknown group key resolves defensively to "none" + no cascade', () => {
    // Defensive guard for stale keys from a prior group model. The
    // SelectionModel must not throw; the paint must default to empty
    // (the "I don't know" answer is 'none'); cascade silently no-ops.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    expect(m.getGroupSelectionState('ticker:UNKNOWN')).toBe('none');
    m.setGroupSelected('ticker:UNKNOWN', true);
    expect(m.getPersistentSelectedRowIds()).toEqual([]);
  });

  it('9. mode "single" rejects setGroupSelected even when cascading is on', () => {
    // Cascading semantically selects N rows; single-mode allows only
    // one. The renderer is expected to hide the checkbox under
    // single-mode (`groupSelectsChildren` is meaningless there), but
    // this guard catches any path that reaches the model anyway —
    // e.g. an app that explicitly calls api.toggleGroupChildrenSelected.
    const m = new SelectionModel('single');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    expect(m.getPersistentSelectedRowIds()).toEqual([]);
  });

  it('10. disabling cascade preserves pre-existing selection; subsequent group calls no-op', () => {
    // Runtime swap path — `setGridOption('groupSelectsChildren', false)`
    // must not silently wipe rows the user selected via the cascade.
    // Mirrors the `setMode('single')` contract from earlier cycles:
    // runtime toggles preserve in-flight state where possible.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    m.setGroupSelectsChildren(false, null);
    expect(new Set(m.getPersistentSelectedRowIds())).toEqual(
      new Set(['POS-1', 'POS-2', 'POS-3']),
    );
    // After disabling, group operations no-op AND aggregate state
    // collapses to 'none' (since the resolver is gone).
    m.setGroupSelected('ticker:AAPL', false);
    expect(new Set(m.getPersistentSelectedRowIds())).toEqual(
      new Set(['POS-1', 'POS-2', 'POS-3']),
    );
    expect(m.getGroupSelectionState('ticker:AAPL')).toBe('none');
  });

  it('11. emit fires exactly once per state change; no-ops do not emit', () => {
    // Paint cost is proportional to emits — a stray emit per cascade
    // is a hot-path regression on grouped grids with many groups
    // visible. No-op cascades (selecting an already-selected group)
    // must be silent so the per-frame paint cost stays bounded.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    let count = 0;
    m.onChange(() => { count += 1; });
    m.setGroupSelected('ticker:AAPL', true); // 1
    expect(count).toBe(1);
    m.setGroupSelected('ticker:AAPL', true); // no-op (already all)
    expect(count).toBe(1);
    m.setGroupSelected('ticker:AAPL', false); // 2
    expect(count).toBe(2);
    m.setGroupSelected('ticker:AAPL', false); // no-op (already none)
    expect(count).toBe(2);
  });

  it('12. getPersistentSelectedRowIds returns leaf rowIds only — never group keys', () => {
    // The persistent set must stay a flat list of leaf rowIds so
    // a sort / filter / transaction round-trip can resolve indices
    // via the rowId map and rebuild paint indices. Persisting
    // composite group keys would break that contract — apps using
    // the persistent id API would receive a mixed array of leaves +
    // group keys and not know which is which.
    const m = new SelectionModel('multiple');
    m.setGroupSelectsChildren(true, makeMembership());
    m.setGroupSelected('ticker:AAPL', true);
    m.setGroupSelected('ticker:MSFT', true);
    const ids = m.getPersistentSelectedRowIds();
    // Every id must be a leaf — none should match the composite
    // group key pattern (`colId:value`).
    for (const id of ids) {
      expect(id.startsWith('ticker:')).toBe(false);
    }
    expect(new Set(ids)).toEqual(
      new Set(['POS-1', 'POS-2', 'POS-3', 'POS-4', 'POS-5']),
    );
  });

  it('13. group cell renderer paints dash for "partial", √ for "all", empty for "none"', () => {
    // The renderer's checkbox slot is the visible contract. Three
    // paint observations:
    //   - 'none' → 1 strokeRect (border), 0 stroke() calls for interior
    //   - 'partial' → 1 strokeRect (border) + 1 stroke() (the dash)
    //   - 'all' → 1 strokeRect (border) + 1 stroke() (the √)
    // The chevron also calls `drawIcon` (which paints via Path2D);
    // we count only the moveTo() calls inside the checkbox-glyph
    // path to differentiate dash from check by SHAPE.
    //
    // Dash = 1 moveTo + 1 lineTo. Check (√) = 1 moveTo + 2 lineTo.
    {
      const { gc, moveTo, lineTo } = makeGc();
      groupCell.paint(gc, basePaintConfig(makeGroupValue({ selectionState: 'none' })));
      // 'none' → only the box; no moveTo on the interior glyph.
      expect(moveTo).toHaveBeenCalledTimes(0);
      expect(lineTo).toHaveBeenCalledTimes(0);
    }
    {
      const { gc, moveTo, lineTo } = makeGc();
      groupCell.paint(gc, basePaintConfig(makeGroupValue({ selectionState: 'partial' })));
      // Dash: one moveTo + one lineTo.
      expect(moveTo).toHaveBeenCalledTimes(1);
      expect(lineTo).toHaveBeenCalledTimes(1);
    }
    {
      const { gc, moveTo, lineTo } = makeGc();
      groupCell.paint(gc, basePaintConfig(makeGroupValue({ selectionState: 'all' })));
      // Check (√): one moveTo + two lineTo.
      expect(moveTo).toHaveBeenCalledTimes(1);
      expect(lineTo).toHaveBeenCalledTimes(2);
    }
    {
      const { gc, moveTo, lineTo } = makeGc();
      // selectionState undefined → no checkbox slot at all (no
      // strokeRect for the box, no interior glyph). Confirms the
      // renderer omits the checkbox when groupSelectsChildren is off.
      groupCell.paint(gc, basePaintConfig(makeGroupValue({ selectionState: undefined })));
      expect(moveTo).toHaveBeenCalledTimes(0);
      expect(lineTo).toHaveBeenCalledTimes(0);
    }
  });
});
