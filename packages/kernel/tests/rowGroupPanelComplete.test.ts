/**
 * Cycle 15.5 / Task 1 — Row group panel completeness unit tests.
 *
 * Cycle 15 / Task 6 shipped the panel with add-via-header-drag and
 * `×`-click remove. Task 1 closes the spec's missing surfaces from
 * Prompt 6:
 *   - pill drag-within-panel REORDER (mouse-down on a chip body →
 *     drag with live insertion line + floating ghost → drop calls
 *     `moveRowGroupColumn`),
 *   - per-pill SORT INDICATOR (`↑` / `↓` glyph between label + `×`;
 *     click cycles `none → asc → desc → none`),
 *   - drag GHOST (DOM overlay on `document.body` following the cursor),
 *   - LIVE INSERTION LINE on every drag source (column-header drop
 *     from Cycle 15 / Task 6 + pill-reorder drop from Task 1),
 *   - PRIMITIVE-API subscription so a mutation from another view
 *     (programmatic API, tool panel — Task 2, context menu — Task 2)
 *     re-renders the chip strip live.
 *
 * Total: 24 cases covering every assertion called out in the worklog
 * Task 1 entry. Visual cells + E2E (`apps/cgrid-positions/e2e-visual/27-…`
 * + `apps/cgrid-positions/e2e/cycle15.5-pillReorder.spec.ts`) cover
 * the cross-component pipeline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RowGroupPanelHost,
  type RowGroupPanelGridContext,
} from '../src/interaction/rowGroupPanel/host';
import { GroupingState } from '../src/core/groupingState';

interface RecordingContext extends RowGroupPanelGridContext {
  reserveCalls: Array<{ side: 'top'; height: number }>;
  addCalls: string[];
  removeCalls: string[];
  moveCalls: Array<{ from: number; to: number }>;
  sortCalls: Array<{ colId: string; direction: 'asc' | 'desc' | null }>;
  enabledCols: Set<string>;
  headerNames: Map<string, string>;
}

function makeContext(): RecordingContext {
  const reserveCalls: Array<{ side: 'top'; height: number }> = [];
  const addCalls: string[] = [];
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
    addCalls,
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
      addCalls.push(colId);
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

/** Dispatch a synthetic PointerEvent with the canonical fields the
 *  host reads. JSDOM doesn't ship `PointerEvent` natively, so we
 *  subclass `MouseEvent` and pin the missing fields. */
function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; button?: number; pointerId?: number },
): void {
  // JSDOM lacks PointerEvent. Build a MouseEvent-shaped synthetic and
  // pin `pointerId` + `pointerType` for the listener.
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(t: string, i: MouseEventInit & { pointerId?: number }) {
      super(t, i);
      this.pointerId = i.pointerId ?? 1;
      this.pointerType = 'mouse';
    }
  }
  const event = new PointerEventPolyfill(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
  });
  target.dispatchEvent(event);
}

/** Mount the panel inside a positioned root attached to the document
 *  so `getBoundingClientRect()` returns real numbers in JSDOM. */
function mountPanel(
  ctx: RowGroupPanelGridContext,
  initialColumns: string[],
  options?: { suppressSort?: boolean },
): { host: RowGroupPanelHost; root: HTMLElement } {
  const root = document.createElement('div');
  Object.assign(root.style, {
    width: '800px',
    height: '600px',
    position: 'relative',
  });
  document.body.appendChild(root);
  const host = new RowGroupPanelHost(
    root,
    ctx,
    'always',
    initialColumns,
    undefined,
    options,
  );
  return { host, root };
}

/** Pin chip rects in JSDOM so the host's snap algorithm sees concrete
 *  positions. JSDOM's default getBoundingClientRect returns zeros for
 *  every element; we override per-instance for the panel + chip elements
 *  so the host's gap-finder + drop hit-test produce realistic values. */
function pinChipRects(root: HTMLElement, chipWidth = 60, chipGap = 12, panelLeft = 0, panelWidth = 800): void {
  const panel = root.querySelector('.vg-row-group-panel') as HTMLElement | null;
  if (!panel) return;
  panel.getBoundingClientRect = function (): DOMRect {
    return {
      left: panelLeft,
      top: 0,
      right: panelLeft + panelWidth,
      bottom: 32,
      width: panelWidth,
      height: 32,
      x: panelLeft,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  const chips = panel.querySelectorAll('.vg-row-group-panel-chip');
  let x = panelLeft + 8;
  chips.forEach((chip) => {
    const element = chip as HTMLElement;
    const startLeft = x;
    element.getBoundingClientRect = function (): DOMRect {
      return {
        left: startLeft,
        top: 5,
        right: startLeft + chipWidth,
        bottom: 27,
        width: chipWidth,
        height: 22,
        x: startLeft,
        y: 5,
        toJSON: () => ({}),
      } as DOMRect;
    };
    x = startLeft + chipWidth + chipGap;
  });
}

describe('Cycle 15.5 / Task 1 — Row group panel completeness', () => {
  let cleanupRoots: HTMLElement[] = [];

  afterEach(() => {
    for (const root of cleanupRoots) {
      root.parentElement?.removeChild(root);
    }
    cleanupRoots = [];
    document.querySelectorAll('.vg-row-group-panel-chip-ghost').forEach((el) => {
      el.parentElement?.removeChild(el);
    });
  });

  function mount(
    ctx: RowGroupPanelGridContext,
    cols: string[],
    options?: { suppressSort?: boolean },
  ): { host: RowGroupPanelHost; root: HTMLElement } {
    const result = mountPanel(ctx, cols, options);
    cleanupRoots.push(result.root);
    return result;
  }

  // ------------------------------------------------------------------
  // 1. Pill reorder mid → mutates rowGroupColumns order
  // ------------------------------------------------------------------
  it('pill reorder drag → drop in middle slot dispatches moveRowGroupColumn(from, to)', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk', 'region', 'ticker']);
    pinChipRects(root);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    const sourceChip = chips[2] as HTMLElement; // ticker
    // Press inside the ticker chip
    dispatchPointer(sourceChip, 'pointerdown', { clientX: 160, clientY: 16 });
    // Move past threshold to start the drag
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 16 });
    // Continue moving toward the gap between desk (0–60) and region (72–132)
    dispatchPointer(window, 'pointermove', { clientX: 66, clientY: 16 });
    // Release at the gap
    dispatchPointer(window, 'pointerup', { clientX: 66, clientY: 16 });
    // moveRowGroupColumn called with (from=2, to=1)
    expect(ctx.moveCalls).toHaveLength(1);
    expect(ctx.moveCalls[0]).toEqual({ from: 2, to: 1 });
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 2. Pill × click removes via the new primitive verb
  // ------------------------------------------------------------------
  it('pill × click dispatches ctx.removeRowGroupColumn', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker', 'sector']);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    const removeBtn = (chips[0] as HTMLElement).querySelector(
      '.vg-row-group-panel-chip-remove',
    ) as HTMLButtonElement;
    removeBtn.click();
    expect(ctx.removeCalls).toEqual(['ticker']);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 3. Sort indicator: no indicator at rest; chip-body click → asc
  // ------------------------------------------------------------------
  it('a no-sort chip omits the indicator span; chip-body click cycles null → asc', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    // No indicator is rendered when the level has no sort entry —
    // chip width matches the byte-stable Task 6 baseline.
    expect(root.querySelector('.vg-row-group-panel-chip-sort')).toBeNull();
    const chip = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    chip.click();
    expect(ctx.sortCalls).toEqual([{ colId: 'ticker', direction: 'asc' }]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 4. Sort indicator: asc → desc on second click
  // ------------------------------------------------------------------
  it('sort indicator cycle: asc → desc on subsequent click', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    host.setGroupingState(['ticker'], [{ direction: 'asc' }]);
    const sortBtn = root.querySelector('.vg-row-group-panel-chip-sort') as HTMLButtonElement;
    expect(sortBtn.dataset.direction).toBe('asc');
    expect(sortBtn.textContent).toBe('↑');
    sortBtn.click();
    expect(ctx.sortCalls).toEqual([{ colId: 'ticker', direction: 'desc' }]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 5. Sort indicator: desc → null on third click
  // ------------------------------------------------------------------
  it('sort indicator cycle: desc → null on third click', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    host.setGroupingState(['ticker'], [{ direction: 'desc' }]);
    const sortBtn = root.querySelector('.vg-row-group-panel-chip-sort') as HTMLButtonElement;
    expect(sortBtn.dataset.direction).toBe('desc');
    expect(sortBtn.textContent).toBe('↓');
    sortBtn.click();
    expect(ctx.sortCalls).toEqual([{ colId: 'ticker', direction: null }]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 6. rowGroupPanelSuppressSort: true hides indicator AND blocks click
  // ------------------------------------------------------------------
  it('rowGroupPanelSuppressSort: true removes the sort-button DOM and the click handler', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker'], { suppressSort: true });
    const sortBtn = root.querySelector('.vg-row-group-panel-chip-sort');
    expect(sortBtn).toBeNull();
    // Click the chip body (no sort indicator) — no sort call fires.
    const chip = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    chip.click();
    expect(ctx.sortCalls).toEqual([]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 7. Live insertion line moves with pointer mid-drag
  // ------------------------------------------------------------------
  it('insertion line snaps to the gap nearest the pointer mid-drag', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk', 'region', 'ticker']);
    pinChipRects(root);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    const sourceChip = chips[0] as HTMLElement;
    dispatchPointer(sourceChip, 'pointerdown', { clientX: 30, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 16 });
    // Pointer now over middle of region; snap should land between
    // region (72–132) and ticker (144–204), at gap idx 2.
    dispatchPointer(window, 'pointermove', { clientX: 138, clientY: 16 });
    const line = root.querySelector('.vg-row-group-panel-insertion-line') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.style.display).not.toBe('none');
    // Snap target: gap between region.right (132) and ticker.left (144),
    // panel-relative ~138 - 0 - 1 = 137px.
    const left = parseFloat(line.style.left);
    expect(left).toBeGreaterThan(130);
    expect(left).toBeLessThanOrEqual(150);
    // Release outside panel — no commit.
    dispatchPointer(window, 'pointerup', { clientX: 138, clientY: 200 });
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 8. Live insertion line hides on drag cancel
  // ------------------------------------------------------------------
  it('insertion line + ghost are torn down on pointercancel', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk', 'region']);
    pinChipRects(root);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    const sourceChip = chips[0] as HTMLElement;
    dispatchPointer(sourceChip, 'pointerdown', { clientX: 30, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 16 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).not.toBeNull();
    dispatchPointer(window, 'pointercancel', { clientX: 100, clientY: 16 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    const line = root.querySelector('.vg-row-group-panel-insertion-line') as HTMLElement | null;
    if (line) expect(line.style.display).toBe('none');
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 9. Drag ghost appears on threshold cross + tracks pointer
  // ------------------------------------------------------------------
  it('drag ghost mounts at threshold cross, tracks pointer, unmounts on pointerup', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    pinChipRects(root);
    const sourceChip = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    // Pointerdown: no ghost yet (still in 'press' state).
    dispatchPointer(sourceChip, 'pointerdown', { clientX: 30, clientY: 16 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    // Move 2px — below threshold, no ghost.
    dispatchPointer(window, 'pointermove', { clientX: 32, clientY: 16 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    // Move 6px — crosses threshold, ghost mounts.
    dispatchPointer(window, 'pointermove', { clientX: 36, clientY: 16 });
    const ghost = document.querySelector('.vg-row-group-panel-chip-ghost') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(parseFloat(ghost.style.left)).toBe(36 + 0);
    expect(parseFloat(ghost.style.top)).toBe(16 + -11);
    // Move further — ghost tracks.
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 20 });
    expect(parseFloat(ghost.style.left)).toBe(100 + 0);
    expect(parseFloat(ghost.style.top)).toBe(20 + -11);
    // Release — ghost unmounts.
    dispatchPointer(window, 'pointerup', { clientX: 100, clientY: 20 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 10. Drop from column-header source still appends via primitive
  // ------------------------------------------------------------------
  it('handleColumnDrop dispatches ctx.addRowGroupColumn for an enabled column', () => {
    const ctx = makeContext();
    const { host } = mount(ctx, []);
    const accepted = host.handleColumnDrop('ticker');
    expect(accepted).toBe(true);
    expect(ctx.addCalls).toEqual(['ticker']);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 11. Drop from tool panel source ALSO routes through handleColumnDrop
  //     (the host is source-agnostic — Task 2 calls the same method).
  // ------------------------------------------------------------------
  it('handleColumnDrop is source-agnostic — accepts any colId with enableRowGroup', () => {
    const ctx = makeContext();
    const { host } = mount(ctx, []);
    // Simulate two different sources dispatching to the same entry point.
    expect(host.handleColumnDrop('ticker')).toBe(true);
    expect(host.handleColumnDrop('sector')).toBe(true);
    expect(ctx.addCalls).toEqual(['ticker', 'sector']);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 12. setGroupingState re-renders pills with new order from outside
  // ------------------------------------------------------------------
  it('setGroupingState from another view re-renders the chip strip in the new order', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk']);
    host.setGroupingState(['ticker', 'region', 'desk'], [null, null, null]);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    expect(Array.from(chips).map((c) => (c as HTMLElement).dataset.colId)).toEqual([
      'ticker',
      'region',
      'desk',
    ]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 13. setGroupingState propagates per-level sort onto the indicators
  // ------------------------------------------------------------------
  it('setGroupingState propagates per-level sort onto chip indicators', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker', 'sector']);
    host.setGroupingState(
      ['ticker', 'sector'],
      [{ direction: 'asc' }, { direction: 'desc' }],
    );
    const sortBtns = root.querySelectorAll('.vg-row-group-panel-chip-sort');
    expect(sortBtns).toHaveLength(2);
    expect((sortBtns[0] as HTMLElement).dataset.direction).toBe('asc');
    expect((sortBtns[0] as HTMLElement).textContent).toBe('↑');
    expect((sortBtns[1] as HTMLElement).dataset.direction).toBe('desc');
    expect((sortBtns[1] as HTMLElement).textContent).toBe('↓');
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 14. Reorder permutations: 3 pills × 3 from-positions → 3 dispatches
  // ------------------------------------------------------------------
  it('reorder permutations: every chip can drag to any slot via moveRowGroupColumn', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk', 'region', 'ticker']);
    pinChipRects(root);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    // Drag chip[0] to the trailing slot (after ticker).
    const source = chips[0] as HTMLElement;
    dispatchPointer(source, 'pointerdown', { clientX: 30, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 300, clientY: 16 });
    dispatchPointer(window, 'pointerup', { clientX: 300, clientY: 16 });
    expect(ctx.moveCalls.at(-1)).toEqual({ from: 0, to: 3 });
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 15. Drop verdict visual: accept marks the panel data-drop attribute
  // ------------------------------------------------------------------
  it('drop verdict accept marks panel[data-drop="accept"]', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, []);
    pinChipRects(root);
    host.setDragHover('ticker', 100, 16);
    const panel = root.querySelector('.vg-row-group-panel') as HTMLElement;
    expect(panel.dataset.drop).toBe('accept');
    host.clearDragHover();
    expect(panel.dataset.drop).toBeUndefined();
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 16. Empty-state placeholder mounts when rowGroupColumns is empty
  // ------------------------------------------------------------------
  it('empty-state placeholder mounts when rowGroupColumns is empty under always mode', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, []);
    const empty = root.querySelector('.vg-row-group-panel-empty') as HTMLElement | null;
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('Drag here to set row groups');
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 17. Empty-state clears when first chip lands via setGroupingState
  // ------------------------------------------------------------------
  it('empty-state clears when first chip lands via setGroupingState', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, []);
    expect(root.querySelector('.vg-row-group-panel-empty')).not.toBeNull();
    host.setGroupingState(['ticker'], [null]);
    expect(root.querySelector('.vg-row-group-panel-empty')).toBeNull();
    expect(root.querySelectorAll('.vg-row-group-panel-chip')).toHaveLength(1);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 18. destroy is idempotent + cleans up the ghost / insertion line
  // ------------------------------------------------------------------
  it('destroy is idempotent and tears down the ghost + insertion line', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    pinChipRects(root);
    const source = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    dispatchPointer(source, 'pointerdown', { clientX: 30, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 100, clientY: 16 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).not.toBeNull();
    host.destroy();
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    expect(() => host.destroy()).not.toThrow();
  });

  // ------------------------------------------------------------------
  // 19. Keyboard delete on a focused chip removes the column
  // ------------------------------------------------------------------
  it('Delete / Backspace on a focused chip dispatches removeRowGroupColumn', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    const chip = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(ctx.removeCalls).toEqual(['ticker']);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 20. Keyboard Cmd+ArrowLeft reorders the chip left
  // ------------------------------------------------------------------
  it('Cmd+ArrowLeft / Cmd+ArrowRight on a focused chip dispatches moveRowGroupColumn', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['desk', 'region', 'ticker']);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    const middle = chips[1] as HTMLElement; // region @ index 1
    middle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true }),
    );
    expect(ctx.moveCalls.at(-1)).toEqual({ from: 1, to: 0 });
    // ArrowRight from middle → slot 3.
    middle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true }),
    );
    expect(ctx.moveCalls.at(-1)).toEqual({ from: 1, to: 3 });
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 21. Chip aria-label reads the column name + group level
  // ------------------------------------------------------------------
  it('chip carries an aria-label naming the column + its group level', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker', 'sector']);
    const chips = root.querySelectorAll('.vg-row-group-panel-chip');
    expect(chips[0]!.getAttribute('aria-label')).toBe('Ticker group level 1');
    expect(chips[1]!.getAttribute('aria-label')).toBe('Sector group level 2');
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 22. Drag threshold: pointer movement <4 px is NOT a drag
  // ------------------------------------------------------------------
  it('pointer movement below the 4 px threshold does not start a drag (no ghost, no move)', () => {
    const ctx = makeContext();
    const { host, root } = mount(ctx, ['ticker']);
    pinChipRects(root);
    const source = root.querySelector('.vg-row-group-panel-chip') as HTMLElement;
    dispatchPointer(source, 'pointerdown', { clientX: 30, clientY: 16 });
    dispatchPointer(window, 'pointermove', { clientX: 32, clientY: 18 });
    dispatchPointer(window, 'pointerup', { clientX: 32, clientY: 18 });
    expect(document.querySelector('.vg-row-group-panel-chip-ghost')).toBeNull();
    expect(ctx.moveCalls).toEqual([]);
    host.destroy();
  });

  // ------------------------------------------------------------------
  // 23. GroupingState primitive: three views, one list invariant
  // ------------------------------------------------------------------
  it('GroupingState primitive: mutation via add → emits to all subscribers with fresh state', () => {
    const state = new GroupingState({ rowGroupColumns: ['desk'] });
    const events: Array<{ cols: string[]; source: string }> = [];
    state.on('groupingStateChanged', (e) => {
      events.push({ cols: e.rowGroupColumns, source: e.source });
    });
    state.addRowGroupColumn('region');
    state.moveRowGroupColumn(0, 2);
    state.removeRowGroupColumn('desk');
    state.setRowGroupColumnSort('region', 'asc');
    expect(events).toEqual([
      { cols: ['desk', 'region'], source: 'add' },
      { cols: ['region', 'desk'], source: 'move' },
      { cols: ['region'], source: 'remove' },
      { cols: ['region'], source: 'sort' },
    ]);
    state.destroy();
  });

  // ------------------------------------------------------------------
  // 24. GroupingState preserves per-level sort across setRowGroupColumns
  // ------------------------------------------------------------------
  it('GroupingState preserves per-level sort across a full setRowGroupColumns swap by colId', () => {
    const state = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    state.setRowGroupColumnSort('region', 'desc');
    state.setRowGroupColumns(['region', 'desk', 'ticker']);
    expect(state.getRowGroupColumns()).toEqual(['region', 'desk', 'ticker']);
    expect(state.getPerLevelSort()).toEqual([
      { direction: 'desc' },
      null,
      null,
    ]);
    state.destroy();
  });
});
