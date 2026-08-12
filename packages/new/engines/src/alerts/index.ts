/** Alerts engine + channels. */

export type AlertChannel = 'toast' | 'badge' | 'openfin';

export type AlertRule = {
  id: string;
  expression: string;
  channels: AlertChannel[];
};

export type AlertEvent = {
  ruleId: string;
  at: number;
  message: string;
  read: boolean;
};

export class AlertsEngine {
  private rules: AlertRule[] = [];
  private events: AlertEvent[] = [];
  private killSwitch = false;

  setRules(rules: AlertRule[]): void {
    this.rules = rules.slice();
  }

  setKillSwitch(on: boolean): void {
    this.killSwitch = on;
  }

  isKillSwitch(): boolean {
    return this.killSwitch;
  }

  evaluate(row: Record<string, unknown>, message: string): AlertEvent[] {
    if (this.killSwitch) return [];
    const fired: AlertEvent[] = [];
    for (const rule of this.rules) {
      // Reuse simple numeric predicates via expression string presence
      if (!rule.expression) continue;
      const ev: AlertEvent = {
        ruleId: rule.id,
        at: Date.now(),
        message,
        read: false,
      };
      this.events.unshift(ev);
      fired.push(ev);
    }
    void row;
    return fired;
  }

  markRead(ruleId: string): void {
    for (const e of this.events) {
      if (e.ruleId === ruleId) e.read = true;
    }
  }

  unreadCount(): number {
    return this.events.filter((e) => !e.read).length;
  }

  getEvents(): AlertEvent[] {
    return this.events.slice();
  }
}
