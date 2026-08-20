// Scope canonicalization + per-scope data-version bookkeeping for the
// aggregate cache, keyed (fn, colId, scopeKey, dataVersion) — spec §6.5.
//
// The WORKER supplies the signature strings; this module only
// canonicalizes. ctx.groupKey / ctx.parentKey are opaque here but MUST
// embed the group-model signature (e.g. 'sig|path') so a regroup
// invalidates every group/parent scope wholesale via
// bumpAllMatching('group:') / bumpAllMatching('parent:') — spec §5 risk
// table.
//
// Both exports are SELF-CONTAINED (zero free variables) and shipped as
// sources for the worker-side cache (Task 10) — the kernel has zero
// runtime @wellsfargo-starui/velocity-grid/calc imports. DataVersionMap uses a TS `private` field
// (not #private) so its compiled source survives the new Function
// round-trip untransformed.

import type { AggScope } from './types';

/** CROSS-TASK CONTRACT (Task 1, assembler): supersedes the Task 1
 *  skeleton's `scopeKeyOf(scope: AggScope, groupSignature: string)`
 *  declaration — a bare string can't distinguish group vs parent keys. */
export interface ScopeKeyContext {
  groupKey?: string;
  parentKey?: string;
}

export function scopeKeyOf(scope: AggScope, ctx: ScopeKeyContext = {}): string {
  switch (scope.kind) {
    case 'all':
      return 'all';
    case 'visible':
      return 'visible';
    case 'group': {
      if (ctx.groupKey === undefined) {
        throw new Error("scopeKeyOf: scope 'group' requires ctx.groupKey");
      }
      return 'group:' + ctx.groupKey;
    }
    case 'parent': {
      if (ctx.parentKey === undefined) {
        throw new Error("scopeKeyOf: scope 'parent' requires ctx.parentKey");
      }
      return 'parent:' + ctx.parentKey;
    }
  }
}

export class DataVersionMap {
  private versions = new Map<string, number>();

  /** Never-bumped scopes are at version 0. */
  versionOf(scopeKey: string): number {
    return this.versions.get(scopeKey) ?? 0;
  }

  /** Increment and return the new version. */
  bump(scopeKey: string): number {
    const v = (this.versions.get(scopeKey) ?? 0) + 1;
    this.versions.set(scopeKey, v);
    return v;
  }

  /** Bump every EXISTING key with the prefix (group-signature
   *  invalidation); returns how many were bumped. */
  bumpAllMatching(prefix: string): number {
    let count = 0;
    for (const key of this.versions.keys()) {
      if (key.startsWith(prefix)) {
        this.versions.set(key, (this.versions.get(key) as number) + 1);
        count += 1;
      }
    }
    return count;
  }

  clear(): void {
    this.versions.clear();
  }
}

/** Worker-shipping sources (Task 10 embeds them in the calc program). */
export const SCOPE_KEY_SOURCE: string = scopeKeyOf.toString();
export const DATA_VERSION_MAP_SOURCE: string = DataVersionMap.toString();
