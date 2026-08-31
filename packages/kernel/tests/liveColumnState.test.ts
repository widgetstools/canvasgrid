import { describe, it, expect } from 'vitest';
import { LiveColumnState } from '../src/core/liveColumnState';

/**
 * The durable store behind runtime column changes.
 *
 * Its whole reason to exist is that the resolved column tree is DERIVED —
 * every rebuild discards it and re-resolves from `options.columnDefs`, which
 * never carried the user's width / hide / pinned changes. Three separate
 * workarounds grew around that (a salvage pass in `rebuildColumns`, a
 * double-apply in `ColumnStateManager`, a private tree copy in `PivotEngine`),
 * none composing with the others. These tests pin the behaviour that lets all
 * three go away.
 */

const leaf = (colId: string, props: Record<string, unknown> = {}) =>
  ({ colId, ...props }) as { colId: string } & Record<string, unknown>;

describe('recording changes', () => {
  it('reports whether anything actually moved', () => {
    const s = new LiveColumnState();
    expect(s.set('a', { width: 100 })).toBe(true);
    // Callers skip events and repaints on a no-op, so this must be exact.
    expect(s.set('a', { width: 100 })).toBe(false);
    expect(s.set('a', { width: 120 })).toBe(true);
  });

  it('merges properties instead of replacing the entry', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100 });
    s.set('a', { hide: true });
    expect(s.get('a')).toEqual({ width: 100, hide: true });
  });

  it('ignores undefined — that is "nothing said", not "clear it"', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100 });
    expect(s.set('a', { width: undefined, hide: undefined })).toBe(false);
    expect(s.get('a')).toEqual({ width: 100 });
  });

  it('keeps false and null, which are real values', () => {
    const s = new LiveColumnState();
    // `hide: false` is "the user un-hid this", not "unset" — losing that
    // distinction is what let a hidden column silently come back.
    expect(s.set('a', { hide: false })).toBe(true);
    expect(s.get('a')).toEqual({ hide: false });
    expect(s.set('b', { pinned: null })).toBe(true);
    expect(s.get('b')).toEqual({ pinned: null });
  });
});

describe('applying to resolved leaves', () => {
  it('stamps remembered values onto a freshly resolved tree', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 250, hide: true });
    const leaves = [leaf('a', { width: 100, hide: false }), leaf('b', { width: 100 })];
    s.applyTo(leaves);
    expect(leaves[0]).toMatchObject({ width: 250, hide: true });
    expect(leaves[1]).toMatchObject({ width: 100 });   // untouched
  });

  it('honours the skip predicate per column AND per property', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 250, hide: true });
    const leaves = [leaf('a', { width: 100, hide: false })];
    // An explicit calc width override wins; visibility is still remembered.
    s.applyTo(leaves, (_colId, key) => key === 'width');
    expect(leaves[0]).toMatchObject({ width: 100, hide: true });
  });

  it('leaves columns it knows nothing about alone', () => {
    const s = new LiveColumnState();
    const leaves = [leaf('a', { width: 100 })];
    s.applyTo(leaves);
    expect(leaves[0]).toEqual({ colId: 'a', width: 100 });
  });
});

describe('lifetime', () => {
  it('clears one property without dropping the rest', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100, hide: true });
    s.clear('a', ['width']);
    expect(s.get('a')).toEqual({ hide: true });
  });

  it('drops the entry once its last property is cleared', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100 });
    s.clear('a', ['width']);
    expect(s.has('a')).toBe(false);
  });

  it('prunes columns that no longer exist', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100 });
    s.set('gone', { hide: true });
    s.prune(['a']);
    expect(s.has('a')).toBe(true);
    expect(s.has('gone')).toBe(false);
  });

  it('pruning is what stops a returning colId inheriting a past life', () => {
    // A provider rebind or pivot toggle can retire a colId and later bring it
    // back. Without pruning it would silently reappear hidden.
    const s = new LiveColumnState();
    s.set('region', { hide: true });
    s.prune([]);                       // region retired
    const leaves = [leaf('region', { hide: false })];
    s.applyTo(leaves);                 // region returns
    expect(leaves[0]).toMatchObject({ hide: false });
  });

  it('round-trips through a snapshot', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100, hide: true });
    s.set('b', { pinned: 'left' });
    const restored = new LiveColumnState();
    restored.restore(s.snapshot());
    expect(restored.snapshot()).toEqual(s.snapshot());
  });

  it('snapshots do not alias the live entries', () => {
    const s = new LiveColumnState();
    s.set('a', { width: 100 });
    const snap = s.snapshot();
    snap.a!.width = 999;
    expect(s.get('a')).toEqual({ width: 100 });
  });
});
