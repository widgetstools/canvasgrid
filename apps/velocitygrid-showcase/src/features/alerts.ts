import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import type { AlertRule, AlertSeverity, AlertsEngine } from '@wellsfargo-starui/velocity-grid/rules';
import type { Feature } from './index';

/**
 * Cycle 21e / Task 16 — Alerts core demo.
 *
 * Three alert rules, one per trigger kind:
 *   • price-move — relativeChange, PERCENT_CHANGE ≥ 1%, 1.5s debounce.
 *   • deep-loss  — dataChange restricted to [pnl], severity critical.
 *   • row-added  — rowChange ROW_ADDED, severity info.
 *
 * The on-page log is fed by alerts.onAlert (severity chip + rendered
 * message); the unread badge tracks unreadCount()/markAllRead(); the
 * mode select flips evaluationMode (realtime / throttled / paused).
 * Channel ROUTING stays in the host by design — this page IS the
 * host's toast/badge surface.
 */

interface BlotterRow {
  symbol: string;
  price: number;
  pnl: number;
  qty: number;
}

const START_ROWS: BlotterRow[] = [
  { symbol: 'AAPL', price: 150.25, pnl: 1250, qty: 300 },
  { symbol: 'GOOG', price: 2850.10, pnl: -840, qty: 120 },
  { symbol: 'MSFT', price: 305.50, pnl: 410, qty: 650 },
  { symbol: 'TSLA', price: 720.85, pnl: 95, qty: 900 },
];

const ALERT_RULES: AlertRule[] = [
  {
    id: 'price-move', name: 'Price move ≥ 1%', enabled: true, priority: 1, severity: 'warning',
    trigger: { kind: 'relativeChange', colId: 'price', mode: 'PERCENT_CHANGE', threshold: 1, direction: 'both' },
    message: '{rule}: {rowId} {column} {prev} → {value}',
    channels: ['toast'],
    debounceMs: 1500,
  },
  {
    id: 'deep-loss', name: 'Deep loss', enabled: true, priority: 2, severity: 'critical',
    trigger: { kind: 'dataChange', expression: '[pnl] < -1000', columnIds: ['pnl'] },
    message: '{rule}: {rowId} P&L {value}',
    channels: ['toast', 'badge'],
  },
  {
    id: 'row-added', name: 'Row added', enabled: true, priority: 3, severity: 'info',
    trigger: { kind: 'rowChange', mode: 'ROW_ADDED' },
    message: '{rule}: {rowId} joined the blotter',
    channels: ['badge'],
  },
];

const COLUMNS: CColDef<BlotterRow>[] = [
  { colId: 'symbol', field: 'symbol', headerName: 'Symbol', cellDataType: 'text', width: 110 },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 120, valueFormatter: (p) => `$${Number(p.value).toFixed(2)}` },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 110 },
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90 },
];

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: '#3b82f6',
  success: '#16a34a',
  warning: '#f59e0b',
  critical: '#dc2626',
};

export const alertsFeature: Feature = {
  id: 'alerts',
  label: 'Alerts',
  description:
    'Cycle 21e — @wellsfargo-starui/velocity-grid/rules alerts core. Three trigger kinds ' +
    '(relativeChange 1% price moves with 1.5s debounce, dataChange ' +
    'deep-loss on [pnl], rowChange on adds), severity chips, message ' +
    'templating, unread badge with mark-all-read, and an evaluation ' +
    'mode switch (realtime / throttled / paused). Channel routing ' +
    'stays in the host — this log IS the host surface.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<BlotterRow>(gridHost, {
      getRowId: (r) => r.symbol,
      columnDefs: COLUMNS,
      theme,
      rowHeight: 32,
      headerHeight: 36,
      enableCellChangeFlash: true,
    });
    grid.setRowData(START_ROWS);

    const { alerts } = wireRules(grid, {
      alertRules: ALERT_RULES,
      alertsSettings: { defaultDebounceMs: 1000 },
    });
    (window as unknown as { __cgridAlerts: AlertsEngine }).__cgridAlerts = alerts;

    // ─── Data mutators ───────────────────────────────────────────────
    const data = new Map(START_ROWS.map((r) => [r.symbol, { ...r }]));
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    let addSeq = 0;

    /** Deterministic tick: AAPL +2% (crosses the 1% threshold). */
    const tickOnce = (): void => {
      const aapl = data.get('AAPL')!;
      aapl.price = round2(aapl.price * 1.02);
      grid.applyTransaction({ update: [{ ...aapl }] });
    };
    /** Five rapid MSFT +2% moves — debounce collapses them to ONE alert. */
    const burst = (): void => {
      for (let i = 0; i < 5; i += 1) {
        const msft = data.get('MSFT')!;
        msft.price = round2(msft.price * 1.02);
        grid.applyTransaction({ update: [{ ...msft }] });
      }
    };
    const addRow = (): void => {
      addSeq += 1;
      const row: BlotterRow = { symbol: `POS${addSeq}`, price: 100, pnl: 0, qty: 10 };
      data.set(row.symbol, row);
      grid.applyTransaction({ add: [{ ...row }] });
    };

    // ─── Alert log + unread badge (host-side channel surface) ────────
    const log = document.createElement('div');
    log.setAttribute('data-testid', 'alert-log');
    log.style.cssText =
      'flex-basis:100%; max-height:150px; overflow-y:auto; display:flex; ' +
      'flex-direction:column; gap:4px; padding:6px 2px 2px;';

    const badge = document.createElement('span');
    badge.className = 'ctrl-btn';
    badge.style.cursor = 'default';
    badge.setAttribute('data-testid', 'alert-unread');

    const renderBadge = (): void => {
      const n = alerts.unreadCount();
      badge.textContent = `Unread: ${n}`;
      badge.style.background = n > 0 ? 'rgba(245,158,11,0.18)' : '';
    };
    renderBadge();

    alerts.onAlert((a) => {
      const entry = document.createElement('div');
      entry.className = 'alert-entry';
      entry.setAttribute('data-severity', a.severity);
      entry.setAttribute('data-rule-id', a.ruleId);
      entry.style.cssText =
        'display:flex; align-items:center; gap:8px; ' +
        'font:12px ui-monospace, SFMono-Regular, Menlo, monospace;';
      const chip = document.createElement('span');
      chip.textContent = a.severity.toUpperCase();
      chip.style.cssText =
        'padding:1px 8px; border-radius:9px; font-size:10px; font-weight:600; ' +
        `letter-spacing:0.4px; color:#fff; background:${SEVERITY_COLORS[a.severity]};`;
      const msg = document.createElement('span');
      msg.textContent = a.message;
      entry.append(chip, msg);
      log.prepend(entry);
      renderBadge();
    });

    // ─── Controls ────────────────────────────────────────────────────
    const mkBtn = (label: string, testid: string, fn: () => void, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = primary ? 'ctrl-btn primary' : 'ctrl-btn';
      b.textContent = label;
      b.setAttribute('data-testid', testid);
      b.addEventListener('click', fn);
      return b;
    };

    const modeSelect = document.createElement('select');
    modeSelect.className = 'ctrl-btn';
    modeSelect.setAttribute('data-testid', 'sel-alert-mode');
    for (const mode of ['realtime', 'throttled', 'paused'] as const) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = `Mode: ${mode}`;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      alerts.setSettings({ evaluationMode: modeSelect.value as 'realtime' | 'throttled' | 'paused' });
    });

    controls.append(
      mkBtn('Tick once (+2% AAPL)', 'btn-al-tick-once', tickOnce, true),
      mkBtn('Burst ×5 (MSFT)', 'btn-al-burst', burst),
      mkBtn('Add row', 'btn-al-add', addRow),
      modeSelect,
      mkBtn('Mark all read', 'btn-alert-read', () => { alerts.markAllRead(); renderBadge(); }),
      badge,
      log,
    );

    return grid;
  },
};
