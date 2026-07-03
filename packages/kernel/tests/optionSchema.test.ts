// Cycle 21i / Phase 1 (T4) — Grid Options schema tests.
//
// The load-bearing assertion is the DRIFT GUARD: every runtime-mutable
// option key is either covered by the panel schema or explicitly excluded
// with a reason. A new runtime option that lands without a schema/exclusion
// decision fails this suite in the same PR.

import { describe, it, expect } from 'vitest';
import { RUNTIME_OPTION_SET } from '../src/core/runtimeOptions';
import {
  buildGridOptionsSchema,
  GRID_OPTIONS_SCHEMA_KEYS,
  GRID_OPTIONS_SCHEMA_EXCLUDED,
  type GridOptionsAccessor,
} from '../src/core/optionSchema';
import { isFieldModified } from '../src/types/settingsSchema';

function makeAccessor(initial: Record<string, unknown> = {}): GridOptionsAccessor & {
  store: Record<string, unknown>;
} {
  const store = { ...initial };
  return {
    store,
    getGridOption: (key) => store[key],
    setGridOption: (key, value) => { store[key] = value; },
  };
}

describe('grid-options schema drift guard', () => {
  it('every runtime option is covered by the schema or explicitly excluded', () => {
    const missing = [...RUNTIME_OPTION_SET].filter(
      (key) => !GRID_OPTIONS_SCHEMA_KEYS.has(key) && !GRID_OPTIONS_SCHEMA_EXCLUDED.has(key),
    );
    expect(missing, `runtime options missing a schema/exclusion decision: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('no option is both covered and excluded', () => {
    const both = [...GRID_OPTIONS_SCHEMA_KEYS].filter((k) =>
      GRID_OPTIONS_SCHEMA_EXCLUDED.has(k as never));
    expect(both).toEqual([]);
  });

  it('every exclusion carries a reason', () => {
    for (const [key, reason] of GRID_OPTIONS_SCHEMA_EXCLUDED) {
      expect(reason.length, `exclusion reason missing for '${key}'`).toBeGreaterThan(4);
    }
  });
});

describe('buildGridOptionsSchema', () => {
  it('reads and writes plain options through the accessor', () => {
    const api = makeAccessor();
    const schema = buildGridOptionsSchema(api);
    const flash = schema.bands
      .flatMap((b) => b.fields)
      .find((f) => f.key === 'enableCellChangeFlash')!;

    expect(flash.get()).toBe(false); // kernel default
    flash.set(true);
    expect(api.store.enableCellChangeFlash).toBe(true);
    expect(flash.get()).toBe(true);
  });

  it('maps null-semantics selects (pivotRowTotals off/before/after)', () => {
    const api = makeAccessor();
    const schema = buildGridOptionsSchema(api);
    const totals = schema.bands
      .flatMap((b) => b.fields)
      .find((f) => f.key === 'pivotRowTotals')!;

    expect(totals.get()).toBe('off');
    totals.set('after');
    expect(api.store.pivotRowTotals).toBe('after');
    totals.set('off');
    expect(api.store.pivotRowTotals).toBeNull();
    expect(totals.get()).toBe('off');
  });

  it('baselines modified-state at build time (app config is unmodified)', () => {
    const api = makeAccessor({ enableCellChangeFlash: true });
    const schema = buildGridOptionsSchema(api);
    const flash = schema.bands
      .flatMap((b) => b.fields)
      .find((f) => f.key === 'enableCellChangeFlash')!;

    expect(isFieldModified(flash)).toBe(false); // true was the app's config
    flash.set(false);
    expect(isFieldModified(flash)).toBe(true);
    flash.set(true);
    expect(isFieldModified(flash)).toBe(false);
  });

  it('fans defaultColDef fields out into single-property patches', () => {
    const api = makeAccessor({ defaultColDef: { resizable: true, minWidth: 80 } });
    const schema = buildGridOptionsSchema(api);
    const fields = schema.bands.find((b) => b.id === 'defaultColDef')!.fields;
    const sortable = fields.find((f) => f.key === 'defaultColDef.sortable')!;
    const minWidth = fields.find((f) => f.key === 'defaultColDef.minWidth')!;

    sortable.set(true);
    expect(api.store.defaultColDef).toEqual({ resizable: true, minWidth: 80, sortable: true });
    minWidth.set(120);
    expect((api.store.defaultColDef as Record<string, unknown>).minWidth).toBe(120);
    // Other props untouched by each patch.
    expect((api.store.defaultColDef as Record<string, unknown>).resizable).toBe(true);
  });

  it('covers ~60 fields across the bands', () => {
    const schema = buildGridOptionsSchema(makeAccessor());
    const count = schema.bands.reduce((n, b) => n + b.fields.length, 0);
    expect(count).toBeGreaterThanOrEqual(40);
    expect(schema.bands.length).toBeGreaterThanOrEqual(8);
  });
});
