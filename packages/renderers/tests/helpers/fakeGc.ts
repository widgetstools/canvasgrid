// Shared fake CanvasRenderingContext2D harness for @cgrid/renderers tests.
//
// Modeled on `packages/kernel/tests/compositeRenderer.test.ts`'s inline
// `makeGc()` (cache Proxy precedent, measureText at 7px/char), extended with
// a unified `calls` log so cross-method draw ORDER is assertable in one array.
//
// Every drawing-op mock pushes `{ op, args }` to `calls`. The `cache` Proxy's
// `set` trap ALSO pushes `{ op: 'set:' + prop, args: [value] }` for style
// properties — mirrors real paint sequencing where a color set immediately
// precedes the draw it colors. `measureText` and property READS are excluded.

import { vi } from 'vitest';
import type { CachedContext2D } from '../../../kernel/src/renderer/gc';

export type FakeGc = CachedContext2D & { calls: Array<{ op: string; args: unknown[] }> };

/** Style properties tracked in the cache Proxy's set trap. */
const TRACKED_STYLE_PROPS = new Set([
  'fillStyle',
  'strokeStyle',
  'font',
  'textAlign',
  'textBaseline',
  'globalAlpha',
  'lineWidth',
]);

/** Drawing ops that push to `calls`. */
const DRAWING_OPS = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arcTo',
  'arc',
  'quadraticCurveTo',
  'bezierCurveTo',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'fillText',
  'strokeText',
  'rect',
  'clip',
  'translate',
  'scale',
  'setLineDash',
] as const;

export function makeFakeGc(overrides: Partial<CanvasRenderingContext2D> = {}): FakeGc {
  const calls: Array<{ op: string; args: unknown[] }> = [];

  const ctx: Record<string, unknown> = {
    calls,
    // measureText — deterministic at 7px/char, excluded from calls
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    // save/restore — stack bookkeeping, not drawing ops per the brief
    save: vi.fn(),
    restore: vi.fn(),
    clearFill: vi.fn(),
    // Style state defaults (mirrors compositeRenderer.test.ts)
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    ...overrides,
  };

  // Install drawing-op mocks that push to calls.
  for (const op of DRAWING_OPS) {
    ctx[op] = vi.fn((...args: unknown[]) => {
      calls.push({ op, args });
    });
  }

  // cache Proxy: get reads through, set writes through AND logs style props.
  ctx['cache'] = new Proxy(ctx, {
    get(target, key) {
      return target[key as string];
    },
    set(target, key, value) {
      target[key as string] = value;
      if (typeof key === 'string' && TRACKED_STYLE_PROPS.has(key)) {
        calls.push({ op: `set:${key}`, args: [value] });
      }
      return true;
    },
  });

  return ctx as unknown as FakeGc;
}
