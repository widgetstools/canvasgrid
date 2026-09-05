import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  configurePerspectiveSharedWorker,
  getPerspectiveSharedWorkerTarget,
  __resetSharedWorkerConfigForTests,
} from '../src/bootstrap';

/**
 * What a page's Perspective engine is keyed on.
 *
 * The intended model is `(origin, instance name)` with `bundled: false`: an
 * app joins the engine NAMED `name` on its origin, and nothing else enters
 * into it. The browser's own rule is stricter — `(origin, script URL, name)`,
 * and the URL cannot be opted out of — so the model only holds once every app
 * points at ONE deployed script and the URL stops varying. `bundled` is the
 * flag that says whether that has happened.
 *
 * These pin the reporting, because a wrong answer here is worse than no
 * answer: two apps comparing targets and concluding they share when they do
 * not is exactly the silent split the whole mechanism exists to prevent.
 */

const DEPLOYED = '/vendor/velocity-grid/psp-shared-worker.js';
/** The app this "page" is served from. Root-relative config must resolve
 *  against the ORIGIN, not the app path — two apps at /a1 and /a2 have to
 *  arrive at the same absolute URL or they do not share. */
const PAGE = 'http://blotters.example:4000/a1/index.html';
const RESOLVED = 'http://blotters.example:4000/vendor/velocity-grid/psp-shared-worker.js';

let hadLocation = false;
let originalLocation: unknown;

beforeEach(() => {
  __resetSharedWorkerConfigForTests();
  // A plain node run has no `location`; the resolution under test is a
  // browser one, so give it the one thing it needs rather than dragging in a
  // whole DOM implementation.
  hadLocation = 'location' in globalThis;
  originalLocation = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { href: PAGE, search: '' };
});

afterEach(() => {
  if (hadLocation) (globalThis as { location?: unknown }).location = originalLocation;
  else delete (globalThis as { location?: unknown }).location;
});

describe('shared worker identity', () => {
  it('reports a bundled worker as per-app, with no URL to compare', () => {
    const t = getPerspectiveSharedWorkerTarget();
    expect(t.bundled).toBe(true);
    // Deliberately null: the bundler substitutes a content-hashed path that
    // nothing here can read back, so any URL reported would be one the engine
    // never runs — and two apps could compare equal strings while running
    // different scripts.
    expect(t.url).toBeNull();
    expect(t.name).toBe('cgrid-ssrm-perspective');
  });

  it('reports a deployed worker as shareable, resolved against the document', () => {
    configurePerspectiveSharedWorker({ url: DEPLOYED });
    const t = getPerspectiveSharedWorkerTarget();
    expect(t.bundled).toBe(false);
    // The name rides IN the url — it cannot live in the SharedWorker options,
    // which a bundler needs to be a static literal. See `resolveEngineUrl`.
    expect(t.url).toBe(`${RESOLVED}?engine=cgrid-ssrm-perspective`);
  });

  it('makes the NAME the axis that partitions engines once the URL is fixed', () => {
    // Two apps, same deployed script, different names ⇒ deliberately
    // different engines. This is the supported way to keep a heavyweight
    // book off the engine everything else shares.
    configurePerspectiveSharedWorker({ url: DEPLOYED, name: 'positions-engine' });
    const a = getPerspectiveSharedWorkerTarget();
    __resetSharedWorkerConfigForTests();
    configurePerspectiveSharedWorker({ url: DEPLOYED, name: 'risk-engine' });
    const b = getPerspectiveSharedWorkerTarget();

    // Same deployed script, but differing names are now differing URLs —
    // which is the same partition by a different mechanism, since the URL was
    // always half the worker's identity.
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain('engine=positions-engine');
    expect(b.url).toContain('engine=risk-engine');
    expect(a.name).not.toBe(b.name);
    expect(a.bundled).toBe(false);
    expect(b.bundled).toBe(false);
  });

  it('keeps a partial reconfigure from silently reverting the other axis', () => {
    configurePerspectiveSharedWorker({ url: DEPLOYED });
    configurePerspectiveSharedWorker({ name: 'positions-engine' });
    const t = getPerspectiveSharedWorkerTarget();
    expect(t.url).toBe(`${RESOLVED}?engine=positions-engine`);
    expect(t.name).toBe('positions-engine');
    expect(t.bundled).toBe(false);
  });

  it('accepts a URL object as readily as a string', () => {
    configurePerspectiveSharedWorker({ url: new URL(RESOLVED) });
    expect(getPerspectiveSharedWorkerTarget().url)
      .toBe(`${RESOLVED}?engine=cgrid-ssrm-perspective`);
  });

  it('says so when a name is set with no URL to carry it', () => {
    // A bundled worker is already private to its own build, and the name has
    // nowhere to live — so it reports but partitions nothing. An app that
    // believed it had split its engines would find out much later.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      configurePerspectiveSharedWorker({ name: 'risk-engine' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no effect'));
      const t = getPerspectiveSharedWorkerTarget();
      expect(t.name, 'still reported honestly').toBe('risk-engine');
      expect(t.bundled).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('strict mode', () => {
  it('is off by default, so a single app keeps working unconfigured', () => {
    expect(getPerspectiveSharedWorkerTarget().bundled).toBe(true);
    // No throw from merely being bundled — strict is opt-in.
    expect(() => configurePerspectiveSharedWorker({})).not.toThrow();
  });

  it('rejects a bundled worker, naming the cause', async () => {
    configurePerspectiveSharedWorker({ strict: true });
    const { getPerspectiveClient } = await import('../src/bootstrap');
    await expect(getPerspectiveClient()).rejects.toThrow(/no `url` configured/);
  });

  it('rejects when SharedWorker is unavailable rather than going it alone', async () => {
    const had = 'SharedWorker' in globalThis;
    const original = (globalThis as { SharedWorker?: unknown }).SharedWorker;
    // A dedicated-worker fallback means an engine of this app's own —
    // sharing with nothing, which under strict is a failure, not a degrade.
    delete (globalThis as { SharedWorker?: unknown }).SharedWorker;
    try {
      configurePerspectiveSharedWorker({ url: DEPLOYED, strict: true });
      const { getPerspectiveClient } = await import('../src/bootstrap');
      await expect(getPerspectiveClient()).rejects.toThrow(/SharedWorker is unavailable/);
    } finally {
      if (had) (globalThis as { SharedWorker?: unknown }).SharedWorker = original;
    }
  });
});

describe('configure-after-init', () => {
  it('warns and ignores rather than pretending the engine moved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      configurePerspectiveSharedWorker({ strict: true });
      const { getPerspectiveClient } = await import('../src/bootstrap');
      await getPerspectiveClient().catch(() => { /* strict rejection is the point */ });
      // The engine's identity is fixed once init has begun; a later call
      // must not leave the caller believing it took effect.
      configurePerspectiveSharedWorker({ url: DEPLOYED });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('already'));
      expect(getPerspectiveSharedWorkerTarget().bundled).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
