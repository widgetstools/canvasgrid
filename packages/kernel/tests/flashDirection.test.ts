/**
 * 2026-08 look-and-feel — directional cell flash.
 *
 * One amber pair used to paint a rise and a fall alike, in every theme. On
 * a blotter the direction of a change is the single most-read signal and
 * the paint did not carry it. The worker's transaction diff already knew
 * both values, so the sign is captured there and travels to the painter:
 *
 *   stageFlashesForUpdates  →  state.pendingFlashDirs
 *   ViewportSlicer.slice    →  chunk.flashDir (one byte per cell: 0/1/2)
 *   serializeChunk          →  FLAG_FLASH_DIR section
 *   FlashRegistry.ingestMask→  per-entry `color` override
 *
 * Every stage falls back to the previous behaviour when the direction is
 * absent, so a text-only feed, a `flashCells` call, and a theme that
 * declares no `--vg-flash-up-*` are all byte-identical to before.
 */
import { describe, it, expect, vi } from 'vitest';
import { RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import { serializeChunk, deserializeChunk } from '../src/worker/chunkFormat';
import { FlashRegistry } from '../src/core/flashRegistry';
import type { WorkerColumn, ViewportRequest } from '../src/worker/protocol';

interface Row { id: string; price: number; ticker: string }

const COLS: WorkerColumn[] = [
  { colId: 'price', field: 'price', type: 'number' },
  { colId: 'ticker', field: 'ticker', type: 'text' },
];

function setup(): { slicer: ViewportSlicer<Row>; req: ViewportRequest } {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: 'a', price: 100, ticker: 'AAPL' },
    { id: 'b', price: 200, ticker: 'MSFT' },
    { id: 'c', price: 300, ticker: 'GOOG' },
  ]);
  return {
    slicer: new ViewportSlicer<Row>(store, COLS),
    req: { rowStart: 0, rowEnd: 3, columns: ['price', 'ticker'], includeFlashMask: true },
  };
}

/** Bit / byte index for (row, col) in flashMask + flashDir order. */
const idx = (row: number, col: number): number => row * 2 + col;

describe('ViewportSlicer — flashDir packing', () => {
  it('omits flashDir entirely when no directions are staged', () => {
    const { slicer, req } = setup();
    const pending = new Map([['a', new Set(['price'])]]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending);
    expect(chunk.flashMask).toBeDefined();
    // A feed with no numeric change ships exactly what it always shipped.
    expect(chunk.flashDir).toBeUndefined();
  });

  it('omits flashDir when the direction map is supplied but empty', () => {
    const { slicer, req } = setup();
    const pending = new Map([['a', new Set(['price'])]]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending, undefined, new Map());
    expect(chunk.flashDir).toBeUndefined();
  });

  it('packs 1 for a rise and 2 for a fall, 0 for a change with no direction', () => {
    const { slicer, req } = setup();
    const pending = new Map([
      ['a', new Set(['price'])],            // rose
      ['b', new Set(['price'])],            // fell
      ['c', new Set(['ticker'])],           // text — no direction
    ]);
    const dirs = new Map<string, Map<string, 1 | 2>>([
      ['a', new Map([['price', 1]])],
      ['b', new Map([['price', 2]])],
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending, undefined, dirs);

    expect(chunk.flashDir).toBeDefined();
    const d = chunk.flashDir!;
    expect(d.length).toBe(6); // 3 rows × 2 cols, one byte each
    expect(d[idx(0, 0)]).toBe(1); // a.price rose
    expect(d[idx(1, 0)]).toBe(2); // b.price fell
    expect(d[idx(2, 1)]).toBe(0); // c.ticker changed, but not numerically
    // Cells that are not flashing carry no direction either.
    expect(d[idx(0, 1)]).toBe(0);
    expect(d[idx(2, 0)]).toBe(0);
  });

  it('never marks a direction on a cell the flashMask did not set', () => {
    const { slicer, req } = setup();
    const pending = new Map([['a', new Set(['price'])]]);
    // A stale direction for a field that is not flashing this tick.
    const dirs = new Map<string, Map<string, 1 | 2>>([
      ['a', new Map([['price', 1], ['ticker', 2]])],
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending, undefined, dirs);
    expect(chunk.flashDir![idx(0, 0)]).toBe(1);
    expect(chunk.flashDir![idx(0, 1)]).toBe(0);
  });
});

describe('chunkFormat — flashDir round-trip', () => {
  it('survives serialize → deserialize byte for byte', () => {
    const { slicer, req } = setup();
    const pending = new Map([['a', new Set(['price'])], ['b', new Set(['price'])]]);
    const dirs = new Map<string, Map<string, 1 | 2>>([
      ['a', new Map([['price', 1]])],
      ['b', new Map([['price', 2]])],
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending, undefined, dirs);
    const round = deserializeChunk(serializeChunk(chunk));
    expect(round.flashDir).toBeDefined();
    expect([...round.flashDir!]).toEqual([...chunk.flashDir!]);
    expect([...round.flashMask!]).toEqual([...chunk.flashMask!]);
  });

  it('leaves flashDir absent on the wire when the chunk has none', () => {
    const { slicer, req } = setup();
    const pending = new Map([['a', new Set(['price'])]]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending);
    const round = deserializeChunk(serializeChunk(chunk));
    expect(round.flashDir).toBeUndefined();
    expect(round.flashMask).toBeDefined();
  });
});

describe('FlashRegistry — direction selects the colour', () => {
  const deps = () => ({
    getEnabled: () => true,
    getFlashDuration: () => 500,
    getFadeDuration: () => 500,
    getReducedMotion: () => false,
    requestRepaint: () => {},
  });

  /** mask with every (row,col) bit set, for `rows` rows × 2 cols */
  const fullMask = (rows: number): Uint8Array => {
    const bits = rows * 2;
    const m = new Uint8Array((bits + 7) >>> 3);
    for (let i = 0; i < bits; i++) m[i >>> 3]! |= 1 << (i & 7);
    return m;
  };

  it('paints a rise green, a fall red and an undirected change neutral', () => {
    const reg = new FlashRegistry(deps());
    const spy = vi.spyOn(reg, 'flash');
    reg.ingestMask({
      rowIds: [1, 2, 3],
      colIds: ['price', 'ticker'],
      mask: fullMask(3),
      dir: new Uint8Array([1, 0, 2, 0, 0, 0]),
      upColor: 'rgb(63 162 102 / 26%)',
      downColor: 'rgb(229 81 122 / 26%)',
      now: 0,
    });
    const byCell = new Map<string, unknown>();
    for (const call of spy.mock.calls) {
      byCell.set(`${call[0]}:${call[1]}`, (call[3] as { color?: string } | undefined)?.color);
    }
    expect(byCell.get('1:price')).toBe('rgb(63 162 102 / 26%)');
    expect(byCell.get('2:price')).toBe('rgb(229 81 122 / 26%)');
    // Direction 0 means "no direction known" — keep the theme's neutral.
    expect(byCell.get('1:ticker')).toBeUndefined();
    expect(byCell.get('3:price')).toBeUndefined();
  });

  it('stages nothing extra when the theme declares no directional colours', () => {
    const reg = new FlashRegistry(deps());
    const spy = vi.spyOn(reg, 'flash');
    reg.ingestMask({
      rowIds: [1],
      colIds: ['price', 'ticker'],
      mask: fullMask(1),
      dir: new Uint8Array([1, 2]),
      now: 0,
    });
    for (const call of spy.mock.calls) expect(call[3]).toBeUndefined();
  });

  it('lets an explicit per-call colour override win over the direction', () => {
    const reg = new FlashRegistry(deps());
    const spy = vi.spyOn(reg, 'flash');
    reg.ingestMask({
      rowIds: [1],
      colIds: ['price', 'ticker'],
      mask: fullMask(1),
      stringRowIds: ['a'],
      getOverride: (sid, colId) =>
        sid === 'a' && colId === 'price' ? { color: '#ff00ff' } : undefined,
      dir: new Uint8Array([1, 2]),
      upColor: 'rgb(63 162 102 / 26%)',
      downColor: 'rgb(229 81 122 / 26%)',
      now: 0,
    });
    const price = spy.mock.calls.find((c) => c[1] === 'price');
    const ticker = spy.mock.calls.find((c) => c[1] === 'ticker');
    // flashCells asked for magenta; the direction does not get to argue.
    expect((price?.[3] as { color?: string } | undefined)?.color).toBe('#ff00ff');
    // The undirected sibling still takes its direction colour.
    expect((ticker?.[3] as { color?: string } | undefined)?.color).toBe('rgb(229 81 122 / 26%)');
  });
});

/**
 * Making it optional.
 *
 * The tones are a theme decision, so a theme that declares no
 * `--vg-flash-up-*` already flashes one colour (covered above). What had no
 * answer was a desk on a theme that DOES declare them and does not want the
 * grid painted red and green — the only lever was editing the theme.
 *
 * `cellFlashDirectional` is that lever, and it is runtime-mutable so the
 * customizer's Grid Options tab can drive it. `VelocityGrid` withholds `dir`
 * and both colours when it is off, which is the same input shape a
 * non-directional theme produces — so the registry needs no branch of its
 * own, and this asserts the shape rather than duplicating its behaviour.
 */
describe('cellFlashDirectional', () => {
  const deps = () => ({
    getEnabled: () => true,
    getFlashDuration: () => 500,
    getFadeDuration: () => 1000,
    getReducedMotion: () => false,
    requestRepaint: () => {},
  });
  const fullMask = (rows: number): Uint8Array => {
    const bits = rows * 2;
    const bytes = new Uint8Array(Math.ceil(bits / 8));
    for (let i = 0; i < bits; i++) bytes[i >>> 3]! |= 1 << (i & 7);
    return bytes;
  };

  it('withholding dir + colours is what "off" looks like to the registry', () => {
    const reg = new FlashRegistry(deps() as never);
    const spy = vi.spyOn(reg, 'flash');
    // Exactly what the grid passes with the option off: the chunk still
    // carries directions, they are simply not forwarded.
    reg.ingestMask({
      rowIds: [1],
      colIds: ['price', 'ticker'],
      mask: fullMask(1),
      dir: undefined,
      upColor: undefined,
      downColor: undefined,
      now: 0,
    });
    expect(spy.mock.calls.length).toBe(2);
    for (const call of spy.mock.calls) expect(call[3]).toBeUndefined();
  });

  it('reaches the customizer: a switch in the Change flash band, default on', async () => {
    // Built through the same entry point the customizer uses — an option
    // absent from this section is an option the user cannot reach.
    const { buildGridOptionsSchema } = await import('../src/core/optionSchema');
    const section = buildGridOptionsSchema({
      getGridOption: () => undefined,
      setGridOption: () => {},
    });
    const band = section.bands.find((b) => b.id === 'changeFlash');
    const field = band?.fields.find((f) => f.key === 'cellFlashDirectional');
    expect(field).toBeDefined();
    expect(field?.type).toBe('switch');
    // Default ON — turning it off is the deliberate act, so an existing grid
    // looks exactly as it did.
    expect(field?.defaultValue).toBe(true);
  });

  it('is runtime-mutable, so the switch applies without a remount', async () => {
    const { RUNTIME_OPTION_SET } = await import('../src/core/runtimeOptions');
    expect(RUNTIME_OPTION_SET.has('cellFlashDirectional' as never)).toBe(true);
  });
});
