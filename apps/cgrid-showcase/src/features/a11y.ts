import { CGrid } from '@cgrid/kernel';
import type { CColDef } from '@cgrid/kernel';
import type { Feature } from './index';
import type { ShowcaseRow } from '../seedData';
import { makeRows } from '../seedData';

/**
 * Cycle 24 / Tasks 1-7 — accessibility + keyboard demo.
 *
 * The toolbar lets visitors flip every Cycle 24 layer:
 *
 *   • Theme picker — Light / Dark / High contrast / High contrast dark
 *   • Tab-exits-grid toggle — wires tabToNextHeader/Previous so Tab
 *     at the last cell releases focus to the page instead of wrapping
 *   • Reduced motion banner — shows when the OS reports the preference
 *
 * A live announcement panel mirrors the contents of the grid's
 * aria-live region (role="status") so visitors see the same text a
 * screen reader would read.
 */

const COLUMNS: CColDef<ShowcaseRow>[] = [
  {
    colId: 'select',
    checkboxSelection: true,
    headerCheckboxSelection: true,
    pinned: 'left',
    width: 42,
    sortable: false,
    resizable: false,
  } as any,
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 120, filter: 'text' },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 110, filter: 'text' },
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 110, filter: 'text' },
  {
    colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 130,
    valueFormatter: ({ value }) => (typeof value === 'number'
      ? `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString()}` : ''),
    cellStyle: ({ value }) =>
      typeof value === 'number' && value >= 0 ? { fg: '#16a34a' } : { fg: '#dc2626' },
  },
  {
    colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 140,
    valueFormatter: ({ value }) => (typeof value === 'number' ? `$${value.toLocaleString()}` : ''),
  },
];

type ThemeChoice =
  | 'cg-theme-quartz'
  | 'cg-theme-quartz-dark'
  | 'cg-theme-high-contrast'
  | 'cg-theme-high-contrast-dark';

export const a11y: Feature = {
  id: 'a11y',
  label: 'A11y + Keyboard',
  description:
    'Cycle 24 / Tasks 1-7 — every accessibility surface in one demo. ' +
    'Theme pills flip between Quartz and WCAG AAA high-contrast variants. ' +
    'Tab-exits toggle wires tabToNextHeader/Previous so the user can leave the ' +
    'grid by keyboard. The announcement panel mirrors the live region a ' +
    'screen reader would read.',

  mount(gridHost, controls, theme) {
    let activeTheme: ThemeChoice = (theme as ThemeChoice) ?? 'cg-theme-quartz';
    let tabExits = false;
    let checkboxOnly = false;

    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: COLUMNS,
      theme: activeTheme,
      rowSelection: 'multiple',
      // Default: row-click toggles selection alongside the checkbox.
      // The toolbar's "Checkbox only" toggle below flips this on.
      suppressRowClickSelection: false,
      ariaLabel: 'Trading positions, accessibility demo',
      tabToNextHeader: ({ event: _e }) => !tabExits,
      tabToPreviousHeader: ({ event: _e }) => !tabExits,
    });

    grid.setRowData(makeRows(50));

    // ─── Theme pills ─────────────────────────────────────────────────

    const themeLabels: Record<ThemeChoice, string> = {
      'cg-theme-quartz': 'Light',
      'cg-theme-quartz-dark': 'Dark',
      'cg-theme-high-contrast': 'High contrast',
      'cg-theme-high-contrast-dark': 'High contrast dark',
    };
    const themeButtons: Partial<Record<ThemeChoice, HTMLButtonElement>> = {};
    const refreshTheme = () => {
      for (const t of Object.keys(themeLabels) as ThemeChoice[]) {
        themeButtons[t]?.classList.toggle('primary', t === activeTheme);
      }
    };

    const themeLabel = document.createElement('span');
    themeLabel.className = 'ctrl-label';
    themeLabel.textContent = 'Theme';
    controls.appendChild(themeLabel);

    for (const t of Object.keys(themeLabels) as ThemeChoice[]) {
      const btn = document.createElement('button');
      btn.className = 'ctrl-btn' + (t === activeTheme ? ' primary' : '');
      btn.textContent = themeLabels[t];
      btn.setAttribute('data-testid', `btn-a11y-theme-${t.replace('cg-theme-', '')}`);
      btn.addEventListener('click', () => {
        activeTheme = t;
        grid.setTheme(t);
        refreshTheme();
      });
      controls.appendChild(btn);
      themeButtons[t] = btn;
    }

    // ─── Tab-exits-grid toggle ──────────────────────────────────────

    const divider = document.createElement('span');
    divider.style.cssText = 'width:1px; height:20px; background:rgba(127,127,127,0.25); margin:0 4px;';
    controls.appendChild(divider);

    const tabBtn = document.createElement('button');
    const refreshTab = () => {
      tabBtn.textContent = `Tab exits grid: ${tabExits ? 'on' : 'off'}`;
      tabBtn.classList.toggle('primary', tabExits);
    };
    tabBtn.className = 'ctrl-btn';
    tabBtn.setAttribute('data-testid', 'btn-a11y-tab-exits');
    refreshTab();
    tabBtn.addEventListener('click', () => {
      tabExits = !tabExits;
      refreshTab();
    });
    controls.appendChild(tabBtn);

    // ─── Checkbox-only selection toggle ─────────────────────────────

    const cbBtn = document.createElement('button');
    const refreshCb = () => {
      cbBtn.textContent = `Checkbox-only selection: ${checkboxOnly ? 'on' : 'off'}`;
      cbBtn.classList.toggle('primary', checkboxOnly);
    };
    cbBtn.className = 'ctrl-btn';
    cbBtn.setAttribute('data-testid', 'btn-a11y-checkbox-only');
    refreshCb();
    cbBtn.addEventListener('click', () => {
      checkboxOnly = !checkboxOnly;
      grid.setGridOption('suppressRowClickSelection', checkboxOnly);
      refreshCb();
    });
    controls.appendChild(cbBtn);

    // ─── Reduced motion banner ──────────────────────────────────────

    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const banner = document.createElement('span');
      banner.className = 'ctrl-label';
      banner.style.color = '#f59e0b';
      banner.textContent = '⚠ reduced motion active — flash + animation disabled';
      banner.setAttribute('data-testid', 'reduced-motion-banner');
      controls.appendChild(banner);
    }

    // ─── Live-announcement mirror panel ─────────────────────────────

    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px', 'width:300px',
      'max-height:50vh', 'overflow:auto', 'padding:8px 10px',
      'background:var(--cg-popup-bg, rgba(0,0,0,0.85))',
      'color:var(--cg-popup-fg, #f3f4f6)',
      'border:1px solid var(--cg-popup-border, rgba(255,255,255,0.15))',
      'border-radius:6px', 'font:11px/1.45 ui-monospace, monospace',
      'pointer-events:none', 'z-index:50',
    ].join(';');
    panel.setAttribute('data-testid', 'announce-panel');
    const title = document.createElement('div');
    title.textContent = 'aria-live mirror';
    title.style.cssText = 'font-weight:600; margin-bottom:6px; opacity:0.7;';
    panel.appendChild(title);
    const list = document.createElement('div');
    panel.appendChild(list);
    gridHost.style.position = 'relative';
    gridHost.appendChild(panel);

    const append = (text: string) => {
      if (!text) return;
      const row = document.createElement('div');
      row.textContent = text;
      row.style.cssText = 'padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.08);';
      list.insertBefore(row, list.firstChild);
      while (list.children.length > 12) list.removeChild(list.lastChild!);
    };

    // Mirror the a11y overlay's live region. Mutation observer is the
    // cheapest way to "shadow" textContent changes without coupling
    // to internals.
    const liveEl = gridHost.querySelector('[role="status"]') as HTMLElement | null;
    if (liveEl) {
      let lastText = '';
      const watch = new MutationObserver(() => {
        const t = (liveEl.textContent ?? '').trim();
        if (t && t !== lastText) {
          lastText = t;
          append(t);
        }
      });
      watch.observe(liveEl, { childList: true, characterData: true, subtree: true });
    }

    return grid;
  },
};
