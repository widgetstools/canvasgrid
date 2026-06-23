const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
