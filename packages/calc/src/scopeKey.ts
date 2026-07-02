// Scope key derivation + delta-aggregate versioning. Ships in Task 6 (finalized).
import type { AggScope } from './types';

/** Context needed to resolve a group/parent scope into a concrete key. */
export interface ScopeKeyContext {
  groupKey?: string;
  parentKey?: string;
  groupSignature?: string;
}

export function scopeKeyOf(_scope: AggScope, _ctx?: ScopeKeyContext): string {
  throw new Error('not-yet-implemented: scopeKeyOf ships in Task 6');
}

/** Tracks per-scope-key data versions so delta aggregates can detect stale state. */
export class DataVersionMap {
  constructor() {
    throw new Error('not-yet-implemented: DataVersionMap ships in Task 6');
  }
  get(_key: string): number { throw new Error('not-yet-implemented'); }
  bump(_key: string): number { throw new Error('not-yet-implemented'); }
  delete(_key: string): void { throw new Error('not-yet-implemented'); }
  clear(): void { throw new Error('not-yet-implemented'); }
}
