import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  connectHub,
  getDataHubTarget,
  DEFAULT_HUB_NAME,
  _resetHubConnectionForTests,
} from '../src/client/hubConnection';

/**
 * The hub worker must stay in the shape a bundler can see, and the hub's
 * identity must be reported honestly.
 *
 * The bundling half is a regression lock on a real production-only bug. The
 * construction used to read:
 *
 *     const url = opts?.workerUrl ?? new URL('../worker.ts', import.meta.url);
 *     sharedWorker = new SharedWorker(url, { type: 'module', name: '…' });
 *
 * Assigning the `new URL(...)` to a variable defeats the pattern Vite matches
 * to compile a worker entry. It fell back to generic asset handling and — for
 * a `.ts` file — inlined the RAW TYPESCRIPT as
 * `data:video/mp2t;base64,…` (MIME guessed from the extension), import
 * statements and type annotations intact. Browsers refuse it; `new
 * SharedWorker` does not throw for a bad script; every hub request then hung
 * until the 60s timeout. Dev servers hide it entirely, because they serve and
 * transpile the source.
 *
 * Verified against a real production build of the CSRM demo before the fix.
 */

// `import.meta.url` is an http URL under this package's happy-dom test
// environment, so resolve from the package root instead.
const pkgFile = (rel: string): string => resolve(process.cwd(), rel);
const SOURCE = readFileSync(pkgFile('src/client/hubConnection.ts'), 'utf8');
/** Collapse whitespace so a reformat does not read as a behavioural change. */
const flat = SOURCE.replace(/\s+/g, ' ');

describe('hub worker bundling pattern', () => {
  it('constructs the default worker with an inline new URL literal', () => {
    expect(
      flat,
      'new SharedWorker(new URL(\'../worker.ts\', import.meta.url), …) must stay inline '
      + '— see this file\'s header for what happens otherwise',
    ).toContain("new SharedWorker( new URL('../worker.ts', import.meta.url)");
  });

  it('never passes a precomputed URL for the DEFAULT (bundled) worker', () => {
    // The configured branch legitimately passes a computed URL — that script
    // is deployed, not bundled. The default branch must not.
    const fn = flat.slice(flat.indexOf('function newHubWorker'));
    const inlineAt = fn.indexOf("new URL('../worker.ts', import.meta.url)");
    expect(inlineAt, 'default branch lost its literal worker URL').toBeGreaterThan(-1);
    const before = fn.slice(Math.max(0, inlineAt - 40), inlineAt);
    expect(before, 'worker URL is assigned to a variable instead of passed inline')
      .toContain('new SharedWorker(');
  });

  it('keeps the worker options a static literal', () => {
    // Vite `eval`s the options object to decide the worker type, so a
    // variable in there makes it unparseable — "unable to parse the worker
    // options as the value is not static" — and the worker transform is
    // skipped, landing straight back on the data-URL bug above. Some Vite
    // versions tolerate it and some do not, which is not a difference worth
    // depending on. This is why the app name rides in the URL instead.
    const fn = flat.slice(flat.indexOf('function newHubWorker'), flat.indexOf('function newHubWorker') + 600);
    for (const m of fn.matchAll(/\{[^{}]*type: 'module'[^{}]*\}/g)) {
      expect(m[0], 'worker options must contain nothing but a literal type')
        .toBe("{ type: 'module' }");
    }
    expect(fn).not.toMatch(/\{\s*name\s*[,}]/);
  });

  it('resolves the worker entry next to this module', () => {
    expect(() => readFileSync(pkgFile('src/worker.ts'))).not.toThrow();
  });
});

describe('hub identity', () => {
  beforeEach(() => { _resetHubConnectionForTests(); });

  it('reports a bundled hub as per-app, with no URL to compare', () => {
    const t = getDataHubTarget();
    expect(t.bundled).toBe(true);
    expect(t.url).toBeNull();
    expect(t.name).toBe(DEFAULT_HUB_NAME);
  });

  it('resolves a root-relative deployed path against the ORIGIN', () => {
    // Load-bearing: two apps served from different paths must arrive at the
    // same absolute URL or they do not share a hub.
    const t = getDataHubTarget({ workerUrl: '/vendor/velocity-grid/data-hub.js' });
    expect(t.bundled).toBe(false);
    expect(t.url).toBe(new URL('/vendor/velocity-grid/data-hub.js?app=' + DEFAULT_HUB_NAME, location.href).href);
  });

  it('makes the name the axis that partitions hubs once the URL is fixed', () => {
    const url = '/vendor/velocity-grid/data-hub.js';
    const a = getDataHubTarget({ workerUrl: url, name: 'blotter-suite' });
    const b = getDataHubTarget({ workerUrl: url, name: 'risk-suite' });
    // The name rides IN the url (see resolveHubUrl), so differing names are
    // differing worker identities — which is the whole point.
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain('app=blotter-suite');
    expect(b.url).toContain('app=risk-suite');
    expect(a.name).not.toBe(b.name);
  });
});

describe('strict hub', () => {
  beforeEach(() => { _resetHubConnectionForTests(); });

  it('rejects the in-process hub, which shares nothing', () => {
    expect(() => connectHub({ inProcess: true, strict: true }))
      .toThrow(/per-page hub/);
  });

  it('rejects a bundled worker, naming the cause', () => {
    expect(() => connectHub({ strict: true })).toThrow(/no `workerUrl` configured/);
  });

  it('is off by default, so an unconfigured single app still works', () => {
    // In-process, because the test environment has no SharedWorker — the
    // point is that it does not throw.
    expect(() => connectHub({ inProcess: true })).not.toThrow();
  });
});
