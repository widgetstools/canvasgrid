/**
 * Fixed-income tick formatting — bond prices quoted in 32nds with the
 * sub-32nd remainder as an eighths digit (market "101-162" convention;
 * the half-32nd renders as `+` in the TICK32+ style). The math is owned
 * here, NOT imported from the kernel's price32 editor — @cgrid/format
 * has no kernel dependency.
 */
export function formatTick(
  value: unknown,
  denom: 32 | 64 | 128 | 256,
  halves: boolean,
): string {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // TICK32+ quotes in half-32nds (1/64) even though the base is 32.
  const quant = halves ? 64 : denom;
  const units = Math.round(abs * quant);         // price in 1/quant units
  const whole = Math.floor(units / quant);
  const rem = units - whole * quant;             // 0..quant-1 sub-handle units
  const perTick = quant / 32;                    // units per 32nd
  const ticks = Math.floor(rem / perTick);       // 0..31
  const sub = rem - ticks * perTick;             // 0..perTick-1
  const eighths = sub * (8 / perTick);           // integer 0..7
  let tail = '';
  if (eighths > 0) tail = halves ? '+' : String(eighths);
  return `${sign}${whole}-${String(ticks).padStart(2, '0')}${tail}`;
}

/** `TICK32` `TICK32+` `TICK64` `TICK128` `TICK256` — whole-string tick tokens. */
export const TICK_FORMAT_RE = /^TICK(32\+?|64|128|256)$/;

export function parseTickFormat(source: string): { denom: 32 | 64 | 128 | 256; halves: boolean } | null {
  const m = TICK_FORMAT_RE.exec(source.trim());
  if (!m) return null;
  const halves = m[1] === '32+';
  const denom = Number(m[1]!.replace('+', '')) as 32 | 64 | 128 | 256;
  return { denom, halves };
}
