// @wellsfargo-starui/velocity-grid-rules — public re-exports.
// See docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §4.1.

export { RuleEngine } from './ruleEngine';
export { AlertsEngine } from './alerts/alertsEngine';
export { wireIntoKernel } from './bridge';
export { compileCondition, validateRule } from './conditionCompiler';
export type { CompiledCondition } from './conditionCompiler';
export { renderMessage } from './alerts/messageTemplate';
export type { MessageContext } from './alerts/messageTemplate';
export { DEFAULT_ALERTS_SETTINGS } from './types';

export type {
  ThemeKind, StyleSlice, ThemeAwareStyle, FlashConfig, RuleIndicator,
  RuleIndicatorPlacement,
  RuleBorderStyle, RuleBorderSide, RuleBorderSpec,
  RuleScope, RuleBase, ConditionalStyleRule, IndicatorRule, StyleRule,
  AlertSeverity, AlertChannel, AlertTrigger, AlertRule, AlertEvent, AlertsSettings,
  RuleEvalContext, RuleCellResult, RuleValidationError, SetRulesResult,
  ChangeRecord, RowChangeSet, FlashDirective, WireRulesOptions, Unsubscribe,
} from './types';
export {
  RULE_INDICATOR_INLINE,
  RULE_INDICATOR_POSITIONAL,
  isRuleIndicatorPositional,
} from './types';
