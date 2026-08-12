// Cycle 21c / Task 15 — multi-format clipboard serialization helpers.
//
// Serialize a selected range to text/plain (TSV) + text/html (styled
// table). The HTML flavor carries composite fragment styling as inline
// <span> runs so a paste into Excel / Google Sheets keeps per-fragment
// color / weight / italic.
//
// Pure functions — the caller (cgrid.copySelectedRangesToClipboard)
// builds the RowExport grid from the selected ranges and the resolved
// column defs.

export interface CellExport {
  /** Plain text for the cell (also the TSV payload). */
  text: string;
  /** Present only for composite cells — styled runs for the HTML flavor. */
  fragments?: Array<{
    text: string;
    style: Record<string, string | number | undefined>;
  }>;
}

export interface RowExport {
  cells: CellExport[];
}

export function serializeToTsv(rows: RowExport[]): string {
  return rows.map((r) => r.cells.map((c) => escapeTsv(c.text)).join('\t')).join('\n');
}

function escapeTsv(text: string): string {
  return text.replace(/\t/g, ' ').replace(/\n/g, ' ');
}

export function serializeToHtml(rows: RowExport[]): string {
  const trs = rows
    .map((r) => {
      const tds = r.cells
        .map((c) => {
          if (c.fragments) {
            const spans = c.fragments
              .map((f) => `<span style="${styleToInline(f.style)}">${escapeHtml(f.text)}</span>`)
              .join('');
            return `<td>${spans}</td>`;
          }
          return `<td>${escapeHtml(c.text)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table>${trs}</table>`;
}

function styleToInline(style: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.background) parts.push(`background-color:${style.background}`);
  if (style.weight !== undefined) parts.push(`font-weight:${style.weight}`);
  if (style.style === 'italic' || style.italic) parts.push('font-style:italic');
  if (style.size !== undefined) parts.push(`font-size:${style.size}px`);
  return parts.join(';');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
