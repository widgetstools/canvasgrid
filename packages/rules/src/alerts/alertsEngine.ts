// AlertsEngine — triggers/debounce/history. Ships in Tasks 7–8.
import type { Schema } from '@cgrid/expression';
import type {
  AlertEvent, AlertRule, AlertsSettings, RowChangeSet, SetRulesResult, Unsubscribe,
} from '../types';

export class AlertsEngine {
  constructor(_opts?: { settings?: Partial<AlertsSettings>; schema?: Schema; now?: () => number }) {
    throw new Error('not-yet-implemented: AlertsEngine ships in Task 7');
  }
  setRules(_rules: AlertRule[]): SetRulesResult { throw new Error('not-yet-implemented'); }
  getRules(): AlertRule[] { throw new Error('not-yet-implemented'); }
  getSettings(): AlertsSettings { throw new Error('not-yet-implemented'); }
  setSettings(_patch: Partial<AlertsSettings>): void { throw new Error('not-yet-implemented'); }
  applyChanges(_changes: RowChangeSet): void { throw new Error('not-yet-implemented'); }
  onAlert(_fn: (alert: AlertEvent) => void): Unsubscribe { throw new Error('not-yet-implemented'); }
  getHistory(): AlertEvent[] { throw new Error('not-yet-implemented'); }
  unreadCount(): number { throw new Error('not-yet-implemented'); }
  markAllRead(): void { throw new Error('not-yet-implemented'); }
  flushThrottled(): void { throw new Error('not-yet-implemented'); }
  droppedCount(): number { throw new Error('not-yet-implemented'); }
}
