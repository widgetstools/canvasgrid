/**
 * Cycle 20 / Task 2 — CRC-32 (IEEE 802.3 polynomial 0xEDB88320).
 *
 * ZIP entries store a CRC-32 of the file's uncompressed bytes in
 * both the local file header and the central directory entry. We
 * generate the standard 256-entry lookup table once and reuse it.
 *
 * ~30 LOC, allocation-free per call.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of `bytes`. Returns an unsigned 32-bit integer (≤ 0xFFFFFFFF). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xFF]! ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
