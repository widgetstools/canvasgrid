/**
 * Grid Layouts — Phase C / C2: render-time application of conditional rules.
 *
 * Proves the worklog's C2 gate — "a rule paints the right cells" — END TO END
 * with the REAL @wellsfargo-starui/velocity-grid-rules RuleEngine + the REAL kernel painter fold
 * (`applyCellProps`), NOT a fake engine. The Cycle-21e fold test
 * (core/propertyChain-ruleFold.test.ts) already covers the painter mechanics
 * with a stub engine over a cellClass/cellStyleFn base; C2 adds the Grid-Layouts
 * angle that C1's reconciliation onto @wellsfargo-starui/velocity-grid-rules made possible:
 *
 *   1. the rule style layers OVER a TEMPLATE-RESOLVED base (spec §3.3:
 *      `templates base → conditional rules overlay`) — the template's static
 *      `cellStyle` object (what calc's resolvedPatchFor emits, step 2) is
 *      preserved on non-match and overridden per-property on match (step 3.5);
 *   2. PRIORITY resolution through the real engine (higher priority wins
 *      per-property; lower-priority non-conflicting fields survive);
 *   3. TARGET = whole row vs a `colIds` set (spec §3.2) — a row-scope rule
 *      paints a cell in ANY column; a cell-scope rule paints only its colIds;
 *   4. the rules arrive through the C1 LAYOUT-TIER `rules` state module
 *      (`module.set(...)` → `RuleEngine.setRules`) and reach the SAME engine the
 *      painter consults via the kernel rule-engine slot — the C1→C2 seam;
 *   5. on a REAL VelocityGrid, `setState({ modules: { rules } })` (the layout-restore
 *      path) feeds that engine.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { applyCellProps, resolveColDefs } from '../src/core/propertyChain';
import {
  registerRuleEngine as slotRegister,
  getRuleEngine,
  _resetRuleEngine_forTests,
} from '../src/core/ruleEngineSlot';
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-rules';
import type { ConditionalStyleRule } from '@wellsfargo-starui/velocity-grid-rules';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../src/theming/cssReader';

// ─── Painter fixtures (mirror core/propertyChain-ruleFold.test.ts) ──────────

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

/** Paint one data cell of `colDef` for a row, returning the resulting config. */
function paint(
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

// ─── Fake grid host that forwards the rule engine into the KERNEL slot ───────
// The @wellsfargo-starui/velocity-grid-rules bridge registers its adapter via grid.registerRuleEngine();
// we route that into the real kernel slot so the real painter consults it.
// Everything else is the minimal surface the bridge touches.

function makeHost(rows: Array<{ rowId: string; row: Record<string, unknown> }> = []) {
  const modules = new Map<string, { id: string; version: number; get(): unknown; set(d: unknown, v: number): void }>();
  return {
    registerRuleEngine(engine: unknown) { slotRegister(engine as Parameters<typeof slotRegister>[0]); },
    registerStateModule(m: { id: string; version: number; get(): unknown; set(d: unknown, v: number): void }) {
      modules.set(m.id, m); return () => {};
    },
    on() { return () => {}; },
    flashCells() {},
    refresh() {},
    forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void) {
      for (const r of rows) fn(r.rowId, r.row);
    },
    getThemeKind: (): 'light' | 'dark' => 'light',
    _modules: modules,
  };
}

/** Install rules the way a layout restore does — through the C1 `rules` module's
 *  set() — NOT via opts, so the test exercises the C1→C2 seam. */
function installViaModule(
  host: ReturnType<typeof makeHost>,
  rules: ConditionalStyleRule[],
): void {
  const mod = host._modules.get('rules');
  if (!mod) throw new Error('rules module not registered');
  mod.set(rules, 1);
}

const NEG: ConditionalStyleRule = {
  kind: 'style', id: 'neg', name: 'Negative', enabled: true, priority: 10,
  condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
  style: { base: { color: '#c00' } }, // fg only — bg comes from the template base
};

describe('Grid Layouts C2 — conditional rules render over the template base', () => {
  beforeEach(() => _resetRuleEngine_forTests());

  it('rule overlays the template-resolved base on match; base is preserved on no-match', () => {
    // colDef.cellStyle (object) is the TEMPLATE base — exactly what calc's
    // resolvedPatchFor emits (step 2). fg #333 + bg #eee from the template.
    const [pnlCol] = resolveColDefs([{
      colId: 'pnl', cellDataType: 'number', cellStyle: { fg: '#333', bg: '#eee' },
    }] as never);
    const host = makeHost();
    wireIntoKernel(host, { now: () => 0 });
    installViaModule(host, [NEG]);
    expect(getRuleEngine()).not.toBeNull(); // C1→C2 seam: engine is in the slot

    // Match: rule fg wins, template bg survives (rule set no bg).
    const hit = paint(pnlCol, { pnl: -5 }, 'pnl');
    expect(hit.fg).toBe('#c00');
    expect(hit.bg).toBe('#eee');

    // No match: template base only — the rule left nothing behind.
    const miss = paint(pnlCol, { pnl: 5 }, 'pnl');
    expect(miss.fg).toBe('#333');
    expect(miss.bg).toBe('#eee');
  });

  it('resolves priority per-property (higher wins; lower non-conflicting field survives)', () => {
    const [pnlCol] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
    const low: ConditionalStyleRule = {
      kind: 'style', id: 'low', name: 'low', enabled: true, priority: 10,
      condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
      style: { base: { color: '#aaa', backgroundColor: '#0a0' } },
    };
    const high: ConditionalStyleRule = {
      kind: 'style', id: 'high', name: 'high', enabled: true, priority: 20,
      condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
      style: { base: { color: '#bbb' } }, // overrides color only
    };
    const host = makeHost();
    wireIntoKernel(host, { now: () => 0 });
    installViaModule(host, [low, high]);

    const cfg = paint(pnlCol, { pnl: -1 }, 'pnl');
    expect(cfg.fg).toBe('#bbb'); // high priority wins the conflicting field
    expect(cfg.bg).toBe('#0a0'); // low's non-conflicting field survives
  });

  it('target=row paints a cell in ANY column; target=columns is scoped to its colIds', () => {
    const [pnlCol] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
    const [nameCol] = resolveColDefs([{ colId: 'name', cellDataType: 'text' }] as never);

    // Row-scope rule → paints the 'name' cell too (whole-row target).
    const rowRule: ConditionalStyleRule = {
      kind: 'style', id: 'row', name: 'row', enabled: true, priority: 10,
      condition: '[pnl] < 0', scope: { kind: 'row' },
      style: { base: { backgroundColor: '#fee' } },
    };
    const host = makeHost();
    wireIntoKernel(host, { now: () => 0 });
    installViaModule(host, [rowRule]);
    const nameCell = paint(nameCol, { pnl: -3, name: 'ACME' }, 'name');
    expect(nameCell.bg).toBe('#fee');

    // Cell-scope rule on ['pnl'] → the 'name' cell is untouched.
    _resetRuleEngine_forTests();
    const host2 = makeHost();
    wireIntoKernel(host2, { now: () => 0 });
    installViaModule(host2, [NEG]); // scope cell ['pnl']
    const nameCell2 = paint(nameCol, { pnl: -3, name: 'ACME' }, 'name');
    expect(nameCell2.bg).toBe('#fff'); // theme/row base, no rule bg
    const pnlCell2 = paint(pnlCol, { pnl: -3 }, 'pnl');
    expect(pnlCell2.fg).toBe('#c00'); // …but the scoped column IS painted
  });

  it('theme-aware style resolves the active theme slice through the painter', () => {
    const [pnlCol] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
    const themed: ConditionalStyleRule = {
      kind: 'style', id: 'themed', name: 'themed', enabled: true, priority: 10,
      condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
      style: { base: { color: '#111' }, dark: { color: '#eee' } },
    };
    const host = makeHost();
    wireIntoKernel(host, { now: () => 0 });
    installViaModule(host, [themed]);

    expect(paint(pnlCol, { pnl: -1 }, 'pnl', 'light').fg).toBe('#111');
    expect(paint(pnlCol, { pnl: -1 }, 'pnl', 'dark').fg).toBe('#eee');
  });

  it('a disabled rule in the layout slice does not paint', () => {
    const [pnlCol] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
    const host = makeHost();
    wireIntoKernel(host, { now: () => 0 });
    installViaModule(host, [{ ...NEG, enabled: false }]);
    const cfg = paint(pnlCol, { pnl: -5 }, 'pnl');
    expect(cfg.fg).toBe('#333'); // theme default fg — the disabled rule left it untouched
    expect(cfg.fg).not.toBe('#c00'); // …NOT the rule's overlay
  });
});

// ─── End-to-end on a REAL VelocityGrid: setState({modules:{rules}}) feeds the engine ─

describe('Grid Layouts C2 — rules ride a layout onto a real VelocityGrid', () => {
  beforeAll(() => {
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      listeners: Array<(e: { data: unknown }) => void> = [];
      constructor(public url: URL) {}
      postMessage = vi.fn();
      addEventListener = (_: string, cb: (e: { data: unknown }) => void) => this.listeners.push(cb);
      terminate = vi.fn();
    };
    HTMLCanvasElement.prototype.getContext = (() => {
      const fakeCtx: Record<string, unknown> = {
        fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
        save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        measureText: () => ({ width: 50 }),
        fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
        textAlign: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
        shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
        globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
        direction: 'inherit', filter: 'none',
      };
      return () => fakeCtx;
    })() as never;
  });

  beforeEach(() => _resetRuleEngine_forTests());

  it('setState({modules:{rules}}) installs rules into the engine the painter consults', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
    document.body.appendChild(container);
    const grid = new VelocityGrid<{ id: string; pnl: number }>(container, {
      columnDefs: [{ field: 'id' }, { field: 'pnl' }],
      getRowId: (r) => r.id,
      theme: 'vg-theme-quartz',
    });
    wireIntoKernel(grid, { now: () => 0 });

    // No rules yet → the pnl cell doesn't match.
    expect(getRuleEngine()!.evaluateCell({ row: { pnl: -1 }, rowId: 'a', colId: 'pnl', theme: 'light' }).matched)
      .toEqual([]);

    // Restore a layout that carries a conditional rule in its `rules` slice.
    // GridState.modules uses a { version, data } envelope (see B1's round-trip).
    grid.setState({ modules: { rules: { version: 1, data: [NEG] } } } as never);

    const res = getRuleEngine()!.evaluateCell({ row: { pnl: -1 }, rowId: 'a', colId: 'pnl', theme: 'light' });
    expect(res.matched).toEqual(['neg']);
    expect(res.style?.color).toBe('#c00');

    grid.destroy();
  });
});
