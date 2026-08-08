import { VelocityGrid, ColorPickerControl } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
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
type ThemeChoice =
  | 'vg-theme-starui'
  | 'vg-theme-starui-dark'
  | 'vg-theme-quartz'
  | 'vg-theme-quartz-dark'
  | 'vg-theme-auto';

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
    let activeTheme: ThemeChoice = (theme as ThemeChoice) ?? 'vg-theme-quartz';
    let activeDensity: Density = 'normal';
    let shadowMode = false;
    let liveOverrides: Record<string, string> = {};
    let grid: VelocityGrid<ShowcaseRow>;

    const construct = (): VelocityGrid<ShowcaseRow> => {
      // Wipe + rebuild the host so the shadow-root toggle doesn't pile
      // up multiple grids on the same node.
      gridHost.innerHTML = '';
      if (gridHost.shadowRoot) {
        // happy path — destroy() already detached the previous tree
        // when shadow mode was on. No-op otherwise.
      }
      const g = new VelocityGrid<ShowcaseRow>(gridHost, {
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
      'vg-theme-starui': 'StarUI Light',
      'vg-theme-starui-dark': 'StarUI Dark',
      'vg-theme-quartz': 'Quartz Light',
      'vg-theme-quartz-dark': 'Quartz Dark',
      'vg-theme-auto': 'Auto',
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
      themeButtons[t] = pill(themeLabels[t], `btn-theme-${t.replace('vg-theme-', '')}`, t === activeTheme, () => setTheme(t));
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
      const picker = new ColorPickerControl(defaultColor, (rgba) => applyOverride(token, rgba));
      picker.el.setAttribute('data-testid', testId);
      wrap.appendChild(lbl);
      wrap.appendChild(picker.el);
      return wrap;
    };

    controls.appendChild(colorPicker('bg', '--vg-bg-color', '#ffffff', 'token-bg'));
    controls.appendChild(colorPicker('fg', '--vg-fg-color', '#1a1f24', 'token-fg'));
    controls.appendChild(colorPicker('header', '--vg-header-bg', '#f4f6f8', 'token-header'));
    controls.appendChild(colorPicker('focus', '--vg-focus-ring-color', '#3b82f6', 'token-focus'));

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
      applyOverride('--vg-row-height', v);
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
