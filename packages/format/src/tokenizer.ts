import type { Loc } from '@cgrid/expression';

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
  | { kind: 'excel-condition'; op: string; value: number; loc: Loc }
  | { kind: 'excel-locale-tag'; hex: string; loc: Loc }
  | { kind: 'tier1-bracket'; channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: Loc; loc: Loc }
  | { kind: 'icon-token'; name: string; nameLoc: Loc; dynamicExpr?: string; dynamicExprLoc?: Loc; loc: Loc }
  | { kind: 'date-token'; token: string; loc: Loc };

export function tokenize(source: string): Token[] {
  throw new Error('not-yet-implemented: tokenizer.tokenize');
}
