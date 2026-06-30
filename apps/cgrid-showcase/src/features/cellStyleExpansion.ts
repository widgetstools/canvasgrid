import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

/**
 * Cycle 27 / Task 1 — Cell style expansion demo.
 *
 * Exercises every new ColCellOverrides field in one grid:
 *  - bg / fg per column (and via cellStyle function based on value sign)
 *  - valign top / middle / bottom across rows
 *  - font breakouts: fontSize, fontWeight, fontStyle (italic), fontFamily
 *  - textTransform: uppercase
 *  - letterSpacing
 *  - padding (uniform + per-side)
 *  - headerStyle on a leaf column
 *  - groupHeaderStyle on a column group
 */
export const cellStyleExpansion: Feature = {
  id: 'cellStyleExpansion',
  label: 'Cycle 27: Cell Style Expansion',
  description:
    'Demonstrates new ColCellOverrides fields: valign, font breakouts, textTransform, letterSpacing, padding, headerStyle, and groupHeaderStyle.',

  mount(gridHost, _controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      rowHeight: 48,
      headerHeight: 40,
      theme,
      columnDefs: [
        // Identity columns — left pin. ML/right padding tweaked.
        {
          colId: 'desk',
          field: 'desk',
          headerName: 'Desk',
          cellDataType: 'text',
          width: 110,
          // headerStyle: an uppercase, italic, larger header for emphasis +
          // a 3px solid teal bottom border (Task 2).
          headerStyle: {
            bg: '#1f2937',
            fg: '#fbbf24',
            fontWeight: 700,
            fontStyle: 'italic',
            fontSize: 14,
            textTransform: 'uppercase',
            letterSpacing: 1,
            border: { bottom: { width: 3, color: '#fbbf24', style: 'solid' } },
          },
          cellStyle: {
            valign: 'top',
            padding: { top: 6, left: 12 },
            fontWeight: 600,
            // Task 2: dotted right separator to visually divide the
            // identity columns from the price block.
            border: { right: { width: 1, color: '#fbbf24', style: 'dotted' } },
          },
        },
        {
          colId: 'ticker',
          field: 'ticker',
          headerName: 'Ticker',
          cellDataType: 'text',
          width: 110,
          headerStyle: { textTransform: 'uppercase' as const, letterSpacing: 2 },
          cellStyle: {
            valign: 'middle',
            fontFamily: 'monospace',
            fontSize: 14,
            letterSpacing: 1,
            // Task 2: dashed left border to bracket the ticker column
            // with the dotted separator on its left neighbour.
            border: { left: { width: 1, color: '#9ca3af', style: 'dashed' } },
          },
        },

        // Price column — group header
        {
          headerName: 'Pricing',
          // groupHeaderStyle: dark band for the whole group header
          headerStyle: {
            bg: '#0f766e',
            fg: '#ffffff',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 2,
            fontSize: 13,
          },
          children: [
            {
              colId: 'pnl',
              field: 'pnl',
              headerName: 'P&L',
              cellDataType: 'number',
              width: 120,
              // Function-form cellStyle: color + bg by sign + bottom valign
              // + a colored bottom border that matches the sign tint
              // (Task 2 — function-form patches can also set borders).
              cellStyle: (p) => {
                const v = Number(p.value ?? 0);
                if (v > 0) return {
                  fg: '#065f46', bg: '#d1fae5', valign: 'bottom', fontWeight: 600,
                  border: { bottom: { width: 2, color: '#10b981', style: 'solid' } },
                };
                if (v < 0) return {
                  fg: '#7f1d1d', bg: '#fee2e2', valign: 'bottom', fontWeight: 600,
                  border: { bottom: { width: 2, color: '#ef4444', style: 'solid' } },
                };
                return { valign: 'bottom' };
              },
            },
            {
              colId: 'notional',
              field: 'notional',
              headerName: 'Notional',
              cellDataType: 'number',
              width: 130,
              cellStyle: {
                valign: 'top',
                fontStyle: 'italic',
                padding: { top: 6, right: 12 },
              },
            },
          ],
        },

        // Sector — capitalize transform + Task 2 'all' border (every
        // cell in the column gets a thin double-line outline).
        {
          colId: 'sector',
          field: 'sector',
          headerName: 'Sector',
          cellDataType: 'text',
          flex: 1,
          headerStyle: { halign: 'center' },
          cellStyle: {
            halign: 'center',
            textTransform: 'capitalize',
            fontWeight: 500,
            border: { all: { width: 1, color: '#a78bfa', style: 'double' } },
          },
        },
      ],
    });

    grid.setRowData(makeRows(40));

    return grid;
  },
};
