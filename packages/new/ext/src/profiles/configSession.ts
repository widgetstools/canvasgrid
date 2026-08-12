/** Instance plane — `vg-new:instance:<gridId>` */

export const INSTANCE_PREFIX = 'vg-new:instance:';

export type InstanceDoc = {
  docVersion: 1;
  gridLevelData?: {
    activeProviderId?: string;
    liveProviderId?: string;
    historicalProviderId?: string;
  };
  version: number;
  columnState?: unknown;
  modules?: Record<string, unknown>;
  layouts?: unknown;
  updatedAt?: number;
};

export class ConfigSession {
  private dirty = false;
  private doc: InstanceDoc;
  private readonly listeners = new Set<(dirty: boolean) => void>();

  constructor(private readonly gridId: string) {
    this.doc = this.load() ?? {
      docVersion: 1,
      version: 1,
      modules: {},
      gridLevelData: {},
    };
  }

  storageKey(): string {
    return `${INSTANCE_PREFIX}${this.gridId}`;
  }

  getDoc(): InstanceDoc {
    return this.doc;
  }

  markDirty(): void {
    this.dirty = true;
    for (const fn of this.listeners) fn(true);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  onDirtyChange(fn: (dirty: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  setModuleSlice(id: string, slice: unknown): void {
    this.doc.modules = { ...(this.doc.modules ?? {}), [id]: slice };
    this.markDirty();
  }

  getModuleSlice<T>(id: string): T | undefined {
    return this.doc.modules?.[id] as T | undefined;
  }

  setActiveProviderId(id: string | undefined): void {
    this.doc.gridLevelData = { ...(this.doc.gridLevelData ?? {}), activeProviderId: id };
    this.markDirty();
  }

  async save(): Promise<void> {
    this.doc.updatedAt = Date.now();
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.doc));
    } catch { /* quota */ }
    this.dirty = false;
    for (const fn of this.listeners) fn(false);
  }

  private load(): InstanceDoc | null {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return null;
      return JSON.parse(raw) as InstanceDoc;
    } catch {
      return null;
    }
  }
}
