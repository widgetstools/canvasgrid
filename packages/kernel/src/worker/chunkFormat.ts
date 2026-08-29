/**
 * Cycle 4 — packed text encoding helpers (`encodeText` / `decodeText`).
 * Cycle 15 / Task 3 — binary serializer for `ViewportChunk` (append-only
 * versioned format: v1 = pre-Task-3, v2 = adds groupValue / groupChildCount /
 * isExpanded). The format is consumed by the cgrid fixture round-trip
 * tests (an ungrouped chunk captured from Cycle 4 era round-trips
 * losslessly through the v2 reader, with the new fields filled to
 * defaults). It is NOT used on the postMessage hot path — chunks ride
 * through structured-clone there. The serializer exists so we can
 * exercise the additive guarantees of the chunk format under unit-test
 * conditions.
 *
 * Binary layout (little-endian throughout):
 *
 *   magic[4]          = "CGCK"
 *   version           = u8 (1 | 2)
 *   reserved[3]       = 0
 *   rowStart          = u32
 *   rowCount          = u32
 *   flags             = u8
 *                       bit 0 = hasFlashMask
 *                       bit 1 = hasTotals
 *                       (v2-only:)
 *                       bit 2 = hasGroupValue
 *                       bit 3 = hasGroupChildCount
 *                       bit 4 = hasIsExpanded
 *   numericColCount   = u16
 *   textColCount      = u16
 *
 *   rowIds            : Uint32Array (rowCount × 4 bytes)
 *   rowKinds          : Uint8Array  (rowCount bytes)
 *   groupDepth        : Uint8Array  (rowCount bytes)
 *   heights           : Float32Array (rowCount × 4 bytes)
 *
 *   numericCols × numericColCount:
 *     colIdLen        = u16
 *     colId           = utf-8 bytes
 *     values          = Float64Array (rowCount × 8 bytes)
 *
 *   textCols × textColCount:
 *     colIdLen        = u16
 *     colId           = utf-8 bytes
 *     offsetsLen      = u32  (Uint32 element count)
 *     offsets         = Uint32Array (offsetsLen × 4 bytes)
 *     bytesLen        = u32
 *     bytes           = Uint8Array (bytesLen)
 *
 *   flashMask (if flag set):
 *     len             = u32
 *     bytes           = Uint8Array (len)
 *
 *   flashDir (if flag set — implies FLAG_FLASH_MASK):
 *     len             = u32
 *     bytes           = Uint8Array (len)   one byte per cell: 0 / 1 up / 2 down
 *
 *   totals (if flag set):
 *     jsonLen         = u32
 *     json            = utf-8 bytes (JSON.stringify(totals))
 *
 *   groupValue (if flag set, v2-only):
 *     packed offsets+bytes per `encodeText`:
 *     offsetsLen      = u32
 *     offsets         = Uint32Array (offsetsLen × 4)
 *     bytesLen        = u32
 *     bytes           = Uint8Array (bytesLen)
 *
 *   groupChildCount (if flag set, v2-only):
 *     values          = Uint32Array (rowCount × 4 bytes)
 *
 *   isExpanded (if flag set, v2-only):
 *     values          = Uint8Array (rowCount bytes)
 */

import type { ViewportChunk, ChunkFormatVersion } from './protocol';
import { CHUNK_FORMAT_VERSION } from './protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MAGIC = new Uint8Array([0x43, 0x47, 0x43, 0x4b]); // "CGCK"

const FLAG_FLASH_MASK       = 1 << 0;
const FLAG_TOTALS           = 1 << 1;
const FLAG_GROUP_VALUE      = 1 << 2;
const FLAG_GROUP_CHILD_CNT  = 1 << 3;
const FLAG_IS_EXPANDED      = 1 << 4;
const FLAG_FLASH_DIR        = 1 << 5;

export function encodeText(strings: string[]): { offsets: Uint32Array; bytes: Uint8Array } {
  const encoded = strings.map((s) => encoder.encode(s ?? ''));
  let total = 0;
  for (const e of encoded) total += e.byteLength;
  const offsets = new Uint32Array(strings.length + 1);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < encoded.length; i++) {
    offsets[i] = pos;
    bytes.set(encoded[i]!, pos);
    pos += encoded[i]!.byteLength;
  }
  offsets[strings.length] = pos;
  return { offsets, bytes };
}

export function decodeText(offsets: Uint32Array, bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < offsets.length - 1; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    out.push(decoder.decode(bytes.subarray(start, end)));
  }
  return out;
}

// ───── Cycle 25 / Task 2 — dictionary-coded text columns ────────────
//
// Low-cardinality columns (region, currency, status) save huge memory
// when stored as `{ dict, indices }` instead of the inline
// `{ offsets, bytes }` shape: 10,000 region cells × 4 distinct values
// compresses from ~50 KB to a 4-entry dict + 10,000 × 1 byte. The
// helpers below are the pure encode/decode used both by the slicer
// (when chunkFormat is rewired to emit dict-coded columns) and by
// the dict-aware text encoder benches.

export type DictIndices = Uint8Array | Uint16Array | Uint32Array;

export interface DictText {
  dict: string[];
  indices: DictIndices;
}

function pickIndicesArray(length: number, dictSize: number): DictIndices {
  if (dictSize <= 256)   return new Uint8Array(length);
  if (dictSize <= 65536) return new Uint16Array(length);
  return new Uint32Array(length);
}

export function encodeTextDict(strings: ReadonlyArray<string | null | undefined>): DictText {
  if (strings.length === 0) return { dict: [], indices: new Uint8Array(0) };
  const dictIndex = new Map<string, number>();
  const dict: string[] = [];
  // Two-pass: walk once to build the dictionary so we can pick the
  // narrowest indices array on the way through. One walk is enough —
  // we don't need to know the dict size up front; we re-resize only
  // when the dict crosses 256 / 65536 (rare).
  const temp = new Uint32Array(strings.length);
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i] ?? '';
    let idx = dictIndex.get(s);
    if (idx === undefined) {
      idx = dict.length;
      dict.push(s);
      dictIndex.set(s, idx);
    }
    temp[i] = idx;
  }
  const indices = pickIndicesArray(strings.length, dict.length);
  for (let i = 0; i < strings.length; i++) indices[i] = temp[i]!;
  return { dict, indices };
}

export function decodeTextDict(dict: ReadonlyArray<string>, indices: DictIndices): string[] {
  const out: string[] = new Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    out[i] = dict[indices[i]!] ?? '';
  }
  return out;
}

// ───── Cycle 25 / Task 3 — varint + delta numeric columns ────────────
//
// Zigzag-encoded varints pack signed 32-bit ints into 1–5 bytes. Small
// magnitudes (the common case for ids, counts, day offsets) shrink to
// 1 byte. The delta variant first-differences the sequence so sorted /
// monotonic columns (rowIds, growing timestamps) become nearly all
// 1-byte deltas — a 1000-row id column packs to ~1 KB instead of 4 KB.
//
// `encodeVarintI32` operates on a raw signed-int sequence;
// `encodeDeltaInts` layers delta-encoding on top. Both produce a
// Uint8Array; the row count is the decoder's external contract
// (caller passes it back in) so we don't waste leading bytes on a
// self-describing prefix.

const VARINT_GROW_FACTOR = 2;

function zigzag32(v: number): number {
  // Force to 32-bit signed via << 0; then zigzag-map.
  return (v << 1) ^ (v >> 31);
}

function unzigzag32(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

export function encodeVarintI32(values: ReadonlyArray<number>): Uint8Array {
  // 5 bytes worst case per int.
  let buf = new Uint8Array(Math.max(8, values.length * 2));
  let pos = 0;
  for (let i = 0; i < values.length; i++) {
    let u = zigzag32(values[i]! | 0) >>> 0;
    // Ensure capacity for up to 5 bytes.
    if (pos + 5 > buf.byteLength) {
      const next = new Uint8Array(buf.byteLength * VARINT_GROW_FACTOR);
      next.set(buf);
      buf = next;
    }
    while (u >= 0x80) {
      buf[pos++] = (u & 0x7f) | 0x80;
      u = u >>> 7;
    }
    buf[pos++] = u & 0x7f;
  }
  return buf.subarray(0, pos);
}

export function decodeVarintI32(bytes: Uint8Array, count: number): number[] {
  const out: number[] = new Array(count);
  let pos = 0;
  for (let i = 0; i < count; i++) {
    let u = 0;
    let shift = 0;
    let b: number;
    do {
      b = bytes[pos++]!;
      u |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    out[i] = unzigzag32(u >>> 0);
  }
  return out;
}

export function encodeDeltaInts(values: ReadonlyArray<number>): Uint8Array {
  if (values.length === 0) return new Uint8Array(0);
  const deltas: number[] = new Array(values.length);
  deltas[0] = values[0]!;
  for (let i = 1; i < values.length; i++) {
    deltas[i] = values[i]! - values[i - 1]!;
  }
  return encodeVarintI32(deltas);
}

export function decodeDeltaInts(bytes: Uint8Array, count: number): number[] {
  if (count === 0) return [];
  const deltas = decodeVarintI32(bytes, count);
  const out: number[] = new Array(count);
  out[0] = deltas[0]!;
  for (let i = 1; i < count; i++) {
    out[i] = out[i - 1]! + deltas[i]!;
  }
  return out;
}

interface BinaryWriter {
  bytes: Uint8Array;
  view: DataView;
  pos: number;
}

function makeWriter(capacity: number): BinaryWriter {
  const bytes = new Uint8Array(capacity);
  return { bytes, view: new DataView(bytes.buffer), pos: 0 };
}

function ensureCapacity(w: BinaryWriter, extra: number): void {
  if (w.pos + extra <= w.bytes.byteLength) return;
  let cap = w.bytes.byteLength;
  while (cap < w.pos + extra) cap *= 2;
  const next = new Uint8Array(cap);
  next.set(w.bytes);
  w.bytes = next;
  w.view = new DataView(next.buffer);
}

function writeU8(w: BinaryWriter, v: number): void {
  ensureCapacity(w, 1);
  w.view.setUint8(w.pos, v);
  w.pos += 1;
}

function writeU16(w: BinaryWriter, v: number): void {
  ensureCapacity(w, 2);
  w.view.setUint16(w.pos, v, true);
  w.pos += 2;
}

function writeU32(w: BinaryWriter, v: number): void {
  ensureCapacity(w, 4);
  w.view.setUint32(w.pos, v, true);
  w.pos += 4;
}

function writeRaw(w: BinaryWriter, src: Uint8Array): void {
  ensureCapacity(w, src.byteLength);
  w.bytes.set(src, w.pos);
  w.pos += src.byteLength;
}

function writeTypedArray(
  w: BinaryWriter,
  arr: Uint8Array | Uint32Array | Float32Array | Float64Array,
): void {
  const byteLen = arr.byteLength;
  if (byteLen === 0) return;
  // Always copy through a Uint8Array view of the underlying buffer so
  // little-endian byte order is preserved regardless of the host.
  const src = new Uint8Array(arr.buffer, arr.byteOffset, byteLen);
  writeRaw(w, src);
}

function writeString(w: BinaryWriter, s: string): void {
  const utf8 = encoder.encode(s);
  writeU16(w, utf8.byteLength);
  writeRaw(w, utf8);
}

interface BinaryReader {
  bytes: Uint8Array;
  view: DataView;
  pos: number;
}

function makeReader(bytes: Uint8Array): BinaryReader {
  return {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    pos: 0,
  };
}

function readU8(r: BinaryReader): number {
  const v = r.view.getUint8(r.pos);
  r.pos += 1;
  return v;
}

function readU16(r: BinaryReader): number {
  const v = r.view.getUint16(r.pos, true);
  r.pos += 2;
  return v;
}

function readU32(r: BinaryReader): number {
  const v = r.view.getUint32(r.pos, true);
  r.pos += 4;
  return v;
}

function readBytes(r: BinaryReader, len: number): Uint8Array {
  const out = new Uint8Array(len);
  out.set(r.bytes.subarray(r.pos, r.pos + len));
  r.pos += len;
  return out;
}

function readString(r: BinaryReader): string {
  const len = readU16(r);
  const utf8 = r.bytes.subarray(r.pos, r.pos + len);
  r.pos += len;
  return decoder.decode(utf8);
}

function readUint32Array(r: BinaryReader, count: number): Uint32Array {
  const out = new Uint32Array(count);
  // Defensive: read via DataView to preserve LE ordering on BE hosts.
  for (let i = 0; i < count; i++) {
    out[i] = r.view.getUint32(r.pos + i * 4, true);
  }
  r.pos += count * 4;
  return out;
}

function readFloat32Array(r: BinaryReader, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = r.view.getFloat32(r.pos + i * 4, true);
  }
  r.pos += count * 4;
  return out;
}

function readFloat64Array(r: BinaryReader, count: number): Float64Array {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = r.view.getFloat64(r.pos + i * 8, true);
  }
  r.pos += count * 8;
  return out;
}

export interface SerializeChunkOptions {
  /** Force-write a specific version. Defaults to the current
   *  `CHUNK_FORMAT_VERSION`. Set to `1` to emit a Cycle 4 era fixture
   *  (no group fields written even when present on the chunk). */
  version?: ChunkFormatVersion;
}

/** Cycle 15 / Task 3 — binary serializer for `ViewportChunk`.
 *  Append-only: emitting `version: 1` skips the v2-only fields so the
 *  resulting bytes match the pre-Task-3 layout. */
export function serializeChunk(
  chunk: ViewportChunk,
  opts?: SerializeChunkOptions,
): Uint8Array {
  const version = opts?.version ?? CHUNK_FORMAT_VERSION;
  const w = makeWriter(256);

  writeRaw(w, MAGIC);
  writeU8(w, version);
  writeU8(w, 0); writeU8(w, 0); writeU8(w, 0); // reserved
  writeU32(w, chunk.rowStart);
  writeU32(w, chunk.rowCount);

  const numericIds = Object.keys(chunk.numericCols);
  const textIds = Object.keys(chunk.textCols);

  let flags = 0;
  if (chunk.flashMask) flags |= FLAG_FLASH_MASK;
  if (chunk.flashMask && chunk.flashDir) flags |= FLAG_FLASH_DIR;
  if (chunk.totals !== undefined) flags |= FLAG_TOTALS;
  if (version >= 2) {
    if (chunk.groupValue) flags |= FLAG_GROUP_VALUE;
    if (chunk.groupChildCount) flags |= FLAG_GROUP_CHILD_CNT;
    if (chunk.isExpanded) flags |= FLAG_IS_EXPANDED;
  }
  writeU8(w, flags);
  writeU16(w, numericIds.length);
  writeU16(w, textIds.length);

  writeTypedArray(w, chunk.rowIds);
  writeTypedArray(w, chunk.rowKinds);
  writeTypedArray(w, chunk.groupDepth);
  writeTypedArray(w, chunk.heights);

  for (const colId of numericIds) {
    writeString(w, colId);
    writeTypedArray(w, chunk.numericCols[colId]!);
  }

  for (const colId of textIds) {
    writeString(w, colId);
    const tc = chunk.textCols[colId]!;
    writeU32(w, tc.offsets.length);
    writeTypedArray(w, tc.offsets);
    writeU32(w, tc.bytes.byteLength);
    writeTypedArray(w, tc.bytes);
  }

  if (flags & FLAG_FLASH_MASK) {
    const mask = chunk.flashMask!;
    writeU32(w, mask.byteLength);
    writeTypedArray(w, mask);
  }

  if (flags & FLAG_FLASH_DIR) {
    const dir = chunk.flashDir!;
    writeU32(w, dir.byteLength);
    writeTypedArray(w, dir);
  }

  if (flags & FLAG_TOTALS) {
    const json = JSON.stringify(chunk.totals);
    const utf8 = encoder.encode(json);
    writeU32(w, utf8.byteLength);
    writeRaw(w, utf8);
  }

  if (flags & FLAG_GROUP_VALUE) {
    const packed = encodeText(chunk.groupValue!);
    writeU32(w, packed.offsets.length);
    writeTypedArray(w, packed.offsets);
    writeU32(w, packed.bytes.byteLength);
    writeTypedArray(w, packed.bytes);
  }

  if (flags & FLAG_GROUP_CHILD_CNT) {
    writeTypedArray(w, chunk.groupChildCount!);
  }

  if (flags & FLAG_IS_EXPANDED) {
    writeTypedArray(w, chunk.isExpanded!);
  }

  return w.bytes.slice(0, w.pos);
}

/** Cycle 15 / Task 3 — binary deserializer. Handles both v1 (Cycle 4
 *  era) and v2 (Task 3+) payloads. Fields absent in v1 are filled with
 *  defaults — `groupValue` array of `''`, zeroed `groupChildCount`,
 *  `isExpanded` all `1`. Throws when the magic header doesn't match or
 *  the version is unknown — silently accepting garbage hides bugs. */
export function deserializeChunk(bytes: Uint8Array): ViewportChunk {
  if (bytes.byteLength < 8) {
    throw new Error('chunkFormat: payload too short');
  }
  const r = makeReader(bytes);

  for (let i = 0; i < 4; i++) {
    if (readU8(r) !== MAGIC[i]) {
      throw new Error('chunkFormat: bad magic');
    }
  }
  const version = readU8(r) as ChunkFormatVersion;
  if (version !== 1 && version !== 2) {
    throw new Error(`chunkFormat: unsupported version ${version as number}`);
  }
  // Reserved bytes — read and discard.
  readU8(r); readU8(r); readU8(r);

  const rowStart = readU32(r);
  const rowCount = readU32(r);
  const flags = readU8(r);
  const numericCount = readU16(r);
  const textCount = readU16(r);

  const rowIds = readUint32Array(r, rowCount);
  const rowKindsBytes = readBytes(r, rowCount);
  const rowKinds = new Uint8Array(rowKindsBytes);
  const groupDepthBytes = readBytes(r, rowCount);
  const groupDepth = new Uint8Array(groupDepthBytes);
  const heights = readFloat32Array(r, rowCount);

  const numericCols: Record<string, Float64Array> = {};
  for (let i = 0; i < numericCount; i++) {
    const colId = readString(r);
    numericCols[colId] = readFloat64Array(r, rowCount);
  }

  const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};
  for (let i = 0; i < textCount; i++) {
    const colId = readString(r);
    const offsetsLen = readU32(r);
    const offsets = readUint32Array(r, offsetsLen);
    const bytesLen = readU32(r);
    const tcBytes = readBytes(r, bytesLen);
    textCols[colId] = { offsets, bytes: tcBytes };
  }

  let flashMask: Uint8Array | undefined;
  if (flags & FLAG_FLASH_MASK) {
    const len = readU32(r);
    flashMask = readBytes(r, len);
  }

  let flashDir: Uint8Array | undefined;
  if (flags & FLAG_FLASH_DIR) {
    const len = readU32(r);
    flashDir = readBytes(r, len);
  }

  let totals: Record<string, unknown> | undefined;
  if (flags & FLAG_TOTALS) {
    const len = readU32(r);
    const jsonBytes = readBytes(r, len);
    totals = JSON.parse(decoder.decode(jsonBytes)) as Record<string, unknown>;
  }

  // v2 fields. Default values are applied for v1 (or v2 with the
  // optional flag unset) so callers downstream of the deserializer can
  // treat the three group fields as always-present.
  let groupValue: string[];
  if (version >= 2 && flags & FLAG_GROUP_VALUE) {
    const offsetsLen = readU32(r);
    const offsets = readUint32Array(r, offsetsLen);
    const bytesLen = readU32(r);
    const gvBytes = readBytes(r, bytesLen);
    groupValue = decodeText(offsets, gvBytes);
  } else {
    groupValue = new Array<string>(rowCount).fill('');
  }

  let groupChildCount: Uint32Array;
  if (version >= 2 && flags & FLAG_GROUP_CHILD_CNT) {
    groupChildCount = readUint32Array(r, rowCount);
  } else {
    groupChildCount = new Uint32Array(rowCount);
  }

  let isExpanded: Uint8Array;
  if (version >= 2 && flags & FLAG_IS_EXPANDED) {
    isExpanded = new Uint8Array(readBytes(r, rowCount));
  } else {
    isExpanded = new Uint8Array(rowCount);
    isExpanded.fill(1);
  }

  const out: ViewportChunk = {
    rowStart,
    rowCount,
    rowIds,
    rowKinds,
    groupDepth,
    heights,
    numericCols,
    textCols,
    groupValue,
    groupChildCount,
    isExpanded,
  };
  if (flashMask) out.flashMask = flashMask;
  if (flashDir) out.flashDir = flashDir;
  if (totals !== undefined) out.totals = totals;
  return out;
}

/** Estimate the serialized size of a chunk without writing it. Used by
 *  the size-budget unit test. */
export function estimateChunkSize(
  chunk: ViewportChunk,
  opts?: SerializeChunkOptions,
): number {
  const version = opts?.version ?? CHUNK_FORMAT_VERSION;
  let size = 4 + 1 + 3 + 4 + 4 + 1 + 2 + 2; // header
  size += chunk.rowCount * (4 + 1 + 1 + 4); // rowIds + rowKinds + groupDepth + heights
  for (const colId of Object.keys(chunk.numericCols)) {
    size += 2 + encoder.encode(colId).byteLength + chunk.rowCount * 8;
  }
  for (const colId of Object.keys(chunk.textCols)) {
    const tc = chunk.textCols[colId]!;
    size += 2 + encoder.encode(colId).byteLength;
    size += 4 + tc.offsets.byteLength;
    size += 4 + tc.bytes.byteLength;
  }
  if (chunk.flashMask) size += 4 + chunk.flashMask.byteLength;
  if (chunk.flashMask && chunk.flashDir) size += 4 + chunk.flashDir.byteLength;
  if (chunk.totals !== undefined) {
    size += 4 + encoder.encode(JSON.stringify(chunk.totals)).byteLength;
  }
  if (version >= 2) {
    if (chunk.groupValue) {
      const packed = encodeText(chunk.groupValue);
      size += 4 + packed.offsets.byteLength + 4 + packed.bytes.byteLength;
    }
    if (chunk.groupChildCount) size += chunk.groupChildCount.byteLength;
    if (chunk.isExpanded) size += chunk.isExpanded.byteLength;
  }
  return size;
}
