// @cgrid/edit — K/M/B magnitude suffix parser + valueParser colDef transform.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 2.3 (Date-free + null-on-failure), section 4.2.5 (magnitude shortcuts,
// gated by magnitudeShortcutsEnabled).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.3 (wiring),
// C.9 (kernel CValueParserParams shape — structural/type-only, no kernel import).
//
// Pure functions only — no kernel imports, no Date, no locale machinery.

/** Strict mantissa regex: optional sign, digits, optional single decimal
 *  point + digits, optional single trailing K/M/B suffix letter. Deliberately
 *  NOT a `parseFloat` prefix-scan — malformed trailing garbage (double
 *  suffixes, a second decimal point, an exponent before the suffix) fails the
 *  whole match rather than silently truncating. */
const MAGNITUDE_RE = /^([+-]?\d+(?:\.\d+)?)([kKmMbB])?$/;

const SUFFIX_MULTIPLIER: Record<'k' | 'm' | 'b', number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
};

/** Parses a plain numeric string or one with a trailing K/M/B magnitude
 *  suffix (case-insensitive). Returns null for anything that doesn't fully
 *  match the strict mantissa+suffix shape (empty/whitespace, commas,
 *  exponents, double suffixes, malformed mantissas, suffix-only strings). */
export function parseMagnitudeSuffix(raw: string): number | null {
  const match = MAGNITUDE_RE.exec(raw);
  if (!match) return null;

  const mantissa = Number(match[1]);
  if (!Number.isFinite(mantissa)) return null;

  const suffix = match[2];
  if (!suffix) return mantissa;

  const multiplier = SUFFIX_MULTIPLIER[suffix.toLowerCase() as 'k' | 'm' | 'b'];
  return mantissa * multiplier;
}

/** Structural shape of the kernel's `CValueParserParams` (recon C.9) — kept
 *  local and type-only so this package never imports from @cgrid/kernel. */
interface MagnitudeValueParserParams {
  newValue: unknown;
  oldValue?: unknown;
  data?: unknown;
  colDef?: unknown;
}

/** Returns a NEW array with NEW colDef objects (shallow copies with a wrapped
 *  `valueParser`) for numeric columns only (`cellDataType === 'number'`);
 *  non-numeric colDefs pass through BY REFERENCE. Input colDefs are never
 *  mutated. The wrapped parser (spec §4.2.5): runs the ORIGINAL `valueParser`
 *  FIRST (if any) with the untouched params object; if `params.newValue` is a
 *  string AND `parseMagnitudeSuffix` succeeds, the parsed number wins;
 *  otherwise the original result (or `params.newValue` verbatim when there
 *  was no original parser) is returned. */
export function applyMagnitudeColDefTransforms<
  T extends { cellDataType?: string; valueParser?: (p: unknown) => unknown },
>(colDefs: T[]): T[] {
  return colDefs.map((colDef) => {
    if (colDef.cellDataType !== 'number') return colDef;

    const originalParser = colDef.valueParser;
    const wrappedParser = (p: unknown): unknown => {
      const params = p as MagnitudeValueParserParams;
      const original = originalParser ? originalParser(p) : params.newValue;

      if (typeof params.newValue === 'string') {
        const parsed = parseMagnitudeSuffix(params.newValue);
        if (parsed !== null) return parsed;
      }
      return original;
    };

    return { ...colDef, valueParser: wrappedParser };
  });
}
