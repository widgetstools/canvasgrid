import { describe, expect, it, vi } from 'vitest';
import { LivePipeline } from '../src/hub/rowCache';
import { rowsToColumnar, columnarToRows } from '../src/pipeline/wireFormat';
import { thinDelta, projectRow } from '../src/pipeline/project';

describe('LivePipeline', () => {
  it('conflates by key within a throttle window', async () => {
    vi.useFakeTimers();
    const flushed: Record<string, unknown>[][] = [];
    const pipe = new LivePipeline(
      { throttleEnabled: true, throttleMs: 50, conflateEnabled: true, conflateByKey: 'id' },
      (rows) => { flushed.push(rows); },
    );
    pipe.push([{ id: 'a', v: 1 }, { id: 'a', v: 2 }, { id: 'b', v: 1 }]);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }]);
    pipe.destroy();
    vi.useRealTimers();
  });
});

describe('wireFormat + project', () => {
  it('round-trips columnar', () => {
    const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
    expect(columnarToRows(rowsToColumnar(rows))).toEqual(rows);
  });

  it('projects and thins deltas', () => {
    expect(projectRow({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    expect(thinDelta({ id: '1', a: 1, b: 2 }, { id: '1', a: 1, b: 9 }, ['id'])).toEqual({ id: '1', b: 9 });
  });
});
