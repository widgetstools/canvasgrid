/**
 * `groupDelta` (Rust hub) -> `SkeletonGroup[]` (VelocityGrid SSRM v2).
 *
 * The Rust hub and VelocityGrid's v2 datasource turn out to agree about
 * grouping in a way neither was designed for. `GroupWatch` computes
 * "aggregates for every group node at every level, keyed by group path" and
 * pushes only the paths whose aggregate moved; v2's `getGroupSkeleton` asks
 * for "all group rows for the current sort/filter/groupBy, any order". Those
 * are the same object.
 *
 * Worth stating, because the hub's own AG-Grid adapter does NOT use this
 * path. AG's server-side model is index-based with server-held expansion, so
 * `RustHubDataService` bridges `readWindow` + `expandRow` and fabricates a
 * root row to make the indices line up -- its comments call these "two shape
 * gaps". v2 deliberately moved expansion client-side and asks for the whole
 * tree at once, which is what the hub already computes. The mapping below is
 * therefore a rename, not a bridge:
 *
 *     groupDelta.groups[].values      -> SkeletonGroup.path
 *     groupDelta.groups[].count       -> SkeletonGroup.leafCount
 *     groupDelta.groups[].aggregates  -> SkeletonGroup.aggregates
 *
 * Note `values`, NOT `path`. The engine's `path` is a type-TAGGED key from
 * its own value encoding -- a string group comes back as `"sRates"`, not
 * `"Rates"` -- while `values` carries the raw group values. Mapping `path`
 * onto v2's `SkeletonGroup.path` paints `sRates` as the group caption, which
 * is what running this against the real engine turned up. The tagged form
 * still earns its keep as the identity key below: it is unambiguous in a way
 * raw values are not.
 *
 * The push is incremental -- the hub never re-sends an unchanged group -- so
 * this owns the FOLD rather than a one-shot convert.
 */

/** One group in a `groupDelta` push. */
export interface HubGroupRow {
  /** The engine's identity key, one tagged value per grouped level --
   *  `["sRates"]` for a string group. Stable and collision-free; used to key
   *  the accumulator, never shown. */
  path: string[];
  /** The RAW group values, one per level. This is what v2's
   *  `SkeletonGroup.path` means and what the grid paints. */
  values?: unknown[];
  /** Leaves under this subtree. */
  count?: number;
  aggregates?: Record<string, unknown>;
}

/** The hub's `type: 'groupDelta'` push. */
export interface HubGroupDelta {
  type?: string;
  datasourceId?: string;
  /** Groups whose aggregate or leaf count moved since the last push. */
  groups?: HubGroupRow[];
  /** Paths that no longer exist, as raw path arrays. */
  removed?: string[][];
}

/** VelocityGrid's `SkeletonGroup`, structurally -- the kernel owns the
 *  nominal type, and packages/data does not depend on the kernel. */
export interface SkeletonGroupShape {
  path: string[];
  leafCount: number;
  aggregates?: Record<string, unknown>;
}

/** The engine's tagged path -> a map key. NUL is the separator because it
 *  cannot appear in a group value that arrived as JSON text, the way `/` or
 *  `|` can: `['a/b']` and `['a','b']` must not collide. */
const pathKey = (path: readonly string[]): string => path.join('\u0000');

/**
 * Accumulates `groupDelta` pushes into the full skeleton.
 *
 * One per open view. `apply` folds a push in; `skeleton()` hands back what
 * `getGroupSkeleton` answers with.
 */
export class HubGroupSkeleton {
  #byPath = new Map<string, SkeletonGroupShape>();

  /** Fold one push in. Returns true when something actually changed, so a
   *  caller can skip work on an empty delta. */
  apply(delta: HubGroupDelta | null | undefined): boolean {
    if (!delta) return false;
    let touched = false;
    for (const g of delta.groups ?? []) {
      if (!Array.isArray(g?.path)) continue;
      const key = pathKey(g.path);
      const prev = this.#byPath.get(key);
      const next: SkeletonGroupShape = {
        // `values` is the raw form the grid paints. Falling back to the
        // tagged `path` keeps a malformed push addressable rather than
        // dropping the group, but it WILL read as `sRates` if it ever fires.
        path: (g.values ?? g.path).map((v) => String(v)),
        // `count` is the hub's name for the same number. Absent means the
        // push carried only moved aggregates, so keep the count we have.
        leafCount: typeof g.count === 'number' ? g.count : prev?.leafCount ?? 0,
      };
      // Same rule for aggregates: only replace what the push actually sent.
      const aggs = g.aggregates ?? prev?.aggregates;
      if (aggs !== undefined) next.aggregates = aggs;
      this.#byPath.set(key, next);
      touched = true;
    }
    for (const path of delta.removed ?? []) {
      if (!Array.isArray(path)) continue;
      if (this.#byPath.delete(pathKey(path))) touched = true;
    }
    return touched;
  }

  /**
   * The current skeleton. Insertion-ordered, which v2 accepts: it normalises
   * to display order itself and only promises to keep sibling input order.
   */
  skeleton(): SkeletonGroupShape[] {
    return [...this.#byPath.values()];
  }

  /** Leaves across the TOP-level groups -- the whole filtered set, without
   *  asking the hub to count it again. Summing every depth would
   *  multiple-count the same leaf once per level. */
  topLevelLeafCount(): number {
    let n = 0;
    for (const g of this.#byPath.values()) if (g.path.length === 1) n += g.leafCount;
    return n;
  }

  /** Drop everything. A new sort/filter/groupBy generation invalidates the
   *  tree, and the hub restarts its own diff from empty. */
  reset(): void {
    this.#byPath.clear();
  }

  get size(): number {
    return this.#byPath.size;
  }
}
