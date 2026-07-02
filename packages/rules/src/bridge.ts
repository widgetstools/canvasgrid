// Kernel bridge. Ships in Task 15.
import type { WireRulesOptions } from './types';
import type { RuleEngine } from './ruleEngine';
import type { AlertsEngine } from './alerts/alertsEngine';

export function wireIntoKernel(
  _grid: unknown,
  _opts?: WireRulesOptions,
): { rules: RuleEngine; alerts: AlertsEngine } {
  throw new Error('not-yet-implemented: wireIntoKernel ships in Task 15');
}
