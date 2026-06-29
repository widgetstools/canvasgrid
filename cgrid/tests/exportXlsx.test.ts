// Cycle 20 / Task 2 — XLSX writer (worker-side) tests.
//
// XLSX is a ZIP of XML. The writer:
//   1. Builds the XML files ([Content_Types].xml, _rels/.rels,
//      xl/workbook.xml, xl/_rels/workbook.xml.rels,
//      xl/worksheets/sheet1.xml, xl/styles.xml,
//      xl/sharedStrings.xml).
//   2. Packs them into a ZIP using "STORED" compression (no DEFLATE
//      runtime — saves bundle bytes; XLSX accepts STORED entries).
//   3. Returns the ZIP bytes.
//
// Tests verify both the ZIP envelope shape (PK\x03\x04 at start,
// PK\x05\x06 EOCD at end, expected entries present) AND the XML
// contents (row + cell text appears, headers appear, options like
// freezeRows + skipColumnHeaders are honoured).
//
// A small test-time unzipper reads back the ZIP entries; the writer
// is self-contained so no DEFLATE-decompression library is needed.

import { describe, it, expect } from 'vitest';
import { writeXlsx, type XlsxWriteColumn } from '../src/worker/export/xlsx';
import { unzipForTest } from '../src/worker/export/zipReader';

const cols: XlsxWriteColumn[] = [
  { colId: 'desk',   field: 'desk',   headerName: 'Desk' },
  { colId: 'region', field: 'region', headerName: 'Region' },
  { colId: 'pnl',    field: 'pnl',    headerName: 'PnL', type: 'number' },
];

const ZIP_LOCAL_HEADER = [0x50, 0x4B, 0x03, 0x04]; // PK\x03\x04
const ZIP_EOCD = [0x50, 0x4B, 0x05, 0x06];         // PK\x05\x06

describe('writeXlsx — ZIP envelope', () => {
  it('starts with the ZIP local-file-header magic', () => {
    const bytes = writeXlsx([], cols, {});
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual(ZIP_LOCAL_HEADER);
  });

  it('ends with the End-Of-Central-Directory record', () => {
    const bytes = writeXlsx([], cols, {});
    // EOCD is exactly 22 bytes when zip comment is empty.
    const tail = bytes.subarray(bytes.length - 22, bytes.length - 18);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual(ZIP_EOCD);
  });

  it('packs the canonical XLSX skeleton (5+ entries)', () => {
    const bytes = writeXlsx([], cols, {});
    const entries = unzipForTest(bytes);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/styles.xml');
  });
});

describe('writeXlsx — sheet content', () => {
  it('writes a header row and one data row per input', () => {
    const rows = [
      { desk: 'APAC', region: 'Rates',  pnl: 100 },
      { desk: 'EMEA', region: 'Credit', pnl: 200 },
    ];
    const bytes = writeXlsx(rows, cols, {});
    const sheet = textOfEntry(bytes, 'xl/worksheets/sheet1.xml');
    // Header labels appear (via shared strings table).
    expect(sheet).toMatch(/<row[^>]*r="1"/);   // header row
    expect(sheet).toMatch(/<row[^>]*r="2"/);   // first data row
    expect(sheet).toMatch(/<row[^>]*r="3"/);   // second data row
    // The numeric column writes as type-n (no shared string).
    expect(sheet).toMatch(/<c[^>]*t="n"[^>]*><v>100<\/v>/);
    expect(sheet).toMatch(/<c[^>]*t="n"[^>]*><v>200<\/v>/);
  });

  it('skipColumnHeaders omits the header row', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 1 }];
    const bytes = writeXlsx(rows, cols, { skipColumnHeaders: true });
    const sheet = textOfEntry(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/<row[^>]*r="1"/);
    expect(sheet).not.toMatch(/<row[^>]*r="2"/);
  });

  it('sheetName lands in the workbook sheet list', () => {
    const bytes = writeXlsx([], cols, { sheetName: 'Trades' });
    const wb = textOfEntry(bytes, 'xl/workbook.xml');
    expect(wb).toMatch(/name="Trades"/);
  });

  it('freezeRows + freezeColumns lands a <pane> element in the sheet', () => {
    const bytes = writeXlsx([{ desk: 'A', region: 'B', pnl: 1 }], cols, {
      freezeRows: 1,
      freezeColumns: 2,
    });
    const sheet = textOfEntry(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/<pane[^>]*ySplit="1"/);
    expect(sheet).toMatch(/<pane[^>]*xSplit="2"/);
    expect(sheet).toMatch(/state="frozen"/);
  });

  it('columnKeys filter selects + reorders columns', () => {
    const rows = [{ desk: 'APAC', region: 'Rates', pnl: 1 }];
    const bytes = writeXlsx(rows, cols, { columnKeys: ['pnl', 'desk'] });
    const sheet = textOfEntry(bytes, 'xl/worksheets/sheet1.xml');
    // First data column should now be the numeric PnL.
    expect(sheet).toMatch(/<c[^>]*r="A2"[^>]*t="n"[^>]*><v>1<\/v>/);
    // Second column = Desk (shared-string ref).
    expect(sheet).toMatch(/<c[^>]*r="B2"[^>]*t="s"/);
  });
});

describe('writeXlsx — shared strings + escaping', () => {
  it('shared strings table holds the unique text values exactly once', () => {
    const rows = [
      { desk: 'APAC', region: 'Rates', pnl: 1 },
      { desk: 'APAC', region: 'Rates', pnl: 2 }, // same strings reused
    ];
    const bytes = writeXlsx(rows, cols, {});
    const ss = textOfEntry(bytes, 'xl/sharedStrings.xml');
    // Unique strings: Desk, Region, PnL, APAC, Rates → 5 entries.
    const matches = ss.match(/<si>/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it('XML-escapes <, >, &, ", \\\' in text values', () => {
    const rows = [{ desk: '<a&b>', region: '"x\'y"', pnl: 1 }];
    const bytes = writeXlsx(rows, cols, {});
    const ss = textOfEntry(bytes, 'xl/sharedStrings.xml');
    expect(ss).toContain('&lt;a&amp;b&gt;');
    expect(ss).toContain('&quot;x&apos;y&quot;');
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function textOfEntry(zipBytes: Uint8Array, entryName: string): string {
  const entries = unzipForTest(zipBytes);
  const entry = entries.find((e) => e.name === entryName);
  if (!entry) throw new Error(`entry not found: ${entryName}`);
  return new TextDecoder('utf-8').decode(entry.bytes);
}
