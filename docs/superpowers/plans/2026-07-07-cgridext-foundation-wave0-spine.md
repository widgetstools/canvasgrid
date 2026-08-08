# VelocityGridExt Foundation — Wave 0 (Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `@wellsfargo-starui/velocity-grid-ext` with the `VelocityGridExt` composer, `<cgrid-ext>` element, the extension contract + registry, the three-region shell (title bar · ribbon · settings sheet), a minimal-but-real profiles controller, one real settings module (Grid Options), and a live-STOMP demo — proving composition top-to-bottom.

**Architecture:** `VelocityGridExt` *owns* a kernel `VelocityGrid` (composition, public API only) plus an `ExtensionRegistry`. Every tooling piece is a `VelocityGridExtension` (`settings-module` | `toolbar-item` | `service`) that receives a `VelocityGridExtContext` (grid + state + modal + events + profiles). The shell is a vertical stack of DOM strips reserving space above the kernel canvas.

**Tech Stack:** TypeScript (ES2022, strict), `@wellsfargo-starui/velocity-grid`, `@wellsfargo-starui/velocity-grid-customizer` (Lit chrome), Lit 3, Vitest + happy-dom (unit), Playwright + Vite (demo/E2E).

## Global Constraints

- **Package name:** `@wellsfargo-starui/velocity-grid-ext`. Source-direct (`main`/`types` → `./src/index.ts`), no build step (scaffold `build` script echoes + exits 0), mirroring `@wellsfargo-starui/velocity-grid-customizer`.
- **Kernel access is public-API-only.** Never import from `@wellsfargo-starui/velocity-grid/src/...` internals; only the package entry `@wellsfargo-starui/velocity-grid`. Any capability gap is a kernel change, not a workaround (no retroactive layering).
- **No decorators.** Lit components/classes use `static properties`, not TC39 decorators (esbuild passes decorators through untransformed in source-direct packages). Mirror `@wellsfargo-starui/velocity-grid-customizer`.
- **State single-source:** every module owns a named `GridState` slice via `grid.registerStateModule(...)`. No shadow state.
- **TS base:** extends `../../tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `useDefineForClassFields`).
- **Tests:** Vitest `environment: 'happy-dom'`, files `tests/**/*.test.ts`. Constructing a `VelocityGrid` under happy-dom requires the Worker + canvas stubs — provide them once in `tests/setup.ts` (Task 1) and import in every test that builds a grid.
- **Commit style:** end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `cgridext/foundation` (already created off latest main).

---

## File Structure

```
packages/ext/
  package.json                     # @wellsfargo-starui/velocity-grid-ext manifest (Task 1)
  tsconfig.json                    # extends base (Task 1)
  vitest.config.ts                 # happy-dom (Task 1)
  README.md                        # purpose + status (Task 1)
  tests/setup.ts                   # Worker + canvas stubs for VelocityGrid-under-happy-dom (Task 1)
  src/
    index.ts                       # public exports (grows each task)
    extension/
      types.ts                     # VelocityGridExtension, SettingsModule, ToolbarItem, VelocityGridExtContext, ProfileController, ProfileStore… (Task 2)
      registry.ts                  # ExtensionRegistry (Task 3)
      context.ts                   # createExtContext(...) factory (Task 4)
    profiles/
      localStorageStore.ts         # default ProfileStore (Task 4)
      controller.ts                # ProfileController impl (dirty + snapshot save/load) (Task 4)
    shell/
      shell.ts                     # ShellLayout: strips, mounts grid, region hosts (Task 5)
    velocityGridExt.ts                    # VelocityGridExt composer + default bundle wiring (Task 6, 9)
    element.ts                     # <cgrid-ext> custom element (Task 7)
    modules/
      gridOptions.ts               # Grid Options settings-module (Task 8)
    defaultBundle.ts               # built-in extension set (Task 9)
apps/cgrid-ext-demo/               # live-STOMP demo + E2E (Task 10, 11)
  package.json  vite.config.ts  index.html  tsconfig.json  playwright.config.ts
  src/main.ts   src/stomp.ts
  e2e/spine.spec.ts
```

---

### Task 1: Package scaffold `@wellsfargo-starui/velocity-grid-ext`

**Files:**
- Create: `packages/ext/package.json`
- Create: `packages/ext/tsconfig.json`
- Create: `packages/ext/vitest.config.ts`
- Create: `packages/ext/README.md`
- Create: `packages/ext/src/index.ts`
- Create: `packages/ext/tests/setup.ts`
- Create: `packages/ext/tests/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `@wellsfargo-starui/velocity-grid-ext` workspace package; `tests/setup.ts` exporting `installGridTestEnv()` used by every later test that constructs a `VelocityGrid`.

- [ ] **Step 1: Create `packages/ext/package.json`**

```json
{
  "name": "@wellsfargo-starui/velocity-grid-ext",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "echo '@wellsfargo-starui/velocity-grid-ext is source-direct — no build yet' && exit 0",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wellsfargo-starui/velocity-grid-calc": "*",
    "@wellsfargo-starui/velocity-grid-customizer": "*",
    "@wellsfargo-starui/velocity-grid-edit": "*",
    "@wellsfargo-starui/velocity-grid-format": "*",
    "@wellsfargo-starui/velocity-grid": "*",
    "@wellsfargo-starui/velocity-grid-renderers": "*",
    "@wellsfargo-starui/velocity-grid-rules": "*",
    "@lit/context": "^1.1.6",
    "lit": "^3.3.3"
  },
  "devDependencies": {
    "happy-dom": "^15.0.0",
    "typescript": "~5.9.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/ext/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/ext/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/ext/README.md`**

```markdown
# @wellsfargo-starui/velocity-grid-ext

`VelocityGridExt` — cgrid's self-contained, batteries-included wrapper: owns a `VelocityGrid`
and layers on all config tooling (two-tier toolbar, settings sheet, profiles)
via a plugin/extension registry. Zero StarUI dependency.

**Status:** Wave 0 (spine). See
`docs/superpowers/specs/2026-07-07-cgridext-foundation-design.md` and
`docs/superpowers/plans/2026-07-07-cgridext-foundation-wave0-spine.md`.
```

- [ ] **Step 5: Create `packages/ext/tests/setup.ts`** (Worker + canvas stubs so `new VelocityGrid(...)` runs under happy-dom — mirrors `packages/customizer/tests/registration.test.ts`)

```ts
import { vi } from 'vitest';

/** Install the Worker + canvas 2D stubs a `VelocityGrid` needs under happy-dom.
 *  Idempotent — safe to call from every test file's `beforeAll`. */
export function installGridTestEnv(): void {
  const g = globalThis as any;
  if (g.__cgridExtFakeEnv) return;
  g.__cgridExtFakeEnv = true;

  g.Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage(): void {}
    addEventListener = (_: string, cb: (e: { data: any }) => void) => {
      this.listeners.push(cb);
    };
    removeEventListener = () => {};
    terminate = vi.fn();
  };

  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
    };
    return () => ctx;
  })() as any;
}
```

- [ ] **Step 6: Create `packages/ext/src/index.ts`** (placeholder export so the package resolves)

```ts
export const CGRID_EXT_VERSION = '0.0.0';
```

- [ ] **Step 7: Create `packages/ext/tests/scaffold.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CGRID_EXT_VERSION } from '../src/index';

describe('@wellsfargo-starui/velocity-grid-ext scaffold', () => {
  it('exposes a version constant', () => {
    expect(CGRID_EXT_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 8: Install workspace deps and run the test**

Run: `npm install && npm test --workspace=@wellsfargo-starui/velocity-grid-ext`
Expected: install links `@wellsfargo-starui/velocity-grid-ext`; test PASSES (1 passed).

- [ ] **Step 9: Verify typecheck**

Run: `npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext`
Expected: exits 0, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/ext package-lock.json
git commit -m "feat(ext): scaffold @wellsfargo-starui/velocity-grid-ext package + test env

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extension contract types

**Files:**
- Create: `packages/ext/src/extension/types.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/types.test.ts`

**Interfaces:**
- Consumes: `VelocityGrid`, `StateModule`, `GridState` from `@wellsfargo-starui/velocity-grid`; `ModalHost` type (re-derive locally — see below).
- Produces: `VelocityGridExtension`, `ExtensionKind`, `SettingsModule`, `ModuleCategory`, `ModuleInstance`, `ToolbarItem`, `ToolbarSlot`, `ToolbarItemInstance`, `VelocityGridExtContext`, `ProfileController`, `ProfileStore`, `ProfileMeta`, `ProfileSnapshot`, `Unsub`, `ExtEvent`, `ExtEventBus`. These names are the contract every later task depends on.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { SettingsModule, ToolbarItem } from '../src/extension/types';
import { isSettingsModule, isToolbarItem } from '../src/extension/types';

describe('extension type guards', () => {
  const mod = {
    id: 'x', kind: 'settings-module', title: 'X', icon: 'i', category: 'layout',
    init() {}, mount() { return { destroy() {} }; },
  } as SettingsModule;
  const item = {
    id: 'y', kind: 'toolbar-item', slot: 'primary-left',
    init() {}, render() { return { destroy() {} }; },
  } as ToolbarItem;

  it('discriminates settings-module vs toolbar-item', () => {
    expect(isSettingsModule(mod)).toBe(true);
    expect(isSettingsModule(item)).toBe(false);
    expect(isToolbarItem(item)).toBe(true);
    expect(isToolbarItem(mod)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- types`
Expected: FAIL — cannot find module `../src/extension/types`.

- [ ] **Step 3: Create `packages/ext/src/extension/types.ts`**

```ts
import type { VelocityGrid, StateModule, GridState } from '@wellsfargo-starui/velocity-grid';

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
export interface VelocityGridExtContext {
  grid: VelocityGrid;
  getState(): GridState;
  setState(state: Partial<GridState>): void;
  registerStateModule(module: StateModule): Unsub;
  modal: ExtModalHost;
  events: ExtEventBus;
  profiles: ProfileController;
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

export interface ModuleInstance { destroy(): void; refresh?(): void }

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
  toggleable?: boolean;
  render(host: HTMLElement, ctx: VelocityGridExtContext): ToolbarItemInstance;
}

export function isSettingsModule(e: VelocityGridExtension): e is SettingsModule {
  return e.kind === 'settings-module';
}
export function isToolbarItem(e: VelocityGridExtension): e is ToolbarItem {
  return e.kind === 'toolbar-item';
}
```

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`**

```ts
export const CGRID_EXT_VERSION = '0.0.0';
export * from './extension/types';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- types`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): extension contract types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extension registry

**Files:**
- Create: `packages/ext/src/extension/registry.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/registry.test.ts`

**Interfaces:**
- Consumes: `VelocityGridExtension`, `SettingsModule`, `ToolbarItem`, `ExtensionKind`, `isSettingsModule`, `isToolbarItem` from `./types`.
- Produces: `ExtensionRegistry` with `register(ext)`, `remove(id)`, `has(id)`, `get(id)`, `all()`, `settingsModules()`, `toolbarItems()`, `initAll(ctx)`, `disposeAll()`; and `ExtensionSpec` (`VelocityGridExtension | { remove: string } | { id: string; factory: () => VelocityGridExtension }`) used by VelocityGridExt to apply consumer overrides.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/registry.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { ExtensionRegistry } from '../src/extension/registry';
import type { VelocityGridExtContext, SettingsModule, ToolbarItem } from '../src/extension/types';

const mod = (id: string): SettingsModule => ({
  id, kind: 'settings-module', title: id, icon: 'i', category: 'layout',
  init: vi.fn(), mount: () => ({ destroy() {} }),
});
const item = (id: string): ToolbarItem => ({
  id, kind: 'toolbar-item', slot: 'primary-left',
  init: vi.fn(), render: () => ({ destroy() {} }),
});

describe('ExtensionRegistry', () => {
  it('registers, dedupes by id (last wins), removes, and filters by kind', () => {
    const r = new ExtensionRegistry();
    r.register(mod('grid-options'));
    r.register(item('save'));
    const replacement = mod('grid-options');
    r.register(replacement);                       // same id → replace
    expect(r.all()).toHaveLength(2);
    expect(r.get('grid-options')).toBe(replacement);
    expect(r.settingsModules().map(m => m.id)).toEqual(['grid-options']);
    expect(r.toolbarItems().map(m => m.id)).toEqual(['save']);
    r.remove('save');
    expect(r.has('save')).toBe(false);
  });

  it('initAll calls init once per extension with the context; disposeAll disposes', () => {
    const r = new ExtensionRegistry();
    const m = mod('m');
    const disposed = vi.fn();
    (m as any).dispose = disposed;
    r.register(m);
    const ctx = {} as VelocityGridExtContext;
    r.initAll(ctx);
    expect(m.init).toHaveBeenCalledWith(ctx);
    r.disposeAll();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- registry`
Expected: FAIL — cannot find `../src/extension/registry`.

- [ ] **Step 3: Create `packages/ext/src/extension/registry.ts`**

```ts
import type { VelocityGridExtension, VelocityGridExtContext, SettingsModule, ToolbarItem } from './types';
import { isSettingsModule, isToolbarItem } from './types';

/** How a consumer mutates the default bundle via `options.ext.extensions`. */
export type ExtensionSpec =
  | VelocityGridExtension
  | { remove: string }
  | { id: string; factory: () => VelocityGridExtension };

export class ExtensionRegistry {
  private map = new Map<string, VelocityGridExtension>();
  private order: string[] = [];

  register(ext: VelocityGridExtension): void {
    if (!this.map.has(ext.id)) this.order.push(ext.id);
    this.map.set(ext.id, ext);
  }

  remove(id: string): void {
    if (this.map.delete(id)) this.order = this.order.filter(x => x !== id);
  }

  has(id: string): boolean { return this.map.has(id); }
  get(id: string): VelocityGridExtension | undefined { return this.map.get(id); }
  all(): VelocityGridExtension[] { return this.order.map(id => this.map.get(id)!); }

  settingsModules(): SettingsModule[] { return this.all().filter(isSettingsModule); }
  toolbarItems(): ToolbarItem[] { return this.all().filter(isToolbarItem); }

  /** Apply a consumer override list on top of the current registry. */
  applySpecs(specs: ExtensionSpec[] | undefined): void {
    for (const s of specs ?? []) {
      if ('remove' in s) this.remove(s.remove);
      else if ('factory' in s) this.register(s.factory());
      else this.register(s);
    }
  }

  initAll(ctx: VelocityGridExtContext): void { for (const e of this.all()) e.init(ctx); }
  disposeAll(): void {
    for (const e of this.all()) e.dispose?.();
    this.map.clear();
    this.order = [];
  }
}
```

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { ExtensionRegistry, type ExtensionSpec } from './extension/registry';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- registry`
Expected: PASS (2 passed).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): extension registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Context factory + profiles (dirty + localStorage store)

**Files:**
- Create: `packages/ext/src/profiles/localStorageStore.ts`
- Create: `packages/ext/src/profiles/controller.ts`
- Create: `packages/ext/src/extension/context.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/profiles.test.ts`, `packages/ext/tests/context.test.ts`

**Interfaces:**
- Consumes: `VelocityGrid` (`getState`/`setState`/`registerStateModule`/`getModal`), `ProfileStore`/`ProfileController`/`ProfileSnapshot`/`ProfileMeta`/`VelocityGridExtContext`/`ExtEventBus` from `./types`.
- Produces: `LocalStorageProfileStore` (impl of `ProfileStore`), `ProfilesController` (impl of `ProfileController`; ctor `(grid, store, opts)`), `createExtEventBus()`, `createExtContext(grid, profiles): VelocityGridExtContext`.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/profiles.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import type { ProfileSnapshot } from '../src/extension/types';

const snap = (id: string): ProfileSnapshot => ({
  meta: { id, name: id, updatedAt: 1 },
  gridState: {} as any,
  ext: { theme: 'dark' },
});

describe('LocalStorageProfileStore', () => {
  beforeEach(() => localStorage.clear());

  it('saves, lists, loads and removes profiles under a namespaced key', async () => {
    const store = new LocalStorageProfileStore('demo');
    await store.save('a', snap('a'));
    await store.save('b', snap('b'));
    expect((await store.list()).map(m => m.id).sort()).toEqual(['a', 'b']);
    expect((await store.load('a'))?.ext).toEqual({ theme: 'dark' });
    await store.remove('a');
    expect((await store.list()).map(m => m.id)).toEqual(['b']);
    expect(await store.load('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- profiles`
Expected: FAIL — cannot find `../src/profiles/localStorageStore`.

- [ ] **Step 3: Create `packages/ext/src/profiles/localStorageStore.ts`**

```ts
import type { ProfileStore, ProfileSnapshot, ProfileMeta } from '../extension/types';

/** Default `ProfileStore` — one localStorage key per namespace holding a
 *  `{ [id]: ProfileSnapshot }` map. Consumers swap in server/IndexedDB
 *  stores by implementing `ProfileStore`. */
export class LocalStorageProfileStore implements ProfileStore {
  constructor(private namespace = 'cgrid-ext') {}
  private get key(): string { return `${this.namespace}:profiles`; }

  private read(): Record<string, ProfileSnapshot> {
    try { return JSON.parse(localStorage.getItem(this.key) ?? '{}'); }
    catch { return {}; }
  }
  private write(map: Record<string, ProfileSnapshot>): void {
    localStorage.setItem(this.key, JSON.stringify(map));
  }

  async list(): Promise<ProfileMeta[]> {
    return Object.values(this.read()).map(s => s.meta);
  }
  async load(id: string): Promise<ProfileSnapshot | null> {
    return this.read()[id] ?? null;
  }
  async save(id: string, snap: ProfileSnapshot): Promise<void> {
    const map = this.read(); map[id] = snap; this.write(map);
  }
  async remove(id: string): Promise<void> {
    const map = this.read(); delete map[id]; this.write(map);
  }
}
```

- [ ] **Step 4: Write the failing test** `packages/ext/tests/context.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeGrid(): VelocityGrid {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new VelocityGrid(host, { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [] } as any);
}

describe('createExtContext + ProfilesController', () => {
  it('exposes grid pass-throughs and a dirty-tracking profiles controller', () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    const ctx = createExtContext(grid, profiles);

    expect(ctx.grid).toBe(grid);
    expect(typeof ctx.getState).toBe('function');

    const seen: boolean[] = [];
    ctx.profiles.onDirtyChange(d => seen.push(d));
    expect(ctx.profiles.isDirty()).toBe(false);
    ctx.profiles.markDirty();
    expect(ctx.profiles.isDirty()).toBe(true);
    expect(seen).toEqual([true]);
    grid.destroy();
  });

  it('save() persists a snapshot and clears dirty', async () => {
    const grid = makeGrid();
    const store = new LocalStorageProfileStore('t');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    profiles.markDirty();
    await profiles.save();
    expect(profiles.isDirty()).toBe(false);
    expect(await store.load('default')).not.toBeNull();
    grid.destroy();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- context`
Expected: FAIL — cannot find `../src/profiles/controller`.

- [ ] **Step 6: Create `packages/ext/src/profiles/controller.ts`**

```ts
import type { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type {
  ProfileController, ProfileStore, ProfileMeta, Unsub,
} from '../extension/types';

export interface ProfilesOptions { initialId?: string; extState?: () => Record<string, unknown> }

/** Wave-0 profiles: tracks dirty state (drives the save button) and does a
 *  full-snapshot save/load through a `ProfileStore`. A profile snapshot is
 *  just `grid.getState()` (which already folds in every registered module
 *  slice) plus ext chrome state. Richer switching UI lands in the Profiles
 *  wave against this same class. */
export class ProfilesController implements ProfileController {
  private id: string;
  private dirty = false;
  private listeners = new Set<(d: boolean) => void>();

  constructor(
    private grid: VelocityGrid,
    private store: ProfileStore,
    private opts: ProfilesOptions = {},
  ) {
    this.id = opts.initialId ?? 'default';
  }

  activeId(): string { return this.id; }
  isDirty(): boolean { return this.dirty; }

  markDirty(): void { this.setDirty(true); }
  private setDirty(v: boolean): void {
    if (this.dirty === v) return;
    this.dirty = v;
    for (const fn of this.listeners) fn(v);
  }
  onDirtyChange(fn: (d: boolean) => void): Unsub {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async save(): Promise<void> {
    await this.store.save(this.id, {
      meta: { id: this.id, name: this.id, updatedAt: nowStamp() },
      gridState: this.grid.getState(),
      ext: this.opts.extState?.() ?? {},
    });
    this.setDirty(false);
  }

  async switchTo(id: string): Promise<void> {
    const snap = await this.store.load(id);
    this.id = id;
    if (snap) this.grid.setState(snap.gridState);
    this.setDirty(false);
  }

  list(): Promise<ProfileMeta[]> { return this.store.list(); }
}

/** Stamp helper isolated so tests can tolerate happy-dom; avoids importing
 *  Date at module top for clarity. */
function nowStamp(): number { return Date.now(); }
```

- [ ] **Step 7: Create `packages/ext/src/extension/context.ts`**

```ts
import type { VelocityGrid, StateModule } from '@wellsfargo-starui/velocity-grid';
import type {
  VelocityGridExtContext, ExtEventBus, ExtEvent, ProfileController, ExtModalHost, Unsub,
} from './types';

export function createExtEventBus(): ExtEventBus {
  const map = new Map<string, Set<(e: ExtEvent) => void>>();
  return {
    on(type, fn): Unsub {
      const set = map.get(type) ?? new Set();
      set.add(fn); map.set(type, set);
      return () => set.delete(fn);
    },
    emit(e): void { for (const fn of map.get(e.type) ?? []) fn(e); },
  };
}

/** Build the context every extension receives. The kernel is reached
 *  through its public api only. `grid.getModal()` returns the kernel
 *  ModalHost, which structurally satisfies `ExtModalHost`. */
export function createExtContext(grid: VelocityGrid, profiles: ProfileController): VelocityGridExtContext {
  const events = createExtEventBus();
  return {
    grid,
    getState: () => grid.getState(),
    setState: (s) => grid.setState(s),
    registerStateModule: (m: StateModule) => grid.registerStateModule(m),
    modal: grid.getModal() as unknown as ExtModalHost,
    events,
    profiles,
  };
}
```

- [ ] **Step 8: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { LocalStorageProfileStore } from './profiles/localStorageStore';
export { ProfilesController, type ProfilesOptions } from './profiles/controller';
export { createExtContext, createExtEventBus } from './extension/context';
```

- [ ] **Step 9: Run both tests to verify they pass**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- profiles context`
Expected: PASS (all).

- [ ] **Step 10: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): context factory + profiles controller + localStorage store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Shell layout (strips + region hosts)

**Files:**
- Create: `packages/ext/src/shell/shell.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/shell.test.ts`

**Interfaces:**
- Consumes: `VelocityGridExtContext`, `SettingsModule`, `ToolbarItem`, `ToolbarSlot` from `../extension/types`; a `VelocityGrid` mounted by the caller.
- Produces: `ShellLayout` class with ctor `(root: HTMLElement)`; `gridMount: HTMLElement` (where the caller constructs the VelocityGrid); `mountToolbarItem(item, ctx)`; `mountSettingsModule(module, ctx)` (registers it into the sheet's category menubar); `openSettings(id?)`; `closeSettings()`; `isSettingsOpen()`; `destroy()`. DOM regions carry stable classes `vgext-titlebar`, `vgext-ribbon`, `vgext-grid`, `vgext-sheet`.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/shell.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { ShellLayout } from '../src/shell/shell';
import type { VelocityGridExtContext, SettingsModule, ToolbarItem } from '../src/extension/types';

const ctx = {} as VelocityGridExtContext;

function toolbarItem(id: string, slot: any): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot, init: vi.fn(),
    render: (host) => { host.textContent = id; return { destroy() {} }; },
  };
}
function settingsModule(id: string): SettingsModule {
  return {
    id, kind: 'settings-module', title: id, icon: 'i', category: 'layout',
    init: vi.fn(),
    mount: (host) => { host.textContent = `panel:${id}`; return { destroy() {} }; },
  };
}

describe('ShellLayout', () => {
  it('builds the strip regions and exposes a grid mount', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    expect(root.querySelector('.vgext-titlebar')).toBeTruthy();
    expect(root.querySelector('.vgext-ribbon')).toBeTruthy();
    expect(root.querySelector('.vgext-grid')).toBeTruthy();
    expect(shell.gridMount.classList.contains('vgext-grid')).toBe(true);
  });

  it('mounts a toolbar item into its slot', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountToolbarItem(toolbarItem('save', 'primary-right'), ctx);
    expect(root.querySelector('.vgext-titlebar')!.textContent).toContain('save');
  });

  it('opens the settings sheet and renders the requested module panel', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options'), ctx);
    expect(shell.isSettingsOpen()).toBe(false);
    shell.openSettings('grid-options');
    expect(shell.isSettingsOpen()).toBe(true);
    expect(root.querySelector('.vgext-sheet')!.textContent).toContain('panel:grid-options');
    shell.closeSettings();
    expect(shell.isSettingsOpen()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- shell`
Expected: FAIL — cannot find `../src/shell/shell`.

- [ ] **Step 3: Create `packages/ext/src/shell/shell.ts`**

```ts
import type {
  VelocityGridExtContext, SettingsModule, ToolbarItem, ToolbarSlot, ModuleInstance,
} from '../extension/types';

/** The shell is a vertical stack of DOM strips wrapping the kernel canvas:
 *
 *    [ .vgext-titlebar ]   primary toolbar slots
 *    [ .vgext-ribbon   ]   toggleable ribbon sections
 *    [ .vgext-grid     ]   ← caller mounts the VelocityGrid here
 *    [ .vgext-sheet    ]   settings drawer (hidden until opened)
 *
 *  Reserving the strips above the canvas is exactly how the kernel already
 *  handles rowGroupPanel/statusBar, so the canvas viewport sizes correctly.
 */
export class ShellLayout {
  readonly gridMount: HTMLElement;
  private titlebar: HTMLElement;
  private ribbon: HTMLElement;
  private sheet: HTMLElement;
  private modules = new Map<string, { module: SettingsModule; ctx: VelocityGridExtContext }>();
  private openModuleId: string | null = null;
  private live: ModuleInstance | null = null;

  constructor(private root: HTMLElement) {
    root.classList.add('vgext-root');
    this.titlebar = el('vgext-titlebar');
    this.ribbon = el('vgext-ribbon');
    this.gridMount = el('vgext-grid');
    this.sheet = el('vgext-sheet');
    this.sheet.hidden = true;
    root.append(this.titlebar, this.ribbon, this.gridMount, this.sheet);
  }

  private slotHost(slot: ToolbarSlot): HTMLElement {
    if (slot.startsWith('ribbon.')) return sub(this.ribbon, `sec-${slot.slice(7)}`);
    return sub(this.titlebar, slot); // primary-left | primary-center | primary-right
  }

  mountToolbarItem(item: ToolbarItem, ctx: VelocityGridExtContext): void {
    const host = el('vgext-toolbar-item');
    host.dataset.itemId = item.id;
    this.slotHost(item.slot).appendChild(host);
    item.render(host, ctx);
  }

  mountSettingsModule(module: SettingsModule, ctx: VelocityGridExtContext): void {
    this.modules.set(module.id, { module, ctx });
  }

  openSettings(id?: string): void {
    const target = id ?? this.modules.keys().next().value;
    if (!target || !this.modules.has(target)) return;
    this.renderSheet(target);
    this.sheet.hidden = false;
    this.openModuleId = target;
  }

  private renderSheet(id: string): void {
    this.live?.destroy();
    this.sheet.replaceChildren();
    const body = sub(this.sheet, 'body');
    const entry = this.modules.get(id)!;
    this.live = entry.module.mount(body, entry.ctx);
  }

  closeSettings(): void {
    this.live?.destroy();
    this.live = null;
    this.sheet.hidden = true;
    this.openModuleId = null;
  }

  isSettingsOpen(): boolean { return !this.sheet.hidden; }

  destroy(): void {
    this.live?.destroy();
    this.root.replaceChildren();
    this.root.classList.remove('vgext-root');
  }
}

function el(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
/** Get-or-create a stable named child of `parent`. */
function sub(parent: HTMLElement, name: string): HTMLElement {
  const key = `vgext-slot-${name}`;
  let found = parent.querySelector<HTMLElement>(`:scope > .${key}`);
  if (!found) { found = el(key); parent.appendChild(found); }
  return found;
}
```

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { ShellLayout } from './shell/shell';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- shell`
Expected: PASS (3 passed).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): shell layout with title bar / ribbon / grid / sheet regions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `VelocityGridExt` composer

**Files:**
- Create: `packages/ext/src/velocityGridExt.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/cgridExt.test.ts`

**Interfaces:**
- Consumes: `VelocityGrid`, `VelocityGridOptions`, `GridState` from `@wellsfargo-starui/velocity-grid`; `ExtensionRegistry`/`ExtensionSpec`; `ShellLayout`; `createExtContext`; `ProfilesController`; `LocalStorageProfileStore`. Default bundle arrives via a `buildDefaultBundle()` injected in Task 9 — for Task 6 the constructor accepts `options.ext.extensions` only and registers nothing built-in yet (the bundle import is added in Task 9).
- Produces: `VelocityGridExt` class: ctor `(container, options: VelocityGridExtOptions)`; `.grid` getter; pass-throughs `setRowData`, `getState`, `setState`, `on`, `destroy`; `.openSettings(id?)`, `.closeSettings()`; and `VelocityGridExtOptions` type.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/cgridExt.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import type { SettingsModule } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

const opts = () => ({ columnDefs: [{ colId: 'a', field: 'a' }], rowData: [{ a: 1 }] } as any);

describe('VelocityGridExt', () => {
  it('constructs a grid inside the shell and exposes .grid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, opts());
    expect(host.querySelector('.vgext-root')).toBeTruthy();
    expect(host.querySelector('.vgext-grid')).toBeTruthy();
    expect(ext.grid).toBeTruthy();
    expect(typeof ext.getState).toBe('function');
    ext.destroy();
  });

  it('mounts a consumer-provided settings module and opens it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = vi.fn();
    const mod: SettingsModule = {
      id: 'demo', kind: 'settings-module', title: 'Demo', icon: 'i', category: 'layout',
      init: vi.fn(),
      mount: (el) => { mounted(); el.textContent = 'demo-panel'; return { destroy() {} }; },
    };
    const ext = new VelocityGridExt(host, { ...opts(), ext: { extensions: [mod] } });
    ext.openSettings('demo');
    expect(mounted).toHaveBeenCalled();
    expect(host.querySelector('.vgext-sheet')!.textContent).toContain('demo-panel');
    ext.destroy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- cgridExt`
Expected: FAIL — cannot find `../src/cgridExt`.

- [ ] **Step 3: Create `packages/ext/src/velocityGridExt.ts`**

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { VelocityGridOptions, GridState } from '@wellsfargo-starui/velocity-grid';
import { ExtensionRegistry, type ExtensionSpec } from './extension/registry';
import { ShellLayout } from './shell/shell';
import { createExtContext } from './extension/context';
import { ProfilesController } from './profiles/controller';
import { LocalStorageProfileStore } from './profiles/localStorageStore';
import { isSettingsModule, isToolbarItem, type VelocityGridExtContext, type ProfileStore } from './extension/types';

export interface VelocityGridExtOptions<TRow = any> extends VelocityGridOptions<TRow> {
  ext?: {
    extensions?: ExtensionSpec[];
    profiles?: { store?: ProfileStore; initialId?: string };
    modules?: Record<string, unknown>;
  };
}

/** Batteries-included wrapper: owns a VelocityGrid + an ExtensionRegistry, wires
 *  every extension to the kernel through a shared context, and lays the
 *  grid + tooling out via ShellLayout. */
export class VelocityGridExt<TRow = any> {
  private _grid: VelocityGrid<TRow>;
  private shell: ShellLayout;
  private registry = new ExtensionRegistry();
  private profiles: ProfilesController;
  private ctx: VelocityGridExtContext;

  constructor(container: HTMLElement, options: VelocityGridExtOptions<TRow> = {} as any) {
    const { ext, ...gridOptions } = options;
    this.shell = new ShellLayout(container);
    this._grid = new VelocityGrid<TRow>(this.shell.gridMount, gridOptions as VelocityGridOptions<TRow>);

    const store = ext?.profiles?.store ?? new LocalStorageProfileStore();
    this.profiles = new ProfilesController(this._grid, store, {
      initialId: ext?.profiles?.initialId ?? 'default',
    });
    this.ctx = createExtContext(this._grid, this.profiles);

    // Default bundle is registered by subclass hook / Task 9 wiring first,
    // then consumer specs layer on top (add / remove / replace).
    this.registerDefaults();
    this.registry.applySpecs(ext?.extensions);

    this.registry.initAll(this.ctx);
    for (const e of this.registry.all()) {
      if (isSettingsModule(e)) this.shell.mountSettingsModule(e, this.ctx);
      else if (isToolbarItem(e)) this.shell.mountToolbarItem(e, this.ctx);
    }
  }

  /** Overridden/populated in Task 9 to register the built-in bundle. */
  protected registerDefaults(): void { /* bundle wired in Task 9 */ }

  get grid(): VelocityGrid<TRow> { return this._grid; }

  setRowData(rows: TRow[]): void { this._grid.setRowData(rows); }
  getState(): GridState { return this._grid.getState(); }
  setState(state: Partial<GridState>): void { this._grid.setState(state); }
  on(type: string, fn: (e: unknown) => void): () => void {
    return this._grid.addEventListener(type as any, fn as any);
  }

  openSettings(id?: string): void { this.shell.openSettings(id); }
  closeSettings(): void { this.shell.closeSettings(); }

  destroy(): void {
    this.registry.disposeAll();
    this.shell.destroy();
    this._grid.destroy();
  }
}
```

Note: if `VelocityGrid.addEventListener` has a narrower signature in the kernel types, keep the `as any` casts localized here — they are the composition boundary, not leaked to consumers.

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { VelocityGridExt, type VelocityGridExtOptions } from './velocityGridExt';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- cgridExt`
Expected: PASS (2 passed).

- [ ] **Step 6: Full suite + typecheck + commit**

```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-ext
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): VelocityGridExt composer wrapping VelocityGrid + registry + shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `<cgrid-ext>` custom element

**Files:**
- Create: `packages/ext/src/element.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/element.test.ts`

**Interfaces:**
- Consumes: `VelocityGridExt`, `VelocityGridExtOptions`.
- Produces: `CgridExtElement extends HTMLElement` registered as `cgrid-ext`; a `.options` property (set before/after connect) and a `.instance` getter returning the live `VelocityGridExt`; `defineCgridExt()` idempotent registrar.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/element.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { defineCgridExt } from '../src/element';

beforeAll(() => { installGridTestEnv(); defineCgridExt(); });
beforeEach(() => localStorage.clear());

describe('<cgrid-ext>', () => {
  it('constructs a VelocityGridExt on connect using .options', () => {
    const el = document.createElement('cgrid-ext') as any;
    el.options = { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [] };
    document.body.appendChild(el);
    expect(el.querySelector('.vgext-root')).toBeTruthy();
    expect(el.instance).toBeTruthy();
    el.remove();
  });

  it('defineCgridExt is idempotent', () => {
    expect(() => { defineCgridExt(); defineCgridExt(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- element`
Expected: FAIL — cannot find `../src/element`.

- [ ] **Step 3: Create `packages/ext/src/element.ts`**

```ts
import { VelocityGridExt, type VelocityGridExtOptions } from './velocityGridExt';

/** Thin custom element over VelocityGridExt. The class is the source of truth; the
 *  element is a shell. Set `.options` before or after connect; it (re)builds
 *  the instance on connect. */
export class CgridExtElement extends HTMLElement {
  options: VelocityGridExtOptions = {} as VelocityGridExtOptions;
  private _instance: VelocityGridExt | null = null;

  get instance(): VelocityGridExt | null { return this._instance; }

  connectedCallback(): void {
    if (this._instance) return;
    this._instance = new VelocityGridExt(this, this.options);
  }
  disconnectedCallback(): void {
    this._instance?.destroy();
    this._instance = null;
  }
}

export function defineCgridExt(tag = 'cgrid-ext'): void {
  if (!customElements.get(tag)) customElements.define(tag, CgridExtElement);
}
```

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { CgridExtElement, defineCgridExt } from './element';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- element`
Expected: PASS (2 passed).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): <cgrid-ext> custom element

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Grid Options settings module

**Files:**
- Create: `packages/ext/src/modules/gridOptions.ts`
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/gridOptionsModule.test.ts`

**Interfaces:**
- Consumes: `SettingsModule`, `VelocityGridExtContext`, `ModuleInstance` from `../extension/types`; `CgcNumber`/`CgcSwitch`/`defineChromeComponents` from `@wellsfargo-starui/velocity-grid-customizer`; kernel `setGridOption`/`getGridOption` (public) via `ctx.grid`.
- Produces: `gridOptionsModule(): SettingsModule` (id `'grid-options'`, category `'layout'`). On mount renders a Row Height number field + a Row-hover switch; edits call `ctx.grid.setGridOption(...)` and `ctx.profiles.markDirty()`; registers a `'grid-options'` state slice mirroring the touched option values.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/gridOptionsModule.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { gridOptionsModule } from '../src/modules/gridOptions';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import { ProfilesController } from '../src/profiles/controller';
import { createExtContext } from '../src/extension/context';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeCtx() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const grid = new VelocityGrid(host, { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [] } as any);
  const profiles = new ProfilesController(grid, new LocalStorageProfileStore('t'), {});
  return { grid, ctx: createExtContext(grid, profiles), profiles };
}

describe('gridOptionsModule', () => {
  it('renders controls and writes row height through the kernel', () => {
    const { grid, ctx, profiles } = makeCtx();
    const setOpt = vi.spyOn(grid, 'setGridOption');
    const mod = gridOptionsModule();
    const panel = document.createElement('div');
    mod.init(ctx);
    const inst = mod.mount(panel, ctx);

    const rowHeight = panel.querySelector<HTMLElement>('[data-opt="rowHeight"]')!;
    expect(rowHeight).toBeTruthy();
    // Simulate the chrome control emitting a change to 40.
    rowHeight.dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 40 }, bubbles: true }));
    expect(setOpt).toHaveBeenCalledWith('rowHeight', 40);
    expect(profiles.isDirty()).toBe(true);

    inst.destroy();
    grid.destroy();
  });

  it('registers a grid-options state slice that round-trips', () => {
    const { grid, ctx } = makeCtx();
    const mod = gridOptionsModule();
    mod.init(ctx);
    const panel = document.createElement('div');
    const inst = mod.mount(panel, ctx);
    panel.querySelector<HTMLElement>('[data-opt="rowHeight"]')!
      .dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 32 }, bubbles: true }));

    const state = grid.getState();
    expect((state.modules?.['grid-options'] as any)?.data?.rowHeight).toBe(32);
    inst.destroy();
    grid.destroy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- gridOptionsModule`
Expected: FAIL — cannot find `../src/modules/gridOptions`.

- [ ] **Step 3: Create `packages/ext/src/modules/gridOptions.ts`**

```ts
import { defineChromeComponents } from '@wellsfargo-starui/velocity-grid-customizer';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';

/** Grid Options module — the spine's proof module. Reads/writes kernel
 *  options through the public `setGridOption`, marks the profile dirty on
 *  edit, and owns a `grid-options` state slice so its values persist with
 *  profiles. Built from @wellsfargo-starui/velocity-grid-customizer chrome (cgc-* controls). */
export function gridOptionsModule(): SettingsModule {
  // Touched values, mirrored into the state slice.
  const touched: Record<string, unknown> = {};

  return {
    id: 'grid-options',
    kind: 'settings-module',
    title: 'Grid Options',
    icon: 'sliders',
    category: 'layout',

    init(ctx: VelocityGridExtContext): void {
      defineChromeComponents(); // idempotent registration of cgc-* elements
      ctx.registerStateModule({
        id: 'grid-options',
        version: 1,
        get: () => (Object.keys(touched).length ? { ...touched } : undefined),
        set: (data) => {
          if (data && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
              touched[k] = v;
              ctx.grid.setGridOption(k as any, v as any);
            }
          }
        },
      });
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      const band = document.createElement('cgc-band');
      band.setAttribute('band-title', 'Display');

      const rowHeight = document.createElement('cgc-number');
      rowHeight.setAttribute('data-opt', 'rowHeight');
      rowHeight.setAttribute('label', 'Row height');
      rowHeight.setAttribute('min', '16');

      const hover = document.createElement('cgc-switch');
      hover.setAttribute('data-opt', 'suppressRowHoverHighlight');
      hover.setAttribute('label', 'Row hover highlight');

      band.append(rowHeight, hover);
      host.appendChild(band);

      const onChange = (ev: Event) => {
        const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-opt]');
        if (!target) return;
        const opt = target.dataset.opt!;
        const value = (ev as CustomEvent).detail?.value;
        // suppressRowHoverHighlight switch is inverted vs the label meaning.
        const applied = opt === 'suppressRowHoverHighlight' ? !value : value;
        touched[opt] = applied;
        ctx.grid.setGridOption(opt as any, applied as any);
        ctx.profiles.markDirty();
      };
      host.addEventListener('cgc-change', onChange);

      return { destroy() { host.removeEventListener('cgc-change', onChange); host.replaceChildren(); } };
    },
  };
}
```

Note: confirm the kernel exposes `setGridOption(key, value)` publicly (it does — `VelocityGridExt` uses it via `ctx.grid`). If the option key `suppressRowHoverHighlight` is not persistable, the slice still round-trips because `set` re-applies via `setGridOption`; adjust the sample option only if the kernel rejects the key at runtime (the test asserts `rowHeight`, which is always valid).

- [ ] **Step 4: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { gridOptionsModule } from './modules/gridOptions';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- gridOptionsModule`
Expected: PASS (2 passed).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): Grid Options settings module (spine proof module)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Default bundle wiring

**Files:**
- Create: `packages/ext/src/defaultBundle.ts`
- Modify: `packages/ext/src/velocityGridExt.ts` (populate `registerDefaults`)
- Modify: `packages/ext/src/index.ts`
- Test: `packages/ext/tests/defaultBundle.test.ts`

**Interfaces:**
- Consumes: `gridOptionsModule`; `ToolbarItem` contract; `VelocityGridExtContext`.
- Produces: `buildDefaultBundle(): VelocityGridExtension[]` returning `[settingsLauncher, profileSelector, saveButton, gridOptionsModule()]`; `VelocityGridExt.registerDefaults` registers them. `settingsLauncher` is a `primary-right` toolbar item whose click calls `ctx` → opens settings; `saveButton` reflects `ctx.profiles` dirty state.

- [ ] **Step 1: Write the failing test** `packages/ext/tests/defaultBundle.test.ts`

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('default bundle', () => {
  it('registers Grid Options + primary toolbar items out of the box', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [] } as any);

    // Settings launcher present in the title bar.
    const launcher = host.querySelector('[data-item-id="settings-launcher"]');
    expect(launcher).toBeTruthy();
    // Save button present.
    expect(host.querySelector('[data-item-id="save"]')).toBeTruthy();

    // Clicking the launcher opens the Grid Options sheet.
    (launcher!.querySelector('button') as HTMLButtonElement).click();
    expect(host.querySelector('.vgext-sheet')!.textContent).toContain('Row height');
    ext.destroy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- defaultBundle`
Expected: FAIL — cannot find `../src/defaultBundle` (and launcher missing).

- [ ] **Step 3: Create `packages/ext/src/defaultBundle.ts`**

```ts
import type { VelocityGridExtension, ToolbarItem, VelocityGridExtContext } from './extension/types';
import { gridOptionsModule } from './modules/gridOptions';

/** A tiny helper for building an icon button toolbar item. */
function button(id: string, label: string, onClick: (ctx: VelocityGridExtContext) => void): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot: 'primary-right', init() {},
    render(host, ctx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vgext-btn';
      b.textContent = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => onClick(ctx));
      host.appendChild(b);
      return { destroy() { host.replaceChildren(); } };
    },
  };
}

/** Save button whose enabled/label state follows the profiles dirty flag. */
function saveButton(): ToolbarItem {
  return {
    id: 'save', kind: 'toolbar-item', slot: 'primary-right', init() {},
    render(host, ctx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vgext-btn vgext-save';
      const sync = (dirty: boolean) => {
        b.textContent = dirty ? 'Save*' : 'Save';
        b.disabled = !dirty;
      };
      sync(ctx.profiles.isDirty());
      const off = ctx.profiles.onDirtyChange(sync);
      b.addEventListener('click', () => { void ctx.profiles.save(); });
      host.appendChild(b);
      return { destroy() { off(); host.replaceChildren(); } };
    },
  };
}

/** The built-in extension set VelocityGridExt registers before consumer specs.
 *  The settings launcher needs a way to open the sheet; it emits an ext
 *  event the shell subscribes to via VelocityGridExt (see registerDefaults). */
export function buildDefaultBundle(): VelocityGridExtension[] {
  const launcher = button('settings-launcher', 'Settings', (ctx) =>
    ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
  return [launcher, saveButton(), gridOptionsModule()];
}
```

- [ ] **Step 4: Populate `registerDefaults` in `packages/ext/src/velocityGridExt.ts`**

Replace the placeholder `registerDefaults` with:

```ts
  protected registerDefaults(): void {
    for (const e of buildDefaultBundle()) this.registry.register(e);
    // Wire the settings launcher's event to the shell.
    this.ctx.events.on('open-settings', (e) =>
      this.shell.openSettings((e as { id?: string }).id));
  }
```

And add the import at the top of `velocityGridExt.ts`:

```ts
import { buildDefaultBundle } from './defaultBundle';
```

Note: `registerDefaults` runs in the constructor AFTER `this.ctx` is assigned — verify ordering: `createExtContext(...)` (assigns `this.ctx`) precedes `this.registerDefaults()`. It does in Task 6's constructor. Good.

- [ ] **Step 5: Re-export from `packages/ext/src/index.ts`** (append)

```ts
export { buildDefaultBundle } from './defaultBundle';
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test --workspace=@wellsfargo-starui/velocity-grid-ext -- defaultBundle`
Expected: PASS.

- [ ] **Step 7: Full suite + typecheck + commit**

```bash
npm test --workspace=@wellsfargo-starui/velocity-grid-ext
npm run typecheck --workspace=@wellsfargo-starui/velocity-grid-ext
git add packages/ext
git commit -m "feat(ext): default bundle (settings launcher, save, grid options)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `apps/cgrid-ext-demo` (live STOMP testbed)

**Files:**
- Create: `apps/cgrid-ext-demo/package.json`
- Create: `apps/cgrid-ext-demo/tsconfig.json`
- Create: `apps/cgrid-ext-demo/vite.config.ts`
- Create: `apps/cgrid-ext-demo/index.html`
- Create: `apps/cgrid-ext-demo/src/main.ts`
- Create: `apps/cgrid-ext-demo/src/stomp.ts`

**Interfaces:**
- Consumes: `VelocityGridExt` from `@wellsfargo-starui/velocity-grid-ext`; `@wellsfargo-starui/velocity-grid/style.css`; the STOMP feed at `ws://localhost:8081` (run `starui/apps/stomp-view-server`).
- Produces: a runnable demo on port **5188** mounting `VelocityGridExt` with the default bundle over the live feed. Zero feature code — a plain consumer.

- [ ] **Step 1: Create `apps/cgrid-ext-demo/package.json`**

```json
{
  "name": "cgrid-ext-demo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@stomp/stompjs": "^7.1.1",
    "@wellsfargo-starui/velocity-grid-ext": "*",
    "@wellsfargo-starui/velocity-grid": "*"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "typescript": "~5.9.3",
    "vite": "^7.3.2"
  }
}
```

- [ ] **Step 2: Create `apps/cgrid-ext-demo/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "e2e/**/*"]
}
```

- [ ] **Step 3: Create `apps/cgrid-ext-demo/vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5188 },
});
```

- [ ] **Step 4: Create `apps/cgrid-ext-demo/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>VelocityGridExt Demo</title>
    <style>
      html, body, #app { height: 100%; margin: 0; }
      .vgext-root { display: flex; flex-direction: column; height: 100%; }
      .vgext-grid { flex: 1 1 auto; min-height: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/cgrid-ext-demo/src/stomp.ts`** (minimal typed feed client — mirrors `apps/cgrid-customizer-demo/src/stomp.ts`)

```ts
import { Client } from '@stomp/stompjs';

export interface Position {
  positionId: string;
  cusip: string;
  isin: string;
  quantity: number;
  price: number;
}

/** Connect to the shared STOMP view server and forward decoded snapshots. */
export function connectStomp(onRows: (rows: Position[]) => void): () => void {
  const client = new Client({
    brokerURL: 'ws://localhost:8081',
    reconnectDelay: 2000,
  });
  client.onConnect = () => {
    client.subscribe('/topic/positions', (msg) => {
      try { onRows(JSON.parse(msg.body) as Position[]); } catch { /* ignore */ }
    });
  };
  client.activate();
  return () => { void client.deactivate(); };
}
```

- [ ] **Step 6: Create `apps/cgrid-ext-demo/src/main.ts`**

```ts
import { VelocityGridExt } from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';
import { connectStomp, type Position } from './stomp';

const app = document.querySelector<HTMLDivElement>('#app')!;

const ext = new VelocityGridExt<Position>(app, {
  columnDefs: [
    { colId: 'positionId', field: 'positionId', headerName: 'Position Id' },
    { colId: 'cusip', field: 'cusip', headerName: 'Cusip' },
    { colId: 'isin', field: 'isin', headerName: 'Isin' },
    { colId: 'quantity', field: 'quantity', headerName: 'Quantity', cellDataType: 'number' },
    { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number' },
  ],
  rowData: [],
} as any);

// Expose for E2E hooks.
(window as any).__ext = ext;

connectStomp((rows) => ext.setRowData(rows));
```

- [ ] **Step 7: Install + typecheck + run dev to smoke-check**

Run: `npm install`
Run: `npm run typecheck --workspace=cgrid-ext-demo`
Expected: install links the app; typecheck exits 0.
Run (manual smoke, optional): `npm run dev --workspace=cgrid-ext-demo` then open `http://localhost:5188` — the grid renders inside the shell with a title bar (Settings + Save buttons).

- [ ] **Step 8: Commit**

```bash
git add apps/cgrid-ext-demo package-lock.json
git commit -m "feat(ext): cgrid-ext-demo live-STOMP testbed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: E2E gate (spine end-to-end)

**Files:**
- Create: `apps/cgrid-ext-demo/playwright.config.ts`
- Create: `apps/cgrid-ext-demo/e2e/spine.spec.ts`

**Interfaces:**
- Consumes: the running demo (Task 10) on port 5188; `window.__ext`.
- Produces: a passing Playwright run that boots the demo, opens the settings sheet via the launcher, changes Row Height, and asserts the grid reflects it — the Wave-0 completion gate.

- [ ] **Step 1: Create `apps/cgrid-ext-demo/playwright.config.ts`** (mirrors `apps/cgrid-customizer-demo/playwright.config.ts`; runs its own dev server, workers=1 per the positions-E2E lesson)

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:5188' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5188',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Write the E2E test** `apps/cgrid-ext-demo/e2e/spine.spec.ts`

```ts
import { test, expect } from '@playwright/test';

test('spine: shell renders, settings sheet opens, row height applies', async ({ page }) => {
  await page.goto('/');

  // Shell chrome is present.
  await expect(page.locator('.vgext-titlebar')).toBeVisible();
  await expect(page.locator('.vgext-grid canvas')).toBeVisible();

  // Open settings via the launcher.
  await page.locator('[data-item-id="settings-launcher"] button').click();
  await expect(page.locator('.vgext-sheet')).toBeVisible();
  await expect(page.locator('.vgext-sheet')).toContainText('Row height');

  // Change row height to 40 via the module, then assert the option took.
  await page.evaluate(() => {
    const el = document.querySelector('.vgext-sheet [data-opt="rowHeight"]')!;
    el.dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 40 }, bubbles: true }));
  });
  const applied = await page.evaluate(() => (window as any).__ext.getState().gridOptions?.rowHeight
    ?? (window as any).__ext.grid.getGridOption?.('rowHeight'));
  expect(applied).toBe(40);

  // Save button becomes enabled (profile dirty).
  await expect(page.locator('[data-item-id="save"] button')).toBeEnabled();
});
```

- [ ] **Step 3: Install Playwright browsers if needed**

Run: `npx playwright install chromium`
Expected: chromium available.

- [ ] **Step 4: Run the E2E gate**

Run: `npm run test:e2e --workspace=cgrid-ext-demo`
Expected: 1 passed. If the row-height assertion path differs (kernel may expose the applied value under a different getter), adjust the `page.evaluate` read to match the kernel's public option accessor — the behavioral assertion (sheet opens, value applies, save enables) stays.

- [ ] **Step 5: Kill any automation browser + commit**

```bash
# ensure no controlled Chrome lingers
pkill -f "playwright" 2>/dev/null || true
git add apps/cgrid-ext-demo
git commit -m "test(ext): spine E2E gate — settings sheet + row height end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Wave 0 scope of the design doc):**
- §2 package & form factor → Tasks 1 (package), 6 (`VelocityGridExt`), 7 (`<cgrid-ext>`). ✓
- §3 extension contract + registry + state slices + Lit chrome → Tasks 2, 3, 8 (uses `@wellsfargo-starui/velocity-grid-customizer` chrome + `registerStateModule`). ✓
- §4 shell layout (title bar · ribbon · grid · sheet regions) → Task 5. ✓ (row-group panel / status bar / tool-panel tabs are kernel-native, configured not rebuilt — no task needed for the spine.)
- §5 two-tier toolbar → Task 9 primary items (settings launcher, save); ribbon *host* exists (Task 5) and ribbon sections land in later waves per §10. ✓ (spine scope)
- §7 profiles (dirty + store) → Task 4. ✓
- §8 state model + data seam → state slice mechanism in Task 8; `dataProvider` reserved seam is typed but not built (spine defers to Data-services spec — consistent with design §11). Note: `VelocityGridExtOptions.ext.dataProvider` from design §2 is intentionally omitted from Task 6's options to avoid a dangling unused field; it is added by the Data-services spec. This is a deliberate scope trim, recorded here.
- §9 demo + E2E gate → Tasks 10, 11. ✓
- Modules beyond Grid Options → later waves (own plans), per design §10. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Each code step shows full code. The two "Note:" callouts flag runtime-verification points (kernel option getter name; option key validity) with a concrete fallback, not a placeholder. ✓

**3. Type consistency:** `VelocityGridExtContext`, `SettingsModule.mount`, `ToolbarItem.render`, `ProfileController` members (`isDirty`/`markDirty`/`onDirtyChange`/`save`/`switchTo`/`list`/`activeId`), `ExtensionRegistry` methods, `ShellLayout` API (`gridMount`/`mountToolbarItem`/`mountSettingsModule`/`openSettings`/`closeSettings`/`isSettingsOpen`/`destroy`), and `buildDefaultBundle` are used identically across Tasks 2→9. `data-item-id`/`data-opt`/`.vgext-*` DOM contracts match between shell (Task 5), module (Task 8), bundle (Task 9), and E2E (Task 11). ✓

**Follow-on plans (not this document):** Wave 1 Layout&Columns, Wave 2 Data, Wave 3 Format&Style, Wave 4 Editing, Wave 5 Workspace, Wave 6 Profiles — each written against the *built* contract once the spine lands.
