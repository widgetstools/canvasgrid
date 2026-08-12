/**
 * PORT-NOTE: NOT a copied legacy test — added by the worker port for
 * required refactor #3.
 *
 * Legacy implements the sticky-band ancestor walk twice: once over CSRM
 * visible-order entries (`worker.ts::computeStickyAncestors`) and once over
 * sparse SSRM rows (`core/ssrmRowMeta.ts::computeSsrmStickyAncestors`). The
 * port factors the CSRM side into `worker/stickyAncestors.ts`; the SSRM side
 * keeps its legacy-verbatim inline walk so `core/` takes no runtime dependency
 * on a worker module, so the two implementations must agree on the same
 * invariants.
 *
 * Nothing in the parity set covers either walk — `stickyGroupsClip.test.ts`
 * feeds the renderer a literal `stickyAncestors` array — so the shared
 * traversal is pinned here, invariant by invariant, along with both callers'
 * resolution rules.
 */
import { describe, it, expect } from 'vitest';
import { collectStickyAncestors } from '../src/worker/stickyAncestors';
import {
  SSRM_ROW_META_KEY,
  computeSsrmStickyAncestors,
  type SsrmRowMeta,
} from '../src/core/ssrmRowMeta';
import { createWorkerHost } from '../src/worker/worker';
import type {
  StickyAncestor, WorkerRequest, WorkerResponse, WorkerPush,
} from '../src/worker/protocol';

interface Group { depth: number; key: string }

/** Resolve every group, so a test isolates the walk from the truncation. */
const acceptAll = (g: Group, depth: number): StickyAncestor => ({
  depth, key: g.key, colId: `c${depth}`, value: g.key, childCount: 0, isExpanded: true,
});

function walk(
  groups: Array<Group | undefined>,
  resolve: (g: Group, depth: number) => StickyAncestor | null = acceptAll,
): StickyAncestor[] {
  return collectStickyAncestors(groups.length, (i) => groups[i], resolve);
}

describe('collectStickyAncestors — the shared walk', () => {
  it('returns nothing for an empty window', () => {
    expect(collectStickyAncestors(0, () => ({ depth: 0, key: 'x' }), acceptAll)).toEqual([]);
    expect(collectStickyAncestors(-5, () => ({ depth: 0, key: 'x' }), acceptAll)).toEqual([]);
  });

  it('returns nothing when the window holds no group rows', () => {
    expect(walk([undefined, undefined, undefined])).toEqual([]);
  });

  it('keeps the LAST group seen at each depth', () => {
    const out = walk([
      { depth: 0, key: 'A' },
      { depth: 1, key: 'A/1' },
      { depth: 1, key: 'A/2' },
    ]);
    expect(out.map((a) => a.key)).toEqual(['A', 'A/2']);
  });

  it('orders the chain shallow → deep regardless of encounter order', () => {
    const out = walk([
      { depth: 2, key: 'deep' },
      { depth: 0, key: 'root' },
      { depth: 1, key: 'mid' },
      { depth: 2, key: 'deep2' },
    ]);
    expect(out.map((a) => a.depth)).toEqual([0, 1, 2]);
    expect(out.map((a) => a.key)).toEqual(['root', 'mid', 'deep2']);
  });

  it('purges deeper entries when a new group starts at a shallower depth', () => {
    // B's subtree must not inherit A's children: without the purge, 'A/1'
    // would still be reported as an ancestor of rows under B.
    const out = walk([
      { depth: 0, key: 'A' },
      { depth: 1, key: 'A/1' },
      { depth: 0, key: 'B' },
    ]);
    expect(out.map((a) => a.key)).toEqual(['B']);
  });

  it('purges only strictly deeper entries, not same-depth ones', () => {
    const out = walk([
      { depth: 0, key: 'A' },
      { depth: 1, key: 'A/1' },
      { depth: 1, key: 'A/2' },
      { depth: 2, key: 'A/2/x' },
    ]);
    expect(out.map((a) => a.key)).toEqual(['A', 'A/2', 'A/2/x']);
  });

  it('ends the chain at the first group the resolver rejects', () => {
    const out = walk(
      [
        { depth: 0, key: 'A' },
        { depth: 1, key: 'collapsed' },
        { depth: 2, key: 'A/1/x' },
      ],
      (g, depth) => (g.key === 'collapsed' ? null : acceptAll(g, depth)),
    );
    // Stops AT the rejected group — does not skip it and continue deeper.
    expect(out.map((a) => a.key)).toEqual(['A']);
  });

  it('does not call the resolver for depths beyond the rejection', () => {
    const seen: string[] = [];
    walk(
      [
        { depth: 0, key: 'A' },
        { depth: 1, key: 'collapsed' },
        { depth: 2, key: 'deep' },
      ],
      (g, depth) => {
        seen.push(g.key);
        return g.key === 'collapsed' ? null : acceptAll(g, depth);
      },
    );
    expect(seen).toEqual(['A', 'collapsed']);
  });
});

// ── SSRM caller ──────────────────────────────────────────────────────────

function ssrmRow(id: string, meta: Partial<SsrmRowMeta> & { kind: SsrmRowMeta['kind'] }) {
  return { id, [SSRM_ROW_META_KEY]: meta };
}

describe('computeSsrmStickyAncestors — SSRM row source', () => {
  const rows: Record<string, unknown> = {
    g0: ssrmRow('g0', { kind: 'group', key: 'desk:EMEA', depth: 0, label: 'EMEA', childCount: 4, expanded: true }),
    g1: ssrmRow('g1', { kind: 'group', key: 'desk:EMEA::region:UK', depth: 1, label: 'UK', childCount: 2, expanded: true }),
    l1: ssrmRow('l1', { kind: 'leaf', key: '', depth: 2, label: '' }),
  };
  const getRowById = (id: string): unknown => rows[id];

  it('reports the ancestor chain above the boundary row', () => {
    const out = computeSsrmStickyAncestors(getRowById, ['g0', 'g1', 'l1'], 2, ['desk', 'region']);
    expect(out).toEqual([
      { depth: 0, key: 'desk:EMEA', colId: 'desk', value: 'EMEA', childCount: 4, isExpanded: true },
      { depth: 1, key: 'desk:EMEA::region:UK', colId: 'region', value: 'UK', childCount: 2, isExpanded: true },
    ]);
  });

  it('ignores leaf rows and unknown ids', () => {
    const out = computeSsrmStickyAncestors(getRowById, ['l1', 'nope', 'g0'], 3, ['desk']);
    expect(out.map((a) => a.key)).toEqual(['desk:EMEA']);
  });

  it('truncates at a collapsed ancestor', () => {
    const collapsed: Record<string, unknown> = {
      ...rows,
      g1: ssrmRow('g1', {
        kind: 'group', key: 'desk:EMEA::region:UK', depth: 1, label: 'UK', expanded: false,
      }),
      g2: ssrmRow('g2', {
        kind: 'group', key: 'desk:EMEA::region:UK::book:B1', depth: 2, label: 'B1', expanded: true,
      }),
    };
    const out = computeSsrmStickyAncestors(
      (id) => collapsed[id], ['g0', 'g1', 'g2'], 3, ['desk', 'region', 'book'],
    );
    expect(out.map((a) => a.key)).toEqual(['desk:EMEA']);
  });

  it('falls back to the colId parsed out of the composite key when rowGroupCols is short', () => {
    const out = computeSsrmStickyAncestors(getRowById, ['g0', 'g1', 'l1'], 2, []);
    expect(out.map((a) => a.colId)).toEqual(['desk', 'region']);
  });

  it('returns nothing when the boundary row is the first row', () => {
    expect(computeSsrmStickyAncestors(getRowById, ['g0', 'g1'], 0, ['desk'])).toEqual([]);
  });

  it('clamps a boundary row past the end of the order', () => {
    const out = computeSsrmStickyAncestors(getRowById, ['g0'], 99, ['desk']);
    expect(out.map((a) => a.key)).toEqual(['desk:EMEA']);
  });
});

// ── CSRM caller, end to end through the worker host ──────────────────────

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

describe('CSRM sticky band — through createWorkerHost', () => {
  /** Two-level group over four rows. The resulting visible order is:
   *    0 EMEA          (group, depth 0)
   *    1   UK          (group, depth 1)
   *    2     r1        (leaf)
   *    3     r2        (leaf)
   *    4   DE          (group, depth 1)
   *    5     r3        (leaf)
   *    6 APAC          (group, depth 0)
   *    7   JP          (group, depth 1)
   *    8     r4        (leaf) */
  async function groupedHost() {
    const outbox: (WorkerResponse | WorkerPush)[] = [];
    const host = createWorkerHost((m) => outbox.push(m));
    host.handle({
      id: 0, type: 'init',
      payload: {
        rowIdField: 'id',
        columns: [
          { colId: 'desk', field: 'desk', type: 'text' },
          { colId: 'region', field: 'region', type: 'text' },
          { colId: 'qty', field: 'qty', type: 'number' },
        ],
      },
    } as WorkerRequest);
    await flush();
    host.handle({
      id: 1, type: 'setRowData',
      payload: {
        rows: [
          { id: 'r1', desk: 'EMEA', region: 'UK', qty: 1 },
          { id: 'r2', desk: 'EMEA', region: 'UK', qty: 2 },
          { id: 'r3', desk: 'EMEA', region: 'DE', qty: 3 },
          { id: 'r4', desk: 'APAC', region: 'JP', qty: 4 },
        ],
        heightsByRowId: undefined,
      },
    } as unknown as WorkerRequest);
    await flush();
    host.handle({
      id: 2, type: 'setGroupModel', payload: { rowGroupCols: ['desk', 'region'] },
    } as unknown as WorkerRequest);
    await flush();
    return { host, outbox };
  }

  async function bandAt(
    host: { handle: (r: WorkerRequest) => void },
    outbox: (WorkerResponse | WorkerPush)[],
    stickyBoundaryRow: number,
  ): Promise<StickyAncestor[]> {
    const id = 100 + stickyBoundaryRow;
    outbox.length = 0;
    host.handle({
      id, type: 'getViewport',
      payload: {
        rowStart: 0, rowEnd: 12, columns: ['desk', 'region', 'qty'], stickyBoundaryRow,
      },
    } as unknown as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => (m as WorkerResponse).id === id) as WorkerResponse;
    expect(reply.type).toBe('viewport');
    return (reply as Extract<WorkerResponse, { type: 'viewport' }>).stickyAncestors ?? [];
  }

  it('is empty at the top of the order', async () => {
    const { host, outbox } = await groupedHost();
    expect(await bandAt(host, outbox, 0)).toEqual([]);
  });

  it('reports the full chain, with display fields resolved from the group meta', async () => {
    const { host, outbox } = await groupedHost();
    expect(await bandAt(host, outbox, 2)).toEqual([
      { depth: 0, key: 'desk:EMEA', colId: 'desk', value: 'EMEA', childCount: 3, isExpanded: true },
      { depth: 1, key: 'desk:EMEA::region:UK', colId: 'region', value: 'UK', childCount: 2, isExpanded: true },
    ]);
  });

  it('replaces a same-depth sibling as the scroll crosses it', async () => {
    const { host, outbox } = await groupedHost();
    // Row 5 sits under DE, not UK.
    expect((await bandAt(host, outbox, 5)).map((a) => a.key))
      .toEqual(['desk:EMEA', 'desk:EMEA::region:DE']);
  });

  it('drops the previous subtree when a new top-level group starts', async () => {
    const { host, outbox } = await groupedHost();
    // Row 7 is the JP group itself; its only ancestor is APAC. EMEA's DE
    // must not survive into APAC's band.
    expect((await bandAt(host, outbox, 7)).map((a) => a.key)).toEqual(['desk:APAC']);
  });

  it('truncates at a collapsed ancestor', async () => {
    const { host, outbox } = await groupedHost();
    host.handle({
      id: 50, type: 'setExpandedKeys', payload: { keys: ['desk:EMEA'] },
    } as unknown as WorkerRequest);
    await flush();
    // Only EMEA is expanded, so UK is collapsed and contributes no visible
    // descendants; the band under it is just EMEA.
    const band = await bandAt(host, outbox, 2);
    expect(band.map((a) => a.key)).toEqual(['desk:EMEA']);
  });
});
