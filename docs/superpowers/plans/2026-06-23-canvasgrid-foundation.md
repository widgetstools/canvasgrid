# Canvasgrid Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Each task is designed to be implemented in a single, isolated session** — the controller extracts the task's brief and dispatches a fresh subagent. The implementer reads the brief once and works without prior conversation context.

**Goal:** Build the Foundation of a vanilla TS canvas-based grid library (`cgrid`) — render engine + viewport virtualization + Web Worker data pipeline (CSRM) + minimum interactive viability — and a demo app (`apps/cgrid-positions`) that consumes the existing STOMP positions feed for apples-to-apples comparison against the current AG Grid showcase.

**Architecture:** Vanilla TypeScript library exposing `class VelocityGrid` with imperative API + typed event emitter. Data lives in a Web Worker that runs Filter → Sort → GroupAgg → ViewportSlicer; viewport requests return zero-copy transferable typed-array chunks. Main thread paints to one `<canvas>` with layered painters (header / pinned-left / body / pinned-right / overlay). DOM overlays handle cell editing + ARIA accessibility scaffold.

**Tech Stack:** TypeScript 5.9, Vite 7 (library mode for `cgrid`, app mode for demos), Vitest for unit tests, npm workspaces, `@stomp/stompjs` (demo only), `axe-core` (a11y verification). React stays only in `apps/showcase` (relocated existing app); `cgrid/` and `apps/cgrid-positions/` are framework-free.

## Global Constraints

These apply to **every task** in this plan.

- **No framework dependency in `cgrid/`.** No React, Vue, Svelte. Pure vanilla TS. Consumers wrap with their framework of choice.
- **TypeScript strict mode** (`"strict": true` in `cgrid/tsconfig.json`). Every `cgrid/src/**/*.ts` must compile clean under `tsc --noEmit`.
- **Public types live in `cgrid/src/types.ts`** and are re-exported from `cgrid/src/velocityGrid.ts`. Nothing leaks from inner folders except via these exports.
- **Worker boundary types are shared.** `cgrid/src/worker/protocol.ts` is imported by BOTH `worker/client.ts` (main) and `worker/worker.ts` (worker). Never re-define types on either side.
- **`getRowId` is mandatory.** Every public method that ingests row data requires `getRowId` to be set in `VelocityGridOptions`. Missing it is a constructor-time throw.
- **Transferable typed arrays** for every viewport response. `postMessage(msg, [...transferList])` carries every `ArrayBuffer` underlying chunk fields.
- **Async transaction batching** is the default for `applyTransactionAsync`. Default `asyncTransactionWaitMillis = 50`. Catalog reference: `04-data-updates.md`.
- **Single-canvas with layered painters.** Five painters in z-order: header, pinned-left, body, pinned-right, overlay. No stacked DOM canvases.
- **DPR-aware paint.** `canvas.{width,height}` is logical × DPR; `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` runs once per resize.
- **Theme tokens use `--vg-*` CSS custom properties.** Library ships `vg-theme-quartz` + `vg-theme-quartz-dark`. Catalog reference: `21-themes-and-styling.md`.
- **`apps/showcase/`** is the existing AG Grid React app, moved as-is. Do NOT modify its `src/` content in this cycle.
- **Commits:** small, per-task, conventional commits (e.g. `feat(cgrid): …`, `feat(demo): …`, `chore(repo): …`).
- **Test runner:** Vitest. Run via `npm test --workspace=cgrid`. Pure-logic tasks are TDD (red → green → refactor); rendering/worker integration tasks use smoke tests + demo verification.
- **Spec:** `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md` is the source of truth for shapes. When this plan and the spec disagree, the spec wins; raise the conflict.

## File structure (complete map)

```
canvasgrid/                              ← repo root
  package.json                           ← workspace root (Task 1)
  apps/
    showcase/                            ← moved in Task 1
      <existing files unchanged>
    cgrid-positions/                     ← created Tasks 25–27
      package.json
      vite.config.ts
      tsconfig.json
      index.html
      src/main.ts
      src/positionsGrid.ts
      src/stomp.ts
      src/style.css
      README.md
  cgrid/                                 ← library (Tasks 2–24)
    package.json
    vite.config.ts
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      velocityGrid.ts                           ← Task 24 (public class) + re-exports
      types.ts                           ← Task 3
      core/
        eventEmitter.ts                  ← Task 4
        propertyChain.ts                 ← Task 5
        viewport.ts                      ← Task 15
        paintLoop.ts                     ← Task 16
        layout.ts                        ← Task 15 (column flex/width resolver)
      renderer/
        renderer.ts                      ← Task 19
        painters/
          headerPainter.ts               ← Task 18
          bodyPainter.ts                 ← Task 18
          pinnedPainter.ts               ← Task 18
          overlayPainter.ts              ← Task 18
        cellRenderers/
          registry.ts                    ← Task 17
          textCell.ts                    ← Task 17
          numberCell.ts                  ← Task 17
          checkboxCell.ts                ← Task 17
      interaction/
        hitTester.ts                     ← Task 15 (lives with viewport math)
        selectionModel.ts                ← Task 20
        pointerInput.ts                  ← Task 21
        keyboardInput.ts                 ← Task 21
        editorOverlay.ts                 ← Task 22
        a11yOverlay.ts                   ← Task 23
      worker/
        protocol.ts                      ← Task 6
        chunkFormat.ts                   ← Task 11
        dataPipeline.ts                  ← Tasks 7–11
        worker.ts                        ← Task 12
        client.ts                        ← Task 13
      theming/
        tokens.css                       ← Task 14
        cssReader.ts                     ← Task 14
    tests/                               ← Vitest unit tests (per-task)
      eventEmitter.test.ts
      propertyChain.test.ts
      viewport.test.ts
      hitTester.test.ts
      paintLoop.test.ts
      chunkFormat.test.ts
      dataPipeline.test.ts
      selectionModel.test.ts
```

## TDD strategy by task type

- **Pure logic** (eventEmitter, propertyChain, viewport math, hitTester, chunk format, sort/filter/agg/slicer, selectionModel) — strict TDD: failing test first.
- **Worker integration** (client.ts, worker.ts wiring) — contract tests using `vitest`'s worker support + a fake worker stub.
- **Rendering** (renderer, painters, cell renderers) — smoke test against a `node-canvas` or `OffscreenCanvas`-equivalent harness. Visual verification through the demo.
- **DOM overlays** (editor, a11y) — DOM tests using `vitest`'s `happy-dom` env.
- **Public class** (`VelocityGrid`) — integration test asserting the full data-in / event-out round trip on a tiny fixture.

---

### Task 1: Repo restructure into npm workspaces

**Files:**
- Create: `package.json` (root, workspaces declaration)
- Move: existing root scaffold (`src/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`) → `apps/showcase/`
- Create: `apps/showcase/package.json` (relocated, name `showcase`)
- Create: `cgrid/package.json` (empty library scaffold; full library code lands in Tasks 2+)
- Create: `apps/cgrid-positions/` directory placeholder

**Interfaces:**
- Consumes: existing AG Grid showcase content under repo root (the result of all prior cycles).
- Produces: a clean three-workspace layout that all later tasks build into.

- [ ] **Step 1: Inspect current state**

```bash
cd /Users/develop/wfh/canvasgrid
ls -la
git status
```
Expected: existing AG Grid showcase at root; clean working tree.

- [ ] **Step 2: Create new directory structure**

```bash
mkdir -p apps/showcase apps/cgrid-positions cgrid/src
```

- [ ] **Step 3: Move the existing showcase**

```bash
git mv src apps/showcase/src
git mv index.html apps/showcase/index.html
git mv package.json apps/showcase/package.json
git mv package-lock.json apps/showcase/package-lock.json
git mv vite.config.ts apps/showcase/vite.config.ts
git mv tsconfig.json apps/showcase/tsconfig.json
git mv tsconfig.node.json apps/showcase/tsconfig.node.json
git mv README.md apps/showcase/README.md
```
The existing `node_modules/`, `tsconfig.tsbuildinfo`, and `dist/` (if present, gitignored) stay at root or get re-created.

- [ ] **Step 4: Rename the showcase package**

Edit `apps/showcase/package.json` — change `"name": "canvasgrid-stomp-showcase"` to `"name": "showcase"`. Leave the rest unchanged.

- [ ] **Step 5: Write the root workspace `package.json`**

Create `/Users/develop/wfh/canvasgrid/package.json`:
```json
{
  "name": "canvasgrid-workspace",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "cgrid",
    "apps/*"
  ],
  "scripts": {
    "dev:showcase": "npm run dev --workspace=showcase",
    "dev:positions": "npm run dev --workspace=cgrid-positions",
    "build:cgrid": "npm run build --workspace=cgrid",
    "test:cgrid": "npm test --workspace=cgrid",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

- [ ] **Step 6: Stub `cgrid/package.json` (just enough that the workspace resolves)**

Create `/Users/develop/wfh/canvasgrid/cgrid/package.json`:
```json
{
  "name": "cgrid",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/velocity-grid.js",
  "types": "./dist/velocity-grid.d.ts",
  "exports": {
    ".": {
      "types": "./dist/velocity-grid.d.ts",
      "import": "./dist/velocity-grid.js"
    }
  },
  "scripts": {
    "build": "echo 'cgrid build placeholder — wired in Task 2'",
    "test": "echo 'cgrid test placeholder — wired in Task 2'",
    "typecheck": "echo 'cgrid typecheck placeholder — wired in Task 2'"
  },
  "files": ["dist"]
}
```

- [ ] **Step 7: Stub `apps/cgrid-positions/package.json` placeholder**

Create `/Users/develop/wfh/canvasgrid/apps/cgrid-positions/package.json`:
```json
{
  "name": "cgrid-positions",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "echo 'cgrid-positions placeholder — implemented in Task 25'"
  }
}
```

- [ ] **Step 8: Update root `.gitignore` (if needed) and re-install**

Confirm `.gitignore` covers `node_modules`, `dist`, `dist-ssr`, `tsconfig.tsbuildinfo`. Then:
```bash
rm -rf node_modules apps/showcase/node_modules apps/showcase/tsconfig.tsbuildinfo
npm install
```
Expected: npm installs and links workspaces. `node_modules/showcase`, `node_modules/cgrid`, `node_modules/cgrid-positions` symlinks should appear.

- [ ] **Step 9: Verify the showcase still runs**

```bash
npm run dev:showcase
```
Expected: Vite serves at http://localhost:5174; the existing positions grid loads against `localhost:8081`.

Stop the server (Ctrl-C) once confirmed.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore(repo): restructure into npm workspaces (apps/showcase, apps/cgrid-positions, cgrid)"
```

---

### Task 2: cgrid library scaffolding (build + test wiring)

**Files:**
- Modify: `cgrid/package.json` (real scripts + devDeps)
- Create: `cgrid/tsconfig.json`
- Create: `cgrid/vite.config.ts`
- Create: `cgrid/vitest.config.ts`
- Create: `cgrid/src/velocityGrid.ts` (empty re-export shell)
- Create: `cgrid/README.md`
- Create: `cgrid/tests/.gitkeep`

**Interfaces:**
- Consumes: workspace layout from Task 1.
- Produces: a buildable `cgrid` package. `npm run build --workspace=cgrid` succeeds; `npm test --workspace=cgrid` runs (zero tests); `npm run typecheck --workspace=cgrid` succeeds.

- [ ] **Step 1: Write `cgrid/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "useDefineForClassFields": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 2: Write `cgrid/vite.config.ts` (library mode)**

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/velocityGrid.ts'),
      formats: ['es'],
      fileName: 'cgrid',
    },
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      external: [],
    },
  },
  worker: {
    format: 'es',
  },
});
```

- [ ] **Step 3: Write `cgrid/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
```

- [ ] **Step 4: Write `cgrid/src/velocityGrid.ts` (empty re-export shell)**

```typescript
// cgrid — vanilla TS canvas grid library
// Public surface lives here. Internals live under core/, renderer/, interaction/,
// worker/, theming/. See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md.

export const CGRID_VERSION = '0.0.0';
```

- [ ] **Step 5: Update `cgrid/package.json` with real scripts + devDeps**

```json
{
  "name": "cgrid",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/velocity-grid.js",
  "types": "./dist/velocity-grid.d.ts",
  "exports": {
    ".": {
      "types": "./dist/velocity-grid.d.ts",
      "import": "./dist/velocity-grid.js"
    }
  },
  "scripts": {
    "build": "vite build && tsc --emitDeclarationOnly",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist", "src"],
  "devDependencies": {
    "@types/node": "^20.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "~5.9.3",
    "vite": "^7.3.2",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0"
  }
}
```

- [ ] **Step 6: Write minimal `cgrid/README.md`**

```markdown
# cgrid

A vanilla-TypeScript canvas-based grid library. No framework dependencies.

See `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md` for the
Foundation design and target feature surface.

## Status

Foundation in progress.

## Install (workspace)

```bash
npm install
npm run build --workspace=cgrid
npm test --workspace=cgrid
```
```

- [ ] **Step 7: Install + verify**

```bash
cd /Users/develop/wfh/canvasgrid
touch cgrid/tests/.gitkeep
npm install
npm run typecheck --workspace=cgrid
npm test --workspace=cgrid
npm run build --workspace=cgrid
```
Expected: typecheck clean, vitest reports 0 tests (no error), `cgrid/dist/velocity-grid.js` and `cgrid/dist/velocity-grid.d.ts` produced.

- [ ] **Step 8: Commit**

```bash
git add cgrid/ package.json package-lock.json
git commit -m "feat(cgrid): scaffold library package with vite library mode + vitest"
```

---

### Task 3: Public types (`cgrid/src/types.ts`)

**Files:**
- Create: `cgrid/src/types.ts`
- Modify: `cgrid/src/velocityGrid.ts` (add the re-export)
- Test: `cgrid/tests/types.test.ts` (type-only smoke test)

**Interfaces:**
- Consumes: package scaffold from Task 2.
- Produces: every public type used by later tasks. Types reach consumers via `import { VelocityGridOptions, CColDef, … } from 'cgrid'`. Subsequent tasks IMPORT from `../types` (inside the library) or `cgrid` (from outside) but never re-define.

- [ ] **Step 1: Write the type-only smoke test (TDD red)**

`cgrid/tests/types.test.ts`:
```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type {
  VelocityGridOptions, CColDef, VelocityGridApi, VelocityGridEvent, CValueGetterParams,
  CValueFormatterParams, SortModel, FilterModel, GroupModel, TransactionResult,
} from '../src/types';

describe('public types', () => {
  it('VelocityGridOptions requires getRowId', () => {
    type Required = VelocityGridOptions<{ id: string }>['getRowId'];
    expectTypeOf<Required>().toBeFunction();
  });

  it('CColDef accepts field as keyof TRow', () => {
    interface Row { id: string; value: number }
    type Field = CColDef<Row>['field'];
    expectTypeOf<Field>().toEqualTypeOf<keyof Row & string | undefined>();
  });

  it('VelocityGridEvent is a discriminated union on .type', () => {
    type T = VelocityGridEvent['type'];
    expectTypeOf<T>().toEqualTypeOf<
      'gridReady' | 'cellClicked' | 'cellDoubleClicked' | 'cellFocused' |
      'cellValueChanged' | 'selectionChanged' | 'viewportChanged' |
      'modelUpdated' | 'sortChanged' | 'filterChanged' | 'columnResized' |
      'asyncTransactionsFlushed'
    >();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (red)**

```bash
npm test --workspace=cgrid -- types.test
```
Expected: FAIL (`Cannot find module '../src/types'`).

- [ ] **Step 3: Write `cgrid/src/types.ts`**

```typescript
// Public types for cgrid. Re-exported from src/velocityGrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.

export interface VelocityGridOptions<TRow = any> {
  columnDefs: CColDef<TRow>[];
  defaultColDef?: Partial<CColDef<TRow>>;
  rowData?: TRow[];
  getRowId: (row: TRow) => string;
  rowHeight?: number;
  headerHeight?: number;
  rowSelection?: 'none' | 'single' | 'multiple';
  enableCellChangeFlash?: boolean;
  cellFlashDuration?: number;
  cellFadeDuration?: number;
  asyncTransactionWaitMillis?: number;
  theme?: string;
  worker?: { url?: string };
}

export interface CColDef<TRow = any, TValue = any> {
  colId?: string;
  field?: keyof TRow & string;
  headerName?: string;
  width?: number;
  flex?: number;
  minWidth?: number;
  maxWidth?: number;
  pinned?: 'left' | 'right';
  type?: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => TValue;
  valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;
  cellRenderer?: string;
  comparator?: (a: TValue, b: TValue, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable?: boolean;
  resizable?: boolean;
  editable?: boolean | ((row: TRow) => boolean);
  cellEditor?: 'text' | 'number';
}

export interface CValueGetterParams<TRow> { data: TRow; colId: string }
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
}

export interface SortModelEntry { colId: string; direction: 'asc' | 'desc' }
export type SortModel = SortModelEntry[];

export type FilterModelEntry =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };
export type FilterModel = Record<string, FilterModelEntry>;

export interface GroupModel { rowGroupCols: string[] }

export interface Tx<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  remove?: TRow[];
}
export interface TransactionResult {
  add: { rowId: string }[];
  update: { rowId: string }[];
  remove: { rowId: string }[];
}

export type VelocityGridEvent =
  | { type: 'gridReady'; api: VelocityGridApi }
  | { type: 'cellClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellFocused'; rowId: string; colId: string }
  | { type: 'cellValueChanged'; rowId: string; colId: string; oldValue: unknown; newValue: unknown }
  | { type: 'selectionChanged'; selectedRowIds: string[] }
  | { type: 'viewportChanged'; firstRow: number; lastRow: number }
  | { type: 'modelUpdated'; visibleRowCount: number }
  | { type: 'sortChanged'; sortModel: SortModel }
  | { type: 'filterChanged'; filterModel: FilterModel }
  | { type: 'columnResized'; colId: string; width: number }
  | { type: 'asyncTransactionsFlushed'; results: TransactionResult[] };

export interface VelocityGridApi {
  setRowData(rows: any[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  ensureRowVisible(rowId: string, position?: 'top' | 'middle' | 'bottom'): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  destroy(): void;
}
```

- [ ] **Step 4: Re-export from `cgrid/src/velocityGrid.ts`**

```typescript
export const CGRID_VERSION = '0.0.0';

export type {
  VelocityGridOptions, CColDef, CValueGetterParams, CValueFormatterParams,
  SortModel, SortModelEntry, FilterModel, FilterModelEntry, GroupModel,
  Tx, TransactionResult, VelocityGridEvent, VelocityGridApi,
} from './types';
```

- [ ] **Step 5: Run test (green)**

```bash
npm test --workspace=cgrid -- types.test
npm run typecheck --workspace=cgrid
```
Expected: PASS (all 3 type assertions). Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add cgrid/src/types.ts cgrid/src/velocityGrid.ts cgrid/tests/types.test.ts
git commit -m "feat(cgrid): add public types (VelocityGridOptions, CColDef, events, api)"
```

---

### Task 4: Typed event emitter (`cgrid/src/core/eventEmitter.ts`)

**Files:**
- Create: `cgrid/src/core/eventEmitter.ts`
- Test: `cgrid/tests/eventEmitter.test.ts`

**Interfaces:**
- Consumes: `VelocityGridEvent` from Task 3.
- Produces:
  ```typescript
  class TypedEventEmitter<E extends { type: string }> {
    on<T extends E['type']>(type: T, handler: (e: Extract<E, { type: T }>) => void): () => void;
    emit<T extends E['type']>(event: Extract<E, { type: T }>): void;
    destroy(): void;
  }
  ```
  Used by Task 24 (`VelocityGrid` class) to back its public `on(...)` API.

- [ ] **Step 1: Write failing test**

`cgrid/tests/eventEmitter.test.ts`:
```typescript
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
});
```

- [ ] **Step 2: Run test, confirm red**

```bash
npm test --workspace=cgrid -- eventEmitter.test
```
Expected: FAIL (`Cannot find module '../src/core/eventEmitter'`).

- [ ] **Step 3: Implement `cgrid/src/core/eventEmitter.ts`**

```typescript
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
```

- [ ] **Step 4: Run test (green)**

```bash
npm test --workspace=cgrid -- eventEmitter.test
npm run typecheck --workspace=cgrid
```
Expected: 5 tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add cgrid/src/core/eventEmitter.ts cgrid/tests/eventEmitter.test.ts
git commit -m "feat(cgrid): typed event emitter for public VelocityGrid API"
```

---

### Task 5: Property chain resolver (`cgrid/src/core/propertyChain.ts`)

**Files:**
- Create: `cgrid/src/core/propertyChain.ts`
- Test: `cgrid/tests/propertyChain.test.ts`

**Interfaces:**
- Consumes: `CColDef`, `VelocityGridOptions` from Task 3.
- Produces:
  ```typescript
  function resolveColDef<TRow>(
    colDef: CColDef<TRow>,
    defaultColDef?: Partial<CColDef<TRow>>,
  ): ResolvedColDef<TRow>;

  interface ResolvedColDef<TRow = any> {
    colId: string;
    field?: keyof TRow & string;
    headerName: string;
    width?: number;
    flex?: number;
    minWidth: number;
    maxWidth: number;
    pinned?: 'left' | 'right';
    type: 'text' | 'number';
    valueGetter?: (params: CValueGetterParams<TRow>) => unknown;
    valueFormatter?: (params: CValueFormatterParams<TRow, unknown>) => string;
    cellRenderer: string;          // defaults: 'text' or 'number'
    comparator?: (...args: any[]) => number;
    filter?: 'text' | 'number';
    aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
    sortable: boolean;
    resizable: boolean;
    editable: boolean | ((row: TRow) => boolean);
    cellEditor?: 'text' | 'number';
  }
  ```
  Used by Task 15 (layout / viewport) and Tasks 12–13 (worker init request).

- [ ] **Step 1: Write failing test**

`cgrid/tests/propertyChain.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { resolveColDef } from '../src/core/propertyChain';

describe('resolveColDef', () => {
  it('uses field as colId default', () => {
    const r = resolveColDef({ field: 'price' });
    expect(r.colId).toBe('price');
  });

  it('explicit colId wins over field', () => {
    const r = resolveColDef({ colId: 'mid', field: 'price' });
    expect(r.colId).toBe('mid');
  });

  it('uses headerName default = field name', () => {
    const r = resolveColDef({ field: 'instrumentName' });
    expect(r.headerName).toBe('instrumentName');
  });

  it('defaults type to text', () => {
    expect(resolveColDef({ field: 'a' }).type).toBe('text');
  });

  it('defaults cellRenderer to type', () => {
    expect(resolveColDef({ field: 'a', type: 'number' }).cellRenderer).toBe('number');
    expect(resolveColDef({ field: 'a' }).cellRenderer).toBe('text');
  });

  it('explicit cellRenderer overrides type-default', () => {
    expect(resolveColDef({ field: 'a', cellRenderer: 'checkbox' }).cellRenderer).toBe('checkbox');
  });

  it('inherits from defaultColDef', () => {
    const r = resolveColDef({ field: 'a' }, { sortable: false, minWidth: 100 });
    expect(r.sortable).toBe(false);
    expect(r.minWidth).toBe(100);
  });

  it('column-level overrides default', () => {
    const r = resolveColDef({ field: 'a', sortable: true }, { sortable: false });
    expect(r.sortable).toBe(true);
  });

  it('sortable/resizable default true', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.sortable).toBe(true);
    expect(r.resizable).toBe(true);
  });

  it('minWidth default 30, maxWidth default Infinity', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.minWidth).toBe(30);
    expect(r.maxWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it('editable default false', () => {
    expect(resolveColDef({ field: 'a' }).editable).toBe(false);
  });

  it('throws when neither colId nor field given', () => {
    expect(() => resolveColDef({})).toThrow(/colId.*field/);
  });
});
```

- [ ] **Step 2: Run test, confirm red**

```bash
npm test --workspace=cgrid -- propertyChain.test
```
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`cgrid/src/core/propertyChain.ts`:
```typescript
import type { CColDef, CValueGetterParams, CValueFormatterParams } from '../types';

export interface ResolvedColDef<TRow = any> {
  colId: string;
  field?: keyof TRow & string;
  headerName: string;
  width?: number;
  flex?: number;
  minWidth: number;
  maxWidth: number;
  pinned?: 'left' | 'right';
  type: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => unknown;
  valueFormatter?: (params: CValueFormatterParams<TRow, unknown>) => string;
  cellRenderer: string;
  comparator?: (a: unknown, b: unknown, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable: boolean;
  resizable: boolean;
  editable: boolean | ((row: TRow) => boolean);
  cellEditor?: 'text' | 'number';
}

export function resolveColDef<TRow>(
  colDef: CColDef<TRow>,
  defaultColDef: Partial<CColDef<TRow>> = {},
): ResolvedColDef<TRow> {
  const merged: CColDef<TRow> = { ...defaultColDef, ...colDef };

  const colId = merged.colId ?? merged.field;
  if (!colId) {
    throw new Error('[cgrid] ColDef must have colId or field');
  }

  const type = merged.type ?? 'text';

  return {
    colId,
    field: merged.field,
    headerName: merged.headerName ?? String(merged.field ?? colId),
    width: merged.width,
    flex: merged.flex,
    minWidth: merged.minWidth ?? 30,
    maxWidth: merged.maxWidth ?? Number.POSITIVE_INFINITY,
    pinned: merged.pinned,
    type,
    valueGetter: merged.valueGetter as ResolvedColDef<TRow>['valueGetter'],
    valueFormatter: merged.valueFormatter as ResolvedColDef<TRow>['valueFormatter'],
    cellRenderer: merged.cellRenderer ?? type,
    comparator: merged.comparator as ResolvedColDef<TRow>['comparator'],
    filter: merged.filter,
    aggFunc: merged.aggFunc,
    sortable: merged.sortable ?? true,
    resizable: merged.resizable ?? true,
    editable: merged.editable ?? false,
    cellEditor: merged.cellEditor,
  };
}
```

- [ ] **Step 4: Run test (green)**

```bash
npm test --workspace=cgrid -- propertyChain.test
npm run typecheck --workspace=cgrid
```
Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cgrid/src/core/propertyChain.ts cgrid/tests/propertyChain.test.ts
git commit -m "feat(cgrid): resolveColDef merges defaults and column-level overrides"
```

---

### Task 6: Worker protocol types (`cgrid/src/worker/protocol.ts`)

**Files:**
- Create: `cgrid/src/worker/protocol.ts`
- Test: `cgrid/tests/protocol.test.ts` (type-only sanity check)

**Interfaces:**
- Consumes: `SortModel`, `FilterModel`, `GroupModel`, `TransactionResult` from Task 3.
- Produces: all `WorkerRequest`, `WorkerResponse`, `WorkerPush`, `ViewportRequest`, `ViewportChunk` shapes. Imported by Tasks 11, 12, 13.

- [ ] **Step 1: Implement `cgrid/src/worker/protocol.ts`**

```typescript
import type { SortModel, FilterModel, GroupModel, TransactionResult } from '../types';

export type ReqId = number;

export interface WorkerInitPayload {
  columns: WorkerColumn[];
  rowIdField: string;            // initial cycle: getRowId is the value of this field
}

export interface WorkerColumn {
  colId: string;
  field?: string;                // dot-path supported
  type: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  filter?: 'text' | 'number';
}

export interface ViewportRequest {
  rowStart: number;              // inclusive
  rowEnd: number;                // exclusive
  columns: string[];             // colIds, in render order
  includeFlashMask?: boolean;
}

export interface ViewportChunk {
  rowStart: number;
  rowCount: number;
  rowIds: Uint32Array;                       // numeric row IDs (hashed)
  rowKinds: Uint8Array;                      // 0 = leaf, 1 = group, 2 = grandTotal, 3 = footer
  groupDepth: Uint8Array;
  numericCols: Record<string, Float64Array>;
  textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }>;
  flashMask?: Uint8Array;
}

export type WorkerRequest =
  | { id: ReqId; type: 'init';             payload: WorkerInitPayload }
  | { id: ReqId; type: 'setRowData';       payload: { rows: unknown[] } }
  | { id: ReqId; type: 'applyTransaction'; payload: { add?: unknown[]; update?: unknown[]; remove?: string[]; async: boolean } }
  | { id: ReqId; type: 'setSortModel';     payload: SortModel }
  | { id: ReqId; type: 'setFilterModel';   payload: FilterModel }
  | { id: ReqId; type: 'setGroupModel';    payload: GroupModel }
  | { id: ReqId; type: 'getViewport';      payload: ViewportRequest };

export type WorkerResponse =
  | { id: ReqId; type: 'ready' }
  | { id: ReqId; type: 'rowCount';            count: number; visibleCount: number }
  | { id: ReqId; type: 'viewport';            chunk: ViewportChunk }
  | { id: ReqId; type: 'transactionFlushed';  results: TransactionResult }
  | { id: ReqId; type: 'error';               error: string };

export type WorkerPush =
  | { type: 'modelUpdated';              visibleCount: number }
  | { type: 'asyncTransactionsFlushed';  results: TransactionResult[] };

/** Build the transfer list for a viewport response. */
export function collectViewportTransferables(chunk: ViewportChunk): ArrayBuffer[] {
  const out: ArrayBuffer[] = [chunk.rowIds.buffer, chunk.rowKinds.buffer, chunk.groupDepth.buffer];
  for (const arr of Object.values(chunk.numericCols)) out.push(arr.buffer);
  for (const tc of Object.values(chunk.textCols)) {
    out.push(tc.offsets.buffer, tc.bytes.buffer);
  }
  if (chunk.flashMask) out.push(chunk.flashMask.buffer);
  return out;
}
```

- [ ] **Step 2: Sanity test**

`cgrid/tests/protocol.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { collectViewportTransferables, type ViewportChunk } from '../src/worker/protocol';

describe('collectViewportTransferables', () => {
  it('includes all typed-array buffers', () => {
    const chunk: ViewportChunk = {
      rowStart: 0,
      rowCount: 2,
      rowIds: new Uint32Array(2),
      rowKinds: new Uint8Array(2),
      groupDepth: new Uint8Array(2),
      numericCols: { a: new Float64Array(2), b: new Float64Array(2) },
      textCols: { c: { offsets: new Uint32Array(3), bytes: new Uint8Array(4) } },
      flashMask: new Uint8Array(1),
    };
    const xfer = collectViewportTransferables(chunk);
    // Expected: rowIds + rowKinds + groupDepth + 2 numeric + 2 text (offsets + bytes) + flashMask = 8
    expect(xfer).toHaveLength(8);
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
npm test --workspace=cgrid -- protocol.test
npm run typecheck --workspace=cgrid
```
Expected: 1 test PASS.

- [ ] **Step 4: Commit**

```bash
git add cgrid/src/worker/protocol.ts cgrid/tests/protocol.test.ts
git commit -m "feat(cgrid): worker protocol types + transferable collector"
```

---

### Task 7: Worker — RowStore + Transactions (`cgrid/src/worker/dataPipeline.ts` part 1)

**Files:**
- Create: `cgrid/src/worker/dataPipeline.ts` (RowStore + TransactionQueue sections only — Tasks 8/9/10/11 extend this same file)
- Test: `cgrid/tests/rowStore.test.ts`

**Interfaces:**
- Consumes: `WorkerColumn`, `WorkerInitPayload`, `Tx`, `TransactionResult` from Tasks 3 + 6.
- Produces:
  ```typescript
  class RowStore<TRow = any> {
    constructor(rowIdField: string);
    setAll(rows: TRow[]): void;
    apply(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): TransactionResult;
    size(): number;
    /** Iterate by current insertion order. */
    rows(): IterableIterator<TRow>;
    getById(rowId: string): TRow | undefined;
    getRowId(row: TRow): string;
    /** Numeric ID (stable per row across the session) for transfer-side packing. */
    getNumericId(rowId: string): number;
    /** Reverse lookup. */
    getStringId(numericId: number): string | undefined;
  }

  class TransactionQueue<TRow = any> {
    constructor(opts: { waitMs: number; onFlush: (txs: TransactionResult[]) => void });
    push(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): void;
    flush(): void;
  }
  ```

- [ ] **Step 1: Write failing test**

`cgrid/tests/rowStore.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RowStore, TransactionQueue } from '../src/worker/dataPipeline';

describe('RowStore', () => {
  it('stores rows by getRowId(row)[rowIdField]', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    expect(s.size()).toBe(2);
    expect(s.getById('a')).toEqual({ id: 'a', v: 1 });
  });

  it('applies add/update/remove with result counts', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a', v: 1 }]);
    const r = s.apply({ add: [{ id: 'b', v: 2 }], update: [{ id: 'a', v: 10 }], remove: ['x'] });
    expect(r.add).toEqual([{ rowId: 'b' }]);
    expect(r.update).toEqual([{ rowId: 'a' }]);
    expect(r.remove).toEqual([]);  // 'x' didn't exist
    expect(s.getById('a')).toEqual({ id: 'a', v: 10 });
  });

  it('numeric IDs are stable across a session', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'a' }, { id: 'b' }]);
    const a1 = s.getNumericId('a');
    s.apply({ add: [{ id: 'c' }] });
    const a2 = s.getNumericId('a');
    expect(a1).toBe(a2);
  });

  it('reverse-lookup string ID from numeric', () => {
    const s = new RowStore('id');
    s.setAll([{ id: 'foo' }]);
    const n = s.getNumericId('foo');
    expect(s.getStringId(n)).toBe('foo');
  });
});

describe('TransactionQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces pushes and flushes after waitMs', () => {
    const onFlush = vi.fn();
    const q = new TransactionQueue({ waitMs: 50, onFlush });
    q.push({ add: [{ rowId: 'x' }] as any });
    q.push({ update: [{ rowId: 'y' }] as any });
    vi.advanceTimersByTime(40);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('flush() drains immediately', () => {
    const onFlush = vi.fn();
    const q = new TransactionQueue({ waitMs: 50, onFlush });
    q.push({ add: [{ rowId: 'x' }] as any });
    q.flush();
    expect(onFlush).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Confirm red**

```bash
npm test --workspace=cgrid -- rowStore.test
```
Expected: FAIL.

- [ ] **Step 3: Implement RowStore + TransactionQueue**

`cgrid/src/worker/dataPipeline.ts`:
```typescript
import type { TransactionResult } from '../types';

/** Source-of-truth row storage in the worker. Keyed by rowIdField on each row. */
export class RowStore<TRow = any> {
  private byId = new Map<string, TRow>();
  private order: string[] = [];
  // Numeric ID assignment — monotonic per session.
  private nextNumeric = 1;
  private stringToNumeric = new Map<string, number>();
  private numericToString = new Map<number, string>();

  constructor(private rowIdField: string) {}

  setAll(rows: TRow[]): void {
    this.byId.clear();
    this.order.length = 0;
    for (const row of rows) {
      const id = this.getRowId(row);
      this.byId.set(id, row);
      this.order.push(id);
      if (!this.stringToNumeric.has(id)) {
        const n = this.nextNumeric++;
        this.stringToNumeric.set(id, n);
        this.numericToString.set(n, id);
      }
    }
  }

  apply(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): TransactionResult {
    const result: TransactionResult = { add: [], update: [], remove: [] };
    if (tx.add) {
      for (const row of tx.add) {
        const id = this.getRowId(row);
        if (!this.byId.has(id)) {
          this.byId.set(id, row);
          this.order.push(id);
          if (!this.stringToNumeric.has(id)) {
            const n = this.nextNumeric++;
            this.stringToNumeric.set(id, n);
            this.numericToString.set(n, id);
          }
          result.add.push({ rowId: id });
        }
      }
    }
    if (tx.update) {
      for (const row of tx.update) {
        const id = this.getRowId(row);
        if (this.byId.has(id)) {
          this.byId.set(id, row);
          result.update.push({ rowId: id });
        }
      }
    }
    if (tx.remove) {
      for (const id of tx.remove) {
        if (this.byId.delete(id)) {
          const i = this.order.indexOf(id);
          if (i !== -1) this.order.splice(i, 1);
          result.remove.push({ rowId: id });
        }
      }
    }
    return result;
  }

  size(): number { return this.byId.size; }

  *rows(): IterableIterator<TRow> {
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r) yield r;
    }
  }

  getById(rowId: string): TRow | undefined {
    return this.byId.get(rowId);
  }

  getRowId(row: TRow): string {
    const v = (row as Record<string, unknown>)[this.rowIdField];
    if (v == null) throw new Error(`[cgrid] row missing rowIdField '${this.rowIdField}'`);
    return String(v);
  }

  getNumericId(rowId: string): number {
    let n = this.stringToNumeric.get(rowId);
    if (n === undefined) {
      n = this.nextNumeric++;
      this.stringToNumeric.set(rowId, n);
      this.numericToString.set(n, rowId);
    }
    return n;
  }

  getStringId(numericId: number): string | undefined {
    return this.numericToString.get(numericId);
  }
}

interface QueueOpts {
  waitMs: number;
  onFlush: (results: TransactionResult[]) => void;
}

export class TransactionQueue<TRow = any> {
  private pending: { add?: TRow[]; update?: TRow[]; remove?: string[] }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushFn: () => void = () => {};

  constructor(private opts: QueueOpts) {}

  /** Caller (worker.ts) installs the actual flush function once RowStore exists. */
  setFlushFn(fn: (txs: { add?: TRow[]; update?: TRow[]; remove?: string[] }[]) => TransactionResult[]): void {
    this.flushFn = () => {
      const queued = this.pending;
      this.pending = [];
      this.timer = null;
      if (queued.length === 0) return;
      const results = fn(queued);
      this.opts.onFlush(results);
    };
  }

  push(tx: { add?: TRow[]; update?: TRow[]; remove?: string[] }): void {
    this.pending.push(tx);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flushFn(), this.opts.waitMs);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushFn();
  }
}
```

Note: the test only exercises `push → onFlush` and uses fake timers — `setFlushFn` is wired by `worker.ts` (Task 12). The test currently passes a `push({...})` whose contents the queue holds opaquely; on flush the wired `setFlushFn` returns a result. To make the test work without `setFlushFn`, set a default that returns the queued txs as a passthrough result.

Replace the default `flushFn` with:
```typescript
private flushFn: () => void = () => {
  const queued = this.pending;
  this.pending = [];
  this.timer = null;
  if (queued.length === 0) return;
  // Default: pretend each tx produced an empty result (real worker overrides).
  this.opts.onFlush(queued.map(() => ({ add: [], update: [], remove: [] })));
};
```

- [ ] **Step 4: Run (green)**

```bash
npm test --workspace=cgrid -- rowStore.test
npm run typecheck --workspace=cgrid
```
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cgrid/src/worker/dataPipeline.ts cgrid/tests/rowStore.test.ts
git commit -m "feat(cgrid): worker RowStore + TransactionQueue with async batching"
```

---

### Task 8: Worker — Filter pass (extends `dataPipeline.ts`)

**Files:**
- Modify: `cgrid/src/worker/dataPipeline.ts` (append `FilterPass`)
- Test: `cgrid/tests/filterPass.test.ts`

**Interfaces:**
- Consumes: `FilterModel`, `FilterModelEntry` from Task 3; `RowStore` from Task 7.
- Produces:
  ```typescript
  class FilterPass<TRow> {
    constructor(store: RowStore<TRow>, columns: WorkerColumn[]);
    setModel(model: FilterModel): void;
    /** Returns the row IDs (string) that pass the current filter, in store order. */
    apply(): string[];
  }
  ```

- [ ] **Step 1: Write failing test**

`cgrid/tests/filterPass.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name',  field: 'name',  type: 'text', filter: 'text' },
  { colId: 'price', field: 'price', type: 'number', filter: 'number' },
];

function makeStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', name: 'apple',  price: 10 },
    { id: '2', name: 'banana', price: 20 },
    { id: '3', name: 'cherry', price: 30 },
    { id: '4', name: 'apricot', price: 25 },
  ]);
  return s;
}

describe('FilterPass', () => {
  it('empty model returns all rows in order', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({});
    expect(p.apply()).toEqual(['1', '2', '3', '4']);
  });

  it('text contains', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'contains', value: 'ap' } });
    expect(p.apply()).toEqual(['1', '4']);
  });

  it('text equals (case-insensitive)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'equals', value: 'APPLE' } });
    expect(p.apply()).toEqual(['1']);
  });

  it('text startsWith', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'startsWith', value: 'ap' } });
    expect(p.apply()).toEqual(['1', '4']);
  });

  it('number gt', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { type: 'number', op: 'gt', value: 20 } });
    expect(p.apply()).toEqual(['3', '4']);
  });

  it('number between', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { type: 'number', op: 'between', value: 15, value2: 28 } });
    expect(p.apply()).toEqual(['2', '4']);
  });

  it('AND across multiple columns', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      name: { type: 'text', op: 'contains', value: 'ap' },
      price: { type: 'number', op: 'lt', value: 20 },
    });
    expect(p.apply()).toEqual(['1']);
  });
});
```

- [ ] **Step 2: Confirm red**

```bash
npm test --workspace=cgrid -- filterPass.test
```

- [ ] **Step 3: Implement FilterPass (append to dataPipeline.ts)**

```typescript
import type { FilterModel, FilterModelEntry } from '../types';
import type { WorkerColumn } from './protocol';

export class FilterPass<TRow = any> {
  private model: FilterModel = {};
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  setModel(model: FilterModel): void {
    this.model = model;
  }

  apply(): string[] {
    const entries = Object.entries(this.model);
    if (entries.length === 0) {
      return Array.from(this.store.rows()).map((r) => this.store.getRowId(r));
    }
    const out: string[] = [];
    for (const row of this.store.rows()) {
      let pass = true;
      for (const [colId, entry] of entries) {
        const col = this.colIndex.get(colId);
        if (!col || !col.field) continue;
        const value = (row as Record<string, unknown>)[col.field];
        if (!matches(entry, value)) { pass = false; break; }
      }
      if (pass) out.push(this.store.getRowId(row));
    }
    return out;
  }
}

function matches(entry: FilterModelEntry, raw: unknown): boolean {
  if (entry.type === 'text') {
    const s = String(raw ?? '').toLowerCase();
    const q = entry.value.toLowerCase();
    if (entry.op === 'contains')   return s.includes(q);
    if (entry.op === 'equals')     return s === q;
    if (entry.op === 'startsWith') return s.startsWith(q);
    return false;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) return false;
  if (entry.op === 'eq') return n === entry.value;
  if (entry.op === 'gt') return n >  entry.value;
  if (entry.op === 'lt') return n <  entry.value;
  if (entry.op === 'between') return n >= entry.value && n <= (entry.value2 ?? entry.value);
  return false;
}
```

- [ ] **Step 4: Run (green) + commit**

```bash
npm test --workspace=cgrid -- filterPass.test
git add cgrid/src/worker/dataPipeline.ts cgrid/tests/filterPass.test.ts
git commit -m "feat(cgrid): worker FilterPass (text/number ops, AND semantics)"
```

---

### Task 9: Worker — Sort pass (extends `dataPipeline.ts`)

**Files:**
- Modify: `cgrid/src/worker/dataPipeline.ts` (append `SortPass`)
- Test: `cgrid/tests/sortPass.test.ts`

**Interfaces:**
- Consumes: `SortModel` from Task 3; `RowStore` from Task 7; `WorkerColumn` from Task 6.
- Produces:
  ```typescript
  class SortPass<TRow> {
    constructor(store: RowStore<TRow>, columns: WorkerColumn[]);
    setModel(model: SortModel): void;
    /** Returns the input row IDs reordered per sort model. */
    apply(inputIds: string[]): string[];
  }
  ```

- [ ] **Step 1: Test**

`cgrid/tests/sortPass.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { SortPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', name: 'b', pri: 2 },
    { id: '2', name: 'a', pri: 2 },
    { id: '3', name: 'c', pri: 1 },
  ]);
  return s;
}

describe('SortPass', () => {
  it('asc text', () => {
    const p = new SortPass(store(), cols);
    p.setModel([{ colId: 'name', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '1', '3']);
  });

  it('desc number', () => {
    const p = new SortPass(store(), cols);
    p.setModel([{ colId: 'pri', direction: 'desc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('multi-sort: primary then secondary', () => {
    const p = new SortPass(store(), cols);
    p.setModel([
      { colId: 'pri',  direction: 'asc' },
      { colId: 'name', direction: 'asc' },
    ]);
    expect(p.apply(['1', '2', '3'])).toEqual(['3', '2', '1']);
  });

  it('empty model returns input unchanged', () => {
    const p = new SortPass(store(), cols);
    p.setModel([]);
    expect(p.apply(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 2: Implement (append)**

```typescript
import type { SortModel } from '../types';

export class SortPass<TRow = any> {
  private model: SortModel = [];
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  setModel(model: SortModel): void { this.model = model; }

  apply(inputIds: string[]): string[] {
    if (this.model.length === 0) return inputIds;
    const sorted = inputIds.slice();
    sorted.sort((aId, bId) => {
      const aRow = this.store.getById(aId);
      const bRow = this.store.getById(bId);
      if (!aRow || !bRow) return 0;
      for (const entry of this.model) {
        const col = this.colIndex.get(entry.colId);
        if (!col || !col.field) continue;
        const av = (aRow as Record<string, unknown>)[col.field];
        const bv = (bRow as Record<string, unknown>)[col.field];
        const cmp = compare(av, bv, col.type);
        if (cmp !== 0) return entry.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }
}

function compare(a: unknown, b: unknown, type: 'text' | 'number'): number {
  if (type === 'number') {
    const an = Number(a), bn = Number(b);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return  1;
    if (Number.isNaN(bn)) return -1;
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = String(a ?? '');
  const bs = String(b ?? '');
  return as < bs ? -1 : as > bs ? 1 : 0;
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- sortPass.test
git add cgrid/src/worker/dataPipeline.ts cgrid/tests/sortPass.test.ts
git commit -m "feat(cgrid): worker SortPass (multi-column asc/desc, text + number)"
```

---

### Task 10: Worker — Agg pass (extends `dataPipeline.ts`)

**Files:**
- Modify: `cgrid/src/worker/dataPipeline.ts` (append `AggPass`)
- Test: `cgrid/tests/aggPass.test.ts`

**Interfaces:**
- Consumes: `RowStore`, `WorkerColumn`.
- Produces:
  ```typescript
  class AggPass<TRow> {
    constructor(store: RowStore<TRow>, columns: WorkerColumn[]);
    /** Compute totals for the given row IDs. Foundation cycle: grand-total only (no grouping). */
    apply(inputIds: string[]): { totals: Record<string, number | null> };
  }
  ```
  In the Foundation cycle, this is grand-total-only. Grouping is deferred to a later cycle (per spec §2 out-of-scope), so `GroupAgg` reduces to `Agg` over the full filtered/sorted set.

- [ ] **Step 1: Test**

`cgrid/tests/aggPass.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AggPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'x', field: 'x', type: 'number', aggFunc: 'sum' },
  { colId: 'y', field: 'y', type: 'number', aggFunc: 'avg' },
  { colId: 'z', field: 'z', type: 'number', aggFunc: 'min' },
  { colId: 'q', field: 'q', type: 'number', aggFunc: 'max' },
  { colId: 'c', field: 'c', type: 'text',   aggFunc: 'count' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', x: 10, y: 2, z: 5, q: 7, c: 'a' },
    { id: '2', x: 20, y: 4, z: 1, q: 9, c: 'b' },
    { id: '3', x: 30, y: 6, z: 3, q: 8, c: 'c' },
  ]);
  return s;
}

describe('AggPass', () => {
  it('grand-total computes per aggFunc', () => {
    const p = new AggPass(store(), cols);
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.x).toBe(60);
    expect(totals.y).toBe(4);
    expect(totals.z).toBe(1);
    expect(totals.q).toBe(9);
    expect(totals.c).toBe(3);
  });

  it('empty input → null totals (avg/min/max) or 0 (sum/count)', () => {
    const p = new AggPass(store(), cols);
    const { totals } = p.apply([]);
    expect(totals.x).toBe(0);
    expect(totals.c).toBe(0);
    expect(totals.y).toBeNull();
  });
});
```

- [ ] **Step 2: Implement (append)**

```typescript
export class AggPass<TRow = any> {
  private aggCols: Array<{ colId: string; field: string; func: NonNullable<WorkerColumn['aggFunc']> }> = [];

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    for (const col of columns) {
      if (col.aggFunc && col.field) {
        this.aggCols.push({ colId: col.colId, field: col.field, func: col.aggFunc });
      }
    }
  }

  apply(inputIds: string[]): { totals: Record<string, number | null> } {
    const totals: Record<string, number | null> = {};
    for (const { colId, field, func } of this.aggCols) {
      let sum = 0, count = 0, min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
      for (const id of inputIds) {
        const row = this.store.getById(id);
        if (!row) continue;
        if (func === 'count') { count++; continue; }
        const v = Number((row as Record<string, unknown>)[field]);
        if (Number.isNaN(v)) continue;
        sum += v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (func === 'sum')   totals[colId] = sum;
      else if (func === 'count') totals[colId] = count;
      else if (count === 0) totals[colId] = null;
      else if (func === 'avg') totals[colId] = sum / count;
      else if (func === 'min') totals[colId] = min;
      else if (func === 'max') totals[colId] = max;
    }
    return { totals };
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- aggPass.test
git add cgrid/src/worker/dataPipeline.ts cgrid/tests/aggPass.test.ts
git commit -m "feat(cgrid): worker AggPass (sum/avg/min/max/count grand totals)"
```

---

### Task 11: Worker — Chunk format + ViewportSlicer

**Files:**
- Create: `cgrid/src/worker/chunkFormat.ts`
- Modify: `cgrid/src/worker/dataPipeline.ts` (append `ViewportSlicer`)
- Test: `cgrid/tests/chunkFormat.test.ts`
- Test: `cgrid/tests/viewportSlicer.test.ts`

**Interfaces:**
- Consumes: `ViewportRequest`, `ViewportChunk` (Task 6), `RowStore` (Task 7), `WorkerColumn` (Task 6).
- Produces:
  ```typescript
  // chunkFormat.ts
  function encodeText(strings: string[]): { offsets: Uint32Array; bytes: Uint8Array };
  function decodeText(offsets: Uint32Array, bytes: Uint8Array): string[];

  // dataPipeline.ts
  class ViewportSlicer<TRow> {
    constructor(store: RowStore<TRow>, columns: WorkerColumn[]);
    slice(visibleIds: string[], req: ViewportRequest): ViewportChunk;
  }
  ```

- [ ] **Step 1: Tests**

`cgrid/tests/chunkFormat.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { encodeText, decodeText } from '../src/worker/chunkFormat';

describe('chunkFormat', () => {
  it('round-trips ASCII', () => {
    const input = ['apple', 'banana', '', 'cherry'];
    const { offsets, bytes } = encodeText(input);
    expect(decodeText(offsets, bytes)).toEqual(input);
  });

  it('round-trips unicode', () => {
    const input = ['日本語', '🍎', 'ümläut'];
    const { offsets, bytes } = encodeText(input);
    expect(decodeText(offsets, bytes)).toEqual(input);
  });

  it('offsets has length n+1', () => {
    const { offsets } = encodeText(['a', 'b', 'c']);
    expect(offsets.length).toBe(4);
  });
});
```

`cgrid/tests/viewportSlicer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import { decodeText } from '../src/worker/chunkFormat';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: 'a', name: 'apple',  pri: 1.5 },
    { id: 'b', name: 'banana', pri: 2.5 },
    { id: 'c', name: 'cherry', pri: 3.5 },
  ]);
  return s;
}

describe('ViewportSlicer', () => {
  it('returns the requested row range as packed arrays', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] });
    expect(chunk.rowCount).toBe(2);
    expect(chunk.rowIds.length).toBe(2);
    // numeric ID for 'a' must round-trip
    expect(s.getStringId(chunk.rowIds[0]!)).toBe('a');
    expect(s.getStringId(chunk.rowIds[1]!)).toBe('b');
    expect(Array.from(chunk.numericCols.pri!)).toEqual([1.5, 2.5]);
    expect(decodeText(chunk.textCols.name!.offsets, chunk.textCols.name!.bytes)).toEqual(['apple', 'banana']);
  });

  it('handles end past visibleIds length', () => {
    const v = new ViewportSlicer(store(), cols);
    const chunk = v.slice(['a', 'b'], { rowStart: 1, rowEnd: 10, columns: ['name'] });
    expect(chunk.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Implement chunkFormat.ts**

```typescript
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeText(strings: string[]): { offsets: Uint32Array; bytes: Uint8Array } {
  const encoded = strings.map((s) => encoder.encode(s ?? ''));
  let total = 0;
  for (const e of encoded) total += e.byteLength;
  const offsets = new Uint32Array(strings.length + 1);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < encoded.length; i++) {
    offsets[i] = pos;
    bytes.set(encoded[i]!, pos);
    pos += encoded[i]!.byteLength;
  }
  offsets[strings.length] = pos;
  return { offsets, bytes };
}

export function decodeText(offsets: Uint32Array, bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < offsets.length - 1; i++) {
    const start = offsets[i]!;
    const end = offsets[i + 1]!;
    out.push(decoder.decode(bytes.subarray(start, end)));
  }
  return out;
}
```

- [ ] **Step 3: Implement ViewportSlicer (append to dataPipeline.ts)**

```typescript
import { encodeText } from './chunkFormat';
import type { ViewportChunk, ViewportRequest } from './protocol';

export class ViewportSlicer<TRow = any> {
  private colIndex = new Map<string, WorkerColumn>();

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  slice(visibleIds: string[], req: ViewportRequest): ViewportChunk {
    const rowStart = Math.max(0, req.rowStart);
    const rowEnd = Math.min(visibleIds.length, req.rowEnd);
    const count = Math.max(0, rowEnd - rowStart);

    const rowIds = new Uint32Array(count);
    const rowKinds = new Uint8Array(count);  // all leaf for Foundation
    const groupDepth = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      const id = visibleIds[rowStart + i]!;
      rowIds[i] = this.store.getNumericId(id);
    }

    const numericCols: Record<string, Float64Array> = {};
    const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};

    for (const colId of req.columns) {
      const col = this.colIndex.get(colId);
      if (!col || !col.field) continue;
      if (col.type === 'number') {
        const arr = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          const row = this.store.getById(visibleIds[rowStart + i]!);
          arr[i] = Number((row as Record<string, unknown> | undefined)?.[col.field!]);
        }
        numericCols[colId] = arr;
      } else {
        const values: string[] = new Array(count);
        for (let i = 0; i < count; i++) {
          const row = this.store.getById(visibleIds[rowStart + i]!);
          const v = (row as Record<string, unknown> | undefined)?.[col.field!];
          values[i] = v == null ? '' : String(v);
        }
        textCols[colId] = encodeText(values);
      }
    }

    return {
      rowStart, rowCount: count, rowIds, rowKinds, groupDepth,
      numericCols, textCols,
    };
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npm test --workspace=cgrid -- chunkFormat.test viewportSlicer.test
git add cgrid/src/worker/chunkFormat.ts cgrid/src/worker/dataPipeline.ts cgrid/tests/chunkFormat.test.ts cgrid/tests/viewportSlicer.test.ts
git commit -m "feat(cgrid): worker chunk format + ViewportSlicer (transferable typed arrays)"
```

---

### Task 12: Worker entry (`cgrid/src/worker/worker.ts`)

**Files:**
- Create: `cgrid/src/worker/worker.ts`
- Test: `cgrid/tests/workerEntry.test.ts` (uses a worker stub — runs in node without real Worker)

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `WorkerPush`, `collectViewportTransferables` (Task 6); `RowStore`, `FilterPass`, `SortPass`, `AggPass`, `ViewportSlicer`, `TransactionQueue` (Tasks 7–11).
- Produces: a worker entry point that wires every request type to the pipeline. Imported by the main side via `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.

- [ ] **Step 1: Sketch the test — direct invocation of the dispatcher**

`cgrid/tests/workerEntry.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';

describe('worker host', () => {
  it('init + setRowData + getViewport returns a viewport response', () => {
    const sent: any[] = [];
    const host = createWorkerHost((msg, _xfer) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'pri',  field: 'pri',  type: 'number' },
      ],
    }});
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [
      { id: 'a', name: 'apple',  pri: 1 },
      { id: 'b', name: 'banana', pri: 2 },
    ] } });
    host.handle({ id: 3, type: 'getViewport', payload: {
      rowStart: 0, rowEnd: 2, columns: ['name', 'pri'],
    }});
    const viewport = sent.find((m) => m.type === 'viewport');
    expect(viewport).toBeDefined();
    expect(viewport.id).toBe(3);
    expect(viewport.chunk.rowCount).toBe(2);
  });

  it('applyTransaction async triggers asyncTransactionsFlushed push', async () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    const host = createWorkerHost((msg) => sent.push(msg));
    host.handle({ id: 1, type: 'init', payload: {
      rowIdField: 'id',
      columns: [{ colId: 'name', field: 'name', type: 'text' }],
    } });
    host.handle({ id: 2, type: 'setRowData', payload: { rows: [{ id: 'a', name: 'x' }] } });
    host.handle({ id: 3, type: 'applyTransaction', payload: {
      update: [{ id: 'a', name: 'y' }],
      async: true,
    }});
    vi.advanceTimersByTime(60);
    const push = sent.find((m) => m.type === 'asyncTransactionsFlushed');
    expect(push).toBeDefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement worker host**

`cgrid/src/worker/worker.ts`:
```typescript
import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerColumn, WorkerInitPayload,
} from './protocol';
import { collectViewportTransferables } from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, ViewportSlicer, TransactionQueue,
} from './dataPipeline';
import type { TransactionResult } from '../types';

interface State {
  store: RowStore;
  filter: FilterPass;
  sort: SortPass;
  agg: AggPass;
  slicer: ViewportSlicer;
  queue: TransactionQueue;
  columns: WorkerColumn[];
  visibleCache: string[] | null;
}

type Postable = WorkerResponse | WorkerPush;
type PostFn = (msg: Postable, transfer?: ArrayBuffer[]) => void;

export interface WorkerHost {
  handle(req: WorkerRequest): void;
}

export function createWorkerHost(post: PostFn): WorkerHost {
  let state: State | null = null;

  function init(payload: WorkerInitPayload, id: number): void {
    const store = new RowStore(payload.rowIdField);
    const queue = new TransactionQueue({
      waitMs: 50,
      onFlush: (results) => post({ type: 'asyncTransactionsFlushed', results }),
    });
    queue.setFlushFn((txs) => {
      const all: TransactionResult[] = [];
      for (const tx of txs) all.push(store.apply(tx));
      state!.visibleCache = null;
      post({ type: 'modelUpdated', visibleCount: invalidateAndCount() });
      return all;
    });
    state = {
      store,
      filter: new FilterPass(store, payload.columns),
      sort:   new SortPass(store, payload.columns),
      agg:    new AggPass(store, payload.columns),
      slicer: new ViewportSlicer(store, payload.columns),
      queue,
      columns: payload.columns,
      visibleCache: null,
    };
    post({ id, type: 'ready' });
  }

  function invalidateAndCount(): number {
    if (!state) return 0;
    state.visibleCache = state.filter.apply();
    state.visibleCache = state.sort.apply(state.visibleCache);
    return state.visibleCache.length;
  }

  function visible(): string[] {
    if (!state) return [];
    if (!state.visibleCache) {
      state.visibleCache = state.filter.apply();
      state.visibleCache = state.sort.apply(state.visibleCache);
    }
    return state.visibleCache;
  }

  return {
    handle(req: WorkerRequest): void {
      try {
        if (req.type === 'init') return init(req.payload, req.id);
        if (!state) {
          post({ id: req.id, type: 'error', error: 'not initialized' });
          return;
        }
        switch (req.type) {
          case 'setRowData': {
            state.store.setAll(req.payload.rows);
            state.visibleCache = null;
            const visibleCount = invalidateAndCount();
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount });
            break;
          }
          case 'applyTransaction': {
            if (req.payload.async) {
              state.queue.push({ add: req.payload.add, update: req.payload.update, remove: req.payload.remove });
              post({ id: req.id, type: 'transactionFlushed', results: { add: [], update: [], remove: [] } });
            } else {
              const results = state.store.apply({ add: req.payload.add, update: req.payload.update, remove: req.payload.remove });
              state.visibleCache = null;
              post({ id: req.id, type: 'transactionFlushed', results });
              post({ type: 'modelUpdated', visibleCount: invalidateAndCount() });
            }
            break;
          }
          case 'setSortModel':   { state.sort.setModel(req.payload);   state.visibleCache = null; post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() }); break; }
          case 'setFilterModel': { state.filter.setModel(req.payload); state.visibleCache = null; post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() }); break; }
          case 'setGroupModel':  { /* Foundation: agg over grand total only — no grouping */ post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: visible().length }); break; }
          case 'getViewport': {
            const chunk = state.slicer.slice(visible(), req.payload);
            post({ id: req.id, type: 'viewport', chunk }, collectViewportTransferables(chunk));
            break;
          }
        }
      } catch (err) {
        post({ id: (req as { id: number }).id, type: 'error', error: String((err as Error).message ?? err) });
      }
    },
  };
}

// In the actual Worker context, wire onmessage to the host.
declare const self: { onmessage?: ((e: MessageEvent<WorkerRequest>) => void); postMessage(msg: any, transfer?: any[]): void };

if (typeof self !== 'undefined' && 'postMessage' in self) {
  const host = createWorkerHost((msg, xfer) => {
    if (xfer && xfer.length) self.postMessage(msg, xfer);
    else                      self.postMessage(msg);
  });
  self.onmessage = (e) => host.handle(e.data);
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- workerEntry.test
git add cgrid/src/worker/worker.ts cgrid/tests/workerEntry.test.ts
git commit -m "feat(cgrid): worker entry host wiring init/data/sort/filter/viewport"
```

---

### Task 13: Main-side worker client (`cgrid/src/worker/client.ts`)

**Files:**
- Create: `cgrid/src/worker/client.ts`
- Test: `cgrid/tests/workerClient.test.ts`

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `WorkerPush` (Task 6).
- Produces:
  ```typescript
  interface WorkerClientHandlers {
    onModelUpdated: (visibleCount: number) => void;
    onAsyncTransactionsFlushed: (results: TransactionResult[]) => void;
    onError: (error: string) => void;
  }
  class WorkerClient {
    constructor(worker: WorkerLike, handlers: WorkerClientHandlers);
    init(payload: WorkerInitPayload): Promise<void>;
    setRowData(rows: unknown[]): Promise<{ count: number; visibleCount: number }>;
    applyTransaction(payload: { add?; update?; remove?; async: boolean }): Promise<TransactionResult>;
    setSortModel(s: SortModel): Promise<{ visibleCount: number }>;
    setFilterModel(f: FilterModel): Promise<{ visibleCount: number }>;
    getViewport(req: ViewportRequest): Promise<ViewportChunk>;
    destroy(): void;
  }
  interface WorkerLike {
    postMessage(msg: any, transfer?: ArrayBuffer[]): void;
    addEventListener(type: 'message', cb: (e: { data: any }) => void): void;
    terminate(): void;
  }
  ```

- [ ] **Step 1: Test (using a fake worker that bridges to the in-process host)**

`cgrid/tests/workerClient.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { WorkerClient } from '../src/worker/client';
import { createWorkerHost } from '../src/worker/worker';

class FakeWorker {
  private listeners: Array<(e: { data: any }) => void> = [];
  host = createWorkerHost((msg) => {
    queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
  });
  postMessage(msg: any) { this.host.handle(msg); }
  addEventListener(_t: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
  terminate() {}
}

describe('WorkerClient', () => {
  it('init -> setRowData -> getViewport round trip', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w as any, {
      onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
    });
    await client.init({
      rowIdField: 'id',
      columns: [
        { colId: 'name', field: 'name', type: 'text' },
        { colId: 'pri',  field: 'pri',  type: 'number' },
      ],
    });
    const rc = await client.setRowData([{ id: 'a', name: 'apple', pri: 1 }]);
    expect(rc.visibleCount).toBe(1);
    const chunk = await client.getViewport({ rowStart: 0, rowEnd: 1, columns: ['name'] });
    expect(chunk.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/worker/client.ts`:
```typescript
import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, ViewportRequest, ViewportChunk,
} from './protocol';
import type { TransactionResult, SortModel, FilterModel } from '../types';

export interface WorkerClientHandlers {
  onModelUpdated: (visibleCount: number) => void;
  onAsyncTransactionsFlushed: (results: TransactionResult[]) => void;
  onError: (error: string) => void;
}

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
  terminate(): void;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

export class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private worker: WorkerLike, private handlers: WorkerClientHandlers) {
    worker.addEventListener('message', (e) => this.onMessage(e.data as WorkerResponse | WorkerPush));
  }

  private onMessage(msg: WorkerResponse | WorkerPush): void {
    if ('id' in msg) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') pending.reject(new Error(msg.error));
      else                       pending.resolve(msg);
      return;
    }
    if (msg.type === 'modelUpdated') this.handlers.onModelUpdated(msg.visibleCount);
    else if (msg.type === 'asyncTransactionsFlushed') this.handlers.onAsyncTransactionsFlushed(msg.results);
  }

  private send<T>(req: Omit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  init(payload: WorkerInitPayload): Promise<void> {
    return this.send<{ type: 'ready' }>({ type: 'init', payload }).then(() => {});
  }
  setRowData(rows: unknown[]): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({ type: 'setRowData', payload: { rows } });
  }
  applyTransaction(payload: { add?: unknown[]; update?: unknown[]; remove?: string[]; async: boolean }): Promise<TransactionResult> {
    return this.send<{ results: TransactionResult }>({ type: 'applyTransaction', payload })
      .then((r) => r.results);
  }
  setSortModel(s: SortModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setSortModel', payload: s });
  }
  setFilterModel(f: FilterModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setFilterModel', payload: f });
  }
  getViewport(req: ViewportRequest): Promise<ViewportChunk> {
    return this.send<{ chunk: ViewportChunk }>({ type: 'getViewport', payload: req }).then((r) => r.chunk);
  }
  destroy(): void {
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('worker terminated')));
    this.pending.clear();
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- workerClient.test
git add cgrid/src/worker/client.ts cgrid/tests/workerClient.test.ts
git commit -m "feat(cgrid): main-side WorkerClient (typed RPC + push event routing)"
```

---

### Task 14: Theme tokens + CssReader (`cgrid/src/theming/`)

**Files:**
- Create: `cgrid/src/theming/tokens.css`
- Create: `cgrid/src/theming/cssReader.ts`
- Test: `cgrid/tests/cssReader.test.ts`

**Interfaces:**
- Consumes: nothing (entry point for theme tokens).
- Produces:
  ```typescript
  interface ResolvedTheme {
    font: string; fg: string; bg: string;
    headerBg: string; headerFg: string;
    borderColor: string; gridLineColor: string;
    rowAltBg: string; rowHoverBg: string; rowSelectedBg: string;
    focusRingColor: string; focusRingWidth: number;
    flashFromColor: string; flashToColor: string;
    rowHeight: number; headerHeight: number;
    resizerHotZone: number;
  }
  class CssReader {
    constructor(container: HTMLElement);
    read(): ResolvedTheme;
  }
  ```
  Used by Tasks 18, 19.

- [ ] **Step 1: Write `cgrid/src/theming/tokens.css`**

```css
.vg-theme-quartz {
  --vg-font-family: Inter, system-ui, -apple-system, sans-serif;
  --vg-font-size: 13px;
  --vg-row-height: 30px;
  --vg-header-height: 32px;
  --vg-fg-color: #1a1f24;
  --vg-bg-color: #ffffff;
  --vg-row-alt-bg: #f4f6f8;
  --vg-header-bg: #e8ecef;
  --vg-header-fg: #1a1f24;
  --vg-border-color: #d5dbe0;
  --vg-grid-line-color: #e8ecef;
  --vg-row-hover-bg: #eef1f3;
  --vg-row-selected-bg: rgb(13 148 136 / 12%);
  --vg-focus-ring-color: #0d9488;
  --vg-focus-ring-width: 2px;
  --vg-flash-from-color: #fef3c7;
  --vg-flash-to-color: rgba(254, 243, 199, 0);
  --vg-resizer-hot-zone: 4px;
  --vg-scrollbar-thickness: 8px;
}
.vg-theme-quartz-dark {
  --vg-font-family: Inter, system-ui, -apple-system, sans-serif;
  --vg-font-size: 13px;
  --vg-row-height: 30px;
  --vg-header-height: 32px;
  --vg-fg-color: #e2e8f0;
  --vg-bg-color: #0f172a;
  --vg-row-alt-bg: #111c2f;
  --vg-header-bg: #1e293b;
  --vg-header-fg: #e2e8f0;
  --vg-border-color: #334155;
  --vg-grid-line-color: #1e293b;
  --vg-row-hover-bg: #1a2540;
  --vg-row-selected-bg: rgb(13 148 136 / 22%);
  --vg-focus-ring-color: #2dd4bf;
  --vg-focus-ring-width: 2px;
  --vg-flash-from-color: #b45309;
  --vg-flash-to-color: rgba(180, 83, 9, 0);
  --vg-resizer-hot-zone: 4px;
  --vg-scrollbar-thickness: 8px;
}
```

- [ ] **Step 2: Write the test**

`cgrid/tests/cssReader.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `
      --vg-font-family: Inter;
      --vg-font-size: 14px;
      --vg-row-height: 32px;
      --vg-header-height: 36px;
      --vg-fg-color: #111;
      --vg-bg-color: #fff;
      --vg-row-alt-bg: #fafafa;
      --vg-header-bg: #eee;
      --vg-header-fg: #111;
      --vg-border-color: #ccc;
      --vg-grid-line-color: #eee;
      --vg-row-hover-bg: #f5f5f5;
      --vg-row-selected-bg: rgba(0,0,0,0.1);
      --vg-focus-ring-color: #08f;
      --vg-focus-ring-width: 2px;
      --vg-flash-from-color: yellow;
      --vg-flash-to-color: transparent;
      --vg-resizer-hot-zone: 4px;
    `;
    document.body.appendChild(container);
  });

  it('reads tokens into a ResolvedTheme', () => {
    const r = new CssReader(container).read();
    expect(r.fg).toBe('#111');
    expect(r.bg).toBe('#fff');
    expect(r.rowHeight).toBe(32);
    expect(r.headerHeight).toBe(36);
    expect(r.font).toContain('14px');
    expect(r.font).toContain('Inter');
    expect(r.focusRingWidth).toBe(2);
    expect(r.resizerHotZone).toBe(4);
  });
});
```

- [ ] **Step 3: Implement**

`cgrid/src/theming/cssReader.ts`:
```typescript
export interface ResolvedTheme {
  font: string;
  fg: string;
  bg: string;
  headerBg: string;
  headerFg: string;
  borderColor: string;
  gridLineColor: string;
  rowAltBg: string;
  rowHoverBg: string;
  rowSelectedBg: string;
  focusRingColor: string;
  focusRingWidth: number;
  flashFromColor: string;
  flashToColor: string;
  rowHeight: number;
  headerHeight: number;
  resizerHotZone: number;
}

export class CssReader {
  constructor(private container: HTMLElement) {}

  read(): ResolvedTheme {
    const cs = getComputedStyle(this.container);
    const get = (name: string) => cs.getPropertyValue(name).trim();
    const px  = (name: string, fallback: number) => {
      const v = parseFloat(get(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const fontSize = get('--vg-font-size') || '13px';
    const fontFamily = get('--vg-font-family') || 'system-ui';
    return {
      font: `${fontSize} ${fontFamily}`,
      fg:           get('--vg-fg-color')         || '#1a1f24',
      bg:           get('--vg-bg-color')         || '#ffffff',
      headerBg:     get('--vg-header-bg')        || '#e8ecef',
      headerFg:     get('--vg-header-fg')        || '#1a1f24',
      borderColor:  get('--vg-border-color')     || '#d5dbe0',
      gridLineColor:get('--vg-grid-line-color') || '#e8ecef',
      rowAltBg:     get('--vg-row-alt-bg')       || '#f4f6f8',
      rowHoverBg:   get('--vg-row-hover-bg')     || '#eef1f3',
      rowSelectedBg:get('--vg-row-selected-bg') || 'rgba(13,148,136,0.12)',
      focusRingColor: get('--vg-focus-ring-color') || '#0d9488',
      focusRingWidth: px('--vg-focus-ring-width', 2),
      flashFromColor: get('--vg-flash-from-color') || '#fef3c7',
      flashToColor:   get('--vg-flash-to-color')   || 'rgba(254,243,199,0)',
      rowHeight:    px('--vg-row-height', 30),
      headerHeight: px('--vg-header-height', 32),
      resizerHotZone: px('--vg-resizer-hot-zone', 4),
    };
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npm test --workspace=cgrid -- cssReader.test
git add cgrid/src/theming/ cgrid/tests/cssReader.test.ts
git commit -m "feat(cgrid): CSS-token theme reader + Quartz light/dark token sets"
```

---

### Task 15: Layout, viewport math, HitTester (`cgrid/src/core/layout.ts`, `viewport.ts`, `interaction/hitTester.ts`)

**Files:**
- Create: `cgrid/src/core/layout.ts`
- Create: `cgrid/src/core/viewport.ts`
- Create: `cgrid/src/interaction/hitTester.ts`
- Test: `cgrid/tests/layout.test.ts`
- Test: `cgrid/tests/viewport.test.ts`
- Test: `cgrid/tests/hitTester.test.ts`

**Interfaces:**
- Consumes: `ResolvedColDef` (Task 5); `ResolvedTheme` (Task 14).
- Produces:
  ```typescript
  // layout.ts
  interface ColumnLayout { colId: string; left: number; width: number; pinned?: 'left'|'right' }
  function resolveColumnWidths(cols: ResolvedColDef[], containerWidth: number): ColumnLayout[];

  // viewport.ts
  interface ViewportState {
    visibleColumns: { colId: string; index: number; left: number; right: number; width: number; pinned?: 'left'|'right' }[];
    visibleRows: { rowIndex: number; top: number; bottom: number; height: number }[];
    firstRow: number; lastRow: number;
    scrollLeft: number; scrollTop: number;
    bodyLeft: number; bodyRight: number;       // pixel x range of scrollable region
    bodyTop: number; bodyBottom: number;
    bodyWidth: number; bodyHeight: number;
  }
  function computeViewport(opts: {
    columnLayout: ColumnLayout[]; rowCount: number; rowHeight: number;
    headerHeight: number; containerWidth: number; containerHeight: number;
    scrollLeft: number; scrollTop: number; overscanRows?: number;
  }): ViewportState;

  // hitTester.ts
  type Hit =
    | { kind: 'header'; colId: string }
    | { kind: 'headerResizer'; colId: string }
    | { kind: 'cell'; rowIndex: number; colId: string }
    | { kind: 'pinnedSplitter'; side: 'left' | 'right' }
    | { kind: 'scrollbar'; axis: 'x' | 'y' }
    | { kind: 'empty' };
  class HitTester {
    constructor(viewport: () => ViewportState, headerHeight: () => number, resizerHotZone: () => number);
    locate(x: number, y: number): Hit;
  }
  ```

- [ ] **Step 1: Tests**

`cgrid/tests/layout.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { resolveColumnWidths } from '../src/core/layout';

const r = (over: any = {}) => ({
  colId: 'c', headerName: '', minWidth: 30, maxWidth: Infinity,
  type: 'text' as const, cellRenderer: 'text',
  sortable: true, resizable: true, editable: false, ...over,
});

describe('resolveColumnWidths', () => {
  it('fixed widths sum and place left-to-right', () => {
    const out = resolveColumnWidths([r({ colId: 'a', width: 100 }), r({ colId: 'b', width: 200 })], 1000);
    expect(out).toEqual([
      { colId: 'a', left: 0,   width: 100 },
      { colId: 'b', left: 100, width: 200 },
    ]);
  });

  it('flex distributes remaining width proportionally', () => {
    const out = resolveColumnWidths(
      [r({ colId: 'a', width: 100 }), r({ colId: 'b', flex: 1 }), r({ colId: 'c', flex: 2 })],
      700,
    );
    expect(out[0]!.width).toBe(100);
    expect(out[1]!.width).toBe(200);
    expect(out[2]!.width).toBe(400);
  });

  it('respects minWidth on flex columns', () => {
    const out = resolveColumnWidths([r({ colId: 'a', flex: 1, minWidth: 300 })], 100);
    expect(out[0]!.width).toBe(300);
  });

  it('pinned: left' satisfies string, () => {
    const out = resolveColumnWidths(
      [r({ colId: 'p', width: 50, pinned: 'left' }), r({ colId: 'b', width: 100 })],
      500,
    );
    expect(out[0]).toEqual({ colId: 'p', left: 0, width: 50, pinned: 'left' });
    expect(out[1]).toEqual({ colId: 'b', left: 50, width: 100 });
  });
});
```

`cgrid/tests/viewport.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeViewport } from '../src/core/viewport';

describe('computeViewport', () => {
  it('selects visible rows given scrollTop + container height', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      rowCount: 1000, rowHeight: 30,
      headerHeight: 32, containerWidth: 100, containerHeight: 332,
      scrollLeft: 0, scrollTop: 90,
      overscanRows: 0,
    });
    expect(vs.firstRow).toBe(3);
    expect(vs.lastRow).toBe(13);
  });

  it('applies overscan above and below', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      rowCount: 1000, rowHeight: 30,
      headerHeight: 0, containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      overscanRows: 2,
    });
    expect(vs.firstRow).toBe(8);
    expect(vs.lastRow).toBe(22);
  });
});
```

`cgrid/tests/hitTester.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { HitTester } from '../src/interaction/hitTester';
import type { ViewportState } from '../src/core/viewport';

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 332,
  bodyWidth: 250, bodyHeight: 300,
};

describe('HitTester', () => {
  it('header click', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    expect(ht.locate(50, 16).kind).toBe('header');
  });

  it('header resizer hot zone on right edge', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    const h = ht.locate(99, 16);
    expect(h.kind).toBe('headerResizer');
  });

  it('cell hit', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    const h = ht.locate(120, 75) as any;
    expect(h.kind).toBe('cell');
    expect(h.colId).toBe('b');
    expect(h.rowIndex).toBe(1);
  });

  it('empty region returns empty', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    expect(ht.locate(500, 500).kind).toBe('empty');
  });
});
```

- [ ] **Step 2: Implement `cgrid/src/core/layout.ts`**

```typescript
import type { ResolvedColDef } from './propertyChain';

export interface ColumnLayout {
  colId: string;
  left: number;
  width: number;
  pinned?: 'left' | 'right';
}

export function resolveColumnWidths<TRow>(cols: ResolvedColDef<TRow>[], containerWidth: number): ColumnLayout[] {
  // Pass 1: assign fixed widths.
  const widths = cols.map((c) => {
    if (c.width != null) return clamp(c.width, c.minWidth, c.maxWidth);
    if (c.flex == null) return clamp(100, c.minWidth, c.maxWidth);  // default 100
    return -1;  // marker for flex
  });

  const fixedTotal = widths.reduce((s, w) => s + (w >= 0 ? w : 0), 0);
  const remaining = Math.max(0, containerWidth - fixedTotal);
  const flexSum = cols.reduce((s, c, i) => s + (widths[i] === -1 ? (c.flex ?? 0) : 0), 0);

  // Pass 2: distribute remaining over flex columns; min/max clamp may force re-distribution.
  let leftover = remaining;
  let flexLeft = flexSum;
  for (let i = 0; i < cols.length; i++) {
    if (widths[i] !== -1) continue;
    const col = cols[i]!;
    const share = flexLeft > 0 ? Math.floor((leftover * (col.flex ?? 0)) / flexLeft) : 0;
    const w = clamp(share, col.minWidth, col.maxWidth);
    widths[i] = w;
    leftover -= w;
    flexLeft -= (col.flex ?? 0);
  }

  // Pass 3: place by pinned regions (left → body → right).
  const out: ColumnLayout[] = [];
  let left = 0;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned !== 'left') continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w, pinned: 'left' });
    left += w;
  }
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned) continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w });
    left += w;
  }
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.pinned !== 'right') continue;
    const w = widths[i]!;
    out.push({ colId: col.colId, left, width: w, pinned: 'right' });
    left += w;
  }
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
```

- [ ] **Step 3: Implement `cgrid/src/core/viewport.ts`**

```typescript
import type { ColumnLayout } from './layout';

export interface ViewportColumn {
  colId: string; index: number; left: number; right: number; width: number; pinned?: 'left' | 'right';
}
export interface ViewportRow {
  rowIndex: number; top: number; bottom: number; height: number;
}

export interface ViewportState {
  visibleColumns: ViewportColumn[];
  visibleRows: ViewportRow[];
  firstRow: number;
  lastRow: number;
  scrollLeft: number;
  scrollTop: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  bodyWidth: number;
  bodyHeight: number;
}

export interface ViewportInput {
  columnLayout: ColumnLayout[];
  rowCount: number;
  rowHeight: number;
  headerHeight: number;
  containerWidth: number;
  containerHeight: number;
  scrollLeft: number;
  scrollTop: number;
  overscanRows?: number;
}

export function computeViewport(opts: ViewportInput): ViewportState {
  const overscan = opts.overscanRows ?? 3;
  const bodyTop = opts.headerHeight;
  const bodyBottom = opts.containerHeight;
  const bodyHeight = bodyBottom - bodyTop;
  const firstRowRaw = Math.floor(opts.scrollTop / opts.rowHeight);
  const lastRowRaw  = Math.floor((opts.scrollTop + bodyHeight) / opts.rowHeight);
  const firstRow = Math.max(0, firstRowRaw - overscan);
  const lastRow  = Math.min(opts.rowCount - 1, lastRowRaw + overscan);

  const visibleRows: ViewportRow[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const top = bodyTop + (r * opts.rowHeight) - opts.scrollTop;
    visibleRows.push({ rowIndex: r, top, bottom: top + opts.rowHeight, height: opts.rowHeight });
  }

  // Pinned-left columns: always visible at their layout x. Body columns: scrolled by scrollLeft.
  const visibleColumns: ViewportColumn[] = [];
  const leftPinned = opts.columnLayout.filter((c) => c.pinned === 'left');
  const center     = opts.columnLayout.filter((c) => !c.pinned);
  const rightPinned= opts.columnLayout.filter((c) => c.pinned === 'right');
  const pinnedLeftWidth  = leftPinned.reduce((s, c) => s + c.width, 0);
  const pinnedRightWidth = rightPinned.reduce((s, c) => s + c.width, 0);
  const bodyLeft  = pinnedLeftWidth;
  const bodyRight = opts.containerWidth - pinnedRightWidth;
  const bodyWidth = bodyRight - bodyLeft;

  let idx = 0;
  for (const c of leftPinned) {
    visibleColumns.push({ colId: c.colId, index: idx++, left: c.left, right: c.left + c.width, width: c.width, pinned: 'left' });
  }
  const centerStart = bodyLeft;
  for (const c of center) {
    const cellLeft = centerStart + (c.left - pinnedLeftWidth) - opts.scrollLeft;
    const cellRight = cellLeft + c.width;
    if (cellRight < bodyLeft || cellLeft > bodyRight) continue;  // clip
    visibleColumns.push({ colId: c.colId, index: idx++, left: cellLeft, right: cellRight, width: c.width });
  }
  for (const c of rightPinned) {
    const fromRight = c.left - (pinnedLeftWidth + center.reduce((s, x) => s + x.width, 0));
    const cellLeft = bodyRight + fromRight;
    visibleColumns.push({ colId: c.colId, index: idx++, left: cellLeft, right: cellLeft + c.width, width: c.width, pinned: 'right' });
  }

  return {
    visibleColumns, visibleRows,
    firstRow, lastRow,
    scrollLeft: opts.scrollLeft, scrollTop: opts.scrollTop,
    bodyLeft, bodyRight, bodyTop, bodyBottom, bodyWidth, bodyHeight,
  };
}
```

- [ ] **Step 4: Implement HitTester**

`cgrid/src/interaction/hitTester.ts`:
```typescript
import type { ViewportState } from '../core/viewport';

export type Hit =
  | { kind: 'header'; colId: string }
  | { kind: 'headerResizer'; colId: string }
  | { kind: 'cell'; rowIndex: number; colId: string }
  | { kind: 'pinnedSplitter'; side: 'left' | 'right' }
  | { kind: 'scrollbar'; axis: 'x' | 'y' }
  | { kind: 'empty' };

export class HitTester {
  constructor(
    private getViewport: () => ViewportState,
    private getHeaderHeight: () => number,
    private getResizerHotZone: () => number,
  ) {}

  locate(x: number, y: number): Hit {
    const vs = this.getViewport();
    const headerH = this.getHeaderHeight();
    const hot = this.getResizerHotZone();

    if (y < headerH) {
      const col = this.findCol(vs, x);
      if (!col) return { kind: 'empty' };
      if (x >= col.right - hot) return { kind: 'headerResizer', colId: col.colId };
      return { kind: 'header', colId: col.colId };
    }

    if (y >= vs.bodyTop && y <= vs.bodyBottom) {
      const col = this.findCol(vs, x);
      const row = this.findRow(vs, y);
      if (col && row) return { kind: 'cell', rowIndex: row.rowIndex, colId: col.colId };
    }
    return { kind: 'empty' };
  }

  private findCol(vs: ViewportState, x: number) {
    let lo = 0, hi = vs.visibleColumns.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = vs.visibleColumns[mid]!;
      if (x < c.left) hi = mid - 1;
      else if (x >= c.right) lo = mid + 1;
      else return c;
    }
    return null;
  }

  private findRow(vs: ViewportState, y: number) {
    let lo = 0, hi = vs.visibleRows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = vs.visibleRows[mid]!;
      if (y < r.top) hi = mid - 1;
      else if (y >= r.bottom) lo = mid + 1;
      else return r;
    }
    return null;
  }
}
```

- [ ] **Step 5: Verify + commit**

```bash
npm test --workspace=cgrid -- layout.test viewport.test hitTester.test
git add cgrid/src/core/layout.ts cgrid/src/core/viewport.ts cgrid/src/interaction/hitTester.ts cgrid/tests/layout.test.ts cgrid/tests/viewport.test.ts cgrid/tests/hitTester.test.ts
git commit -m "feat(cgrid): column layout + viewport math + binary-search HitTester"
```

---

### Task 16: Paint loop + dirty regions (`cgrid/src/core/paintLoop.ts`)

**Files:**
- Create: `cgrid/src/core/paintLoop.ts`
- Test: `cgrid/tests/paintLoop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```typescript
  interface DirtyRect { x: number; y: number; w: number; h: number }
  class PaintLoop {
    constructor(paint: (rects: DirtyRect[]) => void);
    markDirty(rect: DirtyRect): void;
    markFullDirty(): void;
    start(): void;
    stop(): void;
  }
  ```

- [ ] **Step 1: Test**

`cgrid/tests/paintLoop.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PaintLoop } from '../src/core/paintLoop';

const realRAF = globalThis.requestAnimationFrame;
const realCAF = globalThis.cancelAnimationFrame;

function mockRAF() {
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    callbacks.push(cb); return callbacks.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((_id: number) => {}) as typeof cancelAnimationFrame;
  return { tick: () => { const queued = callbacks.splice(0); queued.forEach((c) => c(performance.now())); } };
}

afterEach(() => { globalThis.requestAnimationFrame = realRAF; globalThis.cancelAnimationFrame = realCAF; });

describe('PaintLoop', () => {
  it('paints once per rAF after a markDirty', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 10, h: 10 });
    raf.tick();
    expect(paint).toHaveBeenCalledOnce();
    expect(paint.mock.calls[0]![0]).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });

  it('no-op when no dirty rects accumulated', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    raf.tick();
    expect(paint).not.toHaveBeenCalled();
  });

  it('coalesces multiple markDirty calls into one paint per frame', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 10, h: 10 });
    loop.markDirty({ x: 50, y: 0, w: 10, h: 10 });
    raf.tick();
    expect(paint).toHaveBeenCalledOnce();
    expect(paint.mock.calls[0]![0]).toHaveLength(2);
  });

  it('markFullDirty replaces accumulated rects with a sentinel', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 5, h: 5 });
    loop.markFullDirty();
    raf.tick();
    expect(paint.mock.calls[0]![0]).toEqual([{ x: -Infinity, y: -Infinity, w: Infinity, h: Infinity }]);
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/core/paintLoop.ts`:
```typescript
export interface DirtyRect { x: number; y: number; w: number; h: number }

const FULL: DirtyRect = { x: -Infinity, y: -Infinity, w: Infinity, h: Infinity };

export class PaintLoop {
  private rects: DirtyRect[] = [];
  private fullPending = false;
  private rafId = 0;
  private running = false;

  constructor(private paint: (rects: DirtyRect[]) => void) {}

  markDirty(r: DirtyRect): void {
    if (this.fullPending) return;
    this.rects.push(r);
  }

  markFullDirty(): void {
    this.fullPending = true;
    this.rects.length = 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (this.fullPending) {
      this.paint([FULL]);
      this.fullPending = false;
    } else if (this.rects.length > 0) {
      this.paint(this.rects.slice());
      this.rects.length = 0;
    }
    this.scheduleNext();
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- paintLoop.test
git add cgrid/src/core/paintLoop.ts cgrid/tests/paintLoop.test.ts
git commit -m "feat(cgrid): rAF paint loop with dirty-rect accumulation + full-dirty sentinel"
```

---

### Task 17: Cell renderers (`cgrid/src/renderer/cellRenderers/`)

**Files:**
- Create: `cgrid/src/renderer/cellRenderers/registry.ts`
- Create: `cgrid/src/renderer/cellRenderers/textCell.ts`
- Create: `cgrid/src/renderer/cellRenderers/numberCell.ts`
- Create: `cgrid/src/renderer/cellRenderers/checkboxCell.ts`
- Test: `cgrid/tests/cellRenderers.test.ts`

**Interfaces:**
- Consumes: `ResolvedTheme` (Task 14).
- Produces:
  ```typescript
  interface CellPaintParams<T = unknown> {
    value: T; valueFormatted: string;
    bounds: { x: number; y: number; w: number; h: number };
    style: { font: string; fg: string; bg: string; borderColor: string; halign: 'left'|'right'|'center' };
    flashAlpha?: number; isFocused: boolean; isSelected: boolean; isHovered: boolean;
  }
  interface CellPainter<T = unknown> {
    paint(ctx: CanvasRenderingContext2D, params: CellPaintParams<T>): void;
  }
  class CellRendererRegistry {
    register(name: string, painter: CellPainter): void;
    get(name: string): CellPainter;       // throws if unknown
  }
  const textCell: CellPainter<string>;
  const numberCell: CellPainter<number>;
  const checkboxCell: CellPainter<boolean>;
  ```

- [ ] **Step 1: Test using `happy-dom`'s OffscreenCanvas + spying on context calls**

`cgrid/tests/cellRenderers.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { textCell, numberCell, checkboxCell, CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { CellPaintParams } from '../src/renderer/cellRenderers/registry';

function makeCtx() {
  return {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(), measureText: vi.fn(() => ({ width: 50 })),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    globalAlpha: 1, lineWidth: 1,
  } as any;
}

const baseParams = (over: Partial<CellPaintParams> = {}): CellPaintParams => ({
  value: '', valueFormatted: '',
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  style: { font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc', halign: 'left' },
  isFocused: false, isSelected: false, isHovered: false,
  ...over,
});

describe('textCell', () => {
  it('paints background + text', () => {
    const ctx = makeCtx();
    textCell.paint(ctx, baseParams({ value: 'hi', valueFormatted: 'hi' }));
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('hi', expect.any(Number), expect.any(Number));
  });

  it('halign right adjusts text x to right side', () => {
    const ctx = makeCtx();
    textCell.paint(ctx, baseParams({ value: 'x', valueFormatted: 'x', style: { ...baseParams().style, halign: 'right' } }));
    const [, x] = ctx.fillText.mock.calls[0]!;
    expect(x).toBeGreaterThan(50);
  });
});

describe('numberCell', () => {
  it('right-aligns by default', () => {
    const ctx = makeCtx();
    numberCell.paint(ctx, baseParams({ value: 42, valueFormatted: '42' }));
    expect(ctx.textAlign).toBe('right');
  });
});

describe('checkboxCell', () => {
  it('paints a checkmark when value is true', () => {
    const ctx = makeCtx();
    checkboxCell.paint(ctx, baseParams({ value: true, valueFormatted: '' }));
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });
});

describe('CellRendererRegistry', () => {
  it('register + get', () => {
    const reg = new CellRendererRegistry();
    reg.register('text', textCell);
    expect(reg.get('text')).toBe(textCell);
  });
  it('throws on unknown name', () => {
    expect(() => new CellRendererRegistry().get('missing')).toThrow(/missing/);
  });
});
```

- [ ] **Step 2: Implement registry + painters**

`cgrid/src/renderer/cellRenderers/registry.ts`:
```typescript
export interface CellPaintParams<T = unknown> {
  value: T;
  valueFormatted: string;
  bounds: { x: number; y: number; w: number; h: number };
  style: { font: string; fg: string; bg: string; borderColor: string; halign: 'left' | 'right' | 'center' };
  flashAlpha?: number;
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
}

export interface CellPainter<T = unknown> {
  paint(ctx: CanvasRenderingContext2D, params: CellPaintParams<T>): void;
}

export class CellRendererRegistry {
  private map = new Map<string, CellPainter>();
  register(name: string, painter: CellPainter): void { this.map.set(name, painter); }
  get(name: string): CellPainter {
    const p = this.map.get(name);
    if (!p) throw new Error(`[cgrid] unknown cellRenderer '${name}'`);
    return p;
  }
}

const PADDING = 6;

function paintBackground(ctx: CanvasRenderingContext2D, p: CellPaintParams): void {
  const { x, y, w, h } = p.bounds;
  ctx.fillStyle = p.style.bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = p.style.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);  // crisp 1px line
  if (p.flashAlpha && p.flashAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = p.flashAlpha;
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

export const textCell: CellPainter<string> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    ctx.fillStyle = p.style.fg;
    ctx.font = p.style.font;
    ctx.textBaseline = 'middle';
    const cy = p.bounds.y + p.bounds.h / 2;
    if (p.style.halign === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - PADDING, cy);
    } else if (p.style.halign === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(p.valueFormatted, p.bounds.x + PADDING, cy);
    }
  },
};

export const numberCell: CellPainter<number> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    ctx.fillStyle = p.style.fg;
    ctx.font = p.style.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = p.style.halign === 'left' || p.style.halign === 'center' ? p.style.halign : 'right';
    const cy = p.bounds.y + p.bounds.h / 2;
    const x = ctx.textAlign === 'right' ? p.bounds.x + p.bounds.w - PADDING
            : ctx.textAlign === 'center' ? p.bounds.x + p.bounds.w / 2
            : p.bounds.x + PADDING;
    ctx.fillText(p.valueFormatted, x, cy);
  },
};

export const checkboxCell: CellPainter<boolean> = {
  paint(ctx, p) {
    paintBackground(ctx, p);
    const size = 14;
    const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - size / 2;
    ctx.strokeStyle = p.style.fg;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, size, size);
    if (p.value) {
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy + size / 2);
      ctx.lineTo(cx + size / 2 - 1, cy + size - 3);
      ctx.lineTo(cx + size - 2, cy + 3);
      ctx.stroke();
    }
  },
};
```

Also re-export the painters from individual files for clarity:

`cgrid/src/renderer/cellRenderers/textCell.ts`:
```typescript
export { textCell as default } from './registry';
```

`cgrid/src/renderer/cellRenderers/numberCell.ts`:
```typescript
export { numberCell as default } from './registry';
```

`cgrid/src/renderer/cellRenderers/checkboxCell.ts`:
```typescript
export { checkboxCell as default } from './registry';
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- cellRenderers.test
git add cgrid/src/renderer/cellRenderers/ cgrid/tests/cellRenderers.test.ts
git commit -m "feat(cgrid): cell renderer registry + text/number/checkbox painters"
```

---

### Task 18: Painters (`cgrid/src/renderer/painters/`)

**Files:**
- Create: `cgrid/src/renderer/painters/headerPainter.ts`
- Create: `cgrid/src/renderer/painters/bodyPainter.ts`
- Create: `cgrid/src/renderer/painters/pinnedPainter.ts`
- Create: `cgrid/src/renderer/painters/overlayPainter.ts`
- Test: `cgrid/tests/painters.test.ts`

**Interfaces:**
- Consumes: `ViewportState`, `ResolvedColDef`, `ResolvedTheme`, `CellRendererRegistry`, `CellPaintParams`.
- Produces:
  ```typescript
  interface PainterCtx {
    viewport: ViewportState; theme: ResolvedTheme;
    columnDefs: Map<string, ResolvedColDef>;
    cellRenderers: CellRendererRegistry;
    cellData: CellDataLookup;   // (rowIndex, colId) -> { value, valueFormatted, flashAlpha }
    selection: { focusedRowIndex: number|null; focusedColId: string|null; selectedRowIndices: Set<number> };
  }
  type CellDataLookup = (rowIndex: number, colId: string) => { value: unknown; valueFormatted: string; flashAlpha?: number } | null;

  function paintHeader(ctx: CanvasRenderingContext2D, p: PainterCtx): void;
  function paintBody(ctx: CanvasRenderingContext2D, p: PainterCtx): void;
  function paintPinned(ctx: CanvasRenderingContext2D, p: PainterCtx, side: 'left' | 'right'): void;
  function paintOverlay(ctx: CanvasRenderingContext2D, p: PainterCtx): void;
  ```

- [ ] **Step 1: Test paint sequences (spy on context)**

`cgrid/tests/painters.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { paintHeader, paintBody, paintOverlay } from '../src/renderer/painters/headerPainter';
import { paintBody as _b } from '../src/renderer/painters/bodyPainter';  // ensure import
import { paintOverlay as _o } from '../src/renderer/painters/overlayPainter';
import { CellRendererRegistry, textCell, numberCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';

function ctx() {
  return {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '', lineWidth: 1, globalAlpha: 1,
  } as any;
}

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 92, bodyWidth: 250, bodyHeight: 60,
};
const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4,
};
const cols = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
  ['b', { colId: 'b', headerName: 'B', minWidth: 30, maxWidth: Infinity, type: 'number', cellRenderer: 'number', sortable: true, resizable: true, editable: false }],
]);
const reg = new CellRendererRegistry();
reg.register('text', textCell); reg.register('number', numberCell);
const cellData = () => ({ value: 'x', valueFormatted: 'x' });
const selection = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

describe('painters', () => {
  it('paintHeader fills + writes column header text per visible column', () => {
    const c = ctx();
    paintHeader(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection });
    expect(c.fillRect).toHaveBeenCalled();
    expect(c.fillText.mock.calls.length).toBe(2);
  });

  it('paintBody draws every visible cell', () => {
    const c = ctx();
    paintBody(c, { viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData, selection });
    // 2 rows x 2 cols = 4 fills (background per cell)
    expect(c.fillRect.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('paintOverlay draws focus ring when focused cell is set', () => {
    const c = ctx();
    paintOverlay(c, {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg, cellData,
      selection: { focusedRowIndex: 0, focusedColId: 'b', selectedRowIndices: new Set() },
    });
    expect(c.strokeRect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement painters**

(Implementer fills in `headerPainter.ts`, `bodyPainter.ts`, `pinnedPainter.ts`, `overlayPainter.ts` per the contracts above. The headerPainter draws a single fill across the header height then writes one header label per visible column. The bodyPainter loops visible rows × visible body columns and delegates to the registered cell painter. The pinnedPainter does the same but clipped to the pinned-side rect. The overlayPainter draws the row-selection band(s), then a focus rectangle for `selection.focusedRowIndex`/`selection.focusedColId` using `theme.focusRingColor` and `theme.focusRingWidth`. Implement each file as one exported function matching the signatures above.)

Key shared snippet (`bodyPainter.ts`):
```typescript
import type { PainterCtx } from './types';

export function paintBody(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection } = p;
  for (const row of vs.visibleRows) {
    const rowBg = selection.selectedRowIndices.has(row.rowIndex) ? theme.rowSelectedBg
                : row.rowIndex % 2 === 1 ? theme.rowAltBg
                : theme.bg;
    for (const col of vs.visibleColumns) {
      if (col.pinned) continue;   // pinnedPainter handles those
      const def = columnDefs.get(col.colId);
      if (!def) continue;
      const data = cellData(row.rowIndex, col.colId);
      cellRenderers.get(def.cellRenderer).paint(ctx, {
        value: data?.value ?? '',
        valueFormatted: data?.valueFormatted ?? '',
        bounds: { x: col.left, y: row.top, w: col.width, h: row.height },
        style: { font: theme.font, fg: theme.fg, bg: rowBg, borderColor: theme.gridLineColor,
                 halign: def.type === 'number' ? 'right' : 'left' },
        flashAlpha: data?.flashAlpha,
        isFocused: selection.focusedRowIndex === row.rowIndex && selection.focusedColId === col.colId,
        isSelected: selection.selectedRowIndices.has(row.rowIndex),
        isHovered: false,
      });
    }
  }
}
```

`headerPainter.ts`, `pinnedPainter.ts`, `overlayPainter.ts` are short variants of the same loop. Each file also exports a shared `PainterCtx` type from `./types.ts` for convenience.

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- painters.test
git add cgrid/src/renderer/painters/ cgrid/tests/painters.test.ts
git commit -m "feat(cgrid): header / body / pinned / overlay painters delegating to cell registry"
```

---

### Task 19: Renderer orchestrator (`cgrid/src/renderer/renderer.ts`)

**Files:**
- Create: `cgrid/src/renderer/renderer.ts`
- Test: `cgrid/tests/renderer.test.ts`

**Interfaces:**
- Consumes: all of Tasks 14–18; PaintLoop (Task 16).
- Produces:
  ```typescript
  class Renderer {
    constructor(opts: {
      canvas: HTMLCanvasElement;
      paintLoop: PaintLoop;
      getViewport: () => ViewportState;
      getTheme: () => ResolvedTheme;
      getColumnDefs: () => Map<string, ResolvedColDef>;
      cellRenderers: CellRendererRegistry;
      cellData: CellDataLookup;
      getSelection: () => { focusedRowIndex: number|null; focusedColId: string|null; selectedRowIndices: Set<number> };
    });
    syncSize(cssWidth: number, cssHeight: number): void;
    paint(dirtyRects: DirtyRect[]): void;
  }
  ```

- [ ] **Step 1: Test — render goes through layered painters in order**

`cgrid/tests/renderer.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { Renderer } from '../src/renderer/renderer';
import { PaintLoop } from '../src/core/paintLoop';
import { CellRendererRegistry, textCell } from '../src/renderer/cellRenderers/registry';

function fakeCanvas() {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), measureText: () => ({ width: 50 }),
    setTransform: vi.fn(), clearRect: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '', lineWidth: 1, globalAlpha: 1,
  };
  const canvas = { width: 0, height: 0, style: {} as CSSStyleDeclaration, getContext: () => ctx } as any;
  return { canvas, ctx };
}

describe('Renderer', () => {
  it('syncSize sets canvas width/height to css * dpr', () => {
    const { canvas, ctx } = fakeCanvas();
    const loop = new PaintLoop(() => {});
    const r = new Renderer({
      canvas, paintLoop: loop,
      getViewport: () => ({} as any),
      getTheme: () => ({} as any),
      getColumnDefs: () => new Map(),
      cellRenderers: new CellRendererRegistry(),
      cellData: () => null,
      getSelection: () => ({ focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set() }),
    });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    r.syncSize(800, 600);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/renderer/renderer.ts`:
```typescript
import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { DirtyRect, PaintLoop } from '../core/paintLoop';
import type { CellPaintParams, CellRendererRegistry } from './cellRenderers/registry';
import { paintHeader } from './painters/headerPainter';
import { paintBody } from './painters/bodyPainter';
import { paintPinned } from './painters/pinnedPainter';
import { paintOverlay } from './painters/overlayPainter';

export type CellDataLookup = (rowIndex: number, colId: string) =>
  { value: unknown; valueFormatted: string; flashAlpha?: number } | null;

export interface RendererOpts {
  canvas: HTMLCanvasElement;
  paintLoop: PaintLoop;
  getViewport: () => ViewportState;
  getTheme: () => ResolvedTheme;
  getColumnDefs: () => Map<string, ResolvedColDef>;
  cellRenderers: CellRendererRegistry;
  cellData: CellDataLookup;
  getSelection: () => { focusedRowIndex: number | null; focusedColId: string | null; selectedRowIndices: Set<number> };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private opts: RendererOpts) {
    const c = opts.canvas.getContext('2d');
    if (!c) throw new Error('[cgrid] failed to get 2d context');
    this.ctx = c;
  }

  syncSize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.opts.canvas.width = Math.round(cssWidth * dpr);
    this.opts.canvas.height = Math.round(cssHeight * dpr);
    this.opts.canvas.style.width = cssWidth + 'px';
    this.opts.canvas.style.height = cssHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.opts.paintLoop.markFullDirty();
  }

  paint(_dirtyRects: DirtyRect[]): void {
    // Foundation: dirty-rect filtering is a future optimization; full paint per frame.
    const ctx = this.ctx;
    const pctx = {
      viewport: this.opts.getViewport(),
      theme: this.opts.getTheme(),
      columnDefs: this.opts.getColumnDefs(),
      cellRenderers: this.opts.cellRenderers,
      cellData: this.opts.cellData,
      selection: this.opts.getSelection(),
    };
    ctx.fillStyle = pctx.theme.bg;
    ctx.fillRect(0, 0, this.opts.canvas.width, this.opts.canvas.height);
    paintHeader(ctx, pctx);
    paintPinned(ctx, pctx, 'left');
    paintBody(ctx, pctx);
    paintPinned(ctx, pctx, 'right');
    paintOverlay(ctx, pctx);
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- renderer.test
git add cgrid/src/renderer/renderer.ts cgrid/tests/renderer.test.ts
git commit -m "feat(cgrid): Renderer orchestrator wiring layered painters + DPR + paint loop"
```

---

### Task 20: SelectionModel (`cgrid/src/interaction/selectionModel.ts`)

**Files:**
- Create: `cgrid/src/interaction/selectionModel.ts`
- Test: `cgrid/tests/selectionModel.test.ts`

**Interfaces:**
- Consumes: nothing (pure state).
- Produces:
  ```typescript
  type SelectionMode = 'none' | 'single' | 'multiple';
  interface SelectionState {
    focusedRowIndex: number | null;
    focusedColId: string | null;
    selectedRowIndices: Set<number>;
  }
  class SelectionModel {
    constructor(mode: SelectionMode);
    get state(): Readonly<SelectionState>;
    setFocus(rowIndex: number | null, colId: string | null): void;
    selectSingle(rowIndex: number): void;
    toggleMulti(rowIndex: number): void;
    range(fromRowIndex: number, toRowIndex: number): void;
    clear(): void;
    onChange(fn: (s: Readonly<SelectionState>) => void): () => void;
  }
  ```

- [ ] **Step 1: Test**

`cgrid/tests/selectionModel.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { SelectionModel } from '../src/interaction/selectionModel';

describe('SelectionModel', () => {
  it('single mode selects exactly one', () => {
    const m = new SelectionModel('single');
    m.selectSingle(3);
    m.selectSingle(5);
    expect(Array.from(m.state.selectedRowIndices)).toEqual([5]);
  });

  it('multiple mode toggles', () => {
    const m = new SelectionModel('multiple');
    m.toggleMulti(1); m.toggleMulti(2); m.toggleMulti(1);
    expect(Array.from(m.state.selectedRowIndices)).toEqual([2]);
  });

  it('range adds a contiguous span', () => {
    const m = new SelectionModel('multiple');
    m.range(2, 5);
    expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('range handles reverse order', () => {
    const m = new SelectionModel('multiple');
    m.range(5, 2);
    expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('mode=none ignores all selection ops but still tracks focus', () => {
    const m = new SelectionModel('none');
    m.selectSingle(3);
    expect(m.state.selectedRowIndices.size).toBe(0);
    m.setFocus(2, 'b');
    expect(m.state.focusedRowIndex).toBe(2);
  });

  it('onChange fires on each mutation', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.selectSingle(3);
    m.setFocus(3, 'a');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear empties and fires onChange', () => {
    const m = new SelectionModel('multiple');
    m.toggleMulti(1);
    const fn = vi.fn();
    m.onChange(fn);
    m.clear();
    expect(m.state.selectedRowIndices.size).toBe(0);
    expect(fn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/interaction/selectionModel.ts`:
```typescript
export type SelectionMode = 'none' | 'single' | 'multiple';

export interface SelectionState {
  focusedRowIndex: number | null;
  focusedColId: string | null;
  selectedRowIndices: Set<number>;
}

export class SelectionModel {
  private _state: SelectionState = {
    focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set(),
  };
  private listeners = new Set<(s: Readonly<SelectionState>) => void>();

  constructor(private mode: SelectionMode) {}

  get state(): Readonly<SelectionState> { return this._state; }

  setFocus(rowIndex: number | null, colId: string | null): void {
    if (this._state.focusedRowIndex === rowIndex && this._state.focusedColId === colId) return;
    this._state.focusedRowIndex = rowIndex;
    this._state.focusedColId = colId;
    this.emit();
  }

  selectSingle(rowIndex: number): void {
    if (this.mode === 'none') return;
    this._state.selectedRowIndices.clear();
    this._state.selectedRowIndices.add(rowIndex);
    this.emit();
  }

  toggleMulti(rowIndex: number): void {
    if (this.mode === 'none') return;
    if (this.mode === 'single') return this.selectSingle(rowIndex);
    if (this._state.selectedRowIndices.has(rowIndex)) this._state.selectedRowIndices.delete(rowIndex);
    else this._state.selectedRowIndices.add(rowIndex);
    this.emit();
  }

  range(fromRowIndex: number, toRowIndex: number): void {
    if (this.mode !== 'multiple') return;
    const lo = Math.min(fromRowIndex, toRowIndex);
    const hi = Math.max(fromRowIndex, toRowIndex);
    for (let i = lo; i <= hi; i++) this._state.selectedRowIndices.add(i);
    this.emit();
  }

  clear(): void {
    this._state.selectedRowIndices.clear();
    this.emit();
  }

  onChange(fn: (s: Readonly<SelectionState>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this._state);
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- selectionModel.test
git add cgrid/src/interaction/selectionModel.ts cgrid/tests/selectionModel.test.ts
git commit -m "feat(cgrid): SelectionModel (none/single/multiple with focus + range + onChange)"
```

---

### Task 21: Pointer + keyboard input (`cgrid/src/interaction/{pointerInput,keyboardInput}.ts`)

**Files:**
- Create: `cgrid/src/interaction/pointerInput.ts`
- Create: `cgrid/src/interaction/keyboardInput.ts`
- Test: `cgrid/tests/pointerInput.test.ts`
- Test: `cgrid/tests/keyboardInput.test.ts`

**Interfaces:**
- Consumes: `HitTester` (Task 15), `SelectionModel` (Task 20).
- Produces:
  ```typescript
  interface InputDeps {
    canvas: HTMLCanvasElement;
    hitTester: HitTester;
    selectionModel: SelectionModel;
    visibleColIds: () => string[];     // current visible body cols in order
    visibleRowIndices: () => number[]; // currently rendered row indices
    onCellClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
    onCellDoubleClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
    onColumnResize?: (colId: string, deltaPx: number) => void;
    onScroll?: (dx: number, dy: number) => void;
  }
  class PointerInput {
    constructor(deps: InputDeps);
    destroy(): void;
  }
  class KeyboardInput {
    constructor(deps: InputDeps);
    destroy(): void;
  }
  ```

- [ ] **Step 1: Tests (DOM event dispatch)**

`cgrid/tests/pointerInput.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { PointerInput } from '../src/interaction/pointerInput';
import { HitTester } from '../src/interaction/hitTester';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { ViewportState } from '../src/core/viewport';

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [{ rowIndex: 0, top: 32, bottom: 62, height: 30 }],
  firstRow: 0, lastRow: 0,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 62, bodyWidth: 250, bodyHeight: 30,
};

function setup() {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 300, height: 200 }) });
  document.body.appendChild(canvas);
  const hit = new HitTester(() => vs, () => 32, () => 4);
  const sel = new SelectionModel('multiple');
  const onClick = vi.fn();
  const onDbl = vi.fn();
  const input = new PointerInput({
    canvas, hitTester: hit, selectionModel: sel,
    visibleColIds: () => ['a', 'b'],
    visibleRowIndices: () => [0],
    onCellClicked: onClick, onCellDoubleClicked: onDbl,
  });
  return { canvas, sel, onClick, onDbl, input };
}

describe('PointerInput', () => {
  it('cell click updates focus and fires onCellClicked', () => {
    const { canvas, sel, onClick } = setup();
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 45, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup',   { clientX: 150, clientY: 45, bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(0);
    expect(sel.state.focusedColId).toBe('b');
    expect(onClick).toHaveBeenCalled();
  });

  it('double-click fires onCellDoubleClicked', () => {
    const { canvas, onDbl } = setup();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 45, bubbles: true }));
    expect(onDbl).toHaveBeenCalled();
  });
});
```

`cgrid/tests/keyboardInput.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { KeyboardInput } from '../src/interaction/keyboardInput';
import { HitTester } from '../src/interaction/hitTester';
import { SelectionModel } from '../src/interaction/selectionModel';

describe('KeyboardInput', () => {
  function setup() {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    const sel = new SelectionModel('multiple');
    sel.setFocus(2, 'b');
    const hit = new HitTester(() => ({} as any), () => 32, () => 4);
    const visibleCols = () => ['a', 'b', 'c'];
    const visibleRows = () => [0, 1, 2, 3, 4];
    const onDbl = vi.fn();
    const k = new KeyboardInput({
      canvas, hitTester: hit, selectionModel: sel,
      visibleColIds: visibleCols, visibleRowIndices: visibleRows,
      onCellClicked: () => {}, onCellDoubleClicked: onDbl,
    });
    return { canvas, sel, onDbl };
  }

  it('ArrowDown moves focus to next row', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(3);
  });

  it('ArrowRight moves focus to next column', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sel.state.focusedColId).toBe('c');
  });

  it('Space toggles row selection in multi', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(sel.state.selectedRowIndices.has(2)).toBe(true);
  });

  it('Enter / F2 emits cellDoubleClicked equivalent for editing', () => {
    const { canvas, onDbl } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(onDbl).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement pointer input**

`cgrid/src/interaction/pointerInput.ts`:
```typescript
import type { HitTester, Hit } from './hitTester';
import type { SelectionModel } from './selectionModel';

export interface InputDeps {
  canvas: HTMLCanvasElement;
  hitTester: HitTester;
  selectionModel: SelectionModel;
  visibleColIds: () => string[];
  visibleRowIndices: () => number[];
  onCellClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
  onCellDoubleClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => void;
  onColumnResize?: (colId: string, deltaPx: number) => void;
  onScroll?: (dx: number, dy: number) => void;
}

export class PointerInput {
  private downAt: { x: number; y: number; hit: Hit } | null = null;
  private resizing: { colId: string; startX: number } | null = null;

  private mouseDown = (e: MouseEvent) => {
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    this.downAt = { x, y, hit };
    if (hit.kind === 'headerResizer' && this.deps.onColumnResize) {
      this.resizing = { colId: hit.colId, startX: x };
      window.addEventListener('mousemove', this.mouseMove);
      window.addEventListener('mouseup', this.mouseUp, { once: true });
    }
  };

  private mouseMove = (e: MouseEvent) => {
    if (!this.resizing) return;
    const { x } = this.toLocal(e);
    const dx = x - this.resizing.startX;
    if (dx) {
      this.deps.onColumnResize?.(this.resizing.colId, dx);
      this.resizing.startX = x;
    }
  };

  private mouseUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', this.mouseMove);
    if (!this.downAt) return;
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    if (this.resizing) { this.resizing = null; this.downAt = null; return; }
    if (hit.kind === 'cell' && this.downAt.hit.kind === 'cell' &&
        hit.rowIndex === this.downAt.hit.rowIndex && hit.colId === this.downAt.hit.colId) {
      this.deps.selectionModel.setFocus(hit.rowIndex, hit.colId);
      if (e.shiftKey) {
        const prevFocus = this.deps.selectionModel.state.focusedRowIndex;
        if (prevFocus != null) this.deps.selectionModel.range(prevFocus, hit.rowIndex);
      } else if (e.ctrlKey || e.metaKey) {
        this.deps.selectionModel.toggleMulti(hit.rowIndex);
      } else {
        this.deps.selectionModel.selectSingle(hit.rowIndex);
      }
      this.deps.onCellClicked(hit.rowIndex, hit.colId, e);
    }
    this.downAt = null;
  };

  private dblClick = (e: MouseEvent) => {
    const { x, y } = this.toLocal(e);
    const hit = this.deps.hitTester.locate(x, y);
    if (hit.kind === 'cell') this.deps.onCellDoubleClicked(hit.rowIndex, hit.colId, e);
  };

  private wheel = (e: WheelEvent) => {
    if (!this.deps.onScroll) return;
    e.preventDefault();
    this.deps.onScroll(e.deltaX, e.deltaY);
  };

  constructor(private deps: InputDeps) {
    deps.canvas.addEventListener('mousedown', this.mouseDown);
    deps.canvas.addEventListener('mouseup', this.mouseUp);
    deps.canvas.addEventListener('dblclick', this.dblClick);
    deps.canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  destroy(): void {
    this.deps.canvas.removeEventListener('mousedown', this.mouseDown);
    this.deps.canvas.removeEventListener('mouseup', this.mouseUp);
    this.deps.canvas.removeEventListener('dblclick', this.dblClick);
    this.deps.canvas.removeEventListener('wheel', this.wheel);
  }

  private toLocal(e: MouseEvent): { x: number; y: number } {
    const rect = this.deps.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}
```

- [ ] **Step 3: Implement keyboard input**

`cgrid/src/interaction/keyboardInput.ts`:
```typescript
import type { InputDeps } from './pointerInput';

export class KeyboardInput {
  private keyDown = (e: KeyboardEvent) => {
    const sel = this.deps.selectionModel;
    const rows = this.deps.visibleRowIndices();
    const cols = this.deps.visibleColIds();
    if (rows.length === 0 || cols.length === 0) return;
    const { focusedRowIndex: fr, focusedColId: fc } = sel.state;

    if (e.key === 'ArrowDown') {
      const idx = fr == null ? rows[0]! : Math.min(rows[rows.length - 1]!, fr + 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const idx = fr == null ? rows[0]! : Math.max(rows[0]!, fr - 1);
      sel.setFocus(idx, fc ?? cols[0]!);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const ci = fc == null ? 0 : Math.min(cols.length - 1, cols.indexOf(fc) + 1);
      sel.setFocus(fr ?? rows[0]!, cols[ci]!);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      const ci = fc == null ? 0 : Math.max(0, cols.indexOf(fc) - 1);
      sel.setFocus(fr ?? rows[0]!, cols[ci]!);
      e.preventDefault();
    } else if (e.key === ' ' && fr != null) {
      sel.toggleMulti(fr);
      e.preventDefault();
    } else if ((e.key === 'F2' || e.key === 'Enter') && fr != null && fc != null) {
      this.deps.onCellDoubleClicked(fr, fc, e as unknown as MouseEvent);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      sel.clear();
    }
  };

  constructor(private deps: InputDeps) {
    deps.canvas.tabIndex = 0;
    deps.canvas.addEventListener('keydown', this.keyDown);
  }
  destroy(): void { this.deps.canvas.removeEventListener('keydown', this.keyDown); }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npm test --workspace=cgrid -- pointerInput.test keyboardInput.test
git add cgrid/src/interaction/pointerInput.ts cgrid/src/interaction/keyboardInput.ts cgrid/tests/pointerInput.test.ts cgrid/tests/keyboardInput.test.ts
git commit -m "feat(cgrid): pointer + keyboard input wiring to HitTester + SelectionModel"
```

---

### Task 22: Editor overlay (`cgrid/src/interaction/editorOverlay.ts`)

**Files:**
- Create: `cgrid/src/interaction/editorOverlay.ts`
- Test: `cgrid/tests/editorOverlay.test.ts`

**Interfaces:**
- Consumes: `ResolvedColDef` (Task 5).
- Produces:
  ```typescript
  interface EditorAttachOpts {
    container: HTMLElement;
    bounds: { x: number; y: number; w: number; h: number };  // CSS pixels in container coords
    colDef: ResolvedColDef;
    initialValue: unknown;
    onCommit: (newValue: unknown) => void;
    onCancel: () => void;
  }
  class EditorOverlay {
    open(opts: EditorAttachOpts): void;
    close(): void;
    isOpen(): boolean;
  }
  ```

- [ ] **Step 1: Test**

`cgrid/tests/editorOverlay.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { EditorOverlay } from '../src/interaction/editorOverlay';

const cd: any = { colId: 'c', headerName: 'C', type: 'text', cellRenderer: 'text', cellEditor: 'text', sortable: true, resizable: true, editable: true, minWidth: 30, maxWidth: Infinity };

describe('EditorOverlay', () => {
  it('opens an <input> and seeds the initial value', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 10, y: 20, w: 100, h: 30 },
      colDef: cd, initialValue: 'hi',
      onCommit: () => {}, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('hi');
  });

  it('commits on Enter', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const onCommit = vi.fn();
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: cd, initialValue: 'a',
      onCommit, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith('b');
    expect(overlay.isOpen()).toBe(false);
  });

  it('cancels on Escape', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: cd, initialValue: 'a',
      onCommit, onCancel,
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('number editor type=number', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const overlay = new EditorOverlay();
    overlay.open({
      container: root, bounds: { x: 0, y: 0, w: 100, h: 30 },
      colDef: { ...cd, cellEditor: 'number' },
      initialValue: 42, onCommit: () => {}, onCancel: () => {},
    });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('number');
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/interaction/editorOverlay.ts`:
```typescript
import type { ResolvedColDef } from '../core/propertyChain';

export interface EditorAttachOpts {
  container: HTMLElement;
  bounds: { x: number; y: number; w: number; h: number };
  colDef: ResolvedColDef;
  initialValue: unknown;
  onCommit: (newValue: unknown) => void;
  onCancel: () => void;
}

export class EditorOverlay {
  private wrapper: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private opts: EditorAttachOpts | null = null;

  isOpen(): boolean { return this.wrapper !== null; }

  open(opts: EditorAttachOpts): void {
    this.close();
    this.opts = opts;
    const w = document.createElement('div');
    w.className = 'vg-editor-overlay';
    w.style.cssText = `position:absolute; left:${opts.bounds.x}px; top:${opts.bounds.y}px; width:${opts.bounds.w}px; height:${opts.bounds.h}px; z-index:10`;
    const input = document.createElement('input');
    const editorType = opts.colDef.cellEditor ?? (opts.colDef.type === 'number' ? 'number' : 'text');
    input.type = editorType === 'number' ? 'number' : 'text';
    input.value = String(opts.initialValue ?? '');
    input.style.cssText = 'width:100%; height:100%; box-sizing:border-box; padding:0 4px; border:1px solid #0d9488; font: inherit; outline: none;';
    input.addEventListener('keydown', this.keydown);
    input.addEventListener('blur', this.blur);
    w.appendChild(input);
    opts.container.appendChild(w);
    this.wrapper = w;
    this.input = input;
    input.focus();
    input.select();
  }

  close(): void {
    if (this.wrapper && this.wrapper.parentElement) {
      this.wrapper.parentElement.removeChild(this.wrapper);
    }
    this.wrapper = null;
    this.input = null;
    this.opts = null;
  }

  private keydown = (e: KeyboardEvent) => {
    if (!this.opts || !this.input) return;
    if (e.key === 'Enter') {
      const raw = this.input.value;
      const value = this.opts.colDef.type === 'number' ? Number(raw) : raw;
      this.opts.onCommit(value);
      this.close();
    } else if (e.key === 'Escape') {
      this.opts.onCancel();
      this.close();
    }
  };

  private blur = () => {
    if (!this.opts || !this.input) return;
    const raw = this.input.value;
    const value = this.opts.colDef.type === 'number' ? Number(raw) : raw;
    this.opts.onCommit(value);
    this.close();
  };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- editorOverlay.test
git add cgrid/src/interaction/editorOverlay.ts cgrid/tests/editorOverlay.test.ts
git commit -m "feat(cgrid): DOM-overlay cell editor (text + number) with Enter/Esc/Blur semantics"
```

---

### Task 23: A11y overlay (`cgrid/src/interaction/a11yOverlay.ts`)

**Files:**
- Create: `cgrid/src/interaction/a11yOverlay.ts`
- Test: `cgrid/tests/a11yOverlay.test.ts`

**Interfaces:**
- Consumes: `ResolvedColDef` (Task 5).
- Produces:
  ```typescript
  interface A11yState {
    visibleRowCount: number; columnCount: number;
    focusedRowIndex: number | null; focusedColId: string | null;
    focusedRowData: { colId: string; valueFormatted: string }[];
  }
  class A11yOverlay {
    constructor(container: HTMLElement);
    update(state: A11yState): void;
    destroy(): void;
  }
  ```

- [ ] **Step 1: Test**

`cgrid/tests/a11yOverlay.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { A11yOverlay } from '../src/interaction/a11yOverlay';

describe('A11yOverlay', () => {
  it('mounts a role=grid scaffold', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    new A11yOverlay(root);
    expect(root.querySelector('[role="grid"]')).toBeTruthy();
  });

  it('renders focused row cells with aria-label including header name + value', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const a = new A11yOverlay(root);
    a.update({
      visibleRowCount: 100, columnCount: 3, focusedRowIndex: 5, focusedColId: 'b',
      focusedRowData: [
        { colId: 'a', valueFormatted: 'apple' },
        { colId: 'b', valueFormatted: '12.5' },
      ],
    });
    const cells = root.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(2);
    expect((cells[0] as HTMLElement).getAttribute('aria-label')).toContain('apple');
    expect((cells[1] as HTMLElement).getAttribute('aria-label')).toContain('12.5');
  });

  it('updates aria-rowcount + aria-colcount + row aria-rowindex', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const a = new A11yOverlay(root);
    a.update({
      visibleRowCount: 200, columnCount: 5, focusedRowIndex: 9, focusedColId: 'a',
      focusedRowData: [{ colId: 'a', valueFormatted: 'x' }],
    });
    const grid = root.querySelector('[role="grid"]') as HTMLElement;
    expect(grid.getAttribute('aria-rowcount')).toBe('200');
    expect(grid.getAttribute('aria-colcount')).toBe('5');
    const row = root.querySelector('[role="row"]') as HTMLElement;
    expect(row.getAttribute('aria-rowindex')).toBe('10');
  });
});
```

- [ ] **Step 2: Implement**

`cgrid/src/interaction/a11yOverlay.ts`:
```typescript
export interface A11yState {
  visibleRowCount: number;
  columnCount: number;
  focusedRowIndex: number | null;
  focusedColId: string | null;
  focusedRowData: { colId: string; valueFormatted: string }[];
}

const HIDDEN_STYLE =
  'position:absolute; left:0; top:0; clip:rect(0 0 0 0); width:1px; height:1px; overflow:hidden;';

export class A11yOverlay {
  private grid: HTMLDivElement;
  private row: HTMLDivElement;

  constructor(private container: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'vg-a11y-root';
    root.style.cssText = HIDDEN_STYLE;
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    grid.appendChild(row);
    root.appendChild(grid);
    container.appendChild(root);
    this.grid = grid;
    this.row = row;
  }

  update(state: A11yState): void {
    this.grid.setAttribute('aria-rowcount', String(state.visibleRowCount));
    this.grid.setAttribute('aria-colcount', String(state.columnCount));
    if (state.focusedRowIndex !== null) {
      this.row.setAttribute('aria-rowindex', String(state.focusedRowIndex + 1));
    }
    // Clear + rebuild focused row's cells
    while (this.row.firstChild) this.row.removeChild(this.row.firstChild);
    state.focusedRowData.forEach((cell, i) => {
      const c = document.createElement('div');
      c.setAttribute('role', 'gridcell');
      c.setAttribute('aria-colindex', String(i + 1));
      c.setAttribute('aria-label', `${cell.colId}: ${cell.valueFormatted}`);
      c.tabIndex = -1;
      this.row.appendChild(c);
    });
  }

  destroy(): void {
    const root = this.grid.parentElement;
    if (root && root.parentElement) root.parentElement.removeChild(root);
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- a11yOverlay.test
git add cgrid/src/interaction/a11yOverlay.ts cgrid/tests/a11yOverlay.test.ts
git commit -m "feat(cgrid): hidden DOM ARIA grid scaffold for focused-row screen-reader window"
```

---

### Task 24: Public `class VelocityGrid` (`cgrid/src/velocityGrid.ts`)

**Files:**
- Modify: `cgrid/src/velocityGrid.ts` (replace stub with the real class + re-exports + tokens.css side-effect import)
- Test: `cgrid/tests/cgrid.integration.test.ts`

**Interfaces:**
- Consumes: everything from prior tasks.
- Produces: the public `class VelocityGrid` per spec §10.1 — the user-facing entry point. The implementation:
  1. Constructs container DOM (root div + canvas + editor overlay slot + a11y overlay).
  2. Instantiates `CssReader`, `CellRendererRegistry` (pre-registered painters), `SelectionModel`, `PaintLoop`, `Renderer`, `HitTester`, `PointerInput`, `KeyboardInput`, `EditorOverlay`, `A11yOverlay`.
  3. Starts the worker (`new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' })`).
  4. Wires `WorkerClient` to push events into the `TypedEventEmitter<VelocityGridEvent>`.
  5. Wires viewport requests on scroll / model updates / size changes.
  6. Wires editor commit → `applyTransaction({ update: [...] })`.
  7. Implements the public `VelocityGridApi` methods and `.on(...)` subscription.

- [ ] **Step 1: Integration test (worker mocked, canvas mocked)**

`cgrid/tests/cgrid.integration.test.ts`:
```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

// Stub Worker for happy-dom env. VelocityGrid accepts options.worker.url; in tests we inject a fake.
beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
});

describe('VelocityGrid integration', () => {
  it('constructs and emits gridReady', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
    document.body.appendChild(container);
    const events: any[] = [];
    const grid = new VelocityGrid<{ id: string; name: string }>(container, {
      columnDefs: [{ field: 'id' }, { field: 'name' }],
      getRowId: (r) => r.id,
      theme: 'vg-theme-quartz',
    });
    grid.on('gridReady', (e) => events.push(e));
    // Simulate worker 'ready' response so the integration completes.
    const w = (grid as any).workerClient.worker;  // fakeWorker
    w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events.length).toBe(1);
  });
});
```

(Note: the integration test is best-effort against the worker mock. It verifies the construction wiring lands without errors and the public emitter fires.)

- [ ] **Step 2: Implement `cgrid/src/velocityGrid.ts`**

This file is large (~300 lines). Structure:

```typescript
import './theming/tokens.css';
import type {
  VelocityGridOptions, VelocityGridEvent, VelocityGridApi, Tx, TransactionResult, SortModel, FilterModel, GroupModel, CColDef,
} from './types';
import { TypedEventEmitter } from './core/eventEmitter';
import { resolveColDef, type ResolvedColDef } from './core/propertyChain';
import { resolveColumnWidths, type ColumnLayout } from './core/layout';
import { computeViewport, type ViewportState } from './core/viewport';
import { PaintLoop, type DirtyRect } from './core/paintLoop';
import { CssReader, type ResolvedTheme } from './theming/cssReader';
import { CellRendererRegistry, textCell, numberCell, checkboxCell } from './renderer/cellRenderers/registry';
import { Renderer } from './renderer/renderer';
import { HitTester } from './interaction/hitTester';
import { SelectionModel } from './interaction/selectionModel';
import { PointerInput } from './interaction/pointerInput';
import { KeyboardInput } from './interaction/keyboardInput';
import { EditorOverlay } from './interaction/editorOverlay';
import { A11yOverlay } from './interaction/a11yOverlay';
import { WorkerClient } from './worker/client';
import type { WorkerColumn, ViewportChunk } from './worker/protocol';
import { decodeText } from './worker/chunkFormat';

export const CGRID_VERSION = '0.0.0';

export type {
  VelocityGridOptions, CColDef, VelocityGridEvent, VelocityGridApi, Tx, TransactionResult,
  SortModel, FilterModel, GroupModel,
} from './types';

export class VelocityGrid<TRow = any> {
  private events = new TypedEventEmitter<VelocityGridEvent>();
  private columnDefsMap = new Map<string, ResolvedColDef<TRow>>();
  private columnOrder: ResolvedColDef<TRow>[] = [];
  private columnLayout: ColumnLayout[] = [];
  private theme: ResolvedTheme;
  private scrollLeft = 0;
  private scrollTop = 0;
  private rowCount = 0;
  private chunk: ViewportChunk | null = null;
  private decodedTextCols = new Map<string, string[]>();
  private viewportRequestPending = false;

  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private editorContainer: HTMLDivElement;
  private cssReader: CssReader;
  private cellRenderers: CellRendererRegistry;
  private paintLoop: PaintLoop;
  private renderer: Renderer;
  private viewport: ViewportState;
  private selection: SelectionModel;
  private hitTester: HitTester;
  private pointer: PointerInput;
  private keyboard: KeyboardInput;
  private editor: EditorOverlay;
  private a11y: A11yOverlay;
  private workerClient: WorkerClient;
  private destroyed = false;
  private resizeObs: ResizeObserver;

  constructor(private container: HTMLElement, private options: VelocityGridOptions<TRow>) {
    if (!options.getRowId) throw new Error('[cgrid] options.getRowId is required');

    // 1. DOM scaffold
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden;';
    this.root.classList.add(options.theme ?? 'vg-theme-quartz');
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block; position:absolute; left:0; top:0; outline:none;';
    this.canvas.tabIndex = 0;
    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; pointer-events:none;';
    // Children of editorContainer set pointer-events:auto themselves
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.editorContainer);
    container.appendChild(this.root);

    // 2. Theme + cell renderers
    this.cssReader = new CssReader(this.root);
    this.theme = this.cssReader.read();
    this.cellRenderers = new CellRendererRegistry();
    this.cellRenderers.register('text', textCell);
    this.cellRenderers.register('number', numberCell);
    this.cellRenderers.register('checkbox', checkboxCell);

    // 3. Column model
    for (const def of options.columnDefs) {
      const r = resolveColDef(def, options.defaultColDef);
      this.columnDefsMap.set(r.colId, r);
      this.columnOrder.push(r);
    }

    // 4. Initial viewport
    this.viewport = this.computeCurrentViewport();

    // 5. Selection
    this.selection = new SelectionModel(options.rowSelection ?? 'none');

    // 6. Paint loop + renderer
    this.paintLoop = new PaintLoop((rects) => this.renderer.paint(rects));
    this.renderer = new Renderer({
      canvas: this.canvas,
      paintLoop: this.paintLoop,
      getViewport: () => this.viewport,
      getTheme: () => this.theme,
      getColumnDefs: () => this.columnDefsMap as Map<string, ResolvedColDef>,
      cellRenderers: this.cellRenderers,
      cellData: (rowIndex, colId) => this.cellAt(rowIndex, colId),
      getSelection: () => this.selection.state,
    });

    // 7. Hit-test + input
    this.hitTester = new HitTester(
      () => this.viewport,
      () => this.theme.headerHeight,
      () => this.theme.resizerHotZone,
    );
    const inputDeps = {
      canvas: this.canvas,
      hitTester: this.hitTester,
      selectionModel: this.selection,
      visibleColIds: () => this.viewport.visibleColumns.map((c) => c.colId),
      visibleRowIndices: () => this.viewport.visibleRows.map((r) => r.rowIndex),
      onCellClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) this.events.emit({ type: 'cellClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
      },
      onCellDoubleClicked: (rowIndex: number, colId: string, mouse: MouseEvent) => {
        const rowId = this.rowIdAt(rowIndex);
        if (rowId) {
          this.events.emit({ type: 'cellDoubleClicked', rowId, colId, value: this.cellAt(rowIndex, colId)?.value, mouse });
          this.openEditor(rowIndex, colId);
        }
      },
      onColumnResize: (colId, dx) => this.resizeColumn(colId, dx),
      onScroll: (dx, dy) => this.applyScroll(dx, dy),
    };
    this.pointer = new PointerInput(inputDeps);
    this.keyboard = new KeyboardInput(inputDeps);
    this.editor = new EditorOverlay();
    this.a11y = new A11yOverlay(this.root);

    // 8. Worker
    const url = options.worker?.url ?? new URL('./worker/worker.ts', import.meta.url).toString();
    const worker = new Worker(url, { type: 'module' });
    this.workerClient = new WorkerClient(worker as any, {
      onModelUpdated: (visibleCount) => {
        this.rowCount = visibleCount;
        this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
        this.requestViewport();
      },
      onAsyncTransactionsFlushed: (results) => {
        this.events.emit({ type: 'asyncTransactionsFlushed', results });
      },
      onError: (msg) => console.error('[cgrid] worker error:', msg),
    });

    this.workerClient.init({
      rowIdField: this.inferRowIdField(options),
      columns: this.workerColumns(),
    }).then(() => {
      this.events.emit({ type: 'gridReady', api: this.makeApi() });
      if (options.rowData) this.setRowData(options.rowData);
    });

    // 9. Resize observer
    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(this.root);
    this.handleResize();

    // 10. Selection feedback
    this.selection.onChange(() => {
      this.paintLoop.markFullDirty();
      this.events.emit({ type: 'selectionChanged', selectedRowIds: this.getSelectedRowIds() });
      this.updateA11y();
    });

    this.paintLoop.start();
  }

  // --- Public API -----------------------------------------------------------

  on<E extends VelocityGridEvent['type']>(type: E, handler: (e: Extract<VelocityGridEvent, { type: E }>) => void): () => void {
    return this.events.on(type, handler);
  }

  setRowData(rows: TRow[]): void {
    this.workerClient.setRowData(rows).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'modelUpdated', visibleRowCount: visibleCount });
      this.requestViewport();
    });
  }

  applyTransaction(t: Tx<TRow>): TransactionResult {
    // Foundation: async only. For sync semantics, callers use the worker's sync path via separate cycle.
    this.workerClient.applyTransaction({ ...t, async: false });
    return { add: [], update: [], remove: [] };
  }
  applyTransactionAsync(t: Tx<TRow>): void {
    this.workerClient.applyTransaction({
      add: t.add as unknown[],
      update: t.update as unknown[],
      remove: (t.remove as TRow[] | undefined)?.map((r) => this.options.getRowId(r)),
      async: true,
    });
  }
  flushAsyncTransactions(): void { /* Foundation: deferred — relies on worker's setTimeout */ }

  setSortModel(s: SortModel): void {
    this.workerClient.setSortModel(s).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'sortChanged', sortModel: s });
      this.requestViewport();
    });
  }
  setFilterModel(f: FilterModel): void {
    this.workerClient.setFilterModel(f).then(({ visibleCount }) => {
      this.rowCount = visibleCount;
      this.events.emit({ type: 'filterChanged', filterModel: f });
      this.requestViewport();
    });
  }
  setGroupModel(_g: GroupModel): void { /* Out of scope for Foundation */ }

  ensureRowVisible(_rowId: string, _position?: 'top' | 'middle' | 'bottom'): void {
    // Foundation: simple — scroll to the row's index*rowHeight. Lookup requires worker support not in v1.
  }
  getSelectedRowIds(): string[] {
    const out: string[] = [];
    for (const idx of this.selection.state.selectedRowIndices) {
      const id = this.rowIdAt(idx);
      if (id) out.push(id);
    }
    return out;
  }
  setSelectedRowIds(_ids: string[]): void { /* needs a rowId -> rowIndex map; deferred */ }
  getFocusedCell(): { rowId: string; colId: string } | null {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    if (focusedRowIndex == null || focusedColId == null) return null;
    const rowId = this.rowIdAt(focusedRowIndex);
    return rowId ? { rowId, colId: focusedColId } : null;
  }
  setFocusedCell(_rowId: string, _colId: string): void { /* deferred */ }
  refresh(): void { this.paintLoop.markFullDirty(); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paintLoop.stop();
    this.workerClient.destroy();
    this.resizeObs.disconnect();
    this.pointer.destroy(); this.keyboard.destroy();
    this.a11y.destroy();
    this.editor.close();
    this.root.parentElement?.removeChild(this.root);
    this.events.destroy();
  }

  // --- Internals ------------------------------------------------------------

  private makeApi(): VelocityGridApi {
    return {
      setRowData: (r) => this.setRowData(r as TRow[]),
      applyTransaction: (t) => this.applyTransaction(t as Tx<TRow>),
      applyTransactionAsync: (t) => this.applyTransactionAsync(t as Tx<TRow>),
      flushAsyncTransactions: () => this.flushAsyncTransactions(),
      setSortModel: (s) => this.setSortModel(s),
      setFilterModel: (f) => this.setFilterModel(f),
      setGroupModel: (g) => this.setGroupModel(g),
      ensureRowVisible: (id, pos) => this.ensureRowVisible(id, pos),
      getSelectedRowIds: () => this.getSelectedRowIds(),
      setSelectedRowIds: (ids) => this.setSelectedRowIds(ids),
      getFocusedCell: () => this.getFocusedCell(),
      setFocusedCell: (r, c) => this.setFocusedCell(r, c),
      refresh: () => this.refresh(),
      destroy: () => this.destroy(),
    };
  }

  private workerColumns(): WorkerColumn[] {
    return this.columnOrder.map((c) => ({
      colId: c.colId,
      field: c.field as string | undefined,
      type: c.type,
      aggFunc: c.aggFunc,
      filter: c.filter,
    }));
  }
  private inferRowIdField(opts: VelocityGridOptions<TRow>): string {
    // Foundation: parse the field name out of a `(row) => row.id` style fn body.
    const src = opts.getRowId.toString();
    const m = src.match(/(?:return\s+)?(?:\w+|\(\w+\))\.(\w+)/);
    if (m) return m[1]!;
    throw new Error('[cgrid] could not infer rowIdField from getRowId — Foundation cycle only supports `row => row.<field>` style');
  }

  private handleResize(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.renderer.syncSize(w, h);
    this.columnLayout = resolveColumnWidths(this.columnOrder, w);
    this.viewport = this.computeCurrentViewport();
    this.requestViewport();
  }

  private computeCurrentViewport(): ViewportState {
    const w = this.root.clientWidth || 800;
    const h = this.root.clientHeight || 600;
    return computeViewport({
      columnLayout: this.columnLayout,
      rowCount: this.rowCount,
      rowHeight: this.options.rowHeight ?? this.theme.rowHeight,
      headerHeight: this.options.headerHeight ?? this.theme.headerHeight,
      containerWidth: w, containerHeight: h,
      scrollLeft: this.scrollLeft, scrollTop: this.scrollTop,
    });
  }

  private applyScroll(dx: number, dy: number): void {
    this.scrollLeft = Math.max(0, this.scrollLeft + dx);
    this.scrollTop  = Math.max(0, this.scrollTop  + dy);
    this.viewport = this.computeCurrentViewport();
    this.events.emit({ type: 'viewportChanged', firstRow: this.viewport.firstRow, lastRow: this.viewport.lastRow });
    this.paintLoop.markFullDirty();
    this.requestViewport();
  }

  private requestViewport(): void {
    if (this.viewportRequestPending) return;
    this.viewportRequestPending = true;
    const cols = this.viewport.visibleColumns.map((c) => c.colId);
    const rowStart = this.viewport.firstRow;
    const rowEnd = this.viewport.lastRow + 1;
    this.workerClient.getViewport({ rowStart, rowEnd, columns: cols, includeFlashMask: true })
      .then((chunk) => {
        this.viewportRequestPending = false;
        this.chunk = chunk;
        this.decodedTextCols.clear();
        this.paintLoop.markFullDirty();
        this.updateA11y();
      })
      .catch((err) => { this.viewportRequestPending = false; console.error('[cgrid] viewport request:', err); });
  }

  private cellAt(rowIndex: number, colId: string) {
    if (!this.chunk) return null;
    const localIndex = rowIndex - this.chunk.rowStart;
    if (localIndex < 0 || localIndex >= this.chunk.rowCount) return null;
    const numeric = this.chunk.numericCols[colId];
    if (numeric) {
      const value = numeric[localIndex]!;
      return { value, valueFormatted: this.formatNumber(colId, value) };
    }
    const text = this.chunk.textCols[colId];
    if (text) {
      let decoded = this.decodedTextCols.get(colId);
      if (!decoded) { decoded = decodeText(text.offsets, text.bytes); this.decodedTextCols.set(colId, decoded); }
      const value = decoded[localIndex] ?? '';
      return { value, valueFormatted: value };
    }
    return { value: '', valueFormatted: '' };
  }
  private rowIdAt(rowIndex: number): string | null {
    // Foundation: numeric IDs need round-trip via worker. For now, we only support cell-level focus events.
    return `row-${rowIndex}`;
  }
  private formatNumber(_colId: string, value: number): string {
    return Number.isFinite(value) ? value.toString() : '';
  }
  private updateA11y(): void {
    const { focusedRowIndex, focusedColId } = this.selection.state;
    const focusedRowData = focusedRowIndex == null ? []
      : this.viewport.visibleColumns
          .filter((c) => !c.pinned || c.pinned === 'left')
          .map((c) => ({ colId: c.colId, valueFormatted: this.cellAt(focusedRowIndex, c.colId)?.valueFormatted ?? '' }));
    this.a11y.update({
      visibleRowCount: this.rowCount,
      columnCount: this.columnOrder.length,
      focusedRowIndex, focusedColId, focusedRowData,
    });
  }

  private resizeColumn(colId: string, dx: number): void {
    const def = this.columnDefsMap.get(colId);
    if (!def) return;
    const cur = this.columnLayout.find((c) => c.colId === colId);
    if (!cur) return;
    const newW = Math.max(def.minWidth, cur.width + dx);
    def.width = newW;
    this.columnLayout = resolveColumnWidths(this.columnOrder, this.root.clientWidth);
    this.viewport = this.computeCurrentViewport();
    this.paintLoop.markFullDirty();
    this.events.emit({ type: 'columnResized', colId, width: newW });
  }

  private openEditor(rowIndex: number, colId: string): void {
    const def = this.columnDefsMap.get(colId);
    if (!def || !def.editable) return;
    const col = this.viewport.visibleColumns.find((c) => c.colId === colId);
    const row = this.viewport.visibleRows.find((r) => r.rowIndex === rowIndex);
    if (!col || !row) return;
    const data = this.cellAt(rowIndex, colId);
    this.editorContainer.style.pointerEvents = 'auto';
    this.editor.open({
      container: this.editorContainer,
      bounds: { x: col.left, y: row.top, w: col.width, h: row.height },
      colDef: def,
      initialValue: data?.value ?? '',
      onCommit: (newValue) => {
        this.editorContainer.style.pointerEvents = 'none';
        const rowId = this.rowIdAt(rowIndex);
        if (!rowId) return;
        this.events.emit({ type: 'cellValueChanged', rowId, colId, oldValue: data?.value, newValue });
        // Foundation: emit only; actual transaction wiring needs rowId-by-index lookup (deferred to a follow-up cycle).
      },
      onCancel: () => { this.editorContainer.style.pointerEvents = 'none'; },
    });
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm test --workspace=cgrid -- cgrid.integration.test
npm run typecheck --workspace=cgrid
npm run build --workspace=cgrid
git add cgrid/src/velocityGrid.ts cgrid/tests/cgrid.integration.test.ts
git commit -m "feat(cgrid): public VelocityGrid class wiring renderer + worker + interaction + a11y"
```

---

### Task 25: Demo app scaffold (`apps/cgrid-positions/`)

**Files:**
- Modify: `apps/cgrid-positions/package.json` (replace placeholder)
- Create: `apps/cgrid-positions/vite.config.ts`
- Create: `apps/cgrid-positions/tsconfig.json`
- Create: `apps/cgrid-positions/index.html`
- Create: `apps/cgrid-positions/src/main.ts`
- Create: `apps/cgrid-positions/src/style.css`
- Create: `apps/cgrid-positions/README.md`

**Interfaces:**
- Consumes: `cgrid` workspace package.
- Produces: a runnable demo shell. `npm run dev:positions` serves a "Hello, cgrid" page on a Vite dev port distinct from the showcase. Real grid wiring lands in Task 26.

- [ ] **Step 1: Implement the scaffold (one-pass; no separate test)**

`apps/cgrid-positions/package.json`:
```json
{
  "name": "cgrid-positions",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@stomp/stompjs": "^7.1.1",
    "cgrid": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~5.9.3",
    "vite": "^7.3.2"
  }
}
```

`apps/cgrid-positions/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5175 },
});
```

`apps/cgrid-positions/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`apps/cgrid-positions/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cgrid · STOMP Positions</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div class="app">
      <header>
        <h1>cgrid — STOMP Positions</h1>
        <div class="actions">
          <button id="theme">Toggle theme</button>
        </div>
      </header>
      <div id="grid" class="grid-host vg-theme-quartz"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/cgrid-positions/src/style.css`:
```css
*, *::before, *::after { box-sizing: border-box }
html, body { margin: 0; height: 100%; font-family: Inter, system-ui, sans-serif; }
.app { display: flex; flex-direction: column; height: 100%; padding: 12px; gap: 8px; background: #e8ecef; }
header { display: flex; justify-content: space-between; align-items: center; }
.grid-host { flex: 1; min-height: 0; background: #fff; border: 1px solid #d5dbe0; border-radius: 6px; }
button { padding: 6px 12px; border: 1px solid #c8d0d8; background: #fff; border-radius: 4px; cursor: pointer; }
```

`apps/cgrid-positions/src/main.ts`:
```typescript
console.log('cgrid-positions: bootstrapping');
// Real grid wiring lands in Task 26.
const host = document.getElementById('grid');
if (host) host.textContent = 'Initializing grid…';

document.getElementById('theme')?.addEventListener('click', () => {
  const h = document.getElementById('grid');
  if (!h) return;
  h.classList.toggle('vg-theme-quartz');
  h.classList.toggle('vg-theme-quartz-dark');
});
```

`apps/cgrid-positions/README.md`:
```markdown
# cgrid-positions

Vanilla-TS demo of `cgrid` consuming the STOMP positions feed (same as the
AG Grid `apps/showcase`).

## Prereqs

- STOMP server at `localhost:8081` (see root README of the monorepo).

## Run

```bash
npm install
npm run dev:positions
```

Opens at http://localhost:5175.
```

- [ ] **Step 2: Verify**

```bash
cd /Users/develop/wfh/canvasgrid
npm install
npm run dev:positions
```
Expected: Vite serves at http://localhost:5175 with the placeholder page and a working theme toggle. Stop the server once confirmed.

- [ ] **Step 3: Commit**

```bash
git add apps/cgrid-positions/ package.json package-lock.json
git commit -m "feat(demo): scaffold cgrid-positions vanilla-ts demo app"
```

---

### Task 26: Demo — STOMP + cgrid wiring (`apps/cgrid-positions/src/positionsGrid.ts`)

**Files:**
- Create: `apps/cgrid-positions/src/stomp.ts`
- Create: `apps/cgrid-positions/src/positionsGrid.ts`
- Modify: `apps/cgrid-positions/src/main.ts` (replace placeholder with real wiring)

**Interfaces:**
- Consumes: `cgrid` public API (Task 24); existing STOMP server protocol used by the showcase.
- Produces: a live demo that loads the snapshot and applies live updates against the canvas grid.

- [ ] **Step 1: Implement STOMP client (mirrors the showcase's hook, but without React)**

`apps/cgrid-positions/src/stomp.ts`:
```typescript
import { Client, type IMessage } from '@stomp/stompjs';

export interface Position {
  positionId: string;
  cusip: string;
  ticker: string;
  notionalAmount: number;
  marketValue: number;
  currentPrice: number;
  pnl: number;
  dailyPnl: number;
  unrealizedPnl: number;
  yield: number;
  spread: number;
  dv01: number;
  pv01: number;
}

export interface StompCallbacks {
  onSnapshot: (rows: Position[]) => void;
  onLiveUpdate: (updates: Position[]) => void;
  onPhase: (phase: 'connecting' | 'snapshot' | 'live' | 'error' | 'disconnected') => void;
}

const DEFAULTS = {
  wsUrl: 'ws://localhost:8081',
  clientId: 'TRADER001',
  snapshotRows: 3000,
  rate: 7,
  batchSize: 50,
  sparse: true,
  updatesPerTick: 100,
};

export function connectStomp(cb: StompCallbacks) {
  cb.onPhase('connecting');
  const buffer: Position[] = [];
  const client = new Client({
    brokerURL: DEFAULTS.wsUrl,
    reconnectDelay: 2000,
  });

  client.onConnect = () => {
    cb.onPhase('snapshot');
    const snapshotDest = `/snapshot/positions/${DEFAULTS.clientId}`;
    const liveDest = `/topic/positions/${DEFAULTS.clientId}`;

    client.subscribe(snapshotDest, (msg: IMessage) => {
      const rows = JSON.parse(msg.body) as Position[];
      cb.onSnapshot(rows);
      cb.onPhase('live');
    }, {
      'snapshot-rows': String(DEFAULTS.snapshotRows),
      'sparse': String(DEFAULTS.sparse),
      'rate': String(DEFAULTS.rate),
      'updates-per-tick': String(DEFAULTS.updatesPerTick),
    });

    client.subscribe(liveDest, (msg: IMessage) => {
      const updates = JSON.parse(msg.body) as Position[];
      buffer.push(...updates);
      if (buffer.length >= DEFAULTS.batchSize) {
        cb.onLiveUpdate(buffer.splice(0));
      }
    });
  };

  client.onStompError = (frame) => {
    console.error('[stomp] error:', frame.headers['message']);
    cb.onPhase('error');
  };

  client.onWebSocketClose = () => cb.onPhase('disconnected');

  client.activate();
  return { client, disconnect: () => client.deactivate() };
}
```

- [ ] **Step 2: Implement the grid wrapper**

`apps/cgrid-positions/src/positionsGrid.ts`:
```typescript
import { VelocityGrid, type VelocityGridOptions } from 'cgrid';
import type { Position } from './stomp';

export function createPositionsGrid(container: HTMLElement): VelocityGrid<Position> {
  const options: VelocityGridOptions<Position> = {
    columnDefs: [
      { field: 'positionId',     headerName: 'Position ID', width: 150, pinned: 'left' },
      { field: 'cusip',          headerName: 'CUSIP',       width: 110, pinned: 'left' },
      { field: 'ticker',         headerName: 'Ticker',      width: 100 },
      { field: 'notionalAmount', headerName: 'Notional',    type: 'number', width: 130, aggFunc: 'sum' },
      { field: 'marketValue',    headerName: 'Market Value',type: 'number', width: 130, aggFunc: 'sum' },
      { field: 'currentPrice',   headerName: 'Price',       type: 'number', width: 100, aggFunc: 'avg' },
      { field: 'pnl',            headerName: 'P&L',         type: 'number', width: 110, pinned: 'right', aggFunc: 'sum' },
      { field: 'dailyPnl',       headerName: 'Daily P&L',   type: 'number', width: 110, aggFunc: 'sum' },
      { field: 'unrealizedPnl',  headerName: 'Unrealized',  type: 'number', width: 110, aggFunc: 'sum' },
      { field: 'yield',          headerName: 'Yield',       type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'spread',         headerName: 'Spread',      type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'dv01',           headerName: 'DV01',        type: 'number', width: 100, aggFunc: 'sum' },
      { field: 'pv01',           headerName: 'PV01',        type: 'number', width: 100, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.positionId,
    rowSelection: 'multiple',
    enableCellChangeFlash: true,
    cellFlashDuration: 500,
    cellFadeDuration: 800,
    asyncTransactionWaitMillis: 50,
    theme: 'vg-theme-quartz',
  };
  return new VelocityGrid<Position>(container, options);
}
```

- [ ] **Step 3: Wire `main.ts`**

`apps/cgrid-positions/src/main.ts`:
```typescript
import { createPositionsGrid } from './positionsGrid';
import { connectStomp } from './stomp';

const host = document.getElementById('grid');
if (!host) throw new Error('grid host not found');

const grid = createPositionsGrid(host);

grid.on('gridReady', () => {
  console.log('[cgrid] ready');
  connectStomp({
    onSnapshot: (rows) => grid.setRowData(rows),
    onLiveUpdate: (updates) => grid.applyTransactionAsync({ update: updates }),
    onPhase: (phase) => console.log('[stomp] phase:', phase),
  });
});

grid.on('modelUpdated', (e) => console.log('[cgrid] modelUpdated, visible:', e.visibleRowCount));

document.getElementById('theme')?.addEventListener('click', () => {
  host.classList.toggle('vg-theme-quartz');
  host.classList.toggle('vg-theme-quartz-dark');
  grid.refresh();
});
```

- [ ] **Step 4: Run and verify the demo end-to-end**

```bash
cd /Users/develop/wfh/canvasgrid
npm install
npm run dev:positions
```
- Open http://localhost:5175.
- Confirm the page loads, the worker boots, the STOMP snapshot fills the grid, and live ticks update the visible rows without freezing the UI.
- Toggle theme; confirm colors flip.
- Stop the server.

- [ ] **Step 5: Commit**

```bash
git add apps/cgrid-positions/
git commit -m "feat(demo): wire cgrid-positions to STOMP feed via vanilla-ts VelocityGrid API"
```

---

### Task 27: Definition-of-Done verification + Foundation README

**Files:**
- Create: `docs/superpowers/reports/2026-06-23-canvasgrid-foundation-dod.md` (DoD checklist + perf measurements)
- Modify: `cgrid/README.md` (real API quickstart + link to spec)
- Verification only — no test code beyond what's already in the workspace.

**Interfaces:**
- Consumes: everything from Tasks 1–26.
- Produces: a single report file documenting the Foundation DoD outcome.

- [ ] **Step 1: Run the full workspace verification**

```bash
cd /Users/develop/wfh/canvasgrid
npm run typecheck
npm run test:cgrid
npm run build:cgrid
```
Expected: typecheck clean across workspaces; vitest reports all tests passing; `cgrid/dist/` artifacts present.

- [ ] **Step 2: Manual demo verification**

In one terminal:
```bash
npm run dev:positions
```
In the browser (http://localhost:5175):
1. Confirm grid paints the 3000-row snapshot in under 1.5 seconds.
2. Confirm live ticks land and `enableCellChangeFlash` highlight is visible.
3. Confirm scrolling stays smooth (visual check; record any frame drops).
4. Confirm row clicks update focus + selection; arrow keys move focus.
5. Confirm theme toggle switches colors.

Record observations in the report file.

- [ ] **Step 3: a11y check with axe-core**

```bash
cd apps/cgrid-positions
npx @axe-core/cli http://localhost:5175 --tags=wcag2a,wcag2aa 2>&1 | tee axe-report.txt
```
Capture any Critical violations; if any concern the cgrid grid host, file them as follow-up issues (do not block this task unless blocking).

- [ ] **Step 4: Update `cgrid/README.md` with real quickstart**

```markdown
# cgrid

A vanilla-TypeScript canvas-based grid library. No framework dependencies.

## Install

```bash
npm install cgrid
```

## Quickstart

```typescript
import { VelocityGrid } from 'cgrid';

const grid = new VelocityGrid<{ id: string; name: string; value: number }>(
  document.getElementById('grid')!,
  {
    columnDefs: [
      { field: 'id',    headerName: 'ID',    pinned: 'left', width: 100 },
      { field: 'name',  headerName: 'Name',  flex: 1 },
      { field: 'value', headerName: 'Value', type: 'number', width: 120, aggFunc: 'sum' },
    ],
    getRowId: (row) => row.id,
    rowSelection: 'multiple',
    theme: 'vg-theme-quartz',
  },
);

grid.on('gridReady', () => {
  grid.setRowData([{ id: 'a', name: 'Apple', value: 12.5 }]);
});

grid.on('cellClicked', (e) => console.log(e));
```

## Status

Foundation cycle complete. See:
- `docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md`
- `docs/superpowers/plans/2026-06-23-canvasgrid-foundation.md`
- `docs/superpowers/reports/2026-06-23-canvasgrid-foundation-dod.md`

Filtering UI, grouping, master/detail, charts, SSRM, and other feature parity
land in subsequent cycles (catalog areas 08, 09, 11, 13, 14, 15, 17, 18, 19,
24, 25). See spec §15.
```

- [ ] **Step 5: Write the DoD report**

`docs/superpowers/reports/2026-06-23-canvasgrid-foundation-dod.md`:

Use the template:
```markdown
# Canvasgrid Foundation — Definition of Done Report

**Date:** 2026-06-23
**Spec:** docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md
**Plan:** docs/superpowers/plans/2026-06-23-canvasgrid-foundation.md

## Spec §13 acceptance criteria

1. Repo restructured to npm workspaces: ✅ / ❌ — note any deviations
2. cgrid builds cleanly (tsc + vite): ✅ / ❌
3. Demo runs and stays at 60 fps under streaming load: ✅ / ❌ — include measurement method
4. CSRM sort + filter (text/number) + sum/avg agg reflect in viewport: ✅ / ❌
5. Single + multi row selection + Shift+click range: ✅ / ❌
6. Text + number editors via double-click and F2: ✅ / ❌
7. axe-core: no Critical issues on demo page: ✅ / ❌ — attach summary
8. Theme switch Quartz Light ↔ Quartz Dark: ✅ / ❌
9. Catalog Canvas-port implications coverage (01, 02, 03 CSRM, 04, 05, 07, 10 basic, 12 row+focus, 20 a11y, 21 themes): ✅ / ❌
10. cgrid/README + apps/cgrid-positions/README present: ✅ / ❌

## Risks observed

(Per spec §14: text rendering perf, worker bandwidth, a11y patterns. Document
what was actually observed.)

## Carried forward to follow-up cycles

(Items from spec §2 out-of-scope plus anything observed in this cycle that
needs a future cycle.)

## Commits

`git log --oneline | head -30` (run and paste).
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-06-23-canvasgrid-foundation-dod.md cgrid/README.md
git commit -m "docs(cgrid): Foundation DoD report + README quickstart"
```

- [ ] **Step 7: Push (when ready to publish the cycle)**

```bash
git push origin main
```

---

## Self-review pass

- **Spec coverage:**
  - §1 motivation / §2 scope — Tasks 1–26 build everything in-scope; Task 27 confirms DoD.
  - §3 sources — every implementation references its catalog area in commit messages and code comments.
  - §4 architecture overview — Tasks 13 + 19 + 24 wire the three contexts (main, DOM overlays, worker).
  - §5 repo layout — Task 1.
  - §6 render engine — Tasks 16 (paint loop), 17 (cell renderers), 18 (painters), 19 (renderer).
  - §7 worker data pipeline — Tasks 7 (store), 8 (filter), 9 (sort), 10 (agg), 11 (slicer + chunk), 12 (entry).
  - §8 RPC protocol — Task 6 + Task 13.
  - §9 object model — Task 3.
  - §10 public class — Task 24.
  - §11 theming — Task 14.
  - §12 demo — Tasks 25 + 26.
  - §13 DoD — Task 27.
- **Placeholder scan:** "Foundation: deferred" / "out of scope for Foundation" appears in several APIs — these are intentional and match spec §2. No `TODO`/`TBD`. The `inferRowIdField` regex is a documented Foundation limitation per spec §14 risks; later cycles replace it.
- **Type consistency:** `ResolvedColDef` (Task 5) is the single resolved-column type across Tasks 15, 18, 22, 24. `WorkerColumn` (Task 6) is the worker-side projection used in Tasks 7–13 and constructed by Task 24's `workerColumns()`. `ViewportState` (Task 15) is consumed by Tasks 18, 19, 24. `CellPainter`/`CellPaintParams` (Task 17) used in Tasks 18, 19. `SelectionState` (Task 20) used in Tasks 18, 21, 23, 24. Names + signatures match across tasks.

