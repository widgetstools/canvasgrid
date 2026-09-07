/**
 * Every button in the ribbon's formatting strip, clicked, with an assertion
 * that something actually reached the grid.
 *
 * The ribbon tests that existed asserted on the SOURCE TEXT of ribbon.ts —
 * that a builder was called, that a class name appeared. None of them could
 * have caught the bug this file was written for, because the wiring was
 * present and correct-looking and simply targeted nothing.
 *
 * That bug: `allCols()` collected `def.colId` only, but a column's identity is
 * `colId ?? field` and most apps declare `field`. So the list came back empty,
 * and two things broke silently — scope "All columns" applied every action to
 * nothing, and the AB header-case toggle (which ignores the selection and
 * always works over every column) could neither read its state nor apply it.
 *
 * The lesson generalises past the one fix, so this mounts the real ribbon
 * against a recording grid and walks the strip.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ribbonExtensions } from '../src/toolbar/ribbon';

interface Edit { colId: string; patch: Record<string, unknown> }

/** Columns declared the way apps actually declare them: `field`, no `colId`. */
const COLUMN_DEFS = [
  { field: 'cusip', headerName: 'CUSIP' },
  { field: 'midPrice', headerName: 'Mid', cellDataType: 'number' },
  {
    headerName: 'Pricing',
    children: [
      { field: 'bidPrice', headerName: 'Bid', cellDataType: 'number' },
      { field: 'askPrice', headerName: 'Ask', cellDataType: 'number' },
    ],
  },
  { colId: 'derived', headerName: 'Derived' },
];
const EVERY_COLUMN = ['cusip', 'midPrice', 'bidPrice', 'askPrice', 'derived'];

function harness(focus: { rowId: string; colId: string } | null = null) {
  const edits: Edit[] = [];
  const templates: Array<{ id: string; name: string; overrides: Record<string, unknown> }> = [];

  const grid = {
    editColumn: vi.fn((colId: string, patch: Record<string, unknown>) => {
      edits.push({ colId, patch });
      const id = `__cgridOwn:${colId}`;
      let t = templates.find((x) => x.id === id);
      if (!t) { t = { id, name: colId, overrides: {} }; templates.push(t); }
      for (const [k, v] of Object.entries(patch)) {
        const prev = (t.overrides[k] ?? {}) as Record<string, unknown>;
        t.overrides[k] = typeof v === 'object' && v !== null ? { ...prev, ...v } : v;
      }
    }),
    getTemplates: () => templates,
    getCellRanges: () => [],
    getFocusedCell: () => focus,
    getColumnHeaderName: (c: string) => c,
    getGridOption: (k: string) => (k === 'columnDefs' ? COLUMN_DEFS : undefined),
    getState: () => ({ modules: {} }),
    setState: vi.fn(),
    saveTemplate: vi.fn(), renameTemplate: vi.fn(), deleteTemplate: vi.fn(),
    applyTemplate: vi.fn(), removeTemplate: vi.fn(),
    addEventListener: () => () => {},
    getValueColumns: () => [], addValueColumn: vi.fn(),
    setValueColumnAggFunc: vi.fn(), removeValueColumn: vi.fn(),
    setColumnsPinned: vi.fn(), getColumnState: () => [],
    getRules: () => [], addRule: vi.fn(), deleteRule: vi.fn(),
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const ctx = {
    grid,
    events: { emit: vi.fn(), on: () => () => {} },
    profiles: { markDirty: vi.fn() },
    engines: { get: () => null },
    modal: {}, session: {},
    getState: grid.getState, setState: grid.setState,
    registerStateModule: () => () => {},
  };

  const item = ribbonExtensions()[0] as unknown as {
    render(h: HTMLElement, c: unknown): { destroy?(): void };
  };
  const instance = item.render(host, ctx);
  return { host, grid, edits, templates, ctx, instance };
}

const button = (host: HTMLElement, title: string): HTMLButtonElement | null =>
  Array.from(host.querySelectorAll('button')).find((b) => b.title === title) as HTMLButtonElement ?? null;

/** Flip the scope pill to "all columns". */
function selectAllScope(host: HTMLElement): void {
  const pill = Array.from(host.querySelectorAll('button'))
    .find((b) => /scope:/i.test(b.title ?? '')) as HTMLButtonElement | undefined;
  expect(pill, 'scope pill should exist').toBeTruthy();
  pill!.click();
}

describe('column identity', () => {
  it('treats `field` as the column id, like the rest of the grid does', () => {
    const { host, edits } = harness();
    selectAllScope(host);
    button(host, 'Bold')?.click();
    // Reading `colId` alone returned [] here and every action silently no-opped.
    expect(edits.map((e) => e.colId).sort()).toEqual([...EVERY_COLUMN].sort());
  });
});

describe('a focused column is a valid target on its own', () => {
  it('applies to the focused column with no range selected', () => {
    // A column declared by `field`, focused rather than range-selected — the
    // ordinary case, and the one the identity bug also broke.
    const { host, edits } = harness({ rowId: 'r1', colId: 'cusip' });
    const bold = button(host, 'Bold');
    expect({ enabled: bold!.disabled === false }).toEqual({ enabled: true });
    bold!.click();
    expect(edits.map((e) => e.colId)).toEqual(['cusip']);
  });

  it('reads that column\'s own state back, so toggles round-trip', () => {
    const { host, edits } = harness({ rowId: 'r1', colId: 'cusip' });
    const underline = button(host, 'Underline')!;
    underline.click();
    expect((edits.at(-1)!.patch.cellStyle as Record<string, unknown>).textDecoration)
      .toBe('underline');
    underline.click();
    // Without a working read-back every toggle would only ever go one way.
    expect((edits.at(-1)!.patch.cellStyle as Record<string, unknown>).textDecoration)
      .toBe('none');
  });
});

describe('every formatting button reaches the grid in "all columns" scope', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); selectAllScope(h.host); });

  const CASES: Array<[title: string, assert: (edits: Edit[]) => void]> = [
    ['Bold', (e) => expect(e[0]!.patch).toHaveProperty('cellStyle')],
    ['Italic', (e) => expect(e[0]!.patch).toHaveProperty('cellStyle')],
    ['Underline', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).textDecoration).toBe('underline')],
    ['Strikethrough', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).textDecoration).toBe('line-through')],
    ['Align left', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).halign).toBe('left')],
    ['Align center', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).halign).toBe('center')],
    ['Align right', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).halign).toBe('right')],
    ['Larger font', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).fontSize).toBeGreaterThan(12)],
    ['Smaller font', (e) => expect((e[0]!.patch.cellStyle as never as Record<string, unknown>).fontSize).toBeLessThan(12)],
    ['Currency format', (e) => expect(e[0]!.patch).toHaveProperty('format')],
    ['Percent format', (e) => expect(e[0]!.patch).toHaveProperty('format')],
    ['Thousands format', (e) => expect(e[0]!.patch).toHaveProperty('format')],
    ['More decimals', (e) => expect(e[0]!.patch).toHaveProperty('format')],
    ['Fewer decimals', (e) => expect(e[0]!.patch).toHaveProperty('format')],
  ];

  for (const [title, assert] of CASES) {
    it(`${title} applies to every column`, () => {
      const before = h.edits.length;
      const btn = button(h.host, title);
      expect({ title, present: Boolean(btn) }).toEqual({ title, present: true });
      expect({ title, enabled: btn!.disabled === false }).toEqual({ title, enabled: true });
      btn!.click();

      const produced = h.edits.slice(before);
      expect({ title, touched: produced.length }).toEqual({ title, touched: EVERY_COLUMN.length });
      assert(produced);
    });
  }
});

describe('the AB header-case toggle', () => {
  it('is reachable once the target is Header', () => {
    const { host } = harness();
    const ab = button(host, 'Switch target to Header to toggle header case');
    expect(ab).toBeTruthy();
    expect(ab!.disabled).toBe(true);   // cells target — by design

    const targetPill = Array.from(host.querySelectorAll('button'))
      .find((b) => /styling target/i.test(b.title ?? '')) as HTMLButtonElement;
    targetPill.click();

    const abNow = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'AB') as HTMLButtonElement;
    expect(abNow.disabled).toBe(false);
  });

  it('uppercases EVERY column header, selection or not', () => {
    const { host, edits } = harness();
    const targetPill = Array.from(host.querySelectorAll('button'))
      .find((b) => /styling target/i.test(b.title ?? '')) as HTMLButtonElement;
    targetPill.click();

    const ab = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'AB') as HTMLButtonElement;
    ab.click();

    // It ignores the selection on purpose — header case is all-or-nothing.
    expect(edits.map((e) => e.colId).sort()).toEqual([...EVERY_COLUMN].sort());
    for (const e of edits) {
      expect((e.patch.headerStyle as Record<string, unknown>).textTransform).toBe('uppercase');
    }
  });

  it('toggles back off on a second click', () => {
    const { host, edits } = harness();
    const targetPill = Array.from(host.querySelectorAll('button'))
      .find((b) => /styling target/i.test(b.title ?? '')) as HTMLButtonElement;
    targetPill.click();
    const ab = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'AB') as HTMLButtonElement;

    ab.click();
    const afterOn = edits.length;
    ab.click();

    // `headerCaseOn()` reads the first column's own template; with an empty
    // allCols() it always answered false and the toggle only ever went one way.
    const second = edits.slice(afterOn);
    expect(second.length).toBe(EVERY_COLUMN.length);
    for (const e of second) {
      expect((e.patch.headerStyle as Record<string, unknown>).textTransform).toBe('none');
    }
  });
});
