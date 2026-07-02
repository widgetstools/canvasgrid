import { describe, it, expect, beforeEach } from 'vitest';
import { applyCellProps, resolveColDefs } from '../../src/core/propertyChain';
import {
  registerRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../../src/core/ruleEngineSlot';
import type { CellPaintConfig } from '../../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../../src/theming/cssReader';

const theme = {
  font: '13px Inter', cellFont: '13px Inter', fg: '#111', bg: '#fff',
  headerBg: '#eee', headerFg: '#000', gridLineColor: '#ddd',
  flashFromColor: '#ffeb3b',
  cellClassVariants: new Map<string, Record<string, string>>([
    ['neg', { fg: '#c62828', bg: '#fff0f0' }],
  ]),
  headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function freshConfig(): CellPaintConfig {
  return {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  };
}

function baseCtx(colDef: any, extra: Record<string, unknown> = {}) {
  return {
    theme, colDef, value: -5, valueFormatted: '-5',
    x: 0, y: 0, w: 100, h: 30, rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    rowData: { px: -5 }, rowIndex: 0,
    rowId: 'r1', ruleRow: { px: -5, hidden: 'x' }, themeKind: 'light' as const,
    ...extra,
  };
}

const styleEngine = (style: Record<string, unknown>, matched = ['rule-1']): RuleEngineShape => ({
  evaluateCell: () => ({ matched, style: style as any, indicator: null, formatProgram: null }),
  resolveRuleRef: () => null,
});

describe('applyCellProps rule fold (Cycle 21e / Task 11)', () => {
  beforeEach(() => _resetRuleEngine_forTests());

  it('no engine registered → painted config identical to pre-change snapshot', () => {
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellClassRules: { neg: (p: any) => p.value < 0 },
      cellStyle: () => ({ fg: '#00f' }),
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    // Pre-21e semantics, encoded literally: cellClassRules variant fires
    // (fg #c62828 / bg #fff0f0), then function cellStyle wins on fg.
    expect(cfg.fg).toBe('#00f');
    expect(cfg.bg).toBe('#fff0f0');
    expect(cfg.ruleIndicator).toBeUndefined();
  });

  it('rule patch overrides cellClassRules variant', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa', backgroundColor: '#f3e5f5' }));
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellClassRules: { neg: (p: any) => p.value < 0 },
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.fg).toBe('#8e24aa');
    expect(cfg.bg).toBe('#f3e5f5');
  });

  it('function-form cellStyle overrides the rule patch', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa' }));
    const [def] = resolveColDefs([{
      colId: 'px', cellDataType: 'number',
      cellStyle: () => ({ fg: '#00f' }),
    }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.fg).toBe('#00f');
  });

  it('fontWeight/fontStyle compose into the font shorthand', () => {
    registerRuleEngine(styleEngine({ fontWeight: 'bold', fontStyle: 'italic' }));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.font).toBe('italic bold 13px Inter');
  });

  it('textDecoration + border translate to paint slots', () => {
    registerRuleEngine(styleEngine({
      textDecoration: 'line-through', borderColor: '#c62828', borderStyle: 'dashed',
    }));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    applyCellProps(cfg, baseCtx(def) as any);
    expect(cfg.textDecoration).toBe('line-through');
    expect(cfg.border).toEqual({ all: { width: 1, color: '#c62828', style: 'dashed' } });
  });

  it('matched empty → zero diff', () => {
    registerRuleEngine(styleEngine({ color: '#8e24aa' }, []));
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const withEngine = freshConfig();
    applyCellProps(withEngine, baseCtx(def) as any);
    _resetRuleEngine_forTests();
    const without = freshConfig();
    applyCellProps(without, baseCtx(def) as any);
    expect(withEngine).toEqual(without);
  });

  it('rowId undefined (header/totals/group rows) → engine never consulted', () => {
    let calls = 0;
    registerRuleEngine({
      evaluateCell: () => { calls++; return { matched: [], style: null, indicator: null, formatProgram: null }; },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    applyCellProps(freshConfig(), baseCtx(def, { rowId: undefined }) as any);
    applyCellProps(freshConfig(), baseCtx(def, { isHeader: true, rowId: undefined }) as any);
    applyCellProps(freshConfig(), baseCtx(def, { isTotals: true, rowId: undefined }) as any);
    expect(calls).toBe(0);
  });

  it('row-scope vs cell-scope: engine receives colId + full ruleRow (hidden fields)', () => {
    const seen: any[] = [];
    registerRuleEngine({
      evaluateCell: (c) => { seen.push(c); return { matched: [], style: null, indicator: null, formatProgram: null }; },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    applyCellProps(freshConfig(), baseCtx(def) as any);
    expect(seen[0]).toEqual({
      row: { px: -5, hidden: 'x' }, rowId: 'r1', colId: 'px', theme: 'light',
    });
  });

  it('engine throw is swallowed (paint never breaks)', () => {
    registerRuleEngine({
      evaluateCell: () => { throw new Error('boom'); },
      resolveRuleRef: () => null,
    });
    const [def] = resolveColDefs([{ colId: 'px', cellDataType: 'number' }] as any);
    const cfg = freshConfig();
    expect(() => applyCellProps(cfg, baseCtx(def) as any)).not.toThrow();
  });
});
