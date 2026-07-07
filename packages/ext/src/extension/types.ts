import type { CGrid, StateModule, GridState } from '@cgrid/kernel';

export type Unsub = () => void;

/** Minimal modal surface the context exposes. Structural match for the
 *  kernel `ModalHost` returned by `grid.getModal()` — declared locally so
 *  ext never imports kernel internals. */
export interface ExtModalHost {
  open(content: HTMLElement, options?: { closeOnBackdrop?: boolean }): void;
  close(): void;
  isOpen(): boolean;
}

export interface ExtEvent { type: string; [k: string]: unknown }
export interface ExtEventBus {
  on(type: string, fn: (e: ExtEvent) => void): Unsub;
  emit(e: ExtEvent): void;
}

/** A saved profile's metadata (no payload). */
export interface ProfileMeta { id: string; name: string; updatedAt: number }

/** A full profile payload: the kernel snapshot (which already folds in
 *  every module's registered state slice) plus ext chrome state. */
export interface ProfileSnapshot {
  meta: ProfileMeta;
  gridState: GridState;
  ext: Record<string, unknown>;
}

/** Persistence behind the profiles feature. Async so server/IndexedDB
 *  stores drop in unchanged. */
export interface ProfileStore {
  list(): Promise<ProfileMeta[]>;
  load(id: string): Promise<ProfileSnapshot | null>;
  save(id: string, snap: ProfileSnapshot): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What modules/toolbar items see of the profiles feature. Wave 0 ships
 *  dirty tracking + snapshot save/load; richer switching UI lands in the
 *  Profiles wave against THIS interface. */
export interface ProfileController {
  activeId(): string;
  isDirty(): boolean;
  markDirty(): void;
  onDirtyChange(fn: (dirty: boolean) => void): Unsub;
  save(): Promise<void>;
  switchTo(id: string): Promise<void>;
  list(): Promise<ProfileMeta[]>;
}

/** Handed to every extension's `init` and `mount`/`render`. Kernel is
 *  reached through its PUBLIC api only. */
export interface CgExtContext {
  grid: CGrid;
  getState(): GridState;
  setState(state: Partial<GridState>): void;
  registerStateModule(module: StateModule): Unsub;
  modal: ExtModalHost;
  events: ExtEventBus;
  profiles: ProfileController;
}

export type ExtensionKind = 'settings-module' | 'toolbar-item' | 'service';

export interface CgExtension {
  id: string;
  kind: ExtensionKind;
  init(ctx: CgExtContext): void;
  dispose?(): void;
}

export type ModuleCategory =
  | 'layout' | 'data' | 'format' | 'editing' | 'workspace';

export interface ModuleInstance { destroy(): void; refresh?(): void }

export interface SettingsModule extends CgExtension {
  kind: 'settings-module';
  title: string;
  icon: string;
  category: ModuleCategory;
  mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance;
}

export type ToolbarSlot =
  | 'primary-left' | 'primary-center' | 'primary-right' | `ribbon.${string}`;

export interface ToolbarItemInstance { destroy(): void; refresh?(): void }

export interface ToolbarItem extends CgExtension {
  kind: 'toolbar-item';
  slot: ToolbarSlot;
  toggleable?: boolean;
  render(host: HTMLElement, ctx: CgExtContext): ToolbarItemInstance;
}

export function isSettingsModule(e: CgExtension): e is SettingsModule {
  return e.kind === 'settings-module';
}
export function isToolbarItem(e: CgExtension): e is ToolbarItem {
  return e.kind === 'toolbar-item';
}
