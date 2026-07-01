import type { StyleObj } from '../types';
import type { ExcelFormatTree } from './parser';

export interface ExcelEvalContext {
  value: unknown;
  locale: string;
  currency: string;
}

export interface ExcelEvalResult {
  text: string;
  style: StyleObj | null;
  iconName: string | null;
}

export function evaluateExcel(tree: ExcelFormatTree, ctx: ExcelEvalContext): ExcelEvalResult {
  throw new Error('not-yet-implemented: excel.evaluateExcel');
}
