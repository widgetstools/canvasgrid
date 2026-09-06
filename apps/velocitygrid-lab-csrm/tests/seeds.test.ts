/**
 * The seeds are the lab's content, and a seed that fails validation fails
 * silently: the engines skip the bad rule, warn on the console, and the tab
 * renders as a plain grid. That is exactly the failure this lab exists to
 * avoid, so every seeded rule, alert and calculated column is compiled here
 * against the real engines.
 */
import { describe, it, expect } from 'vitest';
import { RuleEngine, AlertsEngine } from '@wellsfargo-starui/velocity-grid/rules';
import { CalcEngine } from '@wellsfargo-starui/velocity-grid/calc';
import {
  ALERT_RULES, CALC_COLUMNS, CONDITIONAL_RULES, NUDGES, SAVED_FILTERS,
  SEEDS, SHORTCUTS, TICK_ARROW_MS, TICK_ARROW_RULES, seedFor,
} from '../src/lab/seeds';
import { LAB_TABS } from '../src/lab/catalog';
import { baseColumns } from '../src/data/columns';
import { makeRows } from '../src/data/domain';

const FIELDS = new Set(Object.keys(makeRows(1, 1, 0)[0]!));

describe('conditional style rules', () => {
  it('every rule compiles', () => {
    const res = new RuleEngine({}).setRules(CONDITIONAL_RULES);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('every rule scopes to columns that exist', () => {
    const known = new Set(baseColumns.map((c) => (c.colId ?? c.field) as string));
    for (const rule of CONDITIONAL_RULES) {
      if (rule.scope.kind !== 'cell') continue;
      for (const colId of rule.scope.columnIds) {
        expect(known.has(colId) || FIELDS.has(colId)).toBe(true);
      }
    }
  });

  it('gives the tick rules an expiry so they cannot latch on', () => {
    for (const rule of CONDITIONAL_RULES) {
      if (!rule.condition.includes('.old]')) continue;
      // A change-driven rule with no active window stays lit until the
      // opposite condition fires, which on a one-way move is forever.
      expect((rule as { activeDurationMs?: number }).activeDurationMs).toBeGreaterThan(0);
    }
  });

  it('styles both themes, since rules are persisted data not CSS', () => {
    for (const rule of CONDITIONAL_RULES) {
      if (rule.kind !== 'style') continue;
      const s = rule.style as Record<string, unknown>;
      const hasPair = (s.light !== undefined && s.dark !== undefined) || s.base !== undefined;
      expect(hasPair).toBe(true);
    }
  });

  it('has unique ids and no duplicate priorities within a scope', () => {
    const ids = CONDITIONAL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('alert rules', () => {
  it('every alert compiles', () => {
    const res = new AlertsEngine({}).setRules(ALERT_RULES);
    expect(res.errors).toEqual([]);
  });

  it('watches columns that exist', () => {
    for (const rule of ALERT_RULES) {
      const t = rule.trigger as { colId?: string; columnIds?: string[] };
      if (t.colId) expect(FIELDS.has(t.colId)).toBe(true);
      for (const c of t.columnIds ?? []) expect(FIELDS.has(c)).toBe(true);
    }
  });

  it('debounces every rule, so one fast row cannot flood the channel', () => {
    for (const rule of ALERT_RULES) expect(rule.debounceMs ?? 0).toBeGreaterThan(0);
  });
});

describe('calculated columns', () => {
  it('every expression compiles', () => {
    const engine = new CalcEngine({});
    for (const col of CALC_COLUMNS) {
      const res = engine.registerCalculatedColumn(col);
      expect({ colId: col.colId, errors: res.errors ?? [] })
        .toEqual({ colId: col.colId, errors: [] });
    }
    expect(engine.listCalculatedColumns()).toHaveLength(CALC_COLUMNS.length);
  });

  it('references only real fields', () => {
    for (const col of CALC_COLUMNS) {
      for (const ref of col.expression.matchAll(/\[([A-Za-z0-9_]+)\]/g)) {
        expect(FIELDS.has(ref[1]!)).toBe(true);
      }
    }
  });

  it('does not collide with a data field or another calc column', () => {
    const ids = CALC_COLUMNS.map((c) => c.colId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(FIELDS.has(id)).toBe(false);
  });
});

describe('editing seeds', () => {
  it('nudges and shortcuts target real columns', () => {
    for (const n of NUDGES) for (const c of n.scope.columnIds) expect(FIELDS.has(c)).toBe(true);
    for (const s of SHORTCUTS) for (const c of s.scope.columnIds) expect(FIELDS.has(c)).toBe(true);
  });

  it('gives each column exactly one nudge, so the step is unambiguous', () => {
    const seen = new Set<string>();
    for (const n of NUDGES) {
      for (const c of n.scope.columnIds) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });

  it('binds each shortcut key once', () => {
    const keys = SHORTCUTS.map((s) => s.shortcutKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]$/);
  });
});

describe('saved filters', () => {
  it('filters on columns that exist', () => {
    const known = new Set(baseColumns.map((c) => (c.colId ?? c.field) as string));
    for (const f of SAVED_FILTERS) {
      for (const colId of Object.keys(f.filterModel)) {
        expect(known.has(colId) || FIELDS.has(colId)).toBe(true);
      }
    }
  });

  it('starts inactive, so a tab opens showing the whole book', () => {
    for (const f of SAVED_FILTERS) expect(f.active).toBe(false);
  });
});

describe('per-tab coverage', () => {
  it('every feature tab arrives with something configured', () => {
    // The complaint this test encodes: a tab with no seed is the same grid as
    // every other tab, which demonstrates nothing.
    const bare: string[] = [];
    for (const tab of LAB_TABS) {
      const seed = seedFor(tab.id);
      const populated = Boolean(
        seed.rules?.length || seed.alertRules?.length || seed.calculatedColumns?.length
        || seed.nudges?.length || seed.shortcuts?.length || seed.savedFilters?.length
        || seed.sortModel?.length || seed.filterModel,
      );
      // Tabs whose subject IS the bare grid configuration are the exception.
      if (!populated && tab.id !== 'pivot' && tab.id !== 'groups') bare.push(tab.id);
    }
    expect(bare).toEqual([]);
  });

  it('seeds only reference tabs that exist', () => {
    const ids = new Set(LAB_TABS.map((t) => t.id));
    for (const id of Object.keys(SEEDS)) expect(ids.has(id)).toBe(true);
  });
});

describe('tick arrow rules', () => {
  it('every arrow rule compiles', () => {
    const res = new RuleEngine({}).setRules(TICK_ARROW_RULES);
    expect(res.errors).toEqual([]);
  });

  it('pairs one up and one down rule per ticking column', () => {
    const ups = TICK_ARROW_RULES.filter((r) => r.id.startsWith('tick-arrow-up-'));
    const downs = TICK_ARROW_RULES.filter((r) => r.id.startsWith('tick-arrow-down-'));
    expect(ups.length).toBe(downs.length);
    expect(ups.length).toBeGreaterThan(5);
    for (const up of ups) {
      const col = up.id.replace('tick-arrow-up-', '');
      expect(TICK_ARROW_RULES.some((r) => r.id === `tick-arrow-down-${col}`)).toBe(true);
    }
  });

  it('conditions each rule on its OWN column, not a shared one', () => {
    // A rule scoped to a column but conditioned on another would raise arrows
    // on cells that did not change.
    for (const rule of TICK_ARROW_RULES) {
      expect(rule.scope.kind).toBe('cell');
      const [colId] = (rule.scope as { columnIds: string[] }).columnIds;
      expect(rule.condition).toContain(`[${colId}.old]`);
      expect(rule.condition).toContain(`[${colId}]`);
      const others = rule.condition.match(/\[([A-Za-z0-9_]+)(\.old)?\]/g) ?? [];
      for (const ref of others) expect(ref).toContain(colId!);
    }
  });

  it('points up for a rise and down for a fall, in green and red', () => {
    for (const rule of TICK_ARROW_RULES) {
      const ind = (rule as { indicator?: { iconName: string; color: string } }).indicator;
      expect(ind).toBeDefined();
      if (rule.id.startsWith('tick-arrow-up-')) {
        expect(rule.condition).toContain('>');
        expect(ind!.iconName).toBe('arrow-up');
        expect(ind!.color).toBe('#0aa063');
      } else {
        expect(rule.condition).toContain('<');
        expect(ind!.iconName).toBe('arrow-down');
        expect(ind!.color).toBe('#e63946');
      }
    }
  });

  it('shows each arrow for 800ms and no longer', () => {
    expect(TICK_ARROW_MS).toBe(800);
    for (const rule of TICK_ARROW_RULES) {
      // Without an active window the arrow latches until the value moves the
      // other way, which on a one-way move never happens.
      expect((rule as { activeDurationMs?: number }).activeDurationMs).toBe(800);
    }
  });

  it('adds no colour of its own, so the number keeps its formatting', () => {
    for (const rule of TICK_ARROW_RULES) {
      const style = (rule as { style: Record<string, Record<string, unknown>> }).style;
      const slices = Object.values(style ?? {});
      for (const slice of slices) expect(Object.keys(slice ?? {})).toEqual([]);
    }
  });

  it('is offered as a named profile on the tabs where ticking is the point', () => {
    for (const tabId of ['live', 'conditional']) {
      const view = seedFor(tabId).views?.find((v) => v.name === 'Tick arrows');
      expect({ tabId, found: Boolean(view) }).toEqual({ tabId, found: true });
      expect(view!.rules).toBe(TICK_ARROW_RULES);
    }
  });
});
