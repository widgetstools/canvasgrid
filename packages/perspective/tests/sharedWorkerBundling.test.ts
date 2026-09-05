import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The shared-worker construction must stay in the shape a bundler can see.
 *
 * `new URL('./sharedServer.worker.ts', import.meta.url)` written LITERALLY
 * and INLINE inside a `new SharedWorker(...)` call is the exact pattern Vite
 * (and Rollup, and webpack 5) match to compile that file as a worker and
 * bundle its imports. Hand the constructor a URL computed anywhere else —
 * a helper, a variable, a config lookup — and the pattern no longer matches:
 * the build silently degrades to generic asset handling and emits the bare
 * `.ts` source with its `@perspective-dev/server` import unresolved, under an
 * extension most static servers do not serve as JavaScript.
 *
 * Nothing catches that at dev time, because a dev server serves the source
 * and resolves the import. It fails only in a production build, and it fails
 * quietly: the SharedWorker never starts, the client falls back to a
 * dedicated worker, and every tab gets its own Perspective engine — which is
 * precisely the sharing this package exists to provide. It has already been
 * broken once by a refactor that looked purely cosmetic.
 *
 * This is a source-shape assertion on purpose. Asserting on build OUTPUT
 * would mean running a real Vite build per test run; the invariant that
 * actually matters is textual, so that is what is pinned.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/bootstrap.ts', import.meta.url)),
  'utf8',
);

/** Collapse whitespace so a reformat (line breaks, indentation) does not
 *  read as a behavioural change — only the token order matters. */
const flat = SOURCE.replace(/\s+/g, ' ');

describe('shared-worker bundling pattern', () => {
  it('constructs the default worker with an inline new URL literal', () => {
    expect(
      flat,
      'new SharedWorker(new URL(\'./sharedServer.worker.ts\', import.meta.url), ...) '
      + 'must stay inline — see this file’s header for why',
    ).toContain("new SharedWorker( new URL('./sharedServer.worker.ts', import.meta.url)");
  });

  it('never passes a precomputed URL for the DEFAULT (bundled) worker', () => {
    // The configured branch legitimately passes a computed URL — that script
    // is deployed, not bundled. The default branch must not.
    const defaultBranch = flat.slice(flat.indexOf('function newSharedEngineWorker'));
    const inlineAt = defaultBranch.indexOf("new URL('./sharedServer.worker.ts', import.meta.url)");
    expect(inlineAt, 'default branch lost its literal worker URL').toBeGreaterThan(-1);
    // The literal must be the constructor's own argument, not assigned first.
    const before = defaultBranch.slice(Math.max(0, inlineAt - 40), inlineAt);
    expect(before, 'worker URL is assigned to a variable instead of passed inline')
      .toContain('new SharedWorker(');
  });

  it('keeps the worker options a static literal', () => {
    // Vite `eval`s the options object to decide the worker type, so a
    // variable in there is unparseable. Depending on the Vite version that is
    // either a hard build failure ("unable to parse the worker options as the
    // value is not static") or a silently skipped worker transform — which
    // lands straight back on the emitted-bare-`.ts` bug this file exists for.
    //
    // Not hypothetical: `{ name, type: 'module' }` shipped here and broke ELEVEN
    // test suites in `packages/ext`, which import this module transitively and
    // hit vitest's own (stricter) Vite. `packages/data` had already hit the
    // same thing and moved its name into the URL; this did not follow until
    // the failures were traced. Hence `?engine=` in `resolveEngineUrl`.
    const fn = flat.slice(flat.indexOf('function newSharedEngineWorker'));
    const body = fn.slice(0, fn.indexOf('function ', 1) + 1 || 800);
    for (const m of body.matchAll(/\{[^{}]*type: 'module'[^{}]*\}/g)) {
      expect(m[0], 'worker options must contain nothing but a literal type')
        .toBe("{ type: 'module' }");
    }
    expect(body, 'the instance name is back in the options object')
      .not.toMatch(/\{\s*name\s*[,}]/);
  });

  it('keeps the page and worker protocol constants in lockstep', () => {
    // They are exchanged on `hello` and compared at runtime, so a drift is
    // reported rather than silent — but a drift introduced by editing one
    // side and forgetting the other is a bug, not a rollout.
    const worker = readFileSync(
      fileURLToPath(new URL('../src/sharedServer.worker.ts', import.meta.url)),
      'utf8',
    );
    const of = (src: string) =>
      /SHARED_ENGINE_PROTOCOL\s*=\s*(\d+)/.exec(src)?.[1];
    expect(of(worker), 'worker declares no protocol version').toBeDefined();
    expect(of(SOURCE), 'bootstrap declares no protocol version').toBeDefined();
    expect(of(SOURCE), 'bootstrap and worker disagree on the protocol version')
      .toBe(of(worker));
  });

  it('never reaps a session that did not opt into heartbeats', () => {
    // The rollout hazard this guards: the worker is deployed once per origin
    // while apps ship separately, so an older page — one built before the
    // heartbeat existed — will meet this worker. It goes quiet when idle and
    // always did, so judging it by heartbeat silence would close a LIVE
    // blotter's session after five minutes.
    const worker = readFileSync(
      fileURLToPath(new URL('../src/sharedServer.worker.ts', import.meta.url)),
      'utf8',
    ).replace(/\s+/g, ' ');
    const reaper = worker.slice(worker.indexOf('startReaper()'));
    const guard = reaper.indexOf('if (!session.heartbeats) continue;');
    const cutoff = reaper.indexOf('if (session.lastSeen >= cutoff) continue;');
    expect(guard, 'reaper lost its opt-in guard').toBeGreaterThan(-1);
    // Order matters: the opt-in check must gate the staleness check.
    expect(guard).toBeLessThan(cutoff);
  });

  it('keeps the deployed worker free of nested worker entries', () => {
    // The artefact is deployed as a BARE FILENAME an app hard-codes, so
    // anything the build emits alongside it is something nobody is told to
    // deploy — and it fails only at runtime, in a worker, where
    // `new SharedWorker` does not throw for a script it cannot load.
    //
    // The way that happens is an import reaching a module that constructs a
    // worker of its own, which a bundler compiles into a sibling entry. It
    // has happened once: `updateBuffer.ts` imported `composeRowId` from the
    // data package's INDEX, which reaches `connectHub` and its
    // `new SharedWorker(...)`, and the build grew an unreferenced 47 kB
    // `assets/worker-*.js`. Hence the `/rowid` leaf export.
    //
    // Walks the worker's own transitive relative imports rather than naming
    // the two files that happen to be involved today, so a new import from
    // anywhere in the graph is caught by the same rule.
    const seen = new Set<string>();
    const offenders: string[] = [];
    const walk = (rel: string): void => {
      if (seen.has(rel)) return;
      seen.add(rel);
      let src: string;
      try {
        src = readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
      } catch { return; }
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        if (spec === '@wellsfargo-starui/velocity-grid-data') {
          offenders.push(`${rel} → ${spec}`);
          continue;
        }
        if (!spec.startsWith('.')) continue;
        walk(spec.replace(/^\.\//, '') + (spec.endsWith('.ts') ? '' : '.ts'));
      }
    };
    walk('sharedServer.worker.ts');
    expect(
      offenders,
      'the deployed worker reached the data package INDEX, which builds a '
      + 'SharedWorker of its own. Import the leaf instead '
      + '(@wellsfargo-starui/velocity-grid-data/rowid).',
    ).toEqual([]);
    // And the guard is only meaningful if the walk actually got somewhere.
    expect(seen.size, 'import walk found nothing — did the entry move?')
      .toBeGreaterThan(2);
  });

  it('resolves the worker source next to this module', () => {
    // A path that stops resolving would emit nothing and fail at runtime.
    expect(() => readFileSync(
      fileURLToPath(new URL('../src/sharedServer.worker.ts', import.meta.url)),
    )).not.toThrow();
  });
});
