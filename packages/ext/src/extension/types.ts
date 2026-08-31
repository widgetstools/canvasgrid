import type { VelocityGrid, StateModule, GridState } from '@wellsfargo-starui/velocity-grid';
import type { ExtEngineSlots } from './engines';

export type { ExtEngineSlots, ExtEngineName, ExtEngineMap } from './engines';

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
  /** May reject when the underlying store refuses the write — e.g.
   *  `ConfigSession`'s D-F12 forward-compat guard. Do not fire-and-forget
   *  without a `.catch`. */
  save(id: string, snap: ProfileSnapshot): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What modules/toolbar items see of the profiles feature. */
export interface ProfileController {
  activeId(): string;
  isDirty(): boolean;
  markDirty(): void;
  onDirtyChange(fn: (dirty: boolean) => void): Unsub;
  /** Fires when the saved profile list / active id changes. */
  onListChange(fn: () => void): Unsub;
  /** May reject when the backing store refuses the write — e.g.
   *  `ConfigSession`'s D-F12 forward-compat guard. Do not fire-and-forget
   *  without a `.catch`. */
  save(): Promise<void>;
  /** Save current view under a new name; becomes the active profile. May
   *  reject — see interface doc. */
  saveAs(name: string): Promise<string>;
  /** Reload the active saved snapshot, discarding unsaved grid edits. */
  discard(): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** May reject — see interface doc. */
  switchTo(id: string): Promise<void>;
  /** Load initial profile or seed a default snapshot. When the seeded
   *  workspace itself can't be persisted (e.g. `ConfigSession`'s D-F12
   *  forward-compat guard), this rejects — callers (including a
   *  fire-and-forget ctor call) must handle it. */
  bootstrap(): Promise<void>;
  list(): Promise<ProfileMeta[]>;
}

/** One dirty buffer for the open Customize drawer. */
export interface DrawerSession {
  stage(moduleId: string, patch?: unknown): void;
  unstage(moduleId: string): void;
  isDirty(): boolean;
  pendingCount(): number;
  clear(): void;
  onChange(fn: () => void): Unsub;
}

/** Handed to every extension's `init` and `mount`/`render`. Kernel is
 *  reached through its PUBLIC api only. */
export interface VelocityGridExtContext {
  grid: VelocityGrid;
  getState(): GridState;
  setState(state: Partial<GridState>): void;
  registerStateModule(module: StateModule): Unsub;
  modal: ExtModalHost;
  events: ExtEventBus;
  profiles: ProfileController;
  session: DrawerSession;
  /**
   * D-F8 — engine DI slots for THIS grid. Modules ask
   * `ctx.engines.get('edit' | 'calc' | 'rules' | 'alerts')` instead of
   * casting the grid and reading a `__*BridgeWired` expando, and surface
   * `engineMissingNotice(...)` when the answer is `null` rather than
   * silently no-opping. Resolution happens at CALL time (engines are wired
   * after the context exists — see `extension/engines.ts`), so never hoist
   * the result into a mount-time constant.
   */
  engines: ExtEngineSlots;
}

export type ExtensionKind = 'settings-module' | 'toolbar-item' | 'service';

export interface VelocityGridExtension {
  id: string;
  kind: ExtensionKind;
  init(ctx: VelocityGridExtContext): void;
  dispose?(): void;
}

export type ModuleCategory =
  | 'layout' | 'data' | 'format' | 'editing' | 'workspace';

export interface ModuleInstance {
  destroy(): void;
  refresh?(): void;
  /** Flush the pane draft into the grid. Drawer Done calls this once. */
  commit?(): void;
}

export interface SettingsModule extends VelocityGridExtension {
  kind: 'settings-module';
  title: string;
  icon: string;
  category: ModuleCategory;
  mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance;
}

export type ToolbarSlot =
  | 'primary-left' | 'primary-center' | 'primary-right' | `ribbon.${string}`;

export interface ToolbarItemInstance { destroy(): void; refresh?(): void }

export interface ToolbarItem extends VelocityGridExtension {
  kind: 'toolbar-item';
  slot: ToolbarSlot;
  /**
   * Position within the slot, ascending. Ties keep registration order, and
   * items that declare nothing sort after every item that does — so a
   * consumer's extra button lands at the end of the cluster instead of at its
   * head. Without this, position fell out of registration order, which the
   * registry does not preserve when a spec replaces a default (see
   * {@link TITLE_BAR_ORDER}).
   */
  order?: number;
  toggleable?: boolean;
  render(host: HTMLElement, ctx: VelocityGridExtContext): ToolbarItemInstance;
}

export function isSettingsModule(e: VelocityGridExtension): e is SettingsModule {
  return e.kind === 'settings-module';
}
export function isToolbarItem(e: VelocityGridExtension): e is ToolbarItem {
  return e.kind === 'toolbar-item';
}
