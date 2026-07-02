import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERTS_SETTINGS,
  type AlertRule,
  type ConditionalStyleRule,
  type IndicatorRule,
  type RowChangeSet,
} from '../src/index';

describe('types', () => {
  it('rule shapes are plain JSON (structuredClone-safe)', () => {
    const style: ConditionalStyleRule = {
      kind: 'style', id: 'r1', name: 'Neg P&L', enabled: true, priority: 10,
      condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
      style: { base: { color: '#c62828' }, dark: { color: '#ef9a9a' } },
      flash: { enabled: true, target: 'cell', mode: 'fade', color: '#c62828', durationMs: 800 },
      indicator: { iconName: 'trending-down', color: '#c62828', target: 'cell', position: 'after' },
      valueFormatter: '#,##0.00;[Red](#,##0.00)',
      activeDurationMs: 5000,
    };
    const indicator: IndicatorRule = {
      kind: 'indicator', id: 'r2', name: 'Fav', enabled: true, priority: 20,
      condition: '[fav] = true', scope: { kind: 'row' },
      indicator: { iconName: 'star', color: '#fbc02d', target: 'row-start', position: 'before' },
    };
    const alert: AlertRule = {
      id: 'a1', name: 'Big move', enabled: true, priority: 1, severity: 'warning',
      trigger: { kind: 'relativeChange', columnId: 'price', mode: 'PERCENT_CHANGE', threshold: 5, direction: 'both' },
      message: '{rule}: {column} moved {prev} → {value} on {rowId}',
      channels: ['toast', 'badge'],
    };
    for (const r of [style, indicator, alert]) {
      expect(structuredClone(r)).toEqual(r);
    }
  });

  it('DEFAULT_ALERTS_SETTINGS matches spec §3.2 defaults', () => {
    expect(DEFAULT_ALERTS_SETTINGS).toEqual({
      enabled: true,
      defaultDebounceMs: 1000,
      maxNotificationsPerSecond: 10,
      historyLimit: 200,
      enabledChannels: { toast: true, badge: true, openfin: true },
      evaluationMode: 'realtime',
    });
  });

  it('RowChangeSet shape round-trips', () => {
    const cs: RowChangeSet = {
      added: [{ rowId: 'x', row: { a: 1 } }],
      updated: [{ rowId: 'y', row: { a: 2 }, cells: [{ rowId: 'y', colId: 'a', oldValue: 1, newValue: 2 }] }],
      removed: [{ rowId: 'z', row: { a: 3 } }],
    };
    expect(structuredClone(cs)).toEqual(cs);
  });
});
