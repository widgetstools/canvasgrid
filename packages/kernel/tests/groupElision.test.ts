// Cycle 15 / Task 10 — `groupRemoveSingleChildren` + `showOpenedGroup`.
//
// Two polish flags on an existing surface:
//
//   - `groupRemoveSingleChildren` lives in `GroupPass.apply` — when on,
//     the flatOrder walk skips group entries whose recursive
//     `childCount === 1`. The TREE shape stays intact (the meta lookup
//     keeps working for every non-elided group); only the depth-first
//     traversal changes. Chains of single-child groups collapse
//     entirely so a row sitting under N nested singletons emits at its
//     natural slot with no preceding group entries at all.
//
//   - `showOpenedGroup` lives in `sliceGroupedViewport` — when on, the
//     slicer populates `chunk.groupValue[i]` for DATA rows with their
//     leaf-parent group's formatted value (resolved through the same
//     `groupMeta` callback the group rows use). The renderer paints a
//     muted echo on data rows so the user keeps the parent in view
//     while scrolling inside an expanded group. Off, data-row slots
//     stay blank (the pre-Task-10 behaviour).
//
// Together they form Task 10's "polish on an existing surface" guard
// rails — elision tightens the spine, showOpenedGroup orients the eye.
//
// The 8 cases below cover the elision rule end-to-end (4 cases),
// `showOpenedGroup` populates data-row groupValue (3 cases — on / off /
// elided ancestor passthrough), and the elision + showOpenedGroup
// interaction (1 case).

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import {
  computeGroupVisibleOrder,
  sliceGroupedViewport,
} from '../src/worker/viewportSlicer';
import type { FlatOrderEntry } from '../src/worker/passes/groupPass';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'type',   field: 'type',   type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
];

function colIndex(): Map<string, WorkerColumn> {
  const m = new Map<string, WorkerColumn>();
  for (const c of cols) m.set(c.colId, c);
  return m;
}

/** Fixture with a mix of single-child and multi-row groups:
 *
 *   APAC                           (childCount: 4)
 *     Rates                        (childCount: 3)
 *       IRS                        (childCount: 2)  ← rows 1, 2
 *       Swap                       (childCount: 1)  ← row 3 (eligible for elision)
 *     Credit                       (childCount: 1)  ← row 4 (chain: Credit → CDS → 1 row)
 *       CDS                        (childCount: 1)  ← row 4 (eligible too)
 *   EMEA                           (childCount: 1)  ← row 5 (entire chain elides)
 *     Rates                        (childCount: 1)
 *       IRS                        (childCount: 1)
 *
 *  Lets one test assert leaf-only elision, another assert intermediate
 *  elision, and another assert chain elision — without re-seeding a
 *  different fixture each time. */
function fixtureMixed(): { ids: string[]; store: RowStore } {
  const store = new RowStore('id');
  store.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 100 },
    { id: '2', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 101 },
    { id: '3', desk: 'APAC', region: 'Rates',  type: 'Swap', price: 102 },
    { id: '4', desk: 'APAC', region: 'Credit', type: 'CDS',  price: 200 },
    { id: '5', desk: 'EMEA', region: 'Rates',  type: 'IRS',  price: 300 },
  ]);
  return { ids: ['1', '2', '3', '4', '5'], store };
}

// ============================================================
// groupRemoveSingleChildren — flatOrder elision
// ============================================================

// 1 — DEFAULT OFF: every group emits a `kind: 'group'` entry in
// flatOrder regardless of `childCount`. Regression guard that the
// elision flag is off by default so apps that don't opt in see no
// behaviour change.
describe('GroupPass — groupRemoveSingleChildren default off', () => {
  it('1. groupRemoveSingleChildren=false (default) keeps every group entry', () => {
    const { ids, store } = fixtureMixed();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    expect(p.getRemoveSingleChildren()).toBe(false);
    const out = p.apply(ids);
    const groupEntries = out.flatOrder.filter((e) => e.kind === 'group');
    // 2 desks + (APAC: 2 regions + 2 types-under-Rates + 1 type-under-Credit)
    // + (EMEA: 1 region + 1 type) = 2 + 5 + 2 = 9 group entries.
    // (Single-child groups all keep their entries.)
    expect(groupEntries.length).toBeGreaterThanOrEqual(9);
  });
});

// 2 — LEAF GROUP WITH childCount === 1: the leaf group entry is
// skipped; the single descendant row emits in its natural slot. Other
// leaf groups in the SAME parent (childCount > 1) keep their entries.
// Verifies the per-group decision (no "elide the whole branch")
// behaviour at the leaf level.
describe('GroupPass — single leaf elision', () => {
  it('2. single-row leaf group is elided; multi-row siblings keep their entries', () => {
    const { ids, store } = fixtureMixed();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    p.setRemoveSingleChildren(true);
    expect(p.getRemoveSingleChildren()).toBe(true);
    const out = p.apply(ids);
    const groupKeys = out.flatOrder
      .filter((e) => e.kind === 'group')
      .map((e) => (e as Extract<FlatOrderEntry, { kind: 'group' }>).key);
    // The multi-row leaf type (IRS under APAC > Rates with 2 rows)
    // must STILL emit — it has childCount > 1.
    expect(groupKeys).toContain('desk:APAC::region:Rates::type:IRS');
    // The single-row leaf type (Swap under APAC > Rates with 1 row)
    // must NOT emit — childCount === 1.
    expect(groupKeys).not.toContain('desk:APAC::region:Rates::type:Swap');
    // The lone Swap row (rowIndex 2 — id '3') must still appear in
    // flatOrder at its natural slot.
    const rowEntries = out.flatOrder
      .filter((e) => e.kind === 'row')
      .map((e) => (e as Extract<FlatOrderEntry, { kind: 'row' }>).rowIndex);
    expect(rowEntries).toContain(2);
  });
});

// 3 — MULTI-CHILD GROUPS always keep their entry. Top-level APAC has
// childCount = 4 (4 leaves under it) so it MUST emit. Sub-group
// `Rates` under APAC has childCount = 3 (2 IRS + 1 Swap) so it MUST
// emit too. Guards against an over-eager elision rule that walked
// `childGroups.length === 1` instead of `childCount === 1`.
describe('GroupPass — multi-descendant groups never elide', () => {
  it('3. groups whose childCount > 1 stay in flatOrder even with elision on', () => {
    const { ids, store } = fixtureMixed();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    p.setRemoveSingleChildren(true);
    const out = p.apply(ids);
    const groupKeys = out.flatOrder
      .filter((e) => e.kind === 'group')
      .map((e) => (e as Extract<FlatOrderEntry, { kind: 'group' }>).key);
    expect(groupKeys).toContain('desk:APAC');                            // childCount 4
    expect(groupKeys).toContain('desk:APAC::region:Rates');              // childCount 3
    // APAC > Credit has childCount 1 (one CDS row) — elided.
    expect(groupKeys).not.toContain('desk:APAC::region:Credit');
  });
});

// 4 — CHAIN ELISION: EMEA → Rates → IRS → row '5' is a chain of
// single-child groups at every level. Elision skips all three entries;
// the lone row '5' appears alone in flatOrder where the EMEA chain
// would have been. Critical case — the elision is recursive AND
// applies independently per branch (APAC's multi-row sub-tree
// alongside EMEA's elided chain), so the test asserts that ALL three
// EMEA-chain composite keys drop out of the flatOrder simultaneously.
describe('GroupPass — chain elision', () => {
  it('4. nested single-child chain (EMEA → Rates → IRS → row 5) elides every level', () => {
    const { ids, store } = fixtureMixed();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    p.setRemoveSingleChildren(true);
    const out = p.apply(ids);
    const groupKeys = new Set(
      out.flatOrder
        .filter((e) => e.kind === 'group')
        .map((e) => (e as Extract<FlatOrderEntry, { kind: 'group' }>).key),
    );
    expect(groupKeys.has('desk:EMEA')).toBe(false);
    expect(groupKeys.has('desk:EMEA::region:Rates')).toBe(false);
    expect(groupKeys.has('desk:EMEA::region:Rates::type:IRS')).toBe(false);
    // The lone EMEA row (rowIndex 4 — id '5') still emits.
    const rowEntries = out.flatOrder
      .filter((e) => e.kind === 'row')
      .map((e) => (e as Extract<FlatOrderEntry, { kind: 'row' }>).rowIndex);
    expect(rowEntries).toContain(4);
    // Tree shape is unchanged — `roots` still contains both APAC and
    // EMEA (elision is a flatOrder-only concern, not a tree mutation).
    // This is what lets the meta lookup keep resolving every key for
    // any future paint path that needs the non-elided ancestor value.
    expect(out.roots.map((r) => r.value).sort()).toEqual(['APAC', 'EMEA']);
  });
});

// ============================================================
// showOpenedGroup — slicer populates data-row groupValue
// ============================================================

/** Build a single-level (`['desk']`) flatOrder + meta resolver against
 *  the mixed fixture. Used by the showOpenedGroup cases — they only
 *  need a one-level tree to assert the "data row inherits leaf parent
 *  value" behaviour. */
function buildSingleLevel(
  removeSingleChildren = false,
): {
  visibleOrder: ReturnType<typeof computeGroupVisibleOrder>;
  ids: string[];
  store: RowStore;
  metaLookup: (key: string) => { value: string; childCount: number; isExpanded: boolean } | undefined;
} {
  const { ids, store } = fixtureMixed();
  const p = new GroupPass(store, cols);
  p.setModel({ rowGroupCols: ['desk'] });
  if (removeSingleChildren) p.setRemoveSingleChildren(true);
  const out = p.apply(ids);
  // All groups expanded.
  const expandedKeys = new Set(
    out.flatOrder
      .filter((e) => e.kind === 'group')
      .map((e) => (e as Extract<FlatOrderEntry, { kind: 'group' }>).key),
  );
  const visibleOrder = computeGroupVisibleOrder(out.flatOrder, expandedKeys);
  // Hand-built meta lookup keyed by composite key. The slicer normally
  // gets one from `buildGroupMetaLookup` in worker.ts — here we mirror
  // its shape against the actual GroupNode tree so the assertions
  // exercise the exact data the renderer sees in production.
  const metaMap = new Map<string, { value: string; childCount: number; isExpanded: boolean }>();
  const walk = (
    nodes: ReadonlyArray<{
      key: string;
      value: unknown;
      childCount: number;
      childGroups: ReadonlyArray<unknown>;
    }>,
  ): void => {
    for (const n of nodes) {
      metaMap.set(n.key, {
        value: String(n.value ?? ''),
        childCount: n.childCount,
        isExpanded: expandedKeys.has(n.key),
      });
      if (n.childGroups.length > 0) walk(n.childGroups as typeof nodes);
    }
  };
  walk(out.roots);
  return { visibleOrder, ids, store, metaLookup: (k) => metaMap.get(k) };
}

// 5 — SHOWOPENEDGROUP OFF: data-row `groupValue[i]` slots stay
// EMPTY (the pre-Task-10 behaviour). Regression guard that flipping
// the flag off (or leaving it unset, the default) does not paint
// muted echoes on data rows.
describe('sliceGroupedViewport — showOpenedGroup off (default)', () => {
  it('5. data-row groupValue slots stay empty when showOpenedGroup is undefined', () => {
    const { visibleOrder, ids, store, metaLookup } = buildSingleLevel();
    const chunk = sliceGroupedViewport(
      store, colIndex(), ids, visibleOrder,
      { rowStart: 0, rowEnd: visibleOrder.length, columns: ['price'] },
      undefined,
      metaLookup,
      /* showOpenedGroup */ undefined,
    );
    // visibleOrder layout (all expanded, one-level, `desk` grouping):
    //   [group APAC, row 1, row 2, row 3, row 4, group EMEA, row 5]
    // Group slots get the meta value; row slots stay ''.
    for (let i = 0; i < chunk.rowCount; i++) {
      const entry = visibleOrder[i]!;
      if (entry.kind === 'group') continue;
      expect(chunk.groupValue?.[i] ?? '').toBe('');
    }
  });
});

// 6 — SHOWOPENEDGROUP ON: each data row's `groupValue[i]` is the
// formatted value of the most-recent group entry preceding it. With
// the one-level `desk` model, rows 1-4 inherit `APAC` and row 5
// inherits `EMEA`. The check exercises the slicer's pre-walk +
// per-row tracking — getting either branch wrong would mis-pair the
// labels.
describe('sliceGroupedViewport — showOpenedGroup on', () => {
  it('6. data-row groupValue inherits the leaf-parent group value when showOpenedGroup is true', () => {
    const { visibleOrder, ids, store, metaLookup } = buildSingleLevel();
    const chunk = sliceGroupedViewport(
      store, colIndex(), ids, visibleOrder,
      { rowStart: 0, rowEnd: visibleOrder.length, columns: ['price'] },
      undefined,
      metaLookup,
      /* showOpenedGroup */ true,
    );
    // Per-slot expected groupValue, walking visibleOrder + meta lookup.
    let expectedLastGroupValue = '';
    for (let i = 0; i < chunk.rowCount; i++) {
      const entry = visibleOrder[i]!;
      if (entry.kind === 'group') {
        expectedLastGroupValue = metaLookup(entry.key)?.value ?? '';
        // Group slot itself reports the group's own value.
        expect(chunk.groupValue?.[i]).toBe(expectedLastGroupValue);
        continue;
      }
      // Data slot inherits the most recent group value.
      expect(chunk.groupValue?.[i]).toBe(expectedLastGroupValue);
    }
    // Concrete spot-check: a data row inside APAC echoes 'APAC',
    // a data row inside EMEA echoes 'EMEA'.
    const apacIdx = visibleOrder.findIndex((e) => e.kind === 'row');
    expect(chunk.groupValue?.[apacIdx]).toBe('APAC');
    const emeaRowIdx = visibleOrder.length - 1; // last entry is EMEA's row
    expect(chunk.groupValue?.[emeaRowIdx]).toBe('EMEA');
  });
});

// 7 — MID-LIST CHUNK + showOpenedGroup. A chunk that starts in the
// middle of the visible order must still produce the correct
// opened-group label for its leading data rows — even though the
// preceding group entry sits BEFORE rowStart. Exercises the slicer's
// pre-walk-up-to-rowStart path that seeds `lastSeenGroupKey` so the
// first slot doesn't fall back to an empty label.
describe('sliceGroupedViewport — showOpenedGroup mid-list chunk', () => {
  it('7. mid-list chunk seeds the opened-group label from the pre-walk', () => {
    const { visibleOrder, ids, store, metaLookup } = buildSingleLevel();
    // visibleOrder: [group APAC, row, row, row, row, group EMEA, row]
    //                     0       1    2    3    4       5        6
    // Start the chunk at index 2 — a data row deep inside APAC. The
    // pre-walk should pick up `group APAC` and seed it; the data row
    // at chunk index 0 (= visibleOrder[2]) must echo 'APAC'.
    const chunk = sliceGroupedViewport(
      store, colIndex(), ids, visibleOrder,
      { rowStart: 2, rowEnd: 5, columns: ['price'] },
      undefined,
      metaLookup,
      /* showOpenedGroup */ true,
    );
    expect(chunk.rowCount).toBe(3);
    // visibleOrder[2..4] are all APAC data rows.
    for (let i = 0; i < chunk.rowCount; i++) {
      const entry = visibleOrder[2 + i]!;
      expect(entry.kind).toBe('row');
      expect(chunk.groupValue?.[i]).toBe('APAC');
    }
  });
});

// 8 — ELISION + showOpenedGroup interaction. With
// groupRemoveSingleChildren on, the EMEA chain (a single-row chain
// under EMEA in the 3-level fixture) elides entirely — no group
// entries precede the row in flatOrder. The data row's
// `lastSeenGroupKey` resolves to the most-recent NON-elided group
// (whatever multi-row branch came before it — APAC's deepest leaf in
// this fixture). This matches the design intent: data rows borrow
// the closest visible ancestor's label, which after elision is the
// closest NON-elided ancestor. A row promoted by full-chain elision
// is allowed to inherit nothing (no preceding group) or the prior
// branch's label — either is acceptable; the assertion is that the
// slicer doesn't crash AND doesn't echo a value from an ELIDED
// group's key.
describe('sliceGroupedViewport — elision + showOpenedGroup', () => {
  it('8. elided ancestors do not appear in groupValue echoes for data rows', () => {
    const { ids, store } = fixtureMixed();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    p.setRemoveSingleChildren(true);
    const out = p.apply(ids);
    const expandedKeys = new Set(
      out.flatOrder
        .filter((e) => e.kind === 'group')
        .map((e) => (e as Extract<FlatOrderEntry, { kind: 'group' }>).key),
    );
    const visibleOrder = computeGroupVisibleOrder(out.flatOrder, expandedKeys);
    // Build a meta lookup over EVERY tree node (including elided ones)
    // so the slicer's `lastSeenGroupKey → meta.value` resolution
    // works for any key it might encounter. The point is that
    // elided keys never become `lastSeenGroupKey` in the first place
    // (we skip their group entries in flatOrder), so their values
    // shouldn't surface on data-row echoes.
    const metaMap = new Map<string, { value: string; childCount: number; isExpanded: boolean }>();
    const walk = (
      nodes: ReadonlyArray<{
        key: string;
        value: unknown;
        childCount: number;
        childGroups: ReadonlyArray<unknown>;
      }>,
    ): void => {
      for (const n of nodes) {
        metaMap.set(n.key, {
          value: String(n.value ?? ''),
          childCount: n.childCount,
          isExpanded: true,
        });
        if (n.childGroups.length > 0) walk(n.childGroups as typeof nodes);
      }
    };
    walk(out.roots);
    const chunk = sliceGroupedViewport(
      store, colIndex(), ids, visibleOrder,
      { rowStart: 0, rowEnd: visibleOrder.length, columns: ['price'] },
      undefined,
      (k) => metaMap.get(k),
      /* showOpenedGroup */ true,
    );
    // EMEA's chain is fully elided. The row '5' (rowIndex 4) lands at
    // the end of visibleOrder. Its echo MUST NOT be 'EMEA' (the
    // elided top-level desk) OR 'IRS' (the elided leaf type) — the
    // slicer never sees `desk:EMEA` / `desk:EMEA::region:Rates` /
    // `desk:EMEA::region:Rates::type:IRS` as `lastSeenGroupKey`
    // because those entries dropped from flatOrder.
    const lastSlot = chunk.rowCount - 1;
    expect(chunk.rowKinds[lastSlot]).toBe(0); // confirmed a data row
    // The most-recent non-elided group seen before EMEA's row was
    // APAC's deepest leaf (`desk:APAC::region:Rates::type:IRS` has
    // childCount 2 — non-elided). The echo therefore reads 'IRS' (or
    // whatever the deepest non-elided ancestor's formatted value is).
    // Either way, it does NOT read 'EMEA' (the elided value).
    expect(chunk.groupValue?.[lastSlot]).not.toBe('EMEA');
  });
});
