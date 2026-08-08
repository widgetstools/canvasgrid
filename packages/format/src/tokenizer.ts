import type { Loc } from '@wellsfargo-starui/velocity-grid-expression';
import { lookupNamedColor } from './excel/namedColors';

export type Token =
  | { kind: 'literal'; text: string; loc: Loc }
  | { kind: 'digit-placeholder'; char: '0' | '#' | '?'; loc: Loc }
  | { kind: 'group-separator'; loc: Loc }
  | { kind: 'decimal-point'; loc: Loc }
  | { kind: 'percent'; loc: Loc }
  | { kind: 'section-separator'; loc: Loc }
  | { kind: 'quoted'; text: string; loc: Loc }
  | { kind: 'escape'; char: string; loc: Loc }
  | { kind: 'excel-color'; name: string; loc: Loc }
  | { kind: 'excel-condition'; op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number; loc: Loc }
  | { kind: 'excel-locale-tag'; hex: string; loc: Loc }
  | { kind: 'tier1-bracket'; channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc; loc: Loc }
  | { kind: 'icon-token'; name: string; nameLoc: Loc; dynamicExpr?: string; dynamicExprLoc?: Loc; loc: Loc }
  | { kind: 'date-token'; token: string; loc: Loc }
  | { kind: 'exponent'; sign: '+' | '-'; digits: number; loc: Loc }
  | { kind: 'text-placeholder'; loc: Loc };

// Date tokens ordered longest-first so greedy matching works correctly.
const DATE_TOKENS: readonly string[] = [
  'yyyy', 'yy',
  'mmmm', 'mmm', 'mm', 'm',
  'dddd', 'ddd', 'dd', 'd',
  'hh', 'h',
  'nn', 'n',
  'ss', 's',
  'AM/PM', 'am/pm',
];

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let literalBuf = '';
  let literalStart = 0;

  const flushLiteral = (end: number): void => {
    if (literalBuf.length > 0) {
      out.push({ kind: 'literal', text: literalBuf, loc: { start: literalStart, end } });
      literalBuf = '';
    }
  };

  const appendLiteral = (chars: string, pos: number): void => {
    if (literalBuf.length === 0) literalStart = pos;
    literalBuf += chars;
  };

  const isDigitPlaceholderChar = (ch: string): boolean =>
    ch === '0' || ch === '#' || ch === '?';

  // Returns true if the last emitted token is digit-placeholder or group-separator.
  // A section-separator or any other kind resets the chain.
  const lastDigitContext = (): boolean => {
    for (let k = out.length - 1; k >= 0; k--) {
      const tok = out[k];
      if (tok === undefined) break;
      if (tok.kind === 'digit-placeholder' || tok.kind === 'group-separator') return true;
      return false;
    }
    return false;
  };

  while (i < source.length) {
    const c = source[i] ?? '';

    // --- Digit placeholder: 0, #, ?
    if (c === '0' || c === '#' || c === '?') {
      flushLiteral(i);
      out.push({ kind: 'digit-placeholder', char: c, loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // --- Group separator: `,`
    // A comma is a group-separator if the immediately preceding source char is a
    // digit placeholder, OR if the last emitted token is digit-placeholder /
    // group-separator (captures consecutive trailing commas like `#,##0,,`).
    if (c === ',') {
      const prevChar = i > 0 ? (source[i - 1] ?? '') : '';
      const inDigitCtx = isDigitPlaceholderChar(prevChar) || lastDigitContext();
      if (inDigitCtx) {
        flushLiteral(i);
        out.push({ kind: 'group-separator', loc: { start: i, end: i + 1 } });
        i++;
        continue;
      }
      appendLiteral(c, i);
      i++;
      continue;
    }

    // --- Decimal point: `.` adjacent to a digit placeholder char
    if (c === '.') {
      const prevChar = i > 0 ? (source[i - 1] ?? '') : '';
      const nextChar = i < source.length - 1 ? (source[i + 1] ?? '') : '';
      if (isDigitPlaceholderChar(prevChar) || isDigitPlaceholderChar(nextChar)) {
        flushLiteral(i);
        out.push({ kind: 'decimal-point', loc: { start: i, end: i + 1 } });
        i++;
        continue;
      }
      appendLiteral(c, i);
      i++;
      continue;
    }

    // --- Percent
    if (c === '%') {
      flushLiteral(i);
      out.push({ kind: 'percent', loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // --- Section separator
    if (c === ';') {
      flushLiteral(i);
      out.push({ kind: 'section-separator', loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // --- Text placeholder: `@` (Excel text-section value substitution)
    if (c === '@') {
      flushLiteral(i);
      out.push({ kind: 'text-placeholder', loc: { start: i, end: i + 1 } });
      i++;
      continue;
    }

    // --- Quoted literal "..."
    if (c === '"') {
      flushLiteral(i);
      let j = i + 1;
      let content = '';
      while (j < source.length && source[j] !== '"') {
        content += source[j] ?? '';
        j++;
      }
      // j points to closing `"` (or past end if unclosed)
      out.push({ kind: 'quoted', text: content, loc: { start: i, end: j + 1 } });
      i = j + 1;
      continue;
    }

    // --- Escape: \c
    if (c === '\\' && i + 1 < source.length) {
      flushLiteral(i);
      const escaped = source[i + 1] ?? '';
      out.push({ kind: 'escape', char: escaped, loc: { start: i, end: i + 2 } });
      i += 2;
      continue;
    }

    // --- Icon token: {icon:name} or {icon:name|<expr>}
    if (c === '{') {
      if (source.startsWith('icon:', i + 1)) {
        const closeIdx = source.indexOf('}', i);
        if (closeIdx !== -1) {
          const interior = source.slice(i + 6, closeIdx); // skip `{icon:`
          const pipeIdx = interior.indexOf('|');
          let name: string;
          let nameLoc: Loc;
          let dynamicExpr: string | undefined;
          let dynamicExprLoc: Loc | undefined;
          if (pipeIdx === -1) {
            name = interior.trim();
            nameLoc = { start: i + 6, end: closeIdx };
          } else {
            name = interior.slice(0, pipeIdx).trim();
            nameLoc = { start: i + 6, end: i + 6 + pipeIdx };
            dynamicExpr = interior.slice(pipeIdx + 1).trim();
            dynamicExprLoc = { start: i + 6 + pipeIdx + 1, end: closeIdx };
          }
          flushLiteral(i);
          out.push({
            kind: 'icon-token',
            name,
            nameLoc,
            dynamicExpr,
            dynamicExprLoc,
            loc: { start: i, end: closeIdx + 1 },
          });
          i = closeIdx + 1;
          continue;
        }
      }
      appendLiteral(c, i);
      i++;
      continue;
    }

    // --- Bracket forms: [...]
    if (c === '[') {
      const closeIdx = findMatchingCloseBracket(source, i);
      if (closeIdx === -1) {
        // Unclosed bracket — treat `[` as a literal and advance one char
        appendLiteral(c, i);
        i++;
        continue;
      }
      const interior = source.slice(i + 1, closeIdx);

      // Excel named color: [Red], [Green], etc.
      const colorHex = lookupNamedColor(interior);
      if (colorHex !== null) {
        flushLiteral(i);
        out.push({ kind: 'excel-color', name: interior, loc: { start: i, end: closeIdx + 1 } });
        i = closeIdx + 1;
        continue;
      }

      // Excel condition: [>1000], [<=0], [<>0], [=0], [>=1e6]
      const cond = parseExcelCondition(interior);
      if (cond !== null) {
        flushLiteral(i);
        out.push({
          kind: 'excel-condition',
          op: cond.op,
          value: cond.value,
          loc: { start: i, end: closeIdx + 1 },
        });
        i = closeIdx + 1;
        continue;
      }

      // Excel locale tag: [$-409]
      const locale = parseExcelLocaleTag(interior);
      if (locale !== null) {
        flushLiteral(i);
        out.push({ kind: 'excel-locale-tag', hex: locale, loc: { start: i, end: closeIdx + 1 } });
        i = closeIdx + 1;
        continue;
      }

      // Tier 1 bracket: [color=…], [bg=…], [weight=…], [style=…], [if …]
      const tier1 = parseTier1Bracket(interior, i + 1);
      if (tier1 !== null) {
        flushLiteral(i);
        out.push({
          kind: 'tier1-bracket',
          channel: tier1.channel,
          interior: tier1.interior,
          interiorLoc: tier1.interiorLoc,
          loc: { start: i, end: closeIdx + 1 },
        });
        i = closeIdx + 1;
        continue;
      }

      // Unrecognized bracket — treat as literal
      flushLiteral(i);
      appendLiteral(source.slice(i, closeIdx + 1), i);
      i = closeIdx + 1;
      continue;
    }

    // --- Scientific exponent marker: E+00 / E-0 … (uppercase only — Excel's canonical form)
    if (c === 'E') {
      const m = /^E([+-])(0+)/.exec(source.slice(i));
      if (m) {
        flushLiteral(i);
        out.push({
          kind: 'exponent',
          sign: m[1] as '+' | '-',
          digits: m[2]!.length,
          loc: { start: i, end: i + m[0].length },
        });
        i += m[0].length;
        continue;
      }
    }

    // --- Date tokens (case-insensitive, longest-first)
    let dateMatched = false;
    for (const dt of DATE_TOKENS) {
      if (i + dt.length > source.length) continue;
      const slice = source.slice(i, i + dt.length);
      if (slice.toLowerCase() === dt.toLowerCase()) {
        flushLiteral(i);
        out.push({ kind: 'date-token', token: slice, loc: { start: i, end: i + dt.length } });
        i += dt.length;
        dateMatched = true;
        break;
      }
    }
    if (dateMatched) continue;

    // --- Fallback: literal character
    appendLiteral(c, i);
    i++;
  }

  flushLiteral(source.length);
  return out;
}

function findMatchingCloseBracket(source: string, openIdx: number): number {
  let depth = 1;
  let j = openIdx + 1;
  while (j < source.length) {
    const ch = source[j] ?? '';
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

function parseExcelCondition(
  interior: string,
): { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number } | null {
  const match = /^(<=|>=|<>|<|>|=)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)$/.exec(interior);
  if (!match) return null;
  const rawOp = match[1];
  const rawVal = match[2];
  if (rawOp === undefined || rawVal === undefined) return null;
  const op = rawOp as '<=' | '>=' | '<>' | '<' | '>' | '=';
  const value = Number(rawVal);
  if (Number.isNaN(value)) return null;
  return { op, value };
}

function parseExcelLocaleTag(interior: string): string | null {
  const match = /^\$-([0-9a-fA-F]+)$/.exec(interior);
  if (!match) return null;
  return match[1] ?? null;
}

function parseTier1Bracket(
  interior: string,
  interiorStartOffset: number,
): { channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc } | null {
  // [channel=<expr>] forms
  const kv = /^(color|bg|weight|style)\s*=\s*/i.exec(interior);
  if (kv) {
    const rawChannel = kv[1];
    if (rawChannel === undefined) return null;
    const channel = rawChannel.toLowerCase() as 'color' | 'bg' | 'weight' | 'style';
    const exprStart = kv[0].length;
    return {
      channel,
      interior: interior.slice(exprStart),
      interiorLoc: { start: interiorStartOffset + exprStart, end: interiorStartOffset + interior.length },
    };
  }
  // [if <expr>] form
  if (/^if\s/i.test(interior)) {
    // Find where the expression body starts (after `if` + whitespace)
    const bodyStart = interior.slice(3).search(/\S/);
    const trimmedStart = bodyStart === -1 ? interior.length : 3 + bodyStart;
    return {
      channel: 'if',
      interior: interior.slice(trimmedStart),
      interiorLoc: { start: interiorStartOffset + trimmedStart, end: interiorStartOffset + interior.length },
    };
  }
  return null;
}
