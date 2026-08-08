// Centralized teardown registry. VelocityGrid (and other long-lived subsystems) push
// every listener / RAF / timer / observer they install through here; `dispose`
// runs them in LIFO order on destroy. Two wins: (1) we never forget to undo a
// registration, and (2) mid-gesture teardown (e.g. window drag listeners
// installed during a drag) is handled without bespoke unwinding code.
//
// Disposers must be idempotent — `dispose` is one-shot and swallows individual
// errors so one broken disposer doesn't strand the rest.

export type Disposer = () => void;

interface ListenerTarget {
  addEventListener: (type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, handler: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
}

interface MediaQueryListenerTarget {
  addEventListener: (type: 'change', handler: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: 'change', handler: (e: MediaQueryListEvent) => void) => void;
}

export class DisposableRegistry {
  private disposers: Disposer[] = [];
  private disposed = false;

  /** True once `dispose()` has run. Useful for short-circuiting late callbacks. */
  isDisposed(): boolean { return this.disposed; }

  /** Register an arbitrary teardown. If already disposed, runs immediately. */
  add(d: Disposer): void {
    if (this.disposed) { try { d(); } catch (e) { console.error('[velocity-grid] disposer error:', e); } return; }
    this.disposers.push(d);
  }

  /** Register a DOM-style listener; auto-removes on dispose. */
  addListener<T extends ListenerTarget>(
    target: T,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.add(() => target.removeEventListener(type, handler, options as boolean | EventListenerOptions | undefined));
  }

  /** matchMedia listener overload — MediaQueryList has the same shape but a
   *  narrower handler signature. Calling site keeps full typing. */
  addMediaQueryListener(
    mql: MediaQueryListenerTarget,
    handler: (e: MediaQueryListEvent) => void,
  ): void {
    mql.addEventListener('change', handler);
    this.add(() => mql.removeEventListener('change', handler));
  }

  /** Wrap a requestAnimationFrame handle so dispose() cancels it. The handle
   *  comes from the caller — they already scheduled the RAF. */
  addRaf(handle: number): void {
    this.add(() => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    });
  }

  addTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.add(() => clearTimeout(handle));
  }

  addInterval(handle: ReturnType<typeof setInterval>): void {
    this.add(() => clearInterval(handle));
  }

  /** Run every disposer in reverse-registration order. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try { this.disposers[i]!(); } catch (e) {
        console.error('[velocity-grid] disposer error:', e);
      }
    }
    this.disposers.length = 0;
  }
}
