/** Instance plane — `vg-new:instance:<gridId>` with draft → validate → apply. */

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
  savedFilters?: SavedFilter[];
  updatedAt?: number;
};

export type SavedFilter = {
  id: string;
  label: string;
  filterModel: Record<string, unknown>;
  quickFilterText?: string;
};

export type ValidateResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Draft → Validate → Apply/Save grammar for Customize modules.
 * Draft lives in-memory until apply; apply commits module slices + optional persist.
 */
export class ConfigSession {
  private dirty = false;
  private doc: InstanceDoc;
  private readonly drafts = new Map<string, unknown>();
  private readonly listeners = new Set<(dirty: boolean) => void>();

  constructor(private readonly gridId: string) {
    this.doc = this.load() ?? {
      docVersion: 1,
      version: 1,
      modules: {},
      gridLevelData: {},
      savedFilters: [],
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
    return this.dirty || this.drafts.size > 0;
  }

  onDirtyChange(fn: (dirty: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Load persisted slice into draft (or seed). */
  beginDraft<T>(moduleId: string, seed?: T): T {
    const existing = this.drafts.get(moduleId);
    if (existing !== undefined) return existing as T;
    const fromDoc = this.doc.modules?.[moduleId] as T | undefined;
    const draft = (fromDoc !== undefined ? structuredClone(fromDoc) : seed !== undefined
      ? structuredClone(seed)
      : {}) as T;
    this.drafts.set(moduleId, draft);
    return draft;
  }

  getDraft<T>(moduleId: string): T | undefined {
    return this.drafts.get(moduleId) as T | undefined;
  }

  setDraft(moduleId: string, slice: unknown): void {
    this.drafts.set(moduleId, slice);
    this.markDirty();
  }

  discardDraft(moduleId?: string): void {
    if (moduleId) this.drafts.delete(moduleId);
    else this.drafts.clear();
    if (!this.drafts.size) {
      this.dirty = false;
      for (const fn of this.listeners) fn(false);
    }
  }

  validate(
    moduleId: string,
    validator: (draft: unknown) => ValidateResult,
  ): ValidateResult {
    const draft = this.drafts.get(moduleId);
    if (draft === undefined) {
      return { ok: false, errors: [`No draft for module '${moduleId}'`] };
    }
    return validator(draft);
  }

  /**
   * Validate, run applier against live grid, commit slice to doc, persist.
   */
  async apply(
    moduleId: string,
    opts: {
      validate: (draft: unknown) => ValidateResult;
      apply: (draft: unknown) => void | Promise<void>;
      persist?: boolean;
    },
  ): Promise<ValidateResult> {
    const result = this.validate(moduleId, opts.validate);
    if (!result.ok) return result;
    const draft = this.drafts.get(moduleId);
    await opts.apply(draft);
    this.doc.modules = { ...(this.doc.modules ?? {}), [moduleId]: structuredClone(draft) };
    this.drafts.delete(moduleId);
    if (opts.persist !== false) await this.save();
    else {
      this.dirty = this.drafts.size > 0;
      for (const fn of this.listeners) fn(this.dirty);
    }
    return { ok: true };
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

  getSavedFilters(): SavedFilter[] {
    return this.doc.savedFilters ?? [];
  }

  setSavedFilters(filters: SavedFilter[]): void {
    this.doc.savedFilters = filters;
    this.markDirty();
  }

  upsertSavedFilter(filter: SavedFilter): void {
    const list = [...(this.doc.savedFilters ?? [])];
    const i = list.findIndex((f) => f.id === filter.id);
    if (i >= 0) list[i] = filter;
    else list.push(filter);
    this.doc.savedFilters = list;
    this.markDirty();
  }

  removeSavedFilter(id: string): void {
    this.doc.savedFilters = (this.doc.savedFilters ?? []).filter((f) => f.id !== id);
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
