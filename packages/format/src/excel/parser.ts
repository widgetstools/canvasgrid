import type { Loc } from '@cgrid/expression';
import type { Token } from '../tokenizer';

export interface ExcelSection {
  tokens: Token[];
  namedColor?: string;
  condition?: { op: '>' | '<' | '<=' | '>=' | '=' | '<>'; value: number };
  ifCondition?: { interior: string; loc: Loc };
  loc: Loc;
}

export interface ExcelFormatTree {
  sections: ExcelSection[];
  loc: Loc;
}

export interface ExcelParseError { message: string; loc: Loc; code: 'excel-parse' | 'excel-section-count'; }

export type ExcelParseResult =
  | { ok: true; tree: ExcelFormatTree }
  | { ok: false; error: ExcelParseError };

export function parseExcel(tokens: Token[]): ExcelParseResult {
  throw new Error('not-yet-implemented: excel.parseExcel');
}
