/**
 * Cycle 20 / Task 2 — minimal ZIP writer (STORED method).
 *
 * Builds a valid ZIP archive containing `ZipEntry[]`. Uses STORED
 * (compression method 0 — raw bytes) so we don't need DEFLATE at
 * runtime. XLSX accepts STORED entries — Excel + LibreOffice both
 * open them fine; the bundle size hit avoiding a deflate impl is
 * worth more than the per-file compression savings for our use case.
 *
 * The format follows PKWARE's APPNOTE.TXT. For STORED entries with
 * no Zip64 / encryption / extra fields, each entry contributes:
 *
 *   • Local file header           (30 bytes + filename)
 *   • File data                   (entry.bytes.length bytes)
 *   • Central directory entry     (46 bytes + filename)
 *
 * The archive ends with one End-Of-Central-Directory (EOCD) record
 * (22 bytes when comment is empty).
 *
 * Layout in the output buffer:
 *
 *   [ LFH₁ ][ data₁ ][ LFH₂ ][ data₂ ] … [ CDH₁ ][ CDH₂ ] … [ EOCD ]
 *
 * Total scratch sized in one shot from the entry sizes — no buffer
 * doubling — so a 100k-row XLSX export pays one allocation for the
 * whole ZIP envelope (plus the per-XML buffers Task 2's xlsxBuilder
 * already produced).
 */

import { crc32 } from './crc32';

export interface ZipEntry {
  /** Path inside the archive (forward slashes). */
  name: string;
  /** Raw bytes of the file contents. */
  bytes: Uint8Array;
}

const LFH_SIG = 0x04034B50;
const CDH_SIG = 0x02014B50;
const EOCD_SIG = 0x06054B50;

/** Build a STORED-method ZIP archive over `entries`. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();

  // Pre-compute filename bytes + CRCs so the size pass is a single sum.
  const meta = entries.map((e) => {
    const nameBytes = encoder.encode(e.name);
    const crc = crc32(e.bytes);
    return { ...e, nameBytes, crc };
  });

  // Output size = Σ(LFH + name + data) + Σ(CDH + name) + EOCD.
  let lfhSize = 0;
  let cdSize = 0;
  for (const m of meta) {
    lfhSize += 30 + m.nameBytes.length + m.bytes.length;
    cdSize += 46 + m.nameBytes.length;
  }
  const totalSize = lfhSize + cdSize + 22;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);
  let off = 0;

  // ─── Pass 1 — local file headers + data ──────────────────────────
  const lfhOffsets: number[] = [];
  for (const m of meta) {
    lfhOffsets.push(off);
    dv.setUint32(off, LFH_SIG, true); off += 4;
    dv.setUint16(off, 20, true);       off += 2; // version needed (2.0 STORED)
    dv.setUint16(off, 0, true);        off += 2; // general purpose flags
    dv.setUint16(off, 0, true);        off += 2; // compression method (STORED)
    dv.setUint16(off, 0, true);        off += 2; // last mod time
    dv.setUint16(off, 0x21, true);     off += 2; // last mod date (1980-01-01)
    dv.setUint32(off, m.crc, true);    off += 4;
    dv.setUint32(off, m.bytes.length, true); off += 4; // compressed size
    dv.setUint32(off, m.bytes.length, true); off += 4; // uncompressed size
    dv.setUint16(off, m.nameBytes.length, true); off += 2; // file name length
    dv.setUint16(off, 0, true);        off += 2; // extra field length
    out.set(m.nameBytes, off); off += m.nameBytes.length;
    out.set(m.bytes, off);     off += m.bytes.length;
  }

  // ─── Pass 2 — central directory ──────────────────────────────────
  const cdOffset = off;
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]!;
    const lfhOff = lfhOffsets[i]!;
    dv.setUint32(off, CDH_SIG, true);   off += 4;
    dv.setUint16(off, 20, true);        off += 2; // version made by
    dv.setUint16(off, 20, true);        off += 2; // version needed
    dv.setUint16(off, 0, true);         off += 2; // general purpose flags
    dv.setUint16(off, 0, true);         off += 2; // compression method
    dv.setUint16(off, 0, true);         off += 2; // last mod time
    dv.setUint16(off, 0x21, true);      off += 2; // last mod date
    dv.setUint32(off, m.crc, true);     off += 4;
    dv.setUint32(off, m.bytes.length, true); off += 4;
    dv.setUint32(off, m.bytes.length, true); off += 4;
    dv.setUint16(off, m.nameBytes.length, true); off += 2;
    dv.setUint16(off, 0, true);         off += 2; // extra field length
    dv.setUint16(off, 0, true);         off += 2; // file comment length
    dv.setUint16(off, 0, true);         off += 2; // disk number start
    dv.setUint16(off, 0, true);         off += 2; // internal file attrs
    dv.setUint32(off, 0, true);         off += 4; // external file attrs
    dv.setUint32(off, lfhOff, true);    off += 4; // relative offset of LFH
    out.set(m.nameBytes, off); off += m.nameBytes.length;
  }

  // ─── EOCD ────────────────────────────────────────────────────────
  const cdLen = off - cdOffset;
  dv.setUint32(off, EOCD_SIG, true);    off += 4;
  dv.setUint16(off, 0, true);           off += 2; // disk number
  dv.setUint16(off, 0, true);           off += 2; // disk with start of CD
  dv.setUint16(off, meta.length, true); off += 2; // entries on this disk
  dv.setUint16(off, meta.length, true); off += 2; // total entries
  dv.setUint32(off, cdLen, true);       off += 4;
  dv.setUint32(off, cdOffset, true);    off += 4;
  dv.setUint16(off, 0, true);           off += 2; // comment length

  return out;
}
