/**
 * Cycle 20 / Task 2 — XLSX writer (worker-side).
 *
 * Emits a minimal but valid Office Open XML Spreadsheet (XLSX) — a
 * ZIP of XML parts. Targets the common case:
 *
 *   • Single sheet
 *   • Shared strings table (text values deduplicated)
 *   • Inline numbers (no shared-strings indirection)
 *   • Optional frozen header row / left columns (<pane>)
 *   • XML escaping for &, <, >, ", '
 *
 * NOT in scope:
 *   • Multi-sheet workbooks
 *   • Formulas, charts, named ranges, conditional formatting
 *   • Per-cell styles (custom fonts / fills / borders / numFmts —
 *     ships as a follow-up if the demo asks for it)
 *
 * Compression: STORED only (see `zipWriter.ts` for the rationale —
 * keeps the bundle deflate-free). Excel + LibreOffice both open
 * STORED-method XLSX files fine.
 */

import { writeZip, type ZipEntry } from './zipWriter';

/** Minimal per-column metadata for XLSX serialization. */
export interface XlsxWriteColumn {
  colId: string;
  field?: string;
  headerName?: string;
  /** `'number'` writes the value as a numeric cell (`<c t="n">`).
   *  Anything else writes via the shared-strings table (`<c t="s">`). */
  type?: 'text' | 'number';
}

/** XLSX-specific options. Mirrors AG-Grid's `ExcelExportParams`
 *  for the subset a single-sheet writer can honour. */
export interface XlsxWriteOptions {
  sheetName?: string;          // default 'Sheet1'
  columnKeys?: string[];       // export only these columns
  skipColumnHeaders?: boolean;
  freezeRows?: number;         // freeze N rows at top
  freezeColumns?: number;      // freeze N columns at left
  author?: string;             // (currently unused — XLSX cores need it)
}

/** Serialize `rows` to XLSX bytes. */
export function writeXlsx(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: XlsxWriteColumn[],
  opts: XlsxWriteOptions,
): Uint8Array {
  const cols = resolveColumns(columns, opts.columnKeys);
  const sheetName = (opts.sheetName ?? 'Sheet1').replace(/[<>&"']/g, '_');

  // Build the shared strings table — every TEXT cell (and every
  // header) goes through here. Numbers stay inline.
  const sst = new SharedStrings();
  if (!opts.skipColumnHeaders) {
    for (const c of cols) sst.intern(c.headerName ?? c.colId);
  }
  // Pre-intern text values too — keeps the sheet-write pass single-pass.
  for (const row of rows) {
    for (const c of cols) {
      if (c.field === undefined) continue;
      if (c.type === 'number') continue;
      const raw = row[c.field];
      if (raw === null || raw === undefined) continue;
      sst.intern(typeof raw === 'string' ? raw : String(raw));
    }
  }

  const sheetXml = buildSheetXml(rows, cols, opts, sst);
  const sstXml = sst.toXml();
  const workbookXml = buildWorkbookXml(sheetName);
  const stylesXml = buildStylesXml();
  const contentTypesXml = buildContentTypesXml();
  const rootRelsXml = buildRootRelsXml();
  const workbookRelsXml = buildWorkbookRelsXml();

  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml',          bytes: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels',                  bytes: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml',              bytes: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels',   bytes: encoder.encode(workbookRelsXml) },
    { name: 'xl/worksheets/sheet1.xml',     bytes: encoder.encode(sheetXml) },
    { name: 'xl/styles.xml',                bytes: encoder.encode(stylesXml) },
    { name: 'xl/sharedStrings.xml',         bytes: encoder.encode(sstXml) },
  ];
  return writeZip(entries);
}

// ─── Internals ──────────────────────────────────────────────────────────────

function resolveColumns(columns: XlsxWriteColumn[], columnKeys?: string[]): XlsxWriteColumn[] {
  if (!columnKeys || columnKeys.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.colId, c]));
  const out: XlsxWriteColumn[] = [];
  for (const id of columnKeys) {
    const col = byId.get(id);
    if (col) out.push(col);
  }
  return out;
}

class SharedStrings {
  private list: string[] = [];
  private index = new Map<string, number>();

  intern(value: string): number {
    const existing = this.index.get(value);
    if (existing !== undefined) return existing;
    const id = this.list.length;
    this.list.push(value);
    this.index.set(value, id);
    return id;
  }

  toXml(): string {
    const count = this.list.length;
    const parts: string[] = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
    parts.push(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${count}">`);
    for (const v of this.list) {
      // <t xml:space="preserve"> protects leading/trailing whitespace.
      parts.push(`<si><t xml:space="preserve">${xmlEscape(v)}</t></si>`);
    }
    parts.push(`</sst>`);
    return parts.join('');
  }
}

/** Column index → Excel column letters (1 → 'A', 27 → 'AA'). */
function colLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSheetXml(
  rows: ReadonlyArray<Record<string, unknown>>,
  cols: XlsxWriteColumn[],
  opts: XlsxWriteOptions,
  sst: SharedStrings,
): string {
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
  parts.push(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`);

  // sheetViews with optional frozen pane.
  const freezeRows = opts.freezeRows ?? 0;
  const freezeColumns = opts.freezeColumns ?? 0;
  if (freezeRows > 0 || freezeColumns > 0) {
    const topLeft = `${colLetters(freezeColumns + 1)}${freezeRows + 1}`;
    parts.push(`<sheetViews><sheetView workbookViewId="0">`);
    parts.push(`<pane xSplit="${freezeColumns}" ySplit="${freezeRows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>`);
    parts.push(`</sheetView></sheetViews>`);
  }

  parts.push(`<sheetData>`);

  let rowIndex = 1;

  // Header row.
  if (!opts.skipColumnHeaders) {
    parts.push(`<row r="${rowIndex}">`);
    for (let c = 0; c < cols.length; c++) {
      const ref = `${colLetters(c + 1)}${rowIndex}`;
      const headerText = cols[c]!.headerName ?? cols[c]!.colId;
      const sstId = sst.intern(headerText);
      parts.push(`<c r="${ref}" t="s"><v>${sstId}</v></c>`);
    }
    parts.push(`</row>`);
    rowIndex++;
  }

  // Data rows.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    parts.push(`<row r="${rowIndex}">`);
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      const field = col.field;
      const raw = field === undefined ? undefined : row[field];
      const ref = `${colLetters(c + 1)}${rowIndex}`;
      if (raw === null || raw === undefined || raw === '') {
        // Empty cell — omit entirely (Excel treats missing as empty).
        continue;
      }
      if (col.type === 'number' && typeof raw === 'number') {
        parts.push(`<c r="${ref}" t="n"><v>${raw}</v></c>`);
      } else if (col.type === 'number' && typeof raw !== 'number') {
        // Numeric column with non-numeric value — write as shared
        // string to preserve the literal.
        const sstId = sst.intern(String(raw));
        parts.push(`<c r="${ref}" t="s"><v>${sstId}</v></c>`);
      } else {
        const sstId = sst.intern(typeof raw === 'string' ? raw : String(raw));
        parts.push(`<c r="${ref}" t="s"><v>${sstId}</v></c>`);
      }
    }
    parts.push(`</row>`);
    rowIndex++;
  }

  parts.push(`</sheetData>`);
  parts.push(`</worksheet>`);
  return parts.join('');
}

function buildWorkbookXml(sheetName: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `,
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>`,
    `</workbook>`,
  ].join('');
}

function buildStylesXml(): string {
  // Minimum-viable styles part — Excel requires this file even
  // when no per-cell styles are referenced.
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`,
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>`,
    `<borders count="1"><border/></borders>`,
    `<cellStyleXfs count="1"><xf/></cellStyleXfs>`,
    `<cellXfs count="1"><xf/></cellXfs>`,
    `</styleSheet>`,
  ].join('');
}

function buildContentTypesXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
    `</Types>`,
  ].join('');
}

function buildRootRelsXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`,
    `</Relationships>`,
  ].join('');
}

function buildWorkbookRelsXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`,
    `</Relationships>`,
  ].join('');
}
