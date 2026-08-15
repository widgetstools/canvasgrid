import { describe, expect, it } from 'vitest';
import { LivePipeline, composeRowId } from '../src/hub/rowCache';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('composeRowId', () => {
  describe('single key', () => {
    it('returns null for undefined key', () => {
      const id = composeRowId({ a: 'value' }, undefined);
      expect(id).toBeNull();
    });

    it('returns string value for present key', () => {
      const id = composeRowId({ a: 'value' }, 'a');
      expect(id).toBe('value');
    });

    it('returns null for missing key', () => {
      const id = composeRowId({ b: 'value' }, 'a');
      expect(id).toBeNull();
    });
  });

  describe('composite key', () => {
    it('returns null if any part is nullish (C-m2)', () => {
      const id = composeRowId({ a: 'A', b: undefined }, ['a', 'b']);
      expect(id).toBeNull();
    });

    it('returns null if first part missing', () => {
      const id = composeRowId({ b: 'B' }, ['a', 'b']);
      expect(id).toBeNull();
    });

    it('returns null if second part missing', () => {
      const id = composeRowId({ a: 'A' }, ['a', 'b']);
      expect(id).toBeNull();
    });

    it('produces distinct ids for ambiguous splits (C-m2)', () => {
      // With '-' join and default fill: both produce 'A-B-C'
      // With unit-separator join and null check: should differ
      const id1 = composeRowId({ a: 'A-B', b: 'C' }, ['a', 'b']);
      const id2 = composeRowId({ a: 'A', b: 'B-C' }, ['a', 'b']);
      expect(id1).not.toBe(id2);
    });

    it('produces distinct ids for space-containing values that would collide on a space join (MINOR 4)', () => {
      // A literal-space join would collapse both of these to 'New York X'.
      const id1 = composeRowId({ a: 'New York', b: 'X' }, ['a', 'b']);
      const id2 = composeRowId({ a: 'New', b: 'York X' }, ['a', 'b']);
      expect(id1).not.toBe(id2);
      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
    });

    it('joins multiple parts with the ASCII unit separator', () => {
      const id = composeRowId({ a: 'A', b: 'B', c: 'C' }, ['a', 'b', 'c']);
      expect(id).toBe(['A', 'B', 'C'].join('\u001F'));
    });

    it('returns null for empty key array', () => {
      const id = composeRowId({ a: 'A', b: 'B' }, []);
      expect(id).toBeNull();
    });
  });
});

describe('LivePipeline', () => {
  describe('conflation', () => {
    it('merges partial ticks in one throttle window (C-M4)', async () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: true,
          throttleMs: 50,
          conflateEnabled: true,
          keyColumn: 'id',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      // Push two partial ticks for same id in one window
      pipeline.push([{ id: 'r1', px: 2 }]);
      pipeline.push([{ id: 'r1', qty: 5 }]);

      // Wait for throttle to flush
      await sleep(70);

      // Should have one flush with one row containing BOTH px AND qty
      expect(flushed.length).toBe(1);
      expect(flushed[0]!.length).toBe(1);
      const row = flushed[0]![0]!;
      expect(row).toHaveProperty('id', 'r1');
      expect(row).toHaveProperty('px', 2);
      expect(row).toHaveProperty('qty', 5);

      pipeline.destroy();
    });

    it('conflates by custom key', async () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: true,
          throttleMs: 50,
          conflateEnabled: true,
          conflateByKey: 'positionId',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      pipeline.push([{ positionId: 'pos1', price: 100 }]);
      pipeline.push([{ positionId: 'pos1', qty: 500 }]);

      await sleep(70);

      expect(flushed.length).toBe(1);
      expect(flushed[0]!.length).toBe(1);
      const row = flushed[0]![0]!;
      expect(row).toHaveProperty('price', 100);
      expect(row).toHaveProperty('qty', 500);

      pipeline.destroy();
    });

    it('preserves existing fields when conflating', async () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: true,
          throttleMs: 50,
          conflateEnabled: true,
          keyColumn: 'id',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      // First tick with multiple fields
      pipeline.push([{ id: 'r1', a: 1, b: 2, c: 3 }]);
      // Second tick updates only 'b'
      pipeline.push([{ id: 'r1', b: 20 }]);

      await sleep(70);

      expect(flushed.length).toBe(1);
      const row = flushed[0]![0]!;
      expect(row).toEqual({ id: 'r1', a: 1, b: 20, c: 3 });

      pipeline.destroy();
    });

    it('does not conflate when conflateEnabled is false', async () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: true,
          throttleMs: 50,
          conflateEnabled: false,
          keyColumn: 'id',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      pipeline.push([{ id: 'r1', px: 2 }]);
      pipeline.push([{ id: 'r1', qty: 5 }]);

      await sleep(70);

      // Should have both rows, not merged
      expect(flushed.length).toBe(1);
      expect(flushed[0]!.length).toBe(2);

      pipeline.destroy();
    });
  });

  describe('throttling', () => {
    it('batches multiple pushes within throttle window', async () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: true,
          throttleMs: 50,
          conflateEnabled: false,
          keyColumn: 'id',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      pipeline.push([{ id: 'r1' }]);
      pipeline.push([{ id: 'r2' }]);
      pipeline.push([{ id: 'r3' }]);

      await sleep(70);

      // All should be batched into one flush
      expect(flushed.length).toBe(1);
      expect(flushed[0]!.length).toBe(3);

      pipeline.destroy();
    });

    it('flushes immediately when throttleEnabled is false', () => {
      let flushed: Record<string, unknown>[][] = [];
      const pipeline = new LivePipeline(
        {
          throttleEnabled: false,
          conflateEnabled: false,
          keyColumn: 'id',
        },
        (rows) => {
          flushed.push(rows);
        }
      );

      pipeline.push([{ id: 'r1' }]);
      pipeline.push([{ id: 'r2' }]);

      // Should flush immediately, not wait for timer
      expect(flushed.length).toBe(2);

      pipeline.destroy();
    });
  });
});
