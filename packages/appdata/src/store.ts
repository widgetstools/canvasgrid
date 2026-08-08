/**
 * In-memory AppData store — named key/value bags used by `{{name.key}}`
 * template resolution (Markets AppData provider parity, without hub/IDB).
 */

import type { AppDataLookup } from './resolver';

export type AppDataChange = {
  providerName: string;
  key: string;
  value: unknown;
  previous: unknown;
};

export type AppDataUnsubscribe = () => void;

export class AppDataStore {
  private readonly bags = new Map<string, Map<string, unknown>>();
  private readonly listeners = new Set<(change: AppDataChange) => void>();

  /** Bound lookup suitable for `resolveTemplate` / `resolveCfg`. */
  readonly lookup: AppDataLookup = (providerName, key) => this.get(providerName, key);

  get(providerName: string, key: string): unknown {
    return this.bags.get(providerName)?.get(key);
  }

  set(providerName: string, key: string, value: unknown): void {
    let bag = this.bags.get(providerName);
    if (!bag) {
      bag = new Map();
      this.bags.set(providerName, bag);
    }
    const previous = bag.get(key);
    bag.set(key, value);
    this.emit({ providerName, key, value, previous });
  }

  delete(providerName: string, key: string): boolean {
    const bag = this.bags.get(providerName);
    if (!bag || !bag.has(key)) return false;
    const previous = bag.get(key);
    bag.delete(key);
    if (bag.size === 0) this.bags.delete(providerName);
    this.emit({ providerName, key, value: undefined, previous });
    return true;
  }

  /** Shallow snapshot: `{ [providerName]: { [key]: value } }`. */
  snapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, bag] of this.bags) {
      out[name] = Object.fromEntries(bag);
    }
    return out;
  }

  subscribe(fn: (change: AppDataChange) => void): AppDataUnsubscribe {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  clear(): void {
    const names = [...this.bags.keys()];
    for (const name of names) {
      const bag = this.bags.get(name)!;
      for (const key of [...bag.keys()]) this.delete(name, key);
    }
  }

  private emit(change: AppDataChange): void {
    for (const fn of this.listeners) {
      try { fn(change); } catch { /* listener errors must not break store */ }
    }
  }
}

/** True when value is an AppDataStore (has `.lookup` + `.get`). */
export function isAppDataStore(v: unknown): v is AppDataStore {
  return !!v
    && typeof v === 'object'
    && typeof (v as AppDataStore).get === 'function'
    && typeof (v as AppDataStore).lookup === 'function';
}

/** Normalize config `appData` to a lookup function. */
export function toAppDataLookup(appData: AppDataLookup | AppDataStore): AppDataLookup {
  return isAppDataStore(appData) ? appData.lookup : appData;
}
