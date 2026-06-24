type Handler<E> = (event: E) => void;

export class TypedEventEmitter<E extends { type: string }> {
  private handlers = new Map<E['type'], Set<Handler<any>>>();

  on<T extends E['type']>(
    type: T,
    handler: (e: Extract<E, { type: T }>) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  off<T extends E['type']>(
    type: T,
    handler: (e: Extract<E, { type: T }>) => void,
  ): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<T extends E['type']>(event: Extract<E, { type: T }>): void {
    const set = this.handlers.get(event.type as T);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        // Isolate handler failures so siblings still run.
        // eslint-disable-next-line no-console
        console.error('[cgrid] event handler error:', err);
      }
    }
  }

  destroy(): void {
    this.handlers.clear();
  }
}
