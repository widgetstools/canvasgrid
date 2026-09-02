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

  it('resolves the worker source next to this module', () => {
    // A path that stops resolving would emit nothing and fail at runtime.
    expect(() => readFileSync(
      fileURLToPath(new URL('../src/sharedServer.worker.ts', import.meta.url)),
    )).not.toThrow();
  });
});
