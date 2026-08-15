import { describe, expect, it } from 'vitest';
import { tableNameForSchema, POSITION_SCHEMA, SHARED_TABLE_NAME } from '../src/bootstrap';
import { bookIdentityFor } from '../src/provider';
import type { StompPerspectiveProviderConfig } from '../src/provider';
import { PerspectiveBook } from '../src/book';

// Task 9 / C-M6 — the physical Perspective table name (and, via the same
// `tableNameForSchema` primitive, the feed leadership Web Lock name in
// `book.ts`'s `feedLockName()` — literally `cgrid-ssrm:feed:${tableNameForSchema(...)}`)
// used to be keyed on schema SHAPE alone. Two DataProvider catalog entries
// with identical `columnDefinitions` but different brokers/topics resolved
// to the SAME table on the shared-engine (SharedWorker) path, so grid B
// could render grid A's rows. `bookIdentityFor` folds providerId /
// websocketUrl / listenerTopic-or-clientId into the name so they no longer
// collide.

const SCHEMA = { ...POSITION_SCHEMA };

const CONFIG_A: StompPerspectiveProviderConfig = {
  providerId: 'provider-a',
  feed: 'stomp',
  wsUrl: 'ws://broker-a.example:8081',
  clientId: 'TRADER_A',
  schema: SCHEMA,
};

const CONFIG_B: StompPerspectiveProviderConfig = {
  providerId: 'provider-b',
  feed: 'stomp',
  wsUrl: 'ws://broker-b.example:8081',
  clientId: 'TRADER_B',
  schema: SCHEMA,
};

// Drives the REAL `PerspectiveBook.feedLockName()` (private — reached via
// bracket-notation, which TypeScript deliberately exempts from the `private`
// access check) instead of hand-rolling the `cgrid-ssrm:feed:${...}`
// template. A test that reimplements the string it's supposed to verify
// would still pass if `feedLockName` stopped threading `identity` at all.
// `PerspectiveBook` is constructible without WASM — `ensureTable` is lazy
// and the telemetry timer only starts when `onTelemetry` is supplied.
function feedLockNameFor(identity: string | undefined): string {
  const book = new PerspectiveBook({ schema: SCHEMA, identity });
  return book['feedLockName']();
}

describe('table + feed-lock identity (C-M6)', () => {
  it('two providers with identical columnDefinitions but different providerId/websocketUrl/clientId get distinct table names', () => {
    const identityA = bookIdentityFor(CONFIG_A);
    const identityB = bookIdentityFor(CONFIG_B);
    expect(identityA).not.toBe(identityB);

    const tableA = tableNameForSchema(SCHEMA, identityA);
    const tableB = tableNameForSchema(SCHEMA, identityB);
    expect(tableA).not.toBe(tableB);
    // Neither collides with the shared no-catalog demo table either.
    expect(tableA).not.toBe(SHARED_TABLE_NAME);
    expect(tableB).not.toBe(SHARED_TABLE_NAME);
  });

  it('two providers differing ONLY in websocketUrl (same providerId, same clientId) still get distinct table and lock names', () => {
    // Isolates the discriminator the plan actually calls out: `bookIdentityFor`
    // folds `providerId` first, so a test that also varies providerId/clientId
    // (as CONFIG_A/CONFIG_B above do) would pass even if `wsUrl` were dropped
    // from the identity fold entirely. This case holds providerId AND
    // clientId fixed so only `websocketUrl` can be doing the work.
    const configC: StompPerspectiveProviderConfig = {
      providerId: 'provider-shared',
      feed: 'stomp',
      wsUrl: 'ws://broker-x.example:8081',
      clientId: 'TRADER_SAME',
      schema: SCHEMA,
    };
    const configD: StompPerspectiveProviderConfig = {
      ...configC,
      wsUrl: 'ws://broker-y.example:8081',
    };

    const identityC = bookIdentityFor(configC);
    const identityD = bookIdentityFor(configD);
    expect(identityC).not.toBe(identityD);

    const tableC = tableNameForSchema(SCHEMA, identityC);
    const tableD = tableNameForSchema(SCHEMA, identityD);
    expect(tableC).not.toBe(tableD);

    expect(feedLockNameFor(identityC)).not.toBe(feedLockNameFor(identityD));
  });

  it('the same feed-lock template (book.ts `feedLockName`) therefore differs too', () => {
    const lockA = feedLockNameFor(bookIdentityFor(CONFIG_A));
    const lockB = feedLockNameFor(bookIdentityFor(CONFIG_B));
    expect(lockA).not.toBe(lockB);
  });

  it('is deterministic for the same identity + schema (repeat Applies reattach, not fork)', () => {
    const identity = bookIdentityFor(CONFIG_A);
    expect(tableNameForSchema(SCHEMA, identity)).toBe(tableNameForSchema(SCHEMA, identity));
  });

  it('same providerId/wsUrl/clientId still shares one table even when unrelated knobs differ', () => {
    const configA2: StompPerspectiveProviderConfig = {
      ...CONFIG_A,
      // Throughput knobs are not part of identity — same broker/provider
      // must still land on the same physical table regardless of these.
      snapshotRows: 500,
      rate: 10,
    };
    expect(tableNameForSchema(SCHEMA, bookIdentityFor(CONFIG_A)))
      .toBe(tableNameForSchema(SCHEMA, bookIdentityFor(configA2)));
  });

  it('no-catalog seed/demo config (no providerId/wsUrl/clientId) keeps the historical fixed table name', () => {
    expect(bookIdentityFor({})).toBeUndefined();
    expect(tableNameForSchema(SCHEMA, bookIdentityFor({}))).toBe(SHARED_TABLE_NAME);
  });

  it('a bare STOMP config without a catalog providerId is still scoped by broker (not just schema)', () => {
    const bare: StompPerspectiveProviderConfig = {
      feed: 'stomp',
      wsUrl: 'ws://broker-c.example:8081',
      clientId: 'TRADER_C',
    };
    const identity = bookIdentityFor(bare);
    expect(identity).toBeDefined();
    expect(tableNameForSchema(SCHEMA, identity)).not.toBe(SHARED_TABLE_NAME);
  });
});
