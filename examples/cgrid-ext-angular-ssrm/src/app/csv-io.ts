/** Minimal CSV parse/serialize for grid export ↔ import round-trips. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === '\r') i++;
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

export function csvRowsToObjects(csv: string): Record<string, string>[] {
  const table = parseCsv(csv.trim());
  if (table.length < 2) return [];
  const headers = table[0]!.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = cells[c] ?? '';
    }
    if (Object.keys(obj).length) out.push(obj);
  }
  return out;
}

/** Coerce CSV strings into row patches suitable for SSRM `applyServerSideTransaction`. */
export function csvToSsrmUpdates(
  csv: string,
  opts?: { keyColumn?: string; numericFields?: string[] },
): Record<string, unknown>[] {
  const keyColumn = opts?.keyColumn ?? 'positionId';
  const numeric = new Set(opts?.numericFields ?? ['quantity', 'price', 'marketValue', 'pnl']);
  return csvRowsToObjects(csv)
    .filter((row) => row[keyColumn]?.trim())
    .map((row) => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (numeric.has(k)) {
          const n = Number(v.replace(/,/g, ''));
          patch[k] = Number.isFinite(n) ? n : v;
        } else {
          patch[k] = v;
        }
      }
      return patch;
    });
}
