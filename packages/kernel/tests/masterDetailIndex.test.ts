import { describe, it, expect } from 'vitest';
import { MasterDetailIndex, ROW_KIND_DETAIL } from '../src/core/masterDetailIndex';
import { encodeText, decodeText } from '../src/worker/chunkFormat';
import type { ViewportChunk } from '../src/worker/protocol';

/**
 * The display↔base arithmetic under master/detail, and the chunk rewrite that
 * turns a worker reply into what the painter walks.
 *
 * These are the load-bearing pieces: get the mapping wrong by one and rows
 * paint against the wrong data, the scroll extent drifts, and a click lands on
 * the neighbouring row. Everything else in the feature is plumbing on top.
 */

function idx(positions: number[]): MasterDetailIndex {
  const i = new MasterDetailIndex();
  i.setPositions(positions);
  return i;
}

/** Minimal base-space chunk: `n` rows starting at `rowStart`, one numeric and
 *  one text column carrying the row's index so a mis-map is visible. */
function baseChunk(rowStart: number, n: number): ViewportChunk {
  const rowIds = new Uint32Array(n);
  const stringRowIds: string[] = [];
  const texts: string[] = [];
  const nums = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rowIds[i] = 100 + rowStart + i;
    stringRowIds.push(`r${rowStart + i}`);
    texts.push(`t${rowStart + i}`);
    nums[i] = rowStart + i;
  }
  return {
    rowStart,
    rowCount: n,
    rowIds,
    stringRowIds,
    rowKinds: new Uint8Array(n),
    groupDepth: new Uint8Array(n),
    heights: new Float32Array(n).fill(30),
    numericCols: { qty: nums },
    textCols: { name: encodeText(texts) },
  };
}

describe('MasterDetailIndex — mapping', () => {
  it('is the identity while nothing is expanded', () => {
    const i = new MasterDetailIndex();
    expect(i.isEmpty).toBe(true);
    expect(i.count).toBe(0);
    expect(i.displayCount(1000)).toBe(1000);
    expect(i.displayOfBase(437)).toBe(437);
    expect(i.resolve(437)).toEqual({ base: 437, isDetail: false });
    expect(i.mapWindowToBase(10, 20)).toEqual({ rowStart: 10, rowEnd: 20 });
  });

  it('places a detail row directly below its master', () => {
    const i = idx([2]);
    expect(i.displayCount(5)).toBe(6);
    // base:    0 1 2 3 4
    // display: 0 1 2 D 3 4
    expect([0, 1, 2, 3, 4].map((b) => i.displayOfBase(b))).toEqual([0, 1, 2, 4, 5]);
    expect(i.resolve(2)).toEqual({ base: 2, isDetail: false });
    expect(i.resolve(3)).toEqual({ base: 2, isDetail: true });
    expect(i.resolve(4)).toEqual({ base: 3, isDetail: false });
    expect(i.isDetailRow(3)).toBe(true);
    expect(i.isDetailRow(2)).toBe(false);
    expect(i.detailDisplayForBase(2)).toBe(3);
    expect(i.detailDisplayForBase(3)).toBe(-1);
  });

  it('round-trips every display index for several expanded rows', () => {
    const positions = [0, 3, 4, 9];
    const i = idx(positions);
    const baseCount = 12;
    const seen: number[] = [];
    for (let d = 0; d < i.displayCount(baseCount); d++) {
      const ref = i.resolve(d);
      if (ref.isDetail) {
        // A detail row always sits one slot after its master's display slot.
        expect(d).toBe(i.displayOfBase(ref.base) + 1);
        expect(positions).toContain(ref.base);
        continue;
      }
      // Every non-detail slot maps back to exactly its own display index,
      // and the base indices come out in order with no gaps or repeats.
      expect(i.displayOfBase(ref.base)).toBe(d);
      seen.push(ref.base);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('widens a display window to the base window covering it', () => {
    const i = idx([2, 6]);
    // display: 0 1 2 D 3 4 5 6 D 7 …
    // A window opening ON a detail row still has to fetch its master.
    expect(i.mapWindowToBase(3, 6)).toEqual({ rowStart: 2, rowEnd: 5 });
    expect(i.mapWindowToBase(0, 4)).toEqual({ rowStart: 0, rowEnd: 3 });
    // Empty window stays empty rather than fetching a stray row.
    expect(i.mapWindowToBase(5, 5)).toEqual({ rowStart: 4, rowEnd: 4 });
  });

  it('drops unresolved masters and reports whether the set moved', () => {
    const i = new MasterDetailIndex();
    // -1 = master filtered out or hidden in a collapsed group.
    expect(i.setPositions([5, -1, 2, 2])).toBe(true);
    expect(i.expandedBaseIndices).toEqual([2, 5]);
    // Same set, different order in ⇒ no change out, so the caller can skip
    // a reflow.
    expect(i.setPositions([5, 2])).toBe(false);
    expect(i.setPositions([5])).toBe(true);
  });
});

describe('MasterDetailIndex — chunk rewrite', () => {
  it('leaves the chunk alone when nothing is expanded', () => {
    const i = new MasterDetailIndex();
    const chunk = baseChunk(0, 4);
    expect(i.expandChunk(chunk, 300)).toBe(chunk);
  });

  it('shifts rowStart for a window with no expanded row inside it', () => {
    const i = idx([1]);
    const out = i.expandChunk(baseChunk(5, 3), 300);
    // base 5 sits at display 6 once row 1's band is above it.
    expect(out.rowStart).toBe(6);
    expect(out.rowCount).toBe(3);
  });

  it('splices a blank, self-sized detail slot after each master', () => {
    const i = idx([1, 3]);
    const out = i.expandChunk(baseChunk(0, 5), 240);
    expect(out.rowStart).toBe(0);
    expect(out.rowCount).toBe(7);
    expect(Array.from(out.rowKinds)).toEqual([
      0, 0, ROW_KIND_DETAIL, 0, 0, ROW_KIND_DETAIL, 0,
    ]);
    expect(Array.from(out.heights)).toEqual([30, 30, 240, 30, 30, 240, 30]);
    // The band carries its master's id so the host knows what to mount, but
    // no numeric id — it is not a row.
    expect(out.stringRowIds).toEqual(['r0', 'r1', 'r1', 'r2', 'r3', 'r3', 'r4']);
    expect(Array.from(out.rowIds)).toEqual([100, 101, 0, 102, 103, 0, 104]);
  });

  it('keeps every column value on its own row', () => {
    const i = idx([1, 3]);
    const out = i.expandChunk(baseChunk(0, 5), 240);
    expect(Array.from(out.numericCols.qty!)).toEqual([0, 1, 0, 2, 3, 0, 4]);
    const names = decodeText(out.textCols.name!.offsets, out.textCols.name!.bytes);
    expect(names).toEqual(['t0', 't1', '', 't2', 't3', '', 't4']);
  });

  it('carries a flash mask onto the shifted rows and never onto a band', () => {
    const i = idx([0]);
    const chunk = baseChunk(0, 3);
    // Two columns, row-major bits. Flash (row 1, col 0) and (row 2, col 1).
    const colCount = 2;
    const mask = new Uint8Array(Math.ceil((3 * colCount) / 8));
    const set = (r: number, c: number) => {
      const bit = r * colCount + c;
      mask[bit >>> 3]! |= 1 << (bit & 7);
    };
    set(1, 0);
    set(2, 1);
    chunk.flashMask = mask;
    const out = i.expandChunk(chunk, 200);
    // display: 0(master) D 1 2  →  the flashes move down one slot.
    const outMask = out.flashMask!;
    const isSet = (r: number, c: number) => {
      const bit = r * colCount + c;
      return ((outMask[bit >>> 3] ?? 0) & (1 << (bit & 7))) !== 0;
    };
    expect(isSet(2, 0)).toBe(true);
    expect(isSet(3, 1)).toBe(true);
    expect(isSet(1, 0)).toBe(false);
    expect(isSet(1, 1)).toBe(false);
  });

  it('remaps touched rows and keeps "checked, nothing here" distinguishable', () => {
    const i = idx([1]);
    const chunk = baseChunk(0, 4);
    chunk.touchedRows = Uint32Array.from([0, 2]);
    const out = i.expandChunk(chunk, 200);
    // display: 0 1 D 2 3 — base 2 moved to slot 3.
    expect(Array.from(out.touchedRows!)).toEqual([0, 3]);

    const empty = baseChunk(0, 4);
    empty.touchedRows = new Uint32Array(0);
    const outEmpty = i.expandChunk(empty, 200);
    // An empty array must stay an array: `undefined` means "unknown, repaint
    // everything", which is a different thing entirely.
    expect(outEmpty.touchedRows).toBeDefined();
    expect(outEmpty.touchedRows!.length).toBe(0);
  });

  it('preserves group / footer rows sharing the window', () => {
    const i = idx([2]);
    const chunk = baseChunk(0, 4);
    chunk.rowKinds = Uint8Array.from([1, 0, 0, 3]);
    chunk.groupDepth = Uint8Array.from([0, 1, 1, 1]);
    chunk.groupKey = ['desk:FX', '', '', 'desk:FX'];
    chunk.groupValue = ['FX', '', '', 'FX'];
    const out = i.expandChunk(chunk, 200);
    expect(Array.from(out.rowKinds)).toEqual([1, 0, 0, ROW_KIND_DETAIL, 3]);
    expect(Array.from(out.groupDepth)).toEqual([0, 1, 1, 0, 1]);
    expect(out.groupKey).toEqual(['desk:FX', '', '', '', 'desk:FX']);
    expect(out.groupValue).toEqual(['FX', '', '', '', 'FX']);
  });
});
