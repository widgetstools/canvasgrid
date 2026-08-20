import type { Loc } from '../../expression/index';
import type { Token } from '../tokenizer';

export interface ExcelSection {
  tokens: Token[];
  namedColor?: string;
  condition?: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number };
  ifCondition?: { interior: string; interiorLoc: Loc; loc: Loc };
  loc: Loc;
}

export interface ExcelFormatTree {
  sections: ExcelSection[];
  loc: Loc;
}

export interface ExcelParseError {
  message: string;
  loc: Loc;
  code: 'excel-parse' | 'excel-section-count';
}

export type ExcelParseResult =
  | { ok: true; tree: ExcelFormatTree }
  | { ok: false; error: ExcelParseError };

export function parseExcel(tokens: Token[]): ExcelParseResult {
  if (tokens.length === 0) {
    return {
      ok: true,
      tree: {
        sections: [{ tokens: [], loc: { start: 0, end: 0 } }],
        loc: { start: 0, end: 0 },
      },
    };
  }

  // noUncheckedIndexedAccess: use non-null assertion — we checked .length above.
  const firstTok = tokens[0]!;
  const lastTok = tokens[tokens.length - 1]!;

  const sections: ExcelSection[] = [];
  let current: Token[] = [];
  let sectionStart = firstTok.loc.start;

  const finalize = (endLoc: number): void => {
    const section = extractSectionMetadata(current, sectionStart, endLoc);
    sections.push(section);
    current = [];
  };

  for (const tok of tokens) {
    if (tok.kind === 'section-separator') {
      finalize(tok.loc.start);
      sectionStart = tok.loc.end;
    } else {
      current.push(tok);
    }
  }
  // Push the final (or only) section.
  finalize(lastTok.loc.end);

  if (sections.length > 4) {
    return {
      ok: false,
      error: {
        code: 'excel-section-count',
        message: `Excel format supports at most 4 sections (positive;negative;zero;text), got ${sections.length}`,
        loc: { start: firstTok.loc.start, end: lastTok.loc.end },
      },
    };
  }

  return {
    ok: true,
    tree: {
      sections,
      loc: { start: firstTok.loc.start, end: lastTok.loc.end },
    },
  };
}

// Inline copy of the named-color map to avoid any possible circular dependency
// should namedColors.ts ever reference parser-layer utilities.
// Red/Green defer to the theme's semantic neg/pos tokens (teal/rose in the
// StarUI design language) — keep in sync with namedColors.ts.
const EXCEL_NAMED_COLORS_INLINE: Readonly<Record<string, string>> = {
  Black: '#000000',
  White: '#FFFFFF',
  Red: 'var(--vg-neg-color, #E53935)',
  Green: 'var(--vg-pos-color, #43A047)',
  Blue: '#1E88E5',
  Yellow: '#FDD835',
  Cyan: '#00ACC1',
  Magenta: '#D81B60',
};

function extractSectionMetadata(
  tokens: Token[],
  sectionStart: number,
  sectionEnd: number,
): ExcelSection {
  let namedColor: string | undefined;
  let condition: ExcelSection['condition'];
  let ifCondition: ExcelSection['ifCondition'];
  const body: Token[] = [];

  for (const tok of tokens) {
    if (tok.kind === 'excel-color' && namedColor === undefined) {
      // First named-color bracket in the section wins.
      const canon =
        tok.name.charAt(0).toUpperCase() + tok.name.slice(1).toLowerCase();
      // Don't push to body — the color bracket is section metadata.
      namedColor = EXCEL_NAMED_COLORS_INLINE[canon];
      continue;
    }
    if (tok.kind === 'excel-condition' && condition === undefined) {
      condition = { op: tok.op, value: tok.value };
      // Don't push to body.
      continue;
    }
    if (
      tok.kind === 'tier1-bracket' &&
      tok.channel === 'if' &&
      ifCondition === undefined
    ) {
      ifCondition = { interior: tok.interior, interiorLoc: tok.interiorLoc, loc: tok.loc };
      // Don't push to body.
      continue;
    }
    body.push(tok);
  }

  return {
    tokens: body,
    namedColor,
    condition,
    ifCondition,
    loc: { start: sectionStart, end: sectionEnd },
  };
}
