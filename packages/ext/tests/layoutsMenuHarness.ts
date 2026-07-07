import { vi } from 'vitest';
import type { CgExtContext, ToolbarItem, ToolbarItemInstance } from '../src/extension/types';

export interface FakeLayout { id: string; name: string; state: Record<string, unknown> }

/** Structural stand-in for the kernel layout API + event emitter. Mutators
 *  emit `layoutChanged` exactly like the real CGrid so the UI's single
 *  re-sync path is exercised. */
export class FakeGrid {
  layouts: FakeLayout[] = [{ id: 'default', name: 'Default', state: {} }];
  activeId = 'default';
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => { this.listeners.get(type)!.delete(fn); };
  }
  emit(e: { type: string; [k: string]: unknown }): void {
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) fn(e);
  }
  private emitLayoutChanged(source: string): void {
    this.emit({ type: 'layoutChanged', activeLayoutId: this.activeId, source });
  }

  getGridOption = vi.fn((_key: string) => 'fake-grid');
  getLayouts() { return this.layouts.map((l) => ({ ...l })); }
  getActiveLayoutId() { return this.activeId; }
  getActiveLayout() { return { ...this.layouts.find((l) => l.id === this.activeId)! }; }

  loadLayout = vi.fn((id: string) => { this.mustGet(id); this.activeId = id; this.emitLayoutChanged('load'); });
  saveLayout = vi.fn((name: string) => {
    this.assertUnique(name);
    const l = { id: `id-${name}`, name, state: {} };
    this.layouts.push(l); this.activeId = l.id; this.emitLayoutChanged('save'); return { ...l };
  });
  updateLayout = vi.fn(() => { this.emitLayoutChanged('update'); return this.getActiveLayout(); });
  deleteLayout = vi.fn((id: string) => {
    if (id === 'default') throw new Error("the Default layout can't be deleted");
    this.layouts = this.layouts.filter((l) => l.id !== id);
    if (this.activeId === id) this.activeId = 'default';
    this.emitLayoutChanged('delete');
  });
  renameLayout = vi.fn((id: string, name: string) => {
    this.assertUnique(name);
    const l = this.mustGet(id); l.name = name; this.emitLayoutChanged('rename'); return { ...l };
  });
  duplicateLayout = vi.fn((id: string, name: string) => {
    this.assertUnique(name);
    const l = { id: `id-${name}`, name, state: { ...this.mustGet(id).state } };
    this.layouts.push(l); this.emitLayoutChanged('duplicate'); return { ...l };
  });
  exportLayout = vi.fn((id: string) => ({ ...this.mustGet(id) }));
  exportLayouts = vi.fn(() => ({ version: 1, activeLayoutId: this.activeId, layouts: this.getLayouts(), grid: {} }));
  importLayout = vi.fn((l: FakeLayout) => { this.layouts.push({ ...l }); this.emitLayoutChanged('import'); return { ...l }; });
  importLayouts = vi.fn((b: { layouts: FakeLayout[] }) => {
    for (const l of b.layouts) if (!this.layouts.some((x) => x.id === l.id)) this.layouts.push({ ...l });
    this.emitLayoutChanged('import');
  });

  private mustGet(id: string): FakeLayout {
    const l = this.layouts.find((x) => x.id === id);
    if (!l) throw new Error(`unknown layout: ${id}`);
    return l;
  }
  private assertUnique(name: string): void {
    const n = name.trim().toLowerCase();
    if (this.layouts.some((l) => l.name.trim().toLowerCase() === n)) {
      throw new Error(`a layout named '${name}' already exists`);
    }
  }
}

/** Mounts a toolbar item over a FakeGrid; caller must clean the DOM
 *  (tests use afterEach(() => { document.body.replaceChildren(); })). */
export function mountItem(item: ToolbarItem, grid = new FakeGrid()): {
  host: HTMLElement; grid: FakeGrid; inst: ToolbarItemInstance; ctx: CgExtContext;
} {
  const host = document.createElement('div');
  host.dataset.itemId = item.id;
  document.body.appendChild(host);
  const ctx = { grid } as unknown as CgExtContext;
  const inst = item.render(host, ctx);
  return { host, grid, inst, ctx };
}
