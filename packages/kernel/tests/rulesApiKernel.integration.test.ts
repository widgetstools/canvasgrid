/**
 * Grid Layouts — Phase C / C3: the conditional-rules API on CGridApi,
 * exercised end-to-end on a real CGrid wired to @cgrid/rules.
 *
 * Proves the worklog's C3 gate — "Rules API live + round-trip": getRules /
 * addRule / updateRule / deleteRule / setRuleEnabled / reorderRules route to
 * the @cgrid/rules RuleEngine via the rule-engine provider, every mutation
 * fires a `rulesChanged` event, and the rules ride in the layout-tier `rules`
 * state module (C1) so they round-trip through getState. Also proves the
 * graceful degradation path: a grid with NO rules engine wired returns `[]`
 * and the mutators no-op.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { CGrid } from '../src/cgrid';
import { wireIntoKernel } from '@cgrid/rules';
import type { ConditionalStyleRule } from '@cgrid/rules';
import { _resetRuleEngine_forTests } from '../src/core/ruleEngineSlot';

// The rule engine lives in a MODULE-GLOBAL slot — reset between tests so the
// "no engine wired" case doesn't see a prior grid's engine.
beforeEach(() => { _resetRuleEngine_forTests(); });

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
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
    return () => fakeCtx as any;
  })() as any;
});

function rule(id: string, over: Partial<ConditionalStyleRule> = {}): ConditionalStyleRule {
  return {
    kind: 'style', id, name: id, enabled: true, priority: 10,
    condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
    style: { base: { color: '#c00' } },
    ...over,
  };
}

async function mount(opts: { wire?: boolean } = { wire: true }) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<{ id: string; pnl: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'pnl' }],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
  });
  if (opts.wire !== false) wireIntoKernel(grid, { now: () => 0 });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return grid;
}

describe('C3 — Rules API on CGridApi (rules wired)', () => {
  it('addRule → getRules reflects it, firing rulesChanged', async () => {
    const grid = await mount();
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));

    expect(grid.getRules()).toEqual([]);
    grid.addRule(rule('neg'));
    expect(grid.getRules().map((r) => r.id)).toEqual(['neg']);
    expect(events.at(-1)).toEqual({ type: 'rulesChanged', source: 'add', ruleId: 'neg' });
    grid.destroy();
  });

  it('updateRule merges a patch into the rule by id', async () => {
    const grid = await mount();
    grid.addRule(rule('neg', { priority: 10 }));
    grid.updateRule('neg', { priority: 99, name: 'Renamed' });
    const r = grid.getRules().find((x) => x.id === 'neg')!;
    expect(r.priority).toBe(99);
    expect((r as any).name).toBe('Renamed');
    grid.destroy();
  });

  it('deleteRule removes the rule', async () => {
    const grid = await mount();
    grid.addRule(rule('a'));
    grid.addRule(rule('b'));
    grid.deleteRule('a');
    expect(grid.getRules().map((r) => r.id)).toEqual(['b']);
    grid.destroy();
  });

  it('setRuleEnabled toggles the enabled flag; a disabled rule stops matching', async () => {
    const grid = await mount();
    grid.addRule(rule('neg'));
    grid.setRuleEnabled('neg', false);
    expect(grid.getRules().find((r) => r.id === 'neg')!.enabled).toBe(false);
    // disabled → not indexed → evaluateCell no longer matches
    const { getRuleEngine } = await import('../src/core/ruleEngineSlot');
    expect(getRuleEngine()!.evaluateCell({ row: { pnl: -1 }, rowId: 'a', colId: 'pnl', theme: 'light' }).matched)
      .toEqual([]);
    grid.setRuleEnabled('neg', true);
    expect(getRuleEngine()!.evaluateCell({ row: { pnl: -1 }, rowId: 'a', colId: 'pnl', theme: 'light' }).matched)
      .toEqual(['neg']);
    grid.destroy();
  });

  it('reorderRules reorders the set by the given id order', async () => {
    const grid = await mount();
    grid.addRule(rule('a'));
    grid.addRule(rule('b'));
    grid.addRule(rule('c'));
    grid.reorderRules(['c', 'a', 'b']);
    expect(grid.getRules().map((r) => r.id)).toEqual(['c', 'a', 'b']);
    grid.destroy();
  });

  it('every mutation fires rulesChanged with the right source', async () => {
    const grid = await mount();
    const sources: string[] = [];
    grid.on('rulesChanged', (e) => sources.push((e as any).source));
    grid.addRule(rule('a'));
    grid.addRule(rule('b'));
    grid.updateRule('a', { priority: 5 });
    grid.setRuleEnabled('a', false);
    grid.reorderRules(['b', 'a']); // a real reorder (two rules, order changes)
    grid.deleteRule('a');
    expect(sources).toEqual(['add', 'add', 'update', 'enable', 'reorder', 'delete']);
    grid.destroy();
  });

  it('rules ride the layout-tier `rules` module → round-trip through getState', async () => {
    const grid = await mount();
    grid.addRule(rule('neg'));
    const state = grid.getState();
    expect((state.modules?.rules?.data as any[]).map((r) => r.id)).toEqual(['neg']);
    grid.destroy();
  });

  it('a no-op mutation (unknown id) does not fire an event', async () => {
    const grid = await mount();
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));
    grid.updateRule('missing', { priority: 1 });
    grid.deleteRule('missing');
    grid.setRuleEnabled('missing', false);
    expect(events).toEqual([]);
    grid.destroy();
  });

  it('addRule with an existing id is a no-op (no duplicate, no event)', async () => {
    const grid = await mount();
    grid.addRule(rule('neg', { priority: 10 }));
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));
    grid.addRule(rule('neg', { priority: 99 })); // same id, different payload
    expect(grid.getRules().map((r) => r.id)).toEqual(['neg']); // not duplicated…
    expect(grid.getRules()[0]!.priority).toBe(10); // …and the original is untouched
    expect(events).toEqual([]); // no event
    grid.destroy();
  });

  it('setRuleEnabled to the same value is a no-op (no event)', async () => {
    const grid = await mount();
    grid.addRule(rule('neg')); // enabled: true
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));
    grid.setRuleEnabled('neg', true); // already true
    expect(events).toEqual([]);
    grid.setRuleEnabled('neg', false); // real change
    expect(events.map((e) => e.source)).toEqual(['enable']);
    grid.destroy();
  });

  it('reorderRules to the current order is a no-op (no event)', async () => {
    const grid = await mount();
    grid.addRule(rule('a'));
    grid.addRule(rule('b'));
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));
    grid.reorderRules(['a', 'b']); // already this order
    grid.reorderRules(['zzz']); // all-unknown → order unchanged
    expect(events).toEqual([]);
    grid.reorderRules(['b', 'a']); // real change
    expect(events.map((e) => e.source)).toEqual(['reorder']);
    grid.destroy();
  });
});

describe('C3 — degradation with no rules engine wired', () => {
  it('getRules returns [] and mutators no-op without an event', async () => {
    const grid = await mount({ wire: false });
    const events: any[] = [];
    grid.on('rulesChanged', (e) => events.push(e));
    expect(grid.getRules()).toEqual([]);
    grid.addRule(rule('neg'));
    grid.updateRule('neg', { priority: 1 });
    grid.deleteRule('neg');
    grid.setRuleEnabled('neg', false);
    grid.reorderRules(['neg']);
    expect(grid.getRules()).toEqual([]);
    expect(events).toEqual([]);
    grid.destroy();
  });
});
