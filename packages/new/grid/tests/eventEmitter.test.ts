import { describe, it, expect, vi } from 'vitest';
import { TypedEventEmitter } from '../src/core/eventEmitter';

type Ev =
  | { type: 'foo'; payload: number }
  | { type: 'bar'; text: string };

describe('TypedEventEmitter', () => {
  it('delivers events to registered handlers', () => {
    const ee = new TypedEventEmitter<Ev>();
    const fn = vi.fn();
    ee.on('foo', fn);
    ee.emit({ type: 'foo', payload: 42 });
    expect(fn).toHaveBeenCalledWith({ type: 'foo', payload: 42 });
  });

  it('does not deliver to handlers of a different type', () => {
    const ee = new TypedEventEmitter<Ev>();
    const fooFn = vi.fn();
    const barFn = vi.fn();
    ee.on('foo', fooFn);
    ee.on('bar', barFn);
    ee.emit({ type: 'bar', text: 'hi' });
    expect(fooFn).not.toHaveBeenCalled();
    expect(barFn).toHaveBeenCalledOnce();
  });

  it('unsubscribe returned from on() removes the handler', () => {
    const ee = new TypedEventEmitter<Ev>();
    const fn = vi.fn();
    const off = ee.on('foo', fn);
    off();
    ee.emit({ type: 'foo', payload: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('handler exceptions do not block other handlers', () => {
    const ee = new TypedEventEmitter<Ev>();
    const a = vi.fn(() => { throw new Error('boom'); });
    const b = vi.fn();
    ee.on('foo', a);
    ee.on('foo', b);
    ee.emit({ type: 'foo', payload: 1 });
    expect(b).toHaveBeenCalledOnce();
  });

  it('destroy clears all handlers', () => {
    const ee = new TypedEventEmitter<Ev>();
    const fn = vi.fn();
    ee.on('foo', fn);
    ee.destroy();
    ee.emit({ type: 'foo', payload: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('hasListener reflects registration and unsubscription', () => {
    const ee = new TypedEventEmitter<Ev>();
    expect(ee.hasListener('foo')).toBe(false);
    const off = ee.on('foo', () => {});
    expect(ee.hasListener('foo')).toBe(true);
    expect(ee.hasListener('bar')).toBe(false);
    off();
    expect(ee.hasListener('foo')).toBe(false); // emptied Set reads false
  });
});
