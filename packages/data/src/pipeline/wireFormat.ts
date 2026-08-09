export type ColumnarBatch = {
  format: 'columnar';
  fields: string[];
  columns: unknown[][];
  length: number;
};

/** Encode rows as columnar payload (hub → client when wireFormat=columnar). */
export function rowsToColumnar(rows: readonly Record<string, unknown>[]): ColumnarBatch {
  const fieldSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) fieldSet.add(k);
  }
  const fields = [...fieldSet].sort();
  const columns = fields.map((f) => rows.map((r) => r[f]));
  return { format: 'columnar', fields, columns, length: rows.length };
}

/** Decode columnar batch back to row objects. */
export function columnarToRows(batch: ColumnarBatch): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < batch.length; i++) {
    const row: Record<string, unknown> = {};
    for (let f = 0; f < batch.fields.length; f++) {
      row[batch.fields[f]!] = batch.columns[f]![i];
    }
    out.push(row);
  }
  return out;
}
