/**
 * The profile catalog, ported from the MarketsGrid lab's `src/profiles/catalogs/`.
 *
 * Its shape is the reason that lab teaches: each tab opens on a "Full" profile,
 * then a series that each isolate ONE capability, usually with a bare one at
 * the end to author against. A profile showing eight things at once shows none
 * of them.
 *
 * Every profile is compiled here against the real engines, because a bad rule
 * or expression is SKIPPED rather than raised — the tab renders plain and the
 * only evidence is a console warning nobody reads.
 */
import { describe, it, expect } from 'vitest';
import { RuleEngine, AlertsEngine } from '@wellsfargo-starui/velocity-grid/rules';
import { CalcEngine } from '@wellsfargo-starui/velocity-grid/calc';
import { PROFILES, profilesFor } from '../src/lab/seeds';
import { LAB_TABS } from '../src/lab/catalog';
import { baseColumns } from '../src/data/columns';
import { makeRows } from '../src/data/domain';

const FIELDS = new Set(Object.keys(makeRows(1, 1, 0)[0]!));
const COLUMNS = new Set(baseColumns.map((c) => (c.colId ?? c.field) as string));
const ALL = Object.entries(PROFILES).flatMap(([tabId, views]) =>
  views.map((view) => ({ tabId, view })));

describe('profile catalog', () => {
  it('covers every feature tab', () => {
    const missing = LAB_TABS
      .filter((t) => profilesFor(t.id).length === 0)
      .map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it('gives every tab more than one profile, or it is not a choice', () => {
    for (const tab of LAB_TABS) {
      expect({ tab: tab.id, count: profilesFor(tab.id).length > 1 })
        .toEqual({ tab: tab.id, count: true });
    }
  });

  it('names each profile uniquely within its tab', () => {
    for (const [tabId, views] of Object.entries(PROFILES)) {
      const names = views.map((v) => v.name);
      expect({ tabId, unique: new Set(names).size === names.length })
        .toEqual({ tabId, unique: true });
    }
  });

  it('gives every profile a blurb saying what it isolates', () => {
    for (const { tabId, view } of ALL) {
      expect({ tabId, name: view.name, hasBlurb: (view.blurb ?? '').length > 12 })
        .toEqual({ tabId, name: view.name, hasBlurb: true });
    }
  });

  it('makes every profile differ from the others in its tab', () => {
    // Two profiles with the same content are one profile and a decoy.
    for (const [tabId, views] of Object.entries(PROFILES)) {
      const shapes = views.map((v) => JSON.stringify({
        r: (v.rules ?? []).map((x) => `${x.id}:${x.enabled}`).sort(),
        a: (v.alertRules ?? []).map((x) => `${x.id}:${x.enabled}:${x.channels}:${x.debounceMs}`).sort(),
        c: (v.calculatedColumns ?? []).map((x) => x.colId).sort(),
        n: (v.nudges ?? []).map((x) => x.id).sort(),
        s: (v.shortcuts ?? []).map((x) => x.id).sort(),
        f: (v.savedFilters ?? []).map((x) => x.id).sort(),
        sort: v.sortModel ?? null, filter: v.filterModel ?? null, group: v.rowGroupColumns ?? null,
      }));
      expect({ tabId, distinct: new Set(shapes).size === shapes.length })
        .toEqual({ tabId, distinct: true });
    }
  });
});

describe('every profile compiles', () => {
  it.each(ALL.map(({ tabId, view }) => [`${tabId} / ${view.name}`, view] as const))(
    '%s', (_label, view) => {
      if (view.rules?.length) {
        expect(new RuleEngine({}).setRules(view.rules).errors).toEqual([]);
      }
      if (view.alertRules?.length) {
        expect(new AlertsEngine({}).setRules(view.alertRules).errors).toEqual([]);
      }
      if (view.calculatedColumns?.length) {
        const engine = new CalcEngine({});
        for (const col of view.calculatedColumns) {
          expect({ col: col.colId, errors: engine.registerCalculatedColumn(col).errors ?? [] })
            .toEqual({ col: col.colId, errors: [] });
        }
      }
    },
  );
});

describe('every profile references things that exist', () => {
  it('scopes rules to real columns', () => {
    for (const { tabId, view } of ALL) {
      for (const rule of view.rules ?? []) {
        if (rule.scope.kind !== 'cell') continue;
        for (const colId of rule.scope.columnIds) {
          expect({ tabId, rule: rule.id, colId, known: COLUMNS.has(colId) || FIELDS.has(colId) })
            .toEqual({ tabId, rule: rule.id, colId, known: true });
        }
      }
    }
  });

  it('filters, sorts and groups on real columns', () => {
    for (const { tabId, view } of ALL) {
      const cols = [
        ...Object.keys(view.filterModel ?? {}),
        ...(view.sortModel ?? []).map((s) => s.colId),
        ...(view.rowGroupColumns ?? []),
      ];
      for (const colId of cols) {
        const known = COLUMNS.has(colId) || FIELDS.has(colId)
          // Calculated columns are legitimate sort targets once the profile
          // that sorts on one also installs it.
          || (view.calculatedColumns ?? []).some((c) => c.colId === colId);
        expect({ tabId, name: view.name, colId, known }).toEqual({ tabId, name: view.name, colId, known: true });
      }
    }
  });

  it('nudges and shortcuts target real columns', () => {
    for (const { tabId, view } of ALL) {
      for (const n of view.nudges ?? []) {
        for (const c of n.scope.columnIds) {
          expect({ tabId, nudge: n.id, c, ok: FIELDS.has(c) }).toEqual({ tabId, nudge: n.id, c, ok: true });
        }
      }
      for (const sc of view.shortcuts ?? []) {
        for (const c of sc.scope.columnIds) {
          expect({ tabId, key: sc.shortcutKey, c, ok: FIELDS.has(c) })
            .toEqual({ tabId, key: sc.shortcutKey, c, ok: true });
        }
      }
    }
  });
});

describe('the catalog keeps the reference lab\'s teaching shape', () => {
  it('offers a bare profile wherever a tab is about authoring', () => {
    // The reference catalogs end several tabs with a blank one so a reader can
    // build the feature themselves rather than only read someone else's.
    for (const tabId of ['conditional', 'calc', 'toolbar', 'filters', 'live', 'plusminus', 'shortcuts']) {
      const views = profilesFor(tabId);
      // "Bare" is either nothing installed, or — the shape the reference lab
      // uses for its conditional tab — everything installed and switched off,
      // so a reader turns them on one at a time.
      const bare = views.some((v) => {
        const lists = [v.rules, v.calculatedColumns, v.savedFilters, v.nudges, v.shortcuts]
          .filter((x): x is NonNullable<typeof x> => Array.isArray(x));
        const empty = lists.some((x) => x.length === 0);
        const allDisabled = (v.rules?.length ?? 0) > 0 && v.rules!.every((r) => !r.enabled);
        return empty || allDisabled;
      });
      expect({ tabId, hasBare: bare }).toEqual({ tabId, hasBare: true });
    }
  });

  it('leads with a full profile on the tabs that have one', () => {
    for (const tabId of ['overview', 'conditional', 'alerts', 'live', 'calc']) {
      const first = profilesFor(tabId)[0]!;
      // The first entry is what a reader meets; it should be the rich one.
      const richness = (first.rules?.length ?? 0) + (first.calculatedColumns?.length ?? 0)
        + (first.alertRules?.length ?? 0);
      expect({ tabId, first: first.name, rich: richness > 0 })
        .toEqual({ tabId, first: first.name, rich: true });
    }
  });
});
