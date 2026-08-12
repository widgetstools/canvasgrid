/**
 * Alerts engine — condition evaluation, token-bucket rate limit, message templates.
 */
import { compile, evaluate, parse } from '../expression/index';
import type { Compiled } from '../expression/types';
import { renderMessage } from './messageTemplate';
import { TokenBucket } from './tokenBucket';

export { renderMessage, type MessageContext } from './messageTemplate';
export { TokenBucket } from './tokenBucket';

export type AlertChannel = 'toast' | 'badge' | 'openfin';

export type AlertRule = {
  id: string;
  name?: string;
  /** Expression DSL, e.g. `[pnl] < 0`. */
  expression: string;
  channels: AlertChannel[];
  messageTemplate?: string;
  enabled?: boolean;
  /** Column watched for dataChange (optional). */
  column?: string;
};

export type AlertEvent = {
  ruleId: string;
  at: number;
  message: string;
  read: boolean;
  channels: AlertChannel[];
  rowId?: string;
};

type CompiledAlert = AlertRule & { compiled: Compiled | null };

export class AlertsEngine {
  private rules: CompiledAlert[] = [];
  private events: AlertEvent[] = [];
  private killSwitch = false;
  private readonly bucket: TokenBucket;
  private readonly maxHistory: number;
  private readonly now: () => number;
  private onFire: ((ev: AlertEvent) => void) | null = null;

  constructor(opts?: {
    maxPerSecond?: number;
    maxHistory?: number;
    now?: () => number;
  }) {
    this.now = opts?.now ?? (() => Date.now());
    this.bucket = new TokenBucket({
      capacityPerSecond: opts?.maxPerSecond ?? 10,
      now: this.now,
    });
    this.maxHistory = opts?.maxHistory ?? 200;
  }

  setOnFire(cb: ((ev: AlertEvent) => void) | null): void {
    this.onFire = cb;
  }

  setRules(rules: AlertRule[]): void {
    this.rules = rules.map((r) => {
      const parsed = parse(r.expression);
      if (!parsed.ok) return { ...r, compiled: null };
      const c = compile(parsed.ast);
      return { ...r, compiled: c.ok ? c.compiled : null };
    });
  }

  getRules(): AlertRule[] {
    return this.rules.map(({ compiled: _c, ...r }) => r);
  }

  setKillSwitch(on: boolean): void {
    this.killSwitch = on;
  }

  isKillSwitch(): boolean {
    return this.killSwitch;
  }

  /**
   * Evaluate all rules against a row. Rate-limited; fail-closed on eval errors.
   */
  evaluateRow(
    row: Record<string, unknown>,
    rowId: string,
  ): AlertEvent[] {
    if (this.killSwitch) return [];
    const fired: AlertEvent[] = [];
    for (const rule of this.rules) {
      if (rule.enabled === false || !rule.compiled) continue;
      let hit = false;
      try {
        hit = evaluate(rule.compiled, { row }) === true;
      } catch {
        continue;
      }
      if (!hit) continue;
      if (!this.bucket.tryTake()) break;
      const col = rule.column ?? null;
      const message = renderMessage(
        rule.messageTemplate ?? '{rule}: {rowId} {column}={value}',
        {
          rule: rule.name ?? rule.id,
          rowId,
          column: col,
          value: col ? row[col] : undefined,
          prev: undefined,
        },
      );
      const ev: AlertEvent = {
        ruleId: rule.id,
        at: this.now(),
        message,
        read: false,
        channels: rule.channels.slice(),
        rowId,
      };
      this.events.unshift(ev);
      if (this.events.length > this.maxHistory) this.events.length = this.maxHistory;
      fired.push(ev);
      this.onFire?.(ev);
    }
    return fired;
  }

  markRead(ruleId: string): void {
    for (const e of this.events) {
      if (e.ruleId === ruleId) e.read = true;
    }
  }

  markAllRead(): void {
    for (const e of this.events) e.read = true;
  }

  unreadCount(): number {
    return this.events.filter((e) => !e.read).length;
  }

  getEvents(): AlertEvent[] {
    return this.events.slice();
  }
}
