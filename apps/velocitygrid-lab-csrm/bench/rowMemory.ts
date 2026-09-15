/**
 * Retained-heap cost of each copy the CSRM path makes.
 *
 * One representation per PROCESS. Measuring several in one process reports
 * fragmentation and whatever the previous representation failed to release,
 * not the thing under test.
 *
 * Run one mode per process — `--expose-gc` is required:
 *
 *   node --expose-gc --import tsx apps/velocitygrid-lab-csrm/bench/rowMemory.ts <mode> <rows>
 *
 * Modes: wire | rowCache | clone | cloneAndMirror | stampedClone | columnar |
 * wireSize. Findings are written up in `docs/csrm-memory-topology.md`.
 *
 * Method: baseline the settled heap before allocating anything, build the
 * representation, drop every other reference, settle again, subtract.
 * `global.gc()` runs repeatedly because one pass does not always finish a
 * large young-generation evacuation, and a half-collected heap reads as
 * retained bytes.
 */
import { makeRows, type BlotterRow } from '../src/data/domain';
import { RowCache } from '../../../packages/data/src/hub/rowCache';
import v8 from 'node:v8';

declare const global: { gc?: () => void };

/**
 * Settled retained bytes.
 *
 * `heapUsed` ALONE IS WRONG for any representation holding typed arrays: a
 * TypedArray's backing store is allocated outside the V8 heap and reported
 * separately as `arrayBuffers`. Measuring only `heapUsed` therefore counts a
 * columnar store's dictionary strings while silently ignoring every
 * Float64Array of actual data — which understated the columnar mode by
 * roughly an order of magnitude and flattered it against the row-object
 * modes, which have no external memory at all.
 */
function settle(): number {
  for (let i = 0; i < 8; i++) global.gc?.();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

const mode = process.argv[2];
const N = Number(process.argv[3]);
/** Total columns per row. The lab's blotter is 56; production is ~300, and
 *  V8's per-object cost is not linear in field count (a wide enough object
 *  leaves fast properties for dictionary mode), so this is measured, never
 *  extrapolated. */
const COLS = Number(process.argv[4] ?? 56);

/**
 * Widen the real blotter row to `COLS` fields.
 *
 * Added fields are numeric because that is what a wide risk blotter is made
 * of — key-rate durations per tenor, scenario P&L per shock, per-venue prices.
 * The 20 string fields of the base row are kept as-is, so a 300-column row is
 * 20 strings + 280 numbers, which matches the shape of the real thing more
 * closely than padding with strings would.
 */
function widen(rows: BlotterRow[], cols: number): BlotterRow[] {
  const base = Object.keys(rows[0] as unknown as Record<string, unknown>).length;
  if (cols <= base) return rows;
  const extra = cols - base;
  // Built from a single entry list rather than by adding properties in a
  // loop. Incremental addition pushes a wide object into V8's dictionary
  // mode with a heavily over-allocated backing store, which is an artefact of
  // the fixture and not of the data — it made each tier measure whatever mode
  // its own construction path happened to produce, with a 3x spread between
  // them and copies reading cheaper than the original.
  const names = Array.from({ length: extra }, (_, k) => `analytic${k}`);
  return rows.map((r, i) => Object.fromEntries([
    ...Object.entries(r as unknown as Record<string, unknown>),
    ...names.map((n, k) => [n, (i % 997) + k * 0.25] as const),
  ]) as unknown as BlotterRow);
}

const base = settle();

let source: BlotterRow[] | null = widen(makeRows(N), COLS);
/** Kept alive across the final measurement. */
let held: unknown = null;
/** Cheap liveness probe — reads a value without allocating a big string. */
let probe = 0;

switch (mode) {
  case 'wire': {
    held = source;
    probe = (source[N - 1] as BlotterRow).dv01;
    break;
  }
  case 'json': {
    // What a JSON transport actually delivers. The generator builds wide rows
    // by adding properties in a loop, which leaves V8 in dictionary mode with
    // a heavily over-allocated backing store — an artefact of HOW the fixture
    // is built, not of the data. `JSON.parse` produces the compact object a
    // real STOMP/WebSocket feed produces, so this, not `wire`, is the honest
    // baseline for a wide row.
    const rows = JSON.parse(JSON.stringify(source)) as BlotterRow[];
    held = rows;
    probe = rows.length;
    break;
  }
  case 'rowCache': {
    // Copy 1 — the data worker's hub cache. `upsert` does `{...row}`, so what
    // it holds is its own objects, not the wire's.
    const cache = new RowCache();
    cache.setKeyColumn('id');
    cache.upsert(source);
    held = cache;
    probe = cache.size;
    break;
  }
  case 'clone': {
    // Copy 2 — what postMessage delivers to the main thread.
    const rows = structuredClone(source) as BlotterRow[];
    held = rows;
    probe = rows[N - 1]!.dv01;
    break;
  }
  case 'cloneAndMirror': {
    // Copy 2 as actually retained: the cloned rows PLUS `rowDataById`, the
    // main-thread index of pointers into them.
    const rows = structuredClone(source) as BlotterRow[];
    const byId = new Map<string, BlotterRow>();
    for (const r of rows) byId.set(r.id, r);
    held = [rows, byId];
    probe = byId.size;
    break;
  }
  case 'stampedClone': {
    // What the main thread retains when the app supplies no `getRowId`:
    // `stampSyntheticRowIds` spreads every row to add the synthetic field.
    const rows = structuredClone(source) as BlotterRow[];
    const stamped = rows.map((r) => ({ ...r, __vgRowId: r.id }));
    const byId = new Map<string, unknown>();
    for (const r of stamped) byId.set(r.__vgRowId, r);
    held = [stamped, byId];
    probe = byId.size;
    break;
  }
  case 'columnar': {
    // What a wasm-owned store would hold: one typed array per numeric column,
    // dictionary-encoded codes per string column. High-cardinality strings
    // (id, cusip, isin) get nothing from dictionary encoding and are not
    // pretended to — they land one entry per row.
    //
    // This OVERSTATES the wasm case: a V8 string object carries a header and
    // a pointer that UTF-8 bytes in linear memory would not. Read it as an
    // upper bound.
    const first = source[0] as unknown as Record<string, unknown>;
    const cols: Record<string, unknown> = {};
    for (const k of Object.keys(first)) {
      if (typeof first[k] === 'number') {
        const arr = new Float64Array(N);
        for (let i = 0; i < N; i++) arr[i] = (source[i] as any)[k];
        cols[k] = arr;
      } else {
        const dict: string[] = [];
        const ix = new Map<string, number>();
        const codes = new Uint32Array(N);
        for (let i = 0; i < N; i++) {
          const s = (source[i] as any)[k] as string;
          let c = ix.get(s);
          if (c === undefined) { c = dict.length; dict.push(s); ix.set(s, c); }
          codes[i] = c;
        }
        // The build-time index is not part of the stored column.
        cols[k] = { codes, dict };
      }
    }
    held = cols;
    probe = Object.keys(cols).length;
    break;
  }
  case 'wireSize': {
    // Structured-clone wire bytes — what actually crosses each postMessage.
    // Its own mode because serializing allocates a buffer far larger than
    // anything being measured, and a transient that big distorts a retained
    // reading taken in the same process.
    const buf = v8.serialize(source);
    console.log(JSON.stringify({ mode, N, cols: COLS, wireBytes: buf.length }));
    process.exit(0);
  }
  default:
    throw new Error(`unknown mode: ${mode}`);
}

// Release the generator's output unless the mode under test IS that array.
if (mode !== 'wire') source = null;

const after = settle();
if (probe === 0 || held === null) throw new Error('representation was elided');

console.log(JSON.stringify({
  mode, N, cols: COLS,
  retainedBytes: after - base,
  bytesPerRow: Math.round((after - base) / N),
}));
