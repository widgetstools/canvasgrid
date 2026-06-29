// Cycle 20 / Task 1 — CSV writer (worker-side) tests.
//
// The writer is a pure module: given (rows, columns, opts) it returns
// a Uint8Array containing the CSV bytes. It does NOT touch the worker
// state, DOM, or Blob — those wrappers belong to Task 3 (the
// CGridApi-level glue).
//
// Tests cover the RFC 4180 invariants the writer must honour:
//   - field quoting (wrap in `"..."` when value contains separator,
//     quote, or newline; embedded quotes double)
//   - line ending = \r\n (Excel-friendly)
//   - optional BOM (3-byte UTF-8 prefix)
//   - custom separator (tab / pipe)
//   - skip column headers
//   - empty rows / empty values
//   - growable buffer (write enough bytes to force the writer past its
//     initial 64KB scratch and verify the bytes are still correct)

import { describe, it, expect } from 'vitest';
import { writeCsv, type CsvWriteColumn } from '../src/worker/export/csv';

const cols: CsvWriteColumn[] = [
  { colId: 'desk',   field: 'desk',   headerName: 'Desk' },
  { colId: 'region', field: 'region', headerName: 'Region' },
  { colId: 'pnl',    field: 'pnl',    headerName: 'PnL' },
];

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

describe('writeCsv — basic shape', () => {
  it('emits a header row then one row per data row, CRLF separated', () => {
    const rows = [
      { desk: 'APAC', region: 'Rates', pnl: 100 },
      { desk: 'EMEA', region: 'Credit', pnl: 200 },
    ];
    const out = decode(writeCsv(rows, cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\nAPAC,Rates,100\r\nEMEA,Credit,200\r\n');
  });

  it('empty rows → header row only', () => {
    const out = decode(writeCsv([], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\n');
  });

  it('skipColumnHeaders omits the header row', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 100 }];
    const out = decode(writeCsv(rows, cols, { skipColumnHeaders: true }));
    expect(out).toBe('APAC,Rates,100\r\n');
  });
});

describe('writeCsv — RFC 4180 quoting', () => {
  it('quotes fields that contain the column separator', () => {
    const out = decode(writeCsv([{ desk: 'APAC, Asia', region: 'Rates', pnl: 1 }], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\n"APAC, Asia",Rates,1\r\n');
  });

  it('quotes fields that contain a double-quote and doubles the embedded quote', () => {
    const out = decode(writeCsv([{ desk: 'AP"AC', region: 'Rates', pnl: 1 }], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\n"AP""AC",Rates,1\r\n');
  });

  it('quotes fields that contain a newline (CR or LF)', () => {
    const out = decode(writeCsv([{ desk: 'AP\nAC', region: 'Rates', pnl: 1 }], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\n"AP\nAC",Rates,1\r\n');
  });

  it('does NOT quote a plain numeric or text value', () => {
    const out = decode(writeCsv([{ desk: 'APAC', region: 'Rates', pnl: 1 }], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\nAPAC,Rates,1\r\n');
  });

  it('empty cells render as empty fields (no quotes)', () => {
    const out = decode(writeCsv([{ desk: '', region: undefined, pnl: null }], cols, {}));
    expect(out).toBe('Desk,Region,PnL\r\n,,\r\n');
  });
});

describe('writeCsv — options', () => {
  it('custom column separator (tab)', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 1 }];
    const out = decode(writeCsv(rows, cols, { columnSeparator: '\t' }));
    expect(out).toBe('Desk\tRegion\tPnL\r\nAPAC\tRates\t1\r\n');
  });

  it('quotes when value contains the configured separator (pipe)', () => {
    const rows = [{ desk: 'AP|AC', region: 'Rates', pnl: 1 }];
    const out = decode(writeCsv(rows, cols, { columnSeparator: '|' }));
    expect(out).toBe('Desk|Region|PnL\r\n"AP|AC"|Rates|1\r\n');
  });

  it('withBOM prepends the 3-byte UTF-8 BOM', () => {
    const bytes = writeCsv([{ desk: 'APAC', region: 'Rates', pnl: 1 }], cols, { withBOM: true });
    expect(bytes[0]).toBe(0xEF);
    expect(bytes[1]).toBe(0xBB);
    expect(bytes[2]).toBe(0xBF);
    expect(decode(bytes.subarray(3))).toBe('Desk,Region,PnL\r\nAPAC,Rates,1\r\n');
  });

  it('suppressQuotes outputs raw values even when they contain separators (apps that trust their data)', () => {
    const rows = [{ desk: 'AP,AC', region: 'Rates', pnl: 1 }];
    const out = decode(writeCsv(rows, cols, { suppressQuotes: true }));
    expect(out).toBe('Desk,Region,PnL\r\nAP,AC,Rates,1\r\n');
  });

  it('columnKeys filter — only the listed columns appear, in the listed order', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 1 }];
    const out = decode(writeCsv(rows, cols, { columnKeys: ['pnl', 'desk'] }));
    expect(out).toBe('PnL,Desk\r\n1,APAC\r\n');
  });

  it('prependContent + appendContent wrap the body verbatim (no quoting)', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 1 }];
    const out = decode(writeCsv(rows, cols, {
      prependContent: '# generated\r\n',
      appendContent: '# end\r\n',
    }));
    expect(out).toBe('# generated\r\nDesk,Region,PnL\r\nAPAC,Rates,1\r\n# end\r\n');
  });
});

describe('writeCsv — buffer growth', () => {
  it('handles payloads larger than the initial 64KB scratch without truncation', () => {
    // 5,000 rows × ~30 bytes ≈ 150KB → forces at least one buffer grow.
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5000; i++) {
      rows.push({ desk: `D-${i}`, region: `R-${i}`, pnl: i });
    }
    const bytes = writeCsv(rows, cols, {});
    const text = decode(bytes);
    // Header + N rows + N CRLFs after each row.
    expect(text.split('\r\n').length).toBe(5000 + 2); // header + 5000 rows + trailing empty
    expect(text.startsWith('Desk,Region,PnL\r\n')).toBe(true);
    expect(text.endsWith('D-4999,R-4999,4999\r\n')).toBe(true);
  });
});
