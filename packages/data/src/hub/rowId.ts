/**
 * Row identity from a `keyColumn`, single or composite.
 *
 * A leaf module on purpose, reachable as
 * `@wellsfargo-starui/velocity-grid-data/rowid` without the package index.
 * The index pulls in `connectHub`, whose `new SharedWorker(new URL(...))` a
 * bundler compiles as a nested worker entry — so importing this function
 * through the index drags the entire hub, and a second worker asset, into
 * whatever is doing the importing. That is merely wasteful in an app and
 * actively wrong in a WORKER build meant to deploy as one self-contained
 * file (`packages/perspective/src/workerFeedHost.ts` is one).
 *
 * Nothing here may import anything but types.
 */

/**
 * ASCII Unit Separator (0x1F) — joins composite key parts unambiguously.
 * Cannot appear in normal field values, so `{a:'New York', b:'X'}` and
 * `{a:'New', b:'York X'}` can never collide the way a literal space would.
 * Row ids are runtime-only (in-memory cache + wire), so this is not a
 * persisted format and needs no migration.
 */
export const COMPOSITE_KEY_SEPARATOR = '\u001F';

export function composeRowId(
  row: Record<string, unknown>,
  keyColumn: string | readonly string[] | undefined,
): string | null {
  if (keyColumn == null) return null;
  if (typeof keyColumn === 'string') {
    const v = row[keyColumn];
    return v == null ? null : String(v);
  }
  if (keyColumn.length === 0) return null;
  // Composite key: return null if any part is nullish; join with an unambiguous separator.
  const parts: string[] = [];
  for (const k of keyColumn) {
    const v = row[k];
    if (v == null) return null;
    parts.push(String(v));
  }
  return parts.join(COMPOSITE_KEY_SEPARATOR);
}
