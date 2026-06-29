/**
 * Cycle 20 / Task 2 — minimal ZIP reader for test-time verification.
 *
 * The writer in `zipWriter.ts` emits STORED-method entries only, so
 * the matching reader doesn't need DEFLATE either. This module is
 * test-only — it's not exported from the worker bundle. The XLSX
 * tests use it to read back the writer's output and assert on
 * individual XML entries without taking a runtime dependency on
 * `pako` / `fflate` / `JSZip`.
 *
 * Format: same APPNOTE.TXT primitives as the writer. We parse the
 * End-Of-Central-Directory record first to locate the central
 * directory, walk the CD to enumerate entries, then for each entry
 * jump to its local file header and slice out the raw data.
 */

export interface UnzippedEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054B50;
const CDH_SIG = 0x02014B50;
const LFH_SIG = 0x04034B50;

export function unzipForTest(zip: Uint8Array): UnzippedEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Scan back from the end to find the EOCD signature. Empty comment
  // → EOCD is the last 22 bytes; otherwise it can be up to 65557 in.
  let eocdOff = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('unzipForTest: no EOCD');

  const totalEntries = dv.getUint16(eocdOff + 10, true);
  const cdOffset = dv.getUint32(eocdOff + 16, true);

  const decoder = new TextDecoder('utf-8');
  const out: UnzippedEntry[] = [];
  let cdCursor = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(cdCursor, true) !== CDH_SIG) {
      throw new Error('unzipForTest: bad central directory signature');
    }
    const compressedSize = dv.getUint32(cdCursor + 20, true);
    const fileNameLen = dv.getUint16(cdCursor + 28, true);
    const extraLen = dv.getUint16(cdCursor + 30, true);
    const commentLen = dv.getUint16(cdCursor + 32, true);
    const lfhOff = dv.getUint32(cdCursor + 42, true);
    const name = decoder.decode(zip.subarray(cdCursor + 46, cdCursor + 46 + fileNameLen));
    cdCursor += 46 + fileNameLen + extraLen + commentLen;

    if (dv.getUint32(lfhOff, true) !== LFH_SIG) {
      throw new Error('unzipForTest: bad local file header signature');
    }
    const lfhNameLen = dv.getUint16(lfhOff + 26, true);
    const lfhExtraLen = dv.getUint16(lfhOff + 28, true);
    const dataStart = lfhOff + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + compressedSize;
    out.push({ name, bytes: zip.subarray(dataStart, dataEnd) });
  }
  return out;
}
