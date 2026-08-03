import { describe, it, expect } from 'vitest';
import {
  attachSsrmRowMeta,
  computeSsrmStickyAncestors,
  materializeSsrmGroupTotals,
} from '../src/core/ssrmRowMeta';

describe('ssrmRowMeta sticky parity', () => {
  const columns = [
    { colId: 'notional', field: 'notional', aggFunc: 'sum' },
    { colId: 'desk', field: 'desk' },
  ];

  const store = new Map<string, Record<string, unknown>>([
    ['g-desk', attachSsrmRowMeta(
      { notional: 1000, desk: 'FX' },
      { kind: 'group', key: 'desk:FX', depth: 0, label: 'FX', childCount: 2, expanded: true },
    )],
    ['g-region', attachSsrmRowMeta(
      { notional: 400, desk: 'FX' },
      { kind: 'group', key: 'desk:FX::region:EMEA', depth: 1, label: 'EMEA', childCount: 1, expanded: true },
    )],
    ['leaf-1', attachSsrmRowMeta(
      { notional: 400, desk: 'FX' },
      { kind: 'leaf', key: 'desk:FX::region:EMEA', depth: 2, label: '', expanded: true },
    )],
  ]);

  const getRowById = (id: string) => store.get(id);
  const orderIds = ['g-desk', 'g-region', 'leaf-1', 'leaf-2', 'leaf-3'];

  it('materializeSsrmGroupTotals includes sticky ancestors above the chunk', () => {
    const visibleSlice = orderIds.slice(3, 5);
    const rowKinds = new Uint8Array([0, 0]);
    const groupKeys = ['', ''];

    const totals = materializeSsrmGroupTotals(
      getRowById,
      columns,
      visibleSlice,
      rowKinds,
      groupKeys,
      orderIds,
      3,
    );

    expect(totals['desk:FX']?.notional).toBe(1000);
    expect(totals['desk:FX::region:EMEA']?.notional).toBe(400);
  });

  it('computeSsrmStickyAncestors picks last expanded group per depth above viewport', () => {
    const ancestors = computeSsrmStickyAncestors(getRowById, orderIds, 3, ['desk', 'region']);
    expect(ancestors).toEqual([
      {
        depth: 0,
        key: 'desk:FX',
        colId: 'desk',
        value: 'FX',
        childCount: 2,
        isExpanded: true,
      },
      {
        depth: 1,
        key: 'desk:FX::region:EMEA',
        colId: 'region',
        value: 'EMEA',
        childCount: 1,
        isExpanded: true,
      },
    ]);
  });

  it('computeSsrmStickyAncestors works with empty rowGroupCols (sparse path — colId from key segments)', () => {
    // The sparse path never ships the worker group model, so rowGroupCols
    // arrives empty; each ancestor's colId must fall back to its composite
    // key segment.
    const ancestors = computeSsrmStickyAncestors(getRowById, orderIds, 3, []);
    expect(ancestors.map((a) => ({ depth: a.depth, colId: a.colId, key: a.key, value: a.value }))).toEqual([
      { depth: 0, colId: 'desk', key: 'desk:FX', value: 'FX' },
      { depth: 1, colId: 'region', key: 'desk:FX::region:EMEA', value: 'EMEA' },
    ]);
  });

  it('computeSsrmStickyAncestors ends the chain at a collapsed group (descendants cannot be ancestors)', () => {
    const collapsed = attachSsrmRowMeta(
      { notional: 1000 },
      { kind: 'group', key: 'desk:FX', depth: 0, label: 'FX', childCount: 2, expanded: false },
    );
    const localStore = new Map(store);
    localStore.set('g-desk', collapsed);
    const ancestors = computeSsrmStickyAncestors(
      (id) => localStore.get(id),
      orderIds,
      3,
      ['desk', 'region'],
    );
    // A collapsed depth-0 group has no visible descendants, so neither it
    // nor any recorded deeper group can be an ancestor of rows below it.
    expect(ancestors).toEqual([]);
  });

  it('computeSsrmStickyAncestors drops deeper groups from a previous subtree (cross-parent band)', () => {
    // Hydrated order: FX(d0) → FX/EMEA(d1) → leaf → Rates(d0) → leaf.
    // Viewport top below Rates: the band must be [Rates], never
    // [Rates, FX/EMEA] — EMEA belongs to the FX subtree.
    const localStore = new Map(store);
    localStore.set('g-rates', attachSsrmRowMeta(
      { notional: 700, desk: 'Rates' },
      { kind: 'group', key: 'desk:Rates', depth: 0, label: 'Rates', childCount: 1, expanded: true },
    ));
    const order = ['g-desk', 'g-region', 'leaf-1', 'g-rates', 'leaf-2'];
    const ancestors = computeSsrmStickyAncestors(
      (id) => localStore.get(id),
      order,
      4,
      ['desk', 'region'],
    );
    expect(ancestors.map((a) => ({ depth: a.depth, key: a.key }))).toEqual([
      { depth: 0, key: 'desk:Rates' },
    ]);
  });
});
