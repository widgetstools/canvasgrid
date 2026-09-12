/**
 * A styling rule that reaches the column HEADER.
 *
 * A rule used to have exactly one place to paint: the cells its scope named.
 * Styling a column's caption meant leaving the rule editor, finding the
 * column in the formatting toolbar, and setting a header style by hand — two
 * unrelated surfaces for one intent ("make this column stand out"). A rule
 * now carries `target: 'cells' | 'header' | 'both'`.
 *
 * The header has no row behind it, so there is nothing for `[pnl] < 0` to
 * evaluate against. Header styling is therefore UNCONDITIONAL: it applies
 * while the rule is enabled and names the column. That is a deliberate
 * asymmetry with the cell fold, and the tests below pin it — a header that
 * only lit up when some row happened to match would flicker with the feed.
 *
 * The invariant that matters most is the first one: `target` is optional and
 * defaults to `'cells'`, so every rule authored before this existed paints
 * exactly where it did.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyCellProps, resolveColDefs } from '../src/core/propertyChain';
import {
  registerRuleEngine as slotRegister,
  _resetRuleEngine_forTests,
} from '../src/core/ruleEngineSlot';
import { wireIntoKernel, validateRule } from '../src/rules/index';
import type { ConditionalStyleRule } from '../src/rules/index';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../src/theming/cssReader';

const theme = {
  font: '13px Inter', cellFont: '13px Inter', fg: '#333', bg: '#fff',
  headerBg: '#eee', headerFg: '#000', gridLineColor: '#ddd',
  flashFromColor: '#ffeb3b',
  cellClassVariants: new Map(),
  headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function freshConfig(): CellPaintConfig {
  return {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  } as CellPaintConfig;
}

/** Paint the column's HEADER cell — no row, no rowId (byRows' header path). */
function paintHeader(colDef: unknown, themeKind: 'light' | 'dark' = 'light'): CellPaintConfig {
  const cfg = freshConfig();
  applyCellProps(cfg, {
    theme, colDef, value: 'P&L', valueFormatted: 'P&L',
    x: 0, y: 0, w: 100, h: 30, rowBg: '#eee', prefillColor: '#eee',
    isFocused: false, isSelected: false, isHovered: false, isHeader: true,
    rowData: undefined, themeKind,
  } as Parameters<typeof applyCellProps>[1]);
  return cfg;
}

/** Paint one DATA cell of `colDef` for `row`. */
function paintCell(
  colDef: unknown,
  row: Record<string, unknown>,
  colId: string,
  themeKind: 'light' | 'dark' = 'light',
): CellPaintConfig {
  const cfg = freshConfig();
  applyCellProps(cfg, {
    theme, colDef, value: row[colId], valueFormatted: String(row[colId] ?? ''),
    x: 0, y: 0, w: 100, h: 30, rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    rowData: row, rowIndex: 0, rowId: 'r1', ruleRow: row, themeKind,
  } as Parameters<typeof applyCellProps>[1]);
  return cfg;
}

/** Minimal grid host that routes the bridge's adapter into the kernel slot. */
function makeHost() {
  return {
    registerRuleEngine(engine: unknown) { slotRegister(engine as Parameters<typeof slotRegister>[0]); },
    registerStateModule() { return () => {}; },
    on() { return () => {}; },
    flashCells() {},
    refresh() {},
    forEachRow() {},
    getThemeKind: (): 'light' | 'dark' => 'light',
  };
}

function wire(rules: ConditionalStyleRule[]) {
  const { rules: engine } = wireIntoKernel(makeHost(), { now: () => 0 });
  const res = engine.setRules(rules);
  return { engine, res };
}

const base = (over: Partial<ConditionalStyleRule> = {}): ConditionalStyleRule => ({
  kind: 'style', id: 'r', name: 'Rule', enabled: true, priority: 10,
  condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
  style: { base: { color: '#c00' } },
  ...over,
});

let pnlCol: unknown;
beforeEach(() => {
  _resetRuleEngine_forTests();
  [pnlCol] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
});

describe('target defaults to cells — no existing rule changes', () => {
  it('a rule with no target leaves the header alone', () => {
    // The regression gate. Every rule in every saved profile predates
    // `target`; if this fails, upgrading repaints headers nobody asked for.
    wire([base()]);
    expect(paintHeader(pnlCol).fg).not.toBe('#c00');
  });

  it('…and still paints the cells it always painted', () => {
    wire([base()]);
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).toBe('#c00');
    expect(paintCell(pnlCol, { pnl: 5 }, 'pnl').fg).not.toBe('#c00');
  });

  it('an explicit target: cells is the same thing', () => {
    wire([base({ target: 'cells' })]);
    expect(paintHeader(pnlCol).fg).not.toBe('#c00');
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).toBe('#c00');
  });
});

describe('target: header', () => {
  it('paints the caption and leaves the cells alone', () => {
    wire([base({ target: 'header' })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
    // The cells are the OTHER half of the switch — a header-only rule that
    // still tinted its column would make "Header" indistinguishable from
    // "Both".
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).not.toBe('#c00');
  });

  it('ignores the condition — a header has no row to test', () => {
    // `[pnl] < 0` cannot be evaluated for a caption. Gating the header on
    // "some row matches" would make it blink with the feed.
    wire([base({ target: 'header', condition: 'false' })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
  });

  it('under cell scope it reaches only the columns the scope names', () => {
    const [otherCol] = resolveColDefs([{ colId: 'notional' }] as never);
    wire([base({ target: 'header' })]);
    expect(paintHeader(otherCol).fg).not.toBe('#c00');
  });

  it('on a row-scoped rule it reaches EVERY column\u2019s header', () => {
    // Row scope means "every column" — for headers as much as for cells.
    // Hiding the switch under row scope is what made the feature
    // undiscoverable: a new rule starts row-scoped.
    const [otherCol] = resolveColDefs([{ colId: 'notional' }] as never);
    wire([base({ target: 'header', scope: { kind: 'row' } })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
    expect(paintHeader(otherCol).fg).toBe('#c00');
    // …and, being header-only, it stops painting the cells it used to.
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).not.toBe('#c00');
  });

  it('a row-scoped target: both keeps doing its row job as well', () => {
    wire([base({ target: 'both', scope: { kind: 'row' } })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).toBe('#c00');
    expect(paintCell(pnlCol, { pnl: 5 }, 'pnl').fg).not.toBe('#c00');
  });

  it('a row-scoped rule left on cells never touches a header', () => {
    // The regression gate for row scope: every pre-existing row rule.
    wire([base({ scope: { kind: 'row' } })]);
    expect(paintHeader(pnlCol).fg).not.toBe('#c00');
  });

  it('a disabled rule paints nothing', () => {
    wire([base({ target: 'header', enabled: false })]);
    expect(paintHeader(pnlCol).fg).not.toBe('#c00');
  });
});

describe('target: both', () => {
  it('paints the caption and the cells with one style', () => {
    wire([base({ target: 'both' })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').fg).toBe('#c00');
  });

  it('the cells still answer to the condition; the header does not', () => {
    wire([base({ target: 'both' })]);
    expect(paintCell(pnlCol, { pnl: 5 }, 'pnl').fg).not.toBe('#c00');
    expect(paintHeader(pnlCol).fg).toBe('#c00');
  });

  it('carries the whole style vocabulary, not just colour', () => {
    wire([base({
      target: 'both',
      style: { base: { color: '#c00', backgroundColor: '#fee', fontWeight: 'bold' } },
    })]);
    const h = paintHeader(pnlCol);
    expect(h.fg).toBe('#c00');
    expect(h.bg).toBe('#fee');
    expect(h.font).toContain('bold');
  });
});

describe('theme + priority resolve the same way they do for cells', () => {
  it('the dark slice wins under the dark theme', () => {
    wire([base({
      target: 'header',
      style: { base: { color: '#c00' }, dark: { color: '#f88' } },
    })]);
    expect(paintHeader(pnlCol, 'light').fg).toBe('#c00');
    expect(paintHeader(pnlCol, 'dark').fg).toBe('#f88');
  });

  it('a row-scoped header rule and a column-named one merge by priority', () => {
    // Row scope covers this column too, so both are candidates; the higher
    // priority wins per property and the other's fields survive.
    wire([
      base({ id: 'all', priority: 1, target: 'header', scope: { kind: 'row' }, style: { base: { color: '#111', backgroundColor: '#eee' } } }),
      base({ id: 'one', priority: 9, target: 'header', style: { base: { color: '#c00' } } }),
    ]);
    const h = paintHeader(pnlCol);
    expect(h.fg).toBe('#c00');
    expect(h.bg).toBe('#eee');
  });

  it('higher priority wins per property; lower-priority fields survive', () => {
    wire([
      base({ id: 'lo', priority: 1, target: 'header', style: { base: { color: '#111', backgroundColor: '#eee' } } }),
      base({ id: 'hi', priority: 9, target: 'header', style: { base: { color: '#c00' } } }),
    ]);
    const h = paintHeader(pnlCol);
    expect(h.fg).toBe('#c00');   // the higher-priority rule's colour
    expect(h.bg).toBe('#eee');   // the lower one's background is untouched
  });
});

describe('the fold sits below an explicit header style', () => {
  it('colDef.headerStyle overrides the rule', () => {
    // Precedence inside the header branch is class variants → rules →
    // headerStyle → headerStyleFn. An app that sets a header colour
    // outright must not have a rule quietly repaint it.
    const [styled] = resolveColDefs([
      { colId: 'pnl', headerStyle: { fg: '#0a0' } },
    ] as never);
    wire([base({ target: 'header' })]);
    expect(paintHeader(styled).fg).toBe('#0a0');
  });
});

describe('replacing the rule set is visible immediately', () => {
  it('a new style for the same column replaces the cached fold', () => {
    // `headerStyleFor` memoises per (theme, colId) — nothing conditional
    // feeds it — so a stale cache would pin the first style forever.
    const { engine } = wire([base({ target: 'header' })]);
    expect(paintHeader(pnlCol).fg).toBe('#c00');
    engine.setRules([base({ target: 'header', style: { base: { color: '#00c' } } })]);
    expect(paintHeader(pnlCol).fg).toBe('#00c');
  });

  it('dropping the rule restores the plain header', () => {
    const { engine } = wire([base({ target: 'header' })]);
    engine.setRules([]);
    expect(paintHeader(pnlCol).fg).not.toBe('#c00');
  });
});

describe('alignment rides the same target as everything else', () => {
  it('a rule can re-align the cells', () => {
    wire([base({ style: { base: { halign: 'center' } } })]);
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').halign).toBe('center');
  });

  it('…and the header, when the target says so', () => {
    wire([base({ target: 'both', style: { base: { halign: 'center' } } })]);
    expect(paintHeader(pnlCol).halign).toBe('center');
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').halign).toBe('center');
  });

  it('header-only re-aligns the caption and leaves the cells where they were', () => {
    // A number column right-aligns its cells off `cellDataType`; a header
    // target must not disturb that.
    wire([base({ target: 'header', style: { base: { halign: 'center' } } })]);
    expect(paintHeader(pnlCol).halign).toBe('center');
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').halign).toBe('right');
  });

  it('a rule with no alignment leaves both alone', () => {
    // The regression gate: alignment is optional, so a colour-only rule must
    // not silently left-align a number column.
    wire([base({ target: 'both' })]);
    expect(paintCell(pnlCol, { pnl: -5 }, 'pnl').halign).toBe('right');
    expect(paintHeader(pnlCol).halign).toBe('left');
  });

  it('an explicit headerStyle alignment still wins', () => {
    const [styled] = resolveColDefs([
      { colId: 'pnl', cellDataType: 'number', headerStyle: { halign: 'right' } },
    ] as never);
    wire([base({ target: 'header', style: { base: { halign: 'center' } } })]);
    expect(paintHeader(styled).halign).toBe('right');
  });

  it('the cells answer to the condition, the header does not', () => {
    wire([base({ target: 'both', style: { base: { halign: 'center' } } })]);
    expect(paintCell(pnlCol, { pnl: 5 }, 'pnl').halign).toBe('right');   // no match
    expect(paintHeader(pnlCol).halign).toBe('center');                   // unconditional
  });
});

describe('the target survives a profile round-trip', () => {
  it('getRules hands back the target it was given', () => {
    // The `rules` state module serialises whatever getRules returns, so a
    // target dropped here is a target lost on every profile save.
    const { engine } = wire([base({ target: 'both' })]);
    expect(engine.getRules()[0]).toMatchObject({ id: 'r', target: 'both' });
  });
});

describe('validation', () => {
  it('accepts the three targets and absence', () => {
    for (const target of [undefined, 'cells', 'header', 'both'] as const) {
      expect(validateRule(base({ target }))).toEqual([]);
    }
  });

  it('reports a misspelt target instead of silently ignoring it', () => {
    // Silently dropping it reads as "header styling is broken".
    const errors = validateRule(base({ target: 'headers' as never }));
    expect(errors.some((e) => e.code === 'bad-shape' && /target/.test(e.message))).toBe(true);
  });
});
