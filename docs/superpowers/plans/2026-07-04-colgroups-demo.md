# AG-Grid Column Grouping Showcase (`apps/colgroups`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone dark-theme React + AG-Grid demo app that showcases every column-grouping permutation in one kitchen-sink grid over synthetic financial-positions data.

**Architecture:** Vite + React 19 app under `apps/colgroups`, mirroring `apps/showcase`. Pure data + column-definition modules (unit-tested with vitest) feed a single `<AgGridReact>` themed via the AG-Grid 35 Theming API (`themeQuartz.withParams`, dark). A thin page shell adds a legend and expand/collapse-all controls. Browser behavior is verified with Playwright.

**Tech Stack:** React 19, Vite 7, TypeScript ~5.9, `ag-grid-react`/`ag-grid-community` 35.3.1 (Community modules only — no enterprise license), vitest, `@playwright/test`.

## Global Constraints

- AG-Grid version pinned to **35.3.1** (match `apps/showcase`); use the **Theming API only** — no legacy `.css` theme imports.
- **Community modules only.** Register `AllCommunityModule`. `columnGroupShow`, `openByDefault`, `marryChildren` are all Community features — do NOT add `ag-grid-enterprise` and do NOT call `LicenseManager`.
- Dark theme is mandatory: `browserColorScheme: 'dark'`. Reuse the `quartzDark` params (accent `#2dd4bf`, background `#1a1f2e`, foreground `#e2e8f0`, header `#0f1320`).
- Vite dev server on **port 5175**. Playwright `baseURL` must match.
- Workspace name: `colgroups`. Add `"dev:colgroups"` to root `package.json`.
- `type: "module"` in the app `package.json` (ESM, matching the repo).

---

### Task 1: Scaffold the app — dark-themed empty grid boots

**Files:**
- Create: `apps/colgroups/package.json`
- Create: `apps/colgroups/index.html`
- Create: `apps/colgroups/vite.config.ts`
- Create: `apps/colgroups/tsconfig.json`
- Create: `apps/colgroups/tsconfig.node.json`
- Create: `apps/colgroups/src/vite-env.d.ts`
- Create: `apps/colgroups/src/agGridSetup.ts`
- Create: `apps/colgroups/src/theme.ts`
- Create: `apps/colgroups/src/main.tsx`
- Create: `apps/colgroups/src/App.tsx` (temporary minimal version — replaced in Task 4)
- Create: `apps/colgroups/src/styles.css`
- Modify: root `package.json` (add `dev:colgroups` script)

**Interfaces:**
- Produces: `darkTheme` (exported from `src/theme.ts`) — an AG-Grid `Theme` object consumed by `App.tsx`.
- Produces: a running dev server on `http://localhost:5175` serving a full-height `<AgGridReact>` with `theme={darkTheme}`.

- [ ] **Step 1: Create `apps/colgroups/package.json`**

```json
{
  "name": "colgroups",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "ag-grid-community": "35.3.1",
    "ag-grid-react": "35.3.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.5.2",
    "typescript": "~5.9.3",
    "vite": "^7.3.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `apps/colgroups/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Column Grouping · AG Grid Showcase</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `apps/colgroups/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    open: true,
  },
});
```

- [ ] **Step 4: Create `apps/colgroups/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "e2e", "vite.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Create `apps/colgroups/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Create `apps/colgroups/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create `apps/colgroups/src/agGridSetup.ts`**

```ts
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);
```

- [ ] **Step 8: Create `apps/colgroups/src/theme.ts`**

```ts
import { themeQuartz } from 'ag-grid-community';

// Dark theme — reuses the proven quartzDark params from apps/showcase.
export const darkTheme = themeQuartz.withParams(
  {
    accentColor: '#2dd4bf',
    backgroundColor: '#1a1f2e',
    foregroundColor: '#e2e8f0',
    browserColorScheme: 'dark',
    columnBorder: true,
    fontFamily: { googleFont: 'Inter' },
    fontSize: 13,
    headerBackgroundColor: '#0f1320',
    headerFontFamily: { googleFont: 'Inter' },
    headerFontSize: 13,
    headerFontWeight: 600,
    oddRowBackgroundColor: '#1e2436',
    spacing: 6,
    wrapperBorderRadius: 6,
  },
  'dark',
);
```

- [ ] **Step 9: Create temporary `apps/colgroups/src/App.tsx`**

```tsx
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { darkTheme } from './theme';

const cols: ColDef[] = [{ field: 'placeholder', headerName: 'Placeholder' }];

export function App() {
  return (
    <div className="page">
      <div className="grid-wrap" data-testid="grid-wrap">
        <AgGridReact theme={darkTheme} columnDefs={cols} rowData={[]} />
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Create `apps/colgroups/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './agGridSetup';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 11: Create `apps/colgroups/src/styles.css`** (dark page chrome; grid itself is themed by the API)

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: Inter, system-ui, -apple-system, sans-serif;
  background: #0b0e17;
  color: #e2e8f0;
}

.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
  padding: 16px;
}

.grid-wrap {
  flex: 1 1 auto;
  min-height: 0;
}
```

- [ ] **Step 12: Add root script.** In root `package.json`, inside `"scripts"`, add after `"dev:positions"`:

```json
    "dev:colgroups": "npm run dev --workspace=colgroups",
```

- [ ] **Step 13: Install workspace deps**

Run: `npm install`
Expected: completes without error; `apps/colgroups/node_modules` (or hoisted) resolves `ag-grid-react`.

- [ ] **Step 14: Typecheck**

Run: `npm run typecheck --workspace=colgroups`
Expected: PASS (no errors).

- [ ] **Step 15: Smoke-boot the dev server**

Run: `npm run dev --workspace=colgroups -- --port 5175 &` then `curl -sSf http://localhost:5175 | grep -q '<div id="root">' && echo OK`; then kill the dev server.
Expected: `OK`.

- [ ] **Step 16: Commit**

```bash
git add apps/colgroups package.json package-lock.json
git commit -m "feat(colgroups): scaffold dark-theme AG-Grid app shell"
```

---

### Task 2: Synthetic positions data module

**Files:**
- Create: `apps/colgroups/src/data.ts`
- Create: `apps/colgroups/src/data.test.ts`

**Interfaces:**
- Produces: `interface PositionRow` with fields: `positionId: string; instrument: string; cusip: string; assetClass: string; book: string; desk: string; trader: string; region: string; price: number; mtm: number; prevClose: number; currency: string; notional: number; marketValue: number; dayPnl: number; mtdPnl: number; ytdPnl: number; dv01: number; cr01: number; duration: number; grossExp: number; netExp: number; delta: number; gamma: number; vega: number; theta: number; sector: string; rating: string; maturity: string; updatedAt: string;`
- Produces: `function makeRows(count?: number): PositionRow[]` — deterministic (seeded), default `count = 200`.
- Produces formatter helpers: `fmtCcy(p)`, `fmtNum(p)`, `fmtBp(p)`, `fmtSignedCcy(p)` — each takes an AG-Grid `ValueFormatterParams` and returns `string`.

- [ ] **Step 1: Write the failing test** — `apps/colgroups/src/data.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeRows, fmtCcy, fmtBp, fmtSignedCcy } from './data';

describe('makeRows', () => {
  it('returns the requested number of fully-populated rows', () => {
    const rows = makeRows(50);
    expect(rows).toHaveLength(50);
    for (const r of rows) {
      expect(typeof r.positionId).toBe('string');
      expect(r.positionId.length).toBeGreaterThan(0);
      expect(typeof r.dayPnl).toBe('number');
      expect(typeof r.delta).toBe('number');
      expect(r.maturity).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is deterministic (seeded)', () => {
    expect(makeRows(10)).toEqual(makeRows(10));
  });

  it('defaults to 200 rows', () => {
    expect(makeRows()).toHaveLength(200);
  });
});

describe('formatters', () => {
  it('formats currency with a $ and thousands separators', () => {
    expect(fmtCcy({ value: 1234567 } as never)).toBe('$1,234,567');
  });
  it('formats basis points', () => {
    expect(fmtBp({ value: 12.5 } as never)).toBe('12.50 bp');
  });
  it('formats signed currency with sign', () => {
    expect(fmtSignedCcy({ value: -2100 } as never)).toBe('-$2,100');
    expect(fmtSignedCcy({ value: 3400 } as never)).toBe('+$3,400');
  });
  it('renders empty string for nullish values', () => {
    expect(fmtCcy({ value: null } as never)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit --workspace=colgroups -- data.test.ts`
Expected: FAIL — cannot resolve `./data`.

- [ ] **Step 3: Write `apps/colgroups/src/data.ts`**

```ts
import type { ValueFormatterParams } from 'ag-grid-community';

export interface PositionRow {
  positionId: string;
  instrument: string;
  cusip: string;
  assetClass: string;
  book: string;
  desk: string;
  trader: string;
  region: string;
  price: number;
  mtm: number;
  prevClose: number;
  currency: string;
  notional: number;
  marketValue: number;
  dayPnl: number;
  mtdPnl: number;
  ytdPnl: number;
  dv01: number;
  cr01: number;
  duration: number;
  grossExp: number;
  netExp: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  sector: string;
  rating: string;
  maturity: string;
  updatedAt: string;
}

// Small deterministic PRNG (mulberry32) so demo data is stable across renders.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INSTRUMENTS = ['UST 10Y', 'UST 2Y', 'BUND 10Y', 'GILT 30Y', 'AAPL', 'MSFT', 'JPM 5Y CDS', 'XOM', 'IG CDX', 'HY CDX'];
const ASSET = ['Rates', 'Credit', 'Equity', 'Equity', 'Credit'];
const BOOKS = ['RATES-1', 'RATES-2', 'CREDIT-1', 'EQ-US', 'EQ-EU'];
const DESKS = ['Govvies', 'Flow Credit', 'Cash Equity', 'Index'];
const TRADERS = ['A. Rao', 'J. Diaz', 'M. Chen', 'S. Patel', 'L. Weber'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CCY = ['USD', 'EUR', 'GBP'];
const SECTORS = ['Government', 'Financials', 'Technology', 'Energy', 'Index'];
const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB'];

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

export function makeRows(count = 200): PositionRow[] {
  const r = rng(0xc0ffee);
  const rows: PositionRow[] = [];
  for (let i = 0; i < count; i++) {
    const price = 80 + r() * 60;
    const notional = Math.round((0.5 + r() * 9.5) * 1_000_000);
    const dayPnl = Math.round((r() - 0.45) * 60_000);
    const mv = Math.round(notional * (price / 100));
    const year = 2026 + Math.floor(r() * 10);
    const month = String(1 + Math.floor(r() * 12)).padStart(2, '0');
    const day = String(1 + Math.floor(r() * 28)).padStart(2, '0');
    rows.push({
      positionId: `POS-${String(1000 + i)}`,
      instrument: pick(INSTRUMENTS, r),
      cusip: `${Math.floor(r() * 900000000 + 100000000)}`,
      assetClass: pick(ASSET, r),
      book: pick(BOOKS, r),
      desk: pick(DESKS, r),
      trader: pick(TRADERS, r),
      region: pick(REGIONS, r),
      price: Number(price.toFixed(2)),
      mtm: Number((price + (r() - 0.5) * 1.5).toFixed(2)),
      prevClose: Number((price + (r() - 0.5) * 2).toFixed(2)),
      currency: pick(CCY, r),
      notional,
      marketValue: mv,
      dayPnl,
      mtdPnl: Math.round(dayPnl * (2 + r() * 8)),
      ytdPnl: Math.round(dayPnl * (5 + r() * 30)),
      dv01: Number((r() * 5000).toFixed(0)),
      cr01: Number((r() * 3000).toFixed(0)),
      duration: Number((r() * 12).toFixed(2)),
      grossExp: Math.round(notional * (0.9 + r() * 0.2)),
      netExp: Math.round(notional * (r() - 0.5) * 1.5),
      delta: Number((r() * 2 - 1).toFixed(3)),
      gamma: Number((r() * 0.5).toFixed(3)),
      vega: Number((r() * 1000).toFixed(0)),
      theta: Number((-r() * 500).toFixed(0)),
      sector: pick(SECTORS, r),
      rating: pick(RATINGS, r),
      maturity: `${year}-${month}-${day}`,
      updatedAt: `2026-07-04T${String(9 + Math.floor(r() * 8)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
    });
  }
  return rows;
}

function num(p: ValueFormatterParams): number | null {
  return p.value == null || Number.isNaN(Number(p.value)) ? null : Number(p.value);
}

export function fmtCcy(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : `$${Math.round(v).toLocaleString('en-US')}`;
}

export function fmtSignedCcy(p: ValueFormatterParams): string {
  const v = num(p);
  if (v == null) return '';
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
}

export function fmtNum(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : v.toLocaleString('en-US');
}

export function fmtBp(p: ValueFormatterParams): string {
  const v = num(p);
  return v == null ? '' : `${v.toFixed(2)} bp`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit --workspace=colgroups -- data.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/colgroups/src/data.ts apps/colgroups/src/data.test.ts
git commit -m "feat(colgroups): synthetic positions data + value formatters"
```

---

### Task 3: Column definitions — all 7 grouping structures

**Files:**
- Create: `apps/colgroups/src/columnDefs.ts`
- Create: `apps/colgroups/src/columnDefs.test.ts`

**Interfaces:**
- Consumes: `PositionRow`, `fmtCcy`, `fmtSignedCcy`, `fmtNum`, `fmtBp` from `./data`.
- Produces: `columnDefs: (ColDef<PositionRow> | ColGroupDef<PositionRow>)[]` — the full definition array.
- Produces: `defaultColDef: ColDef<PositionRow>` (`sortable`, `resizable`, `filter`, `minWidth: 90`).
- Produces: `GROUP_IDS: string[]` — the `groupId`s of every top-level group, in order, used by the expand/collapse-all controls: `['grp-instrument','grp-coverage','grp-valuation','grp-pnl','grp-risk','grp-metadata']`. (The `Position ID` column is not a group and is not listed.)

**Structures to encode (from the spec):**
1. `positionId` — plain column, `pinned: 'left'`, no group.
2. `grp-instrument` — group, children instrument/cusip/assetClass all always-visible (no `columnGroupShow`), no `openByDefault` → not expandable.
3. `grp-coverage` — group `openByDefault: false`; book (always), desk (`open`), trader (`open`), region (`closed`).
4. `grp-valuation` — group `openByDefault: true`; price (always), mtm (`open`), currency (`open`), prevClose (`closed`).
5. `grp-pnl` — group; marketValue (always), dayPnl/mtdPnl/ytdPnl (all `open`).
6. `grp-risk` — group `marryChildren: true`; **mixed** leaf fields + nested sub-groups, each with its own state: dv01 (always), cr01 (`open`), duration (`closed`), sub-group `grp-exposure` (always) [grossExp, netExp], sub-group `grp-greeks` (`open`) [delta, gamma, vega, theta], sub-group `grp-scenario` (`closed`) [up100bp, down100bp].
7. `grp-metadata` — group `marryChildren: true`; sector/rating/maturity/updatedAt all always-visible.

- [ ] **Step 1: Write the failing test** — `apps/colgroups/src/columnDefs.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import { columnDefs, GROUP_IDS } from './columnDefs';

type AnyCol = ColDef | ColGroupDef;
const isGroup = (c: AnyCol): c is ColGroupDef => 'children' in c;
const groupById = (id: string): ColGroupDef => {
  const g = columnDefs.find((c) => isGroup(c) && c.groupId === id);
  if (!g || !isGroup(g)) throw new Error(`group ${id} not found`);
  return g;
};
const leaf = (g: ColGroupDef, field: string): ColDef => {
  const c = (g.children as AnyCol[]).find((x) => !isGroup(x) && (x as ColDef).field === field);
  if (!c) throw new Error(`leaf ${field} not found in ${g.groupId}`);
  return c as ColDef;
};

describe('columnDefs structure', () => {
  it('has a flat pinned Position ID column with no group', () => {
    const idCol = columnDefs.find((c) => !isGroup(c) && (c as ColDef).field === 'positionId') as ColDef;
    expect(idCol).toBeTruthy();
    expect(idCol.pinned).toBe('left');
  });

  it('GROUP_IDS lists all six top-level groups in order', () => {
    expect(GROUP_IDS).toEqual([
      'grp-instrument',
      'grp-coverage',
      'grp-valuation',
      'grp-pnl',
      'grp-risk',
      'grp-metadata',
    ]);
  });

  it('Instrument group is fields-only and not open-by-default (no caret)', () => {
    const g = groupById('grp-instrument');
    expect(g.openByDefault).toBeUndefined();
    for (const child of g.children as ColDef[]) {
      expect((child as ColDef).columnGroupShow).toBeUndefined();
    }
  });

  it('Coverage group is closed by default with always/open/closed leaves', () => {
    const g = groupById('grp-coverage');
    expect(g.openByDefault).toBe(false);
    expect(leaf(g, 'book').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'desk').columnGroupShow).toBe('open');
    expect(leaf(g, 'trader').columnGroupShow).toBe('open');
    expect(leaf(g, 'region').columnGroupShow).toBe('closed');
  });

  it('Valuation group is open by default', () => {
    const g = groupById('grp-valuation');
    expect(g.openByDefault).toBe(true);
    expect(leaf(g, 'price').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'mtm').columnGroupShow).toBe('open');
    expect(leaf(g, 'prevClose').columnGroupShow).toBe('closed');
  });

  it('P&L group reveals the three pnl columns only when open', () => {
    const g = groupById('grp-pnl');
    expect(leaf(g, 'marketValue').columnGroupShow).toBeUndefined();
    for (const f of ['dayPnl', 'mtdPnl', 'ytdPnl']) {
      expect(leaf(g, f).columnGroupShow).toBe('open');
    }
  });

  it('Risk group mixes leaf fields AND nested sub-groups, each with a state', () => {
    const g = groupById('grp-risk');
    expect(g.marryChildren).toBe(true);
    // leaf fields in three states
    expect(leaf(g, 'dv01').columnGroupShow).toBeUndefined();
    expect(leaf(g, 'cr01').columnGroupShow).toBe('open');
    expect(leaf(g, 'duration').columnGroupShow).toBe('closed');
    // nested sub-groups in three states
    const subs = (g.children as AnyCol[]).filter(isGroup) as ColGroupDef[];
    const byId = (id: string) => subs.find((s) => s.groupId === id)!;
    expect(byId('grp-exposure').columnGroupShow).toBeUndefined();
    expect(byId('grp-greeks').columnGroupShow).toBe('open');
    expect(byId('grp-scenario').columnGroupShow).toBe('closed');
    // sub-group leaves exist
    expect((byId('grp-greeks').children as ColDef[]).map((c) => c.field)).toEqual(
      ['delta', 'gamma', 'vega', 'theta'],
    );
  });

  it('Metadata group marries its always-visible children', () => {
    const g = groupById('grp-metadata');
    expect(g.marryChildren).toBe(true);
    for (const child of g.children as ColDef[]) {
      expect((child as ColDef).columnGroupShow).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit --workspace=colgroups -- columnDefs.test.ts`
Expected: FAIL — cannot resolve `./columnDefs`.

- [ ] **Step 3: Write `apps/colgroups/src/columnDefs.ts`**

```ts
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import type { PositionRow } from './data';
import { fmtBp, fmtCcy, fmtNum, fmtSignedCcy } from './data';

type Col = ColDef<PositionRow>;
type Group = ColGroupDef<PositionRow>;

export const defaultColDef: Col = {
  sortable: true,
  resizable: true,
  filter: true,
  minWidth: 90,
};

// Red/green P&L coloring for the dark grid.
const pnlCellStyle = (p: { value: number | null }) =>
  p.value == null
    ? null
    : { color: p.value >= 0 ? '#34d399' : '#f87171', fontWeight: 500 };

export const columnDefs: (Col | Group)[] = [
  // 1 — flat pinned column, no group
  { field: 'positionId', headerName: 'Position ID', pinned: 'left', width: 130 },

  // 2 — fields-only group, not expandable (no columnGroupShow, no openByDefault)
  {
    groupId: 'grp-instrument',
    headerName: 'Instrument',
    children: [
      { field: 'instrument', headerName: 'Name', width: 130 },
      { field: 'cusip', headerName: 'CUSIP', width: 120 },
      { field: 'assetClass', headerName: 'Asset Class', width: 120 },
    ],
  },

  // 3 — expandable, CLOSED by default; always / open / closed leaves
  {
    groupId: 'grp-coverage',
    headerName: 'Book & Coverage',
    openByDefault: false,
    children: [
      { field: 'book', headerName: 'Book', width: 110 },
      { field: 'desk', headerName: 'Desk', width: 120, columnGroupShow: 'open' },
      { field: 'trader', headerName: 'Trader', width: 110, columnGroupShow: 'open' },
      { field: 'region', headerName: 'Region', width: 100, columnGroupShow: 'closed' },
    ],
  },

  // 4 — expandable, OPEN by default
  {
    groupId: 'grp-valuation',
    headerName: 'Valuation',
    openByDefault: true,
    children: [
      { field: 'price', headerName: 'Price', width: 100, type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'mtm', headerName: 'MTM', width: 100, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'open' },
      { field: 'currency', headerName: 'Ccy', width: 80, columnGroupShow: 'open' },
      { field: 'prevClose', headerName: 'Prev Close', width: 110, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'closed' },
    ],
  },

  // 5 — reveals extra columns only when opened
  {
    groupId: 'grp-pnl',
    headerName: 'P&L',
    children: [
      { field: 'marketValue', headerName: 'Market Value', width: 140, type: 'numericColumn', valueFormatter: fmtCcy },
      { field: 'dayPnl', headerName: 'Day P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
      { field: 'mtdPnl', headerName: 'MTD P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
      { field: 'ytdPnl', headerName: 'YTD P&L', width: 120, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle, columnGroupShow: 'open' },
    ],
  },

  // 6 — CENTERPIECE: mixed leaf fields + nested sub-groups, each in its own state
  {
    groupId: 'grp-risk',
    headerName: 'Risk & Analytics',
    marryChildren: true,
    children: [
      // leaf fields — always / open / closed
      { field: 'dv01', headerName: 'DV01', width: 100, type: 'numericColumn', valueFormatter: fmtNum },
      { field: 'cr01', headerName: 'CR01', width: 100, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'open' },
      { field: 'duration', headerName: 'Duration', width: 110, type: 'numericColumn', valueFormatter: fmtNum, columnGroupShow: 'closed' },
      // nested sub-group — always visible
      {
        groupId: 'grp-exposure',
        headerName: 'Exposure',
        children: [
          { field: 'grossExp', headerName: 'Gross', width: 130, type: 'numericColumn', valueFormatter: fmtCcy },
          { field: 'netExp', headerName: 'Net', width: 130, type: 'numericColumn', valueFormatter: fmtSignedCcy, cellStyle: pnlCellStyle },
        ],
      },
      // nested sub-group — only when parent OPEN
      {
        groupId: 'grp-greeks',
        headerName: 'Greeks',
        columnGroupShow: 'open',
        children: [
          { field: 'delta', headerName: 'Δ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'gamma', headerName: 'Γ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'vega', headerName: 'ν', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
          { field: 'theta', headerName: 'Θ', width: 90, type: 'numericColumn', valueFormatter: fmtNum },
        ],
      },
      // nested sub-group — only when parent CLOSED
      {
        groupId: 'grp-scenario',
        headerName: 'Scenario',
        columnGroupShow: 'closed',
        children: [
          { field: 'up100bp', headerName: '+100bp', width: 100, type: 'numericColumn', valueFormatter: fmtBp },
          { field: 'down100bp', headerName: '-100bp', width: 100, type: 'numericColumn', valueFormatter: fmtBp },
        ],
      },
    ],
  },

  // 7 — fields-only group, married together
  {
    groupId: 'grp-metadata',
    headerName: 'Metadata',
    marryChildren: true,
    children: [
      { field: 'sector', headerName: 'Sector', width: 130 },
      { field: 'rating', headerName: 'Rating', width: 90 },
      { field: 'maturity', headerName: 'Maturity', width: 120 },
      { field: 'updatedAt', headerName: 'Updated', width: 140 },
    ],
  },
];

export const GROUP_IDS = [
  'grp-instrument',
  'grp-coverage',
  'grp-valuation',
  'grp-pnl',
  'grp-risk',
  'grp-metadata',
];
```

> Note: the test references `up100bp`/`down100bp` and Task 2's `PositionRow` does not declare them. Add `up100bp: number;` and `down100bp: number;` to `PositionRow` in `data.ts`, and in `makeRows` set `up100bp: Number((r() * 40 - 20).toFixed(2)), down100bp: Number((r() * 40 - 20).toFixed(2)),`. Do this as part of Step 3 (edit `data.ts`), then re-run Task 2's test to confirm it still passes.

- [ ] **Step 4: Update `data.ts`** — add the two scenario fields to `PositionRow` and `makeRows` (see note above), then run:

Run: `npm run test:unit --workspace=colgroups -- data.test.ts`
Expected: PASS (still green).

- [ ] **Step 5: Run column-def tests to verify they pass**

Run: `npm run test:unit --workspace=colgroups -- columnDefs.test.ts`
Expected: PASS (all structural assertions green).

- [ ] **Step 6: Commit**

```bash
git add apps/colgroups/src/columnDefs.ts apps/colgroups/src/columnDefs.test.ts apps/colgroups/src/data.ts
git commit -m "feat(colgroups): column definitions for all 7 grouping structures"
```

---

### Task 4: Full page shell — legend, expand/collapse-all, wired grid

**Files:**
- Modify: `apps/colgroups/src/App.tsx` (replace the temporary version)
- Modify: `apps/colgroups/src/styles.css` (add header / legend / toolbar chrome)

**Interfaces:**
- Consumes: `columnDefs`, `defaultColDef`, `GROUP_IDS` from `./columnDefs`; `makeRows`, `PositionRow` from `./data`; `darkTheme` from `./theme`.
- Produces: rendered DOM test hooks — `data-testid="btn-expand-all"`, `data-testid="btn-collapse-all"`, `data-testid="grid-wrap"`, and `role="grid"` (from AG-Grid).

- [ ] **Step 1: Replace `apps/colgroups/src/App.tsx`**

```tsx
import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi, GridReadyEvent } from 'ag-grid-community';
import { darkTheme } from './theme';
import { columnDefs, defaultColDef, GROUP_IDS } from './columnDefs';
import { makeRows, type PositionRow } from './data';

export function App() {
  const apiRef = useRef<GridApi<PositionRow> | null>(null);
  const rowData = useMemo(() => makeRows(200), []);

  const onGridReady = useCallback((e: GridReadyEvent<PositionRow>) => {
    apiRef.current = e.api;
  }, []);

  const setAll = useCallback((open: boolean) => {
    const api = apiRef.current;
    if (!api) return;
    for (const id of GROUP_IDS) {
      api.setColumnGroupOpened(id, open);
    }
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1>AG-Grid Column Grouping</h1>
          <p>
            One grid, every grouping permutation — flat columns, fields-only groups, always /
            open / closed children, open-by-default, nested sub-groups, and married groups.
          </p>
        </div>
        <div className="toolbar">
          <button type="button" data-testid="btn-expand-all" onClick={() => setAll(true)}>
            Expand all groups
          </button>
          <button type="button" data-testid="btn-collapse-all" onClick={() => setAll(false)}>
            Collapse all groups
          </button>
        </div>
      </header>

      <div className="legend">
        <span className="chip chip-always">Always visible</span>
        <span className="chip chip-open">Shows when open ▸</span>
        <span className="chip chip-closed">Shows when closed ◂</span>
        <span className="legend-note">Groups #3 (closed) &amp; #4 (open) differ by <code>openByDefault</code>. Group #6 “Risk &amp; Analytics” mixes leaf fields and nested sub-groups, each in its own state.</span>
      </div>

      <div className="grid-wrap" data-testid="grid-wrap">
        <AgGridReact<PositionRow>
          theme={darkTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rowData}
          onGridReady={onGridReady}
          getRowId={(p) => p.data.positionId}
          suppressDragLeaveHidesColumns
          animateRows={false}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append chrome to `apps/colgroups/src/styles.css`**

```css
.masthead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.masthead h1 {
  margin: 0 0 4px;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.masthead p {
  margin: 0;
  max-width: 62ch;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: #94a3b8;
}

.toolbar {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar button {
  border: 1px solid #2b3348;
  background: #161b2b;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 7px 13px;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.toolbar button:hover {
  background: #1e2436;
  border-color: #2dd4bf;
}

.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-weight: 500;
  border: 1px solid transparent;
}

.chip-always {
  background: rgb(45 212 191 / 12%);
  color: #2dd4bf;
  border-color: rgb(45 212 191 / 30%);
}

.chip-open {
  background: rgb(129 140 248 / 12%);
  color: #a5b4fc;
  border-color: rgb(129 140 248 / 30%);
}

.chip-closed {
  background: rgb(251 146 60 / 12%);
  color: #fdba74;
  border-color: rgb(251 146 60 / 30%);
}

.legend-note code {
  background: #161b2b;
  border: 1px solid #2b3348;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.72rem;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=colgroups`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build --workspace=colgroups`
Expected: `tsc -b` clean, `vite build` writes `dist/` with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/colgroups/src/App.tsx apps/colgroups/src/styles.css
git commit -m "feat(colgroups): page shell with legend and expand/collapse-all controls"
```

---

### Task 5: Playwright E2E — verify grouping behavior in the browser

**Files:**
- Create: `apps/colgroups/playwright.config.ts`
- Create: `apps/colgroups/e2e/colgroups.spec.ts`

**Interfaces:**
- Consumes: the running app on `http://localhost:5175`; DOM hooks from Task 4 and AG-Grid header-group DOM (`.ag-header-group-cell[col-id="..."]`, header cells with `col-id`).
- Produces: a passing Playwright suite that is the UI acceptance gate (per repo's "E2E required for UI features" bar).

- [ ] **Step 1: Create `apps/colgroups/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  webServer: {
    command: 'npm run dev -- --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
    viewport: { width: 1500, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

- [ ] **Step 2: Write the E2E spec** — `apps/colgroups/e2e/colgroups.spec.ts`

```ts
import { test, expect } from '@playwright/test';

// AG-Grid renders a header cell for a leaf column as
// [role="columnheader"][col-id="<field>"]; a group header is
// .ag-header-group-cell with an aria-label containing the group name.
const leaf = (field: string) => `[role="columnheader"][col-id="${field}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="grid"]')).toBeVisible();
  // wait for at least one data row
  await expect(page.locator('[role="row"][row-index="0"]')).toBeVisible();
});

test('renders in dark theme', async ({ page }) => {
  const scheme = await page.evaluate(() => {
    const el = document.querySelector('.ag-root-wrapper') as HTMLElement;
    return getComputedStyle(el).colorScheme;
  });
  expect(scheme).toContain('dark');
});

test('Position ID is present and pinned left', async ({ page }) => {
  await expect(page.locator(leaf('positionId'))).toBeVisible();
  const pinnedLeft = page.locator('.ag-pinned-left-header ' + leaf('positionId'));
  await expect(pinnedLeft).toHaveCount(1);
});

test('Instrument group shows all three fields and has no expand caret', async ({ page }) => {
  await expect(page.locator(leaf('instrument'))).toBeVisible();
  await expect(page.locator(leaf('cusip'))).toBeVisible();
  await expect(page.locator(leaf('assetClass'))).toBeVisible();
  const group = page.locator('.ag-header-group-cell', { hasText: 'Instrument' });
  await expect(group.locator('.ag-header-expand-icon')).toHaveCount(0);
});

test('Book & Coverage group is CLOSED by default (region hidden, book shown)', async ({ page }) => {
  await expect(page.locator(leaf('book'))).toBeVisible();
  await expect(page.locator(leaf('region'))).toHaveCount(0);
  await expect(page.locator(leaf('desk'))).toHaveCount(0);
});

test('Valuation group is OPEN by default (mtm shown, prevClose hidden)', async ({ page }) => {
  await expect(page.locator(leaf('price'))).toBeVisible();
  await expect(page.locator(leaf('mtm'))).toBeVisible();
  await expect(page.locator(leaf('prevClose'))).toHaveCount(0);
});

test('Expand all reveals open-only columns; Collapse all hides them', async ({ page }) => {
  await page.getByTestId('btn-expand-all').click();
  await expect(page.locator(leaf('desk'))).toBeVisible();      // coverage open child
  await expect(page.locator(leaf('dayPnl'))).toBeVisible();    // pnl open child
  await expect(page.locator(leaf('delta'))).toBeVisible();     // greeks sub-group (open)

  await page.getByTestId('btn-collapse-all').click();
  await expect(page.locator(leaf('desk'))).toHaveCount(0);
  await expect(page.locator(leaf('dayPnl'))).toHaveCount(0);
  await expect(page.locator(leaf('delta'))).toHaveCount(0);
  // closed-only columns now appear
  await expect(page.locator(leaf('region'))).toBeVisible();    // coverage closed child
  await expect(page.locator(leaf('prevClose'))).toBeVisible(); // valuation closed child
});

test('Risk group centerpiece: mixed leaf fields + nested sub-groups switch by state', async ({ page }) => {
  await page.getByTestId('btn-collapse-all').click();
  // collapsed: always-visible leaf dv01 + always-visible Exposure sub-group; closed-only duration + Scenario
  await expect(page.locator(leaf('dv01'))).toBeVisible();
  await expect(page.locator(leaf('grossExp'))).toBeVisible();   // Exposure (always)
  await expect(page.locator(leaf('duration'))).toBeVisible();   // closed-only leaf
  await expect(page.locator(leaf('up100bp'))).toBeVisible();    // Scenario sub-group (closed)
  await expect(page.locator(leaf('cr01'))).toHaveCount(0);      // open-only leaf hidden
  await expect(page.locator(leaf('delta'))).toHaveCount(0);     // Greeks hidden when closed

  await page.getByTestId('btn-expand-all').click();
  // open: dv01 + Exposure still there; cr01 + Greeks appear; duration + Scenario hide
  await expect(page.locator(leaf('dv01'))).toBeVisible();
  await expect(page.locator(leaf('grossExp'))).toBeVisible();
  await expect(page.locator(leaf('cr01'))).toBeVisible();       // open-only leaf
  await expect(page.locator(leaf('delta'))).toBeVisible();      // Greeks (open)
  await expect(page.locator(leaf('duration'))).toHaveCount(0);  // closed-only leaf hidden
  await expect(page.locator(leaf('up100bp'))).toHaveCount(0);   // Scenario hidden when open
});
```

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e --workspace=colgroups`
Expected: all specs PASS (Playwright auto-starts the dev server via `webServer`).

- [ ] **Step 4: Kill any lingering dev server / browser** (per repo practice — never leave an automation browser open)

Run: `pkill -f "vite --port 5175" || true`

- [ ] **Step 5: Commit**

```bash
git add apps/colgroups/playwright.config.ts apps/colgroups/e2e/colgroups.spec.ts
git commit -m "test(colgroups): Playwright E2E for column-grouping behavior"
```

---

## Self-Review

**Spec coverage:**
- Dark theme → Task 1 (`theme.ts`), verified in Task 5 dark-theme test. ✓
- 7 structures incl. flat column, fields-only, always/open/closed, openByDefault true/false, nested, marryChildren → Task 3 columnDefs + unit tests. ✓
- Centerpiece group #6 mixing leaf fields AND nested sub-groups each in always/open/closed → Task 3 test "Risk group mixes…", Task 5 centerpiece test. ✓
- Financial-positions data + formatters + P&L coloring → Task 2 (`data.ts`), Task 3 (`pnlCellStyle`). ✓
- Legend + expand/collapse-all → Task 4. ✓
- Community-only, no license → Task 1 `agGridSetup.ts`; Global Constraints. ✓
- Port 5175, root `dev:colgroups` script → Task 1. ✓
- E2E gate → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one cross-task dependency (scenario fields) is called out explicitly in Task 3's note with exact edits. ✓

**Type consistency:** `PositionRow`, `makeRows`, `fmtCcy/fmtSignedCcy/fmtNum/fmtBp`, `columnDefs`, `defaultColDef`, `GROUP_IDS`, `darkTheme`, `setColumnGroupOpened` used consistently across tasks. `up100bp`/`down100bp` reconciled between Task 2 and Task 3 via the Task 3 note. ✓

**Risk note for implementer:** If `api.setColumnGroupOpened(groupId, open)` does not toggle a group in 35.3.1 (API name drift), the fallback is `api.getColumnGroupState()` / `api.setColumnGroupState(...)` or `provided`-column-group APIs — confirm against the loaded AG-Grid 35 types before deviating.
