import { describe, it, expect, vi } from 'vitest';
import { DisposableRegistry } from '../src/core/disposable';

describe('DisposableRegistry', () => {
  it('runs disposers in LIFO order on dispose', () => {
    const r = new DisposableRegistry();
    const log: number[] = [];
    r.add(() => log.push(1));
    r.add(() => log.push(2));
    r.add(() => log.push(3));
    r.dispose();
    expect(log).toEqual([3, 2, 1]);
  });

  it('is idempotent — second dispose is a no-op', () => {
    const r = new DisposableRegistry();
    const spy = vi.fn();
    r.add(spy);
    r.dispose();
    r.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('isDisposed flips after first dispose', () => {
    const r = new DisposableRegistry();
    expect(r.isDisposed()).toBe(false);
    r.dispose();
    expect(r.isDisposed()).toBe(true);
  });

  it('runs late-added disposers immediately when already disposed', () => {
    const r = new DisposableRegistry();
    r.dispose();
    const spy = vi.fn();
    r.add(spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('individual disposer error does not strand the rest', () => {
    const r = new DisposableRegistry();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    r.add(after);
    r.add(() => { throw new Error('boom'); });
    r.dispose();
    expect(after).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('addListener registers + removes on dispose', () => {
    const r = new DisposableRegistry();
    const add = vi.fn();
    const remove = vi.fn();
    const target = { addEventListener: add, removeEventListener: remove };
    const handler = () => {};
    r.addListener(target as never, 'click', handler);
    expect(add).toHaveBeenCalledWith('click', handler, undefined);
    expect(remove).not.toHaveBeenCalled();
    r.dispose();
    expect(remove).toHaveBeenCalledWith('click', handler, undefined);
  });

  it('addListener passes options through to both calls', () => {
    const r = new DisposableRegistry();
    const add = vi.fn();
    const remove = vi.fn();
    const target = { addEventListener: add, removeEventListener: remove };
    const handler = () => {};
    r.addListener(target as never, 'keydown', handler, true);
    r.dispose();
    expect(add).toHaveBeenCalledWith('keydown', handler, true);
    expect(remove).toHaveBeenCalledWith('keydown', handler, true);
  });

  it('addMediaQueryListener subscribes + tears down', () => {
    const r = new DisposableRegistry();
    const add = vi.fn();
    const remove = vi.fn();
    const mql = { addEventListener: add, removeEventListener: remove };
    const handler = (_e: MediaQueryListEvent) => {};
    r.addMediaQueryListener(mql as never, handler);
    expect(add).toHaveBeenCalledWith('change', handler);
    r.dispose();
    expect(remove).toHaveBeenCalledWith('change', handler);
  });

  it('addRaf cancels the handle on dispose', () => {
    const r = new DisposableRegistry();
    const cancelled: number[] = [];
    const original = globalThis.cancelAnimationFrame;
    (globalThis as { cancelAnimationFrame: (h: number) => void }).cancelAnimationFrame = (h: number) => {
      cancelled.push(h);
    };
    r.addRaf(42);
    r.dispose();
    expect(cancelled).toEqual([42]);
    (globalThis as { cancelAnimationFrame: typeof original }).cancelAnimationFrame = original;
  });

  it('addTimeout / addInterval clear their handles', () => {
    const r = new DisposableRegistry();
    const cleared: Array<{ kind: string; handle: unknown }> = [];
    const originalCT = globalThis.clearTimeout;
    const originalCI = globalThis.clearInterval;
    (globalThis as { clearTimeout: (h: unknown) => void }).clearTimeout = (h) => { cleared.push({ kind: 'timeout', handle: h }); };
    (globalThis as { clearInterval: (h: unknown) => void }).clearInterval = (h) => { cleared.push({ kind: 'interval', handle: h }); };
    const t = 1 as unknown as ReturnType<typeof setTimeout>;
    const i = 2 as unknown as ReturnType<typeof setInterval>;
    r.addTimeout(t);
    r.addInterval(i);
    r.dispose();
    expect(cleared).toEqual([{ kind: 'interval', handle: i }, { kind: 'timeout', handle: t }]);
    (globalThis as { clearTimeout: typeof originalCT }).clearTimeout = originalCT;
    (globalThis as { clearInterval: typeof originalCI }).clearInterval = originalCI;
  });
});
