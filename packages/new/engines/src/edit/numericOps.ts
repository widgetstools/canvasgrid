export type SmartEditOp = 'multiply' | 'divide' | 'add' | 'subtract' | 'set';

/** Apply smart-edit arithmetic. Non-finite current → null (skip). Never throws. */
export function applyNumericOp(
  current: unknown,
  op: SmartEditOp,
  operand: number,
): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  let result: number;
  switch (op) {
    case 'multiply': result = current * operand; break;
    case 'divide':
      if (operand === 0) return null;
      result = current / operand;
      break;
    case 'add': result = current + operand; break;
    case 'subtract': result = current - operand; break;
    case 'set': result = operand; break;
  }
  return Number.isFinite(result) ? result : null;
}

export function isNumericCellDataType(cellDataType?: string): boolean {
  return cellDataType === 'number';
}
