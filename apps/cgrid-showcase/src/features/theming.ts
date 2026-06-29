import { CGrid } from 'cgrid';
import type { CColDef } from 'cgrid';
import type { Feature } from './index';
import type { ShowcaseRow } from '../seedData';
import { makeRows } from '../seedData';

/**
 * Cycle 22 / Tasks 1-5 — theming surface demo.
 *
 * The toolbar exercises every Cycle 22 layer side-by-side:
 *   • Density pills (compact / normal / comfortable)
 *   • Theme pills (quartz / dark / auto)
 *   • Live token override pickers (bg / fg / header bg / focus / row height)
 *   • Shadow-root toggle (destroys + rebuilds the grid inside a shadow tree)
 *
 * Pick a section, watch the grid respond on the next paint frame. No
 * scroll repositioning, no data reload — every change is a single
 * class flip / inline-style write / `cssReader.read()` + repaint.
 */
type Density = 'compact' | 'normal' | 'comfortable';
type ThemeChoice = 'cg-theme-quartz' | 'cg-theme-quartz-dark' | 'cg-theme-auto';

const COLUMNS: CColDef<ShowcaseRow>[] = [
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 120 },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 120 },
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 120 },
  { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', width: 120 },
  {
    colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 130,
    valueFormatter: ({ value }) =>
      typeof value === 'number'
        ? `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString()}`
        : '',
    cellStyle: ({ value }) =>
      typeof value === 'number' && value >= 0 ? { fg: '#16a34a' } : { fg: '#dc2626' },
  },
  {
    colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 140,
    valueFormatter: ({ value }) => (typeof value === 'number' ? `$${value.toLocaleString()}` : ''),
  },
];

export const theming: Feature = {
  id: 'theming',
  label: 'Theming',
  description:
    'Cycle 22 / Tasks 1-5 — every theming layer driven from the toolbar. ' +
    'Density pills swap one CSS class. Theme pills swap another. Token ' +
    'overrides land as inline styles. Shadow-root toggle re-mounts the ' +
    'entire grid inside an encapsulated DOM tree.',

  mount(gridHost, controls, theme) {
    let activeTheme: ThemeChoice = (theme as ThemeChoice) ?? 'cg-theme-quartz';
    let activeDensity: Density = 'normal';
    let shadowMode = false;
    let liveOverrides: Record<string, string> = {};
    let grid: CGrid<ShowcaseRow>;

    const construct = (): CGrid<ShowcaseRow> => {
      // Wipe + rebuild the host so the shadow-root toggle doesn't pile
      // up multiple grids on the same node.
      gridHost.innerHTML = '';
      if (gridHost.shadowRoot) {
        // happy path — destroy() already detached the previous tree
        // when shadow mode was on. No-op otherwise.
      }
      const g = new CGrid<ShowcaseRow>(gridHost, {
        getRowId: (r) => r.id,
        columnDefs: COLUMNS,
        theme: activeTheme,
        density: activeDensity,
        shadowRoot: shadowMode,
      });
      g.setRowData(makeRows(60));
      if (Object.keys(liveOverrides).length > 0) {
        g.setThemeParams(liveOverrides);
      }
      return g;
    };

    grid = construct();

    // ─── Toolbar layout helpers ──────────────────────────────────────

    const section = (label: string): HTMLElement => {
      const el = document.createElement('span');
      el.className = 'ctrl-label';
      el.textContent = label;
      return el;
    };

    const pill = (
      label: string,
      testId: string,
      isActive: boolean,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'ctrl-btn' + (isActive ? ' primary' : '');
      btn.textContent = label;
      btn.setAttribute('data-testid', testId);
      btn.addEventListener('click', onClick);
      return btn;
    };

    const divider = (): HTMLElement => {
      const el = document.createElement('span');
      el.style.cssText = 'width:1px; height:20px; background:rgba(127,127,127,0.25); margin:0 4px;';
      return el;
    };

    // ─── Density pills ───────────────────────────────────────────────

    const densityButtons: Record<Density, HTMLButtonElement> = {} as any;
    const refreshDensity = () => {
      for (const d of ['compact', 'normal', 'comfortable'] as Density[]) {
        densityButtons[d].classList.toggle('primary', d === activeDensity);
      }
    };
    const setDensity = (next: Density) => {
      activeDensity = next;
      grid.setGridOption('density', next);
      refreshDensity();
    };

    controls.appendChild(section('Density'));
    for (const d of ['compact', 'normal', 'comfortable'] as Density[]) {
      densityButtons[d] = pill(
        d[0]!.toUpperCase() + d.slice(1),
        `btn-density-${d}`,
        d === activeDensity,
        () => setDensity(d),
      );
      controls.appendChild(densityButtons[d]);
    }
    controls.appendChild(divider());

    // ─── Theme pills ─────────────────────────────────────────────────

    const themeButtons: Record<ThemeChoice, HTMLButtonElement> = {} as any;
    const themeLabels: Record<ThemeChoice, string> = {
      'cg-theme-quartz': 'Light',
      'cg-theme-quartz-dark': 'Dark',
      'cg-theme-auto': 'Auto',
    };
    const refreshTheme = () => {
      for (const t of Object.keys(themeLabels) as ThemeChoice[]) {
        themeButtons[t].classList.toggle('primary', t === activeTheme);
      }
    };
    const setTheme = (next: ThemeChoice) => {
      activeTheme = next;
      grid.setTheme(next);
      refreshTheme();
    };

    controls.appendChild(section('Theme'));
    for (const t of Object.keys(themeLabels) as ThemeChoice[]) {
      themeButtons[t] = pill(themeLabels[t], `btn-theme-${t.replace('cg-theme-', '')}`, t === activeTheme, () => setTheme(t));
      controls.appendChild(themeButtons[t]);
    }
    controls.appendChild(divider());

    // ─── Live token overrides ────────────────────────────────────────

    controls.appendChild(section('Tokens'));

    const applyOverride = (key: string, value: string) => {
      if (value === '') {
        delete liveOverrides[key];
      } else {
        liveOverrides[key] = value;
      }
      grid.setThemeParams({ [key]: value });
    };

    const colorPicker = (label: string, token: string, defaultColor: string, testId: string) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:inline-flex; align-items:center; gap:4px; font-size:12px; color:var(--ctrl-label-color, #8b949e);';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      const input = document.createElement('input');
      input.type = 'color';
      input.value = defaultColor;
      input.setAttribute('data-testid', testId);
      input.style.cssText = 'width:28px; height:24px; border:1px solid rgba(127,127,127,0.3); border-radius:4px; background:transparent; cursor:pointer; padding:0;';
      input.addEventListener('input', () => applyOverride(token, input.value));
      wrap.appendChild(lbl);
      wrap.appendChild(input);
      return wrap;
    };

    controls.appendChild(colorPicker('bg', '--cg-bg-color', '#ffffff', 'token-bg'));
    controls.appendChild(colorPicker('fg', '--cg-fg-color', '#1a1f24', 'token-fg'));
    controls.appendChild(colorPicker('header', '--cg-header-bg', '#f4f6f8', 'token-header'));
    controls.appendChild(colorPicker('focus', '--cg-focus-ring-color', '#3b82f6', 'token-focus'));

    const rowHeightSlider = document.createElement('label');
    rowHeightSlider.style.cssText = 'display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--ctrl-label-color, #8b949e);';
    const rowHeightLabel = document.createElement('span');
    rowHeightLabel.textContent = 'row';
    const rowHeightInput = document.createElement('input');
    rowHeightInput.type = 'range';
    rowHeightInput.min = '20';
    rowHeightInput.max = '64';
    rowHeightInput.step = '2';
    rowHeightInput.value = '32';
    rowHeightInput.setAttribute('data-testid', 'token-row-height');
    rowHeightInput.style.cssText = 'width:80px;';
    const rowHeightValue = document.createElement('span');
    rowHeightValue.textContent = '32px';
    rowHeightValue.style.cssText = 'font-variant-numeric: tabular-nums; min-width:32px;';
    rowHeightInput.addEventListener('input', () => {
      const v = `${rowHeightInput.value}px`;
      rowHeightValue.textContent = v;
      applyOverride('--cg-row-height', v);
    });
    rowHeightSlider.appendChild(rowHeightLabel);
    rowHeightSlider.appendChild(rowHeightInput);
    rowHeightSlider.appendChild(rowHeightValue);
    controls.appendChild(rowHeightSlider);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'ctrl-btn';
    resetBtn.textContent = 'Reset tokens';
    resetBtn.setAttribute('data-testid', 'btn-reset-tokens');
    resetBtn.addEventListener('click', () => {
      // Source the keys from the grid itself so the button also clears
      // overrides set through the API directly (not just through the
      // toolbar pickers).
      const current = grid.getThemeParams();
      const clear: Record<string, string> = {};
      for (const k of Object.keys(current)) clear[k] = '';
      liveOverrides = {};
      grid.setThemeParams(clear);
      // Reset UI widgets too.
      rowHeightInput.value = '32';
      rowHeightValue.textContent = '32px';
    });
    controls.appendChild(resetBtn);

    controls.appendChild(divider());

    // ─── Shadow root toggle ──────────────────────────────────────────

    controls.appendChild(section('Encapsulation'));
    const shadowBtn = document.createElement('button');
    const refreshShadow = () => {
      shadowBtn.textContent = `Shadow root: ${shadowMode ? 'on' : 'off'}`;
      shadowBtn.classList.toggle('primary', shadowMode);
    };
    shadowBtn.className = 'ctrl-btn';
    shadowBtn.setAttribute('data-testid', 'btn-shadow-root');
    refreshShadow();
    shadowBtn.addEventListener('click', () => {
      shadowMode = !shadowMode;
      refreshShadow();
      // shadowRoot is initial-only — destroy + reconstruct to flip.
      grid.destroy();
      grid = construct();
    });
    controls.appendChild(shadowBtn);

    return grid;
  },
};
