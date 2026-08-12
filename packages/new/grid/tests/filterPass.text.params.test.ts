/**
 * Cycle 7 / Task 5 — text-filter parameter tests.
 *
 * Covers the three pieces Task 5 adds to the text-filter pipeline:
 *
 * 1. Entry-level `caseSensitive` on a CTextFilterModel — already wired
 *    by the matchesText() Task 1 added; this file pins the contract.
 *    (`caseSensitive: true` rejects case-mismatches; defaults to false.)
 *
 * 2. Column-level `textFormatter` ('lowercase' | 'uppercase' | 'trim')
 *    on WorkerColumn — runs on BOTH the cell value AND the filter
 *    value before any case-folding or operator comparison.
 *
 * 3. Main-side `trimInput` honored at setColumnFilterModel time — does
 *    NOT need worker changes; tested via the exported helper
 *    `applyTrimInputToModel(model, trim)` that velocityGrid.ts calls before
 *    storing the model.
 */
import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore } from '../src/worker/dataPipeline';
// PORT-NOTE: import path only. `applyTrimInputToModel` lives in
// `src/interaction/filters/textFilter.ts` (a DOM popup module, unported —
// outside the worker scope); the worker port carries the DOM-free helper at
// `src/worker/interop/trimInput.ts`. Implementation is verbatim; assertions
// below are untouched.
import { applyTrimInputToModel } from '../src/worker/interop/trimInput';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row { id: string; name: string }

function makeStore(rows: Row[]): RowStore<Row> {
  const s = new RowStore<Row>('id');
  s.setAll(rows);
  return s;
}

describe('FilterPass — text caseSensitive', () => {
  const rows: Row[] = [
    { id: '1', name: 'POS-100' },
    { id: '2', name: 'pos-200' },
    { id: '3', name: 'XYZ-300' },
  ];
  const cols: WorkerColumn[] = [
    { colId: 'name', field: 'name', type: 'text', filter: 'text' },
  ];

  it('caseSensitive: true rejects case-mismatches', () => {
    const p = new FilterPass<Row>(makeStore(rows), cols);
    p.setModel({
      name: { filterType: 'text', type: 'contains', filter: 'POS', caseSensitive: true },
    });
    // Only 'POS-100' matches with caseSensitive on; 'pos-200' is filtered out.
    expect(p.apply().sort()).toEqual(['1']);
  });

  it('caseSensitive: false (default) matches case-insensitively', () => {
    const p = new FilterPass<Row>(makeStore(rows), cols);
    p.setModel({
      name: { filterType: 'text', type: 'contains', filter: 'POS' },
    });
    // Both 'POS-100' and 'pos-200' match.
    expect(p.apply().sort()).toEqual(['1', '2']);
  });
});

describe('FilterPass — text textFormatter', () => {
  it('textFormatter: lowercase normalises both sides before comparison', () => {
    const rows: Row[] = [
      { id: '1', name: 'POS-100' },
      { id: '2', name: 'pos-200' },
      { id: '3', name: 'XYZ-300' },
    ];
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', filter: 'text', textFormatter: 'lowercase' },
    ];
    const p = new FilterPass<Row>(makeStore(rows), cols);
    // caseSensitive: true on the entry — without textFormatter this would
    // only match exact-case rows. With textFormatter: 'lowercase' applied
    // pre-compare on both sides, both POS-* rows match.
    p.setModel({
      name: { filterType: 'text', type: 'contains', filter: 'POS', caseSensitive: true },
    });
    expect(p.apply().sort()).toEqual(['1', '2']);
  });

  it('textFormatter: trim normalises both sides before comparison', () => {
    const rows: Row[] = [
      { id: '1', name: '  hello  ' },
      { id: '2', name: 'world' },
    ];
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', filter: 'text', textFormatter: 'trim' },
    ];
    const p = new FilterPass<Row>(makeStore(rows), cols);
    p.setModel({
      name: { filterType: 'text', type: 'equals', filter: 'hello', caseSensitive: true },
    });
    expect(p.apply()).toEqual(['1']);
  });

  it('textFormatter: uppercase normalises both sides before comparison', () => {
    const rows: Row[] = [
      { id: '1', name: 'hello world' },
      { id: '2', name: 'goodbye' },
    ];
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', filter: 'text', textFormatter: 'uppercase' },
    ];
    const p = new FilterPass<Row>(makeStore(rows), cols);
    p.setModel({
      name: { filterType: 'text', type: 'startsWith', filter: 'HELLO', caseSensitive: true },
    });
    expect(p.apply()).toEqual(['1']);
  });
});

describe('applyTrimInputToModel — main-side trimInput', () => {
  it('trims the filter value when trim=true', () => {
    const m = applyTrimInputToModel(
      { filterType: 'text', type: 'contains', filter: '  POS-1  ' },
      true,
    );
    expect(m).toEqual({ filterType: 'text', type: 'contains', filter: 'POS-1' });
  });

  it('passes through when trim=false', () => {
    const m = applyTrimInputToModel(
      { filterType: 'text', type: 'contains', filter: '  POS-1  ' },
      false,
    );
    expect(m).toEqual({ filterType: 'text', type: 'contains', filter: '  POS-1  ' });
  });

  it('passes null through unchanged', () => {
    expect(applyTrimInputToModel(null, true)).toBeNull();
  });

  it('leaves operator-only models (blank / notBlank) unchanged when trim=true', () => {
    const m = applyTrimInputToModel(
      { filterType: 'text', type: 'blank' },
      true,
    );
    expect(m).toEqual({ filterType: 'text', type: 'blank' });
  });
});
