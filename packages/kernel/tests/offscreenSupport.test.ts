import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOffscreenCanvasSupported,
  resolvePaintMode,
} from '../src/renderer/offscreenSupport';

/**
 * Cycle 25 / Task 4 — OffscreenCanvas paint-mode foundation.
 *
 * `paintMode: 'auto' | 'main' | 'offscreen'` opts the grid into a
 * worker-side painter. `'auto'` (default) resolves to `'offscreen'`
 * only when the platform supports `OffscreenCanvas` + a paint worker;
 * otherwise it falls back to `'main'`. This commit ships the
 * detection + resolution logic; the worker-side painter is the
 * follow-up that closes Task 4.
 */

const realOffscreen = (globalThis as any).OffscreenCanvas;
const realWorker = (globalThis as any).Worker;

beforeEach(() => {
  delete (globalThis as any).OffscreenCanvas;
  delete (globalThis as any).Worker;
});

afterEach(() => {
  (globalThis as any).OffscreenCanvas = realOffscreen;
  (globalThis as any).Worker = realWorker;
});

describe('isOffscreenCanvasSupported', () => {
  it('returns true when OffscreenCanvas and Worker are both present', () => {
    (globalThis as any).OffscreenCanvas = class {};
    (globalThis as any).Worker = class {};
    expect(isOffscreenCanvasSupported()).toBe(true);
  });

  it('returns false when OffscreenCanvas is missing', () => {
    (globalThis as any).Worker = class {};
    expect(isOffscreenCanvasSupported()).toBe(false);
  });

  it('returns false when Worker is missing', () => {
    (globalThis as any).OffscreenCanvas = class {};
    expect(isOffscreenCanvasSupported()).toBe(false);
  });
});

describe('resolvePaintMode', () => {
  it("'main' always resolves to 'main' regardless of platform", () => {
    (globalThis as any).OffscreenCanvas = class {};
    (globalThis as any).Worker = class {};
    expect(resolvePaintMode('main')).toBe('main');
  });

  it("'offscreen' resolves to 'offscreen' when supported", () => {
    (globalThis as any).OffscreenCanvas = class {};
    (globalThis as any).Worker = class {};
    expect(resolvePaintMode('offscreen')).toBe('offscreen');
  });

  it("'offscreen' falls back to 'main' on unsupported platforms (no surprises)", () => {
    expect(resolvePaintMode('offscreen')).toBe('main');
  });

  it("'auto' picks 'offscreen' when supported", () => {
    (globalThis as any).OffscreenCanvas = class {};
    (globalThis as any).Worker = class {};
    expect(resolvePaintMode('auto')).toBe('offscreen');
  });

  it("'auto' picks 'main' on unsupported platforms", () => {
    expect(resolvePaintMode('auto')).toBe('main');
  });

  it("undefined defaults to 'auto' semantics", () => {
    expect(resolvePaintMode(undefined)).toBe('main');
    (globalThis as any).OffscreenCanvas = class {};
    (globalThis as any).Worker = class {};
    expect(resolvePaintMode(undefined)).toBe('offscreen');
  });
});
