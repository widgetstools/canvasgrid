/**
 * Two grids on one page each keep their own rule engine and calc provider.
 *
 * Both used to live in module-global DI slots, so the last grid to call
 * `registerRuleEngine` / `registerCalcProvider` owned them for EVERY grid on
 * the page. The first grid silently started painting with the second grid's
 * rules, and serving the second grid's calculated columns.
 *
 * This is not an exotic layout. Positions and orders stacked on one page is
 * an ordinary blotter, and the two grids there carry deliberately different
 * rule sets — P&L thresholds on one, order-state highlighting on the other —
 * so the cross-talk showed up the moment both were wired, not as a rare race.
 * Separating the DATA (different providers, different Perspective tables)
 * does not help: the collision was in main-thread module scope and never
 * looked at where the rows came from.
 *
 * The engine is now owned by the grid that registered it and threaded into
 * the paint context. The slot survives as a fallback for paint helpers that
 * run with no grid in scope, which is why `undefined` (caller doesn't know)
 * and `null` (this grid has none) have to mean different things.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { applyCellProps, resolveColDefs } from '../src/core/propertyChain';
import {
  registerRuleEngine as slotRegisterRuleEngine,
  resolveRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../src/core/ruleEngineSlot';
import {
  registerCalcProvider as slotRegisterCalcProvider,
  resolveCalcProvider,
  _resetCalcProvider_forTests,
  type CalcProviderShape,
} from '../src/core/calcSlot';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../src/theming/cssReader';

// happy-dom has no 2d context; the two-grid test constructs REAL grids, so
// give them a canvas that answers. Same stub the other integration tests use.
beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx: Record<string, unknown> = {
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
    return () => ctx as unknown as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

const theme = {
  font: '13px Inter', cellFont: '13px Inter', fg: '#333', bg: '#fff',
  headerBg: '#eee', headerFg: '#000', gridLineColor: '#ddd',
  cellClassVariants: new Map(), headerClassVariants: new Map(),
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

/** An engine that paints every cell one colour, so which engine ran is
 *  readable straight off the config. */
function enginePainting(color: string): RuleEngineShape {
  return {
    evaluateCell: () => ({
      matched: ['r'], style: { color }, indicator: null, formatProgram: null,
    }),
    resolveRuleRef: () => color,
    headerStyleFor: () => ({ color }),
    getRules: () => [{ id: `rule-${color}` }],
  };
}

let col: unknown;
beforeEach(() => {
  _resetRuleEngine_forTests();
  _resetCalcProvider_forTests();
  [col] = resolveColDefs([{ colId: 'pnl', cellDataType: 'number' }] as never);
});

/** Paint one data cell as the grid that threaded `ruleEngine`. */
function paintCell(ruleEngine: RuleEngineShape | null | undefined): CellPaintConfig {
  const cfg = freshConfig();
  applyCellProps(cfg, {
    theme, colDef: col, value: -5, valueFormatted: '-5',
    x: 0, y: 0, w: 100, h: 30, rowBg: '#fff', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    rowData: { pnl: -5 }, rowIndex: 0, rowId: 'r1', ruleRow: { pnl: -5 },
    themeKind: 'light', ruleEngine,
  } as Parameters<typeof applyCellProps>[1]);
  return cfg;
}

function paintHeader(ruleEngine: RuleEngineShape | null | undefined): CellPaintConfig {
  const cfg = freshConfig();
  applyCellProps(cfg, {
    theme, colDef: col, value: 'P&L', valueFormatted: 'P&L',
    x: 0, y: 0, w: 100, h: 30, rowBg: '#eee', prefillColor: '#eee',
    isFocused: false, isSelected: false, isHovered: false, isHeader: true,
    rowData: undefined, themeKind: 'light', ruleEngine,
  } as Parameters<typeof applyCellProps>[1]);
  return cfg;
}

describe('the rule fold uses the engine it was handed', () => {
  it('two grids paint with their own engines, whoever registered last', () => {
    // The bug, stated as a test: positions wires first, orders wires second,
    // and positions keeps painting positions' rules.
    const positions = enginePainting('#0F766E');
    const orders = enginePainting('#CC3311');
    slotRegisterRuleEngine(positions);
    slotRegisterRuleEngine(orders);          // the page-level slot now holds orders

    expect(paintCell(positions).fg).toBe('#0F766E');
    expect(paintCell(orders).fg).toBe('#CC3311');
  });

  it('the same holds for the header fold', () => {
    const positions = enginePainting('#0F766E');
    const orders = enginePainting('#CC3311');
    slotRegisterRuleEngine(orders);
    expect(paintHeader(positions).fg).toBe('#0F766E');
    expect(paintHeader(orders).fg).toBe('#CC3311');
  });

  it('a grid with NO engine does not borrow another grid’s', () => {
    // `null` is the load-bearing half of the contract. Without the
    // undefined/null distinction an unruled grid falls through to the slot
    // and picks up whatever the other grid registered.
    slotRegisterRuleEngine(enginePainting('#CC3311'));
    expect(paintCell(null).fg).not.toBe('#CC3311');
    expect(paintHeader(null).fg).not.toBe('#CC3311');
  });

  it('an un-threaded caller still falls back to the slot', () => {
    // Zero-diff for single-grid pages and for the composite/export helpers
    // that paint without a grid in scope.
    slotRegisterRuleEngine(enginePainting('#CC3311'));
    expect(paintCell(undefined).fg).toBe('#CC3311');
  });

  it('the engine reaches the config, so downstream renderers agree with the fold', () => {
    // The composite renderer evaluates its own format program; reading a
    // different engine than the fold just used would colour one cell from
    // two grids' rules at once.
    const positions = enginePainting('#0F766E');
    expect(paintCell(positions).ruleEngine).toBe(positions);
  });
});

describe('resolveRuleEngine / resolveCalcProvider', () => {
  const provider = (id: string) =>
    ({ resolvedPatchFor: () => ({ id }), onColumnsChanged: () => () => {} } as unknown as CalcProviderShape);

  it('undefined means "I do not know" and falls back', () => {
    const slot = enginePainting('#000');
    slotRegisterRuleEngine(slot);
    expect(resolveRuleEngine(undefined)).toBe(slot);
  });

  it('null means "I have none" and is honoured', () => {
    slotRegisterRuleEngine(enginePainting('#000'));
    expect(resolveRuleEngine(null)).toBeNull();
  });

  it('an own engine always wins over the slot', () => {
    const own = enginePainting('#111');
    slotRegisterRuleEngine(enginePainting('#000'));
    expect(resolveRuleEngine(own)).toBe(own);
  });

  it('the calc provider follows the same three rules', () => {
    const slot = provider('slot');
    const own = provider('own');
    slotRegisterCalcProvider(slot);
    expect(resolveCalcProvider(undefined)).toBe(slot);
    expect(resolveCalcProvider(null)).toBeNull();
    expect(resolveCalcProvider(own)).toBe(own);
  });

  it('with nothing registered at all, everything resolves to null', () => {
    expect(resolveRuleEngine(undefined)).toBeNull();
    expect(resolveCalcProvider(undefined)).toBeNull();
  });
});

/**
 * The real thing: two VelocityGrid instances, each wired to its own rule
 * engine through the public API, both alive at once.
 */
describe('two live grids', () => {
  it('each keeps the engine it registered', async () => {
    const { VelocityGrid } = await import('../src/velocityGrid');
    const { createWorkerHost } = await import('../src/worker/worker');
    // Each grid builds its OWN dedicated worker — which is the point: the
    // data planes were never the thing that collided.
    const prevWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = class {
      listeners: Array<(e: { data: unknown }) => void> = [];
      host = createWorkerHost((msg) => {
        queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
      });
      constructor(public url: URL) {}
      postMessage(msg: unknown) { this.host.handle(msg as Parameters<typeof this.host.handle>[0]); }
      addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
      terminate() {}
    };
    const mk = (): HTMLElement => {
      const host = document.createElement('div');
      host.style.cssText = 'width:600px;height:300px';
      document.body.appendChild(host);
      return host;
    };
    const hostA = mk();
    const hostB = mk();
    const defs = [{ colId: 'id', field: 'id' }, { colId: 'pnl', field: 'pnl' }];
    const positions = new VelocityGrid(hostA, {
      columnDefs: defs, getRowId: (r: { id: string }) => r.id, rowData: [{ id: '1', pnl: -5 }],
    } as never);
    const orders = new VelocityGrid(hostB, {
      columnDefs: defs, getRowId: (r: { id: string }) => r.id, rowData: [{ id: '1', pnl: -5 }],
    } as never);

    const posEngine = enginePainting('#0F766E');
    const ordEngine = enginePainting('#CC3311');
    positions.registerRuleEngine(posEngine);
    orders.registerRuleEngine(ordEngine);   // registered SECOND — used to win for both

    // getRules is the cheapest observable that goes through the same
    // ownership as the paint fold.
    expect(positions.getRules()[0]?.id).toBe('rule-#0F766E');
    expect(orders.getRules()[0]?.id).toBe('rule-#CC3311');

    positions.destroy();
    orders.destroy();
    hostA.remove();
    hostB.remove();
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
  });

  it('a grid that never registers one reports no rules, whatever its neighbour did', () => {
    // Reading the page-level slot here would hand back the neighbour's set.
    slotRegisterRuleEngine(enginePainting('#CC3311'));
    expect(resolveRuleEngine(null)).toBeNull();
  });
});
