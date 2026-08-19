// @wellsfargo-starui/velocity-grid-edit — bridge.test.ts
// Covers `wireEditIntoKernel` (spec §4): surface/idempotency/mirror (round A),
// key router (round B, spec §3.1), commit pipeline + selection restore
// (round C, spec §3.2/§3.3), journal feeds + facades (round D, spec §3.5/§4.2).
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 11.

import { describe, it, expect, vi } from 'vitest';
import { wireEditIntoKernel } from '../src/bridge';
import { createFakeKernelGrid, type FakeRow, type FakeColDef } from './helpers/fakeGrid';

const rows: FakeRow[] = [
  { id: 'r0', qty: 10, price: 1.5, trader: 'alice', status: 'active' },
  { id: 'r1', qty: 20, price: 2.5, trader: 'bob', status: 'inactive' },
  { id: 'r2', qty: 30, price: 3.5, trader: 'carol', status: 'active' },
];

// All editable by default (kernel parity: an unset `editable` resolves to
// `false`, `editController.ts:407-428` — the shared fixture opts every
// column IN so existing nudge/shortcut/smart-edit/bulk-update tests keep
// exercising a normal editable grid; the editability-gate regression test
// below overrides `qty` to `editable: false` explicitly).
const colDefs: FakeColDef[] = [
  { colId: 'qty', field: 'qty', cellDataType: 'number', editable: true },
  { colId: 'price', field: 'price', cellDataType: 'number', editable: true },
  { colId: 'trader', field: 'trader', cellDataType: 'text', editable: true },
  { colId: 'status', field: 'status', cellDataType: 'text', editable: true },
];

function makeGrid(overrides?: Partial<{ rows: FakeRow[]; colDefs: FakeColDef[] }>) {
  return createFakeKernelGrid({
    rows: overrides?.rows ?? rows.map((r) => ({ ...r })),
    colDefs: overrides?.colDefs ?? colDefs,
  });
}

function keyEvent(key: string): { key: string; preventDefault: ReturnType<typeof vi.fn> } {
  return { key, preventDefault: vi.fn() };
}

describe('wireEditIntoKernel — round A: surface, idempotency, mirror', () => {
  it('returns an EditBridgeHandle with all pinned members; journal is an EditJournal-shaped object', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    expect(handle.journal).toBeDefined();
    expect(typeof handle.journal.record).toBe('function');
    expect(typeof handle.journal.undo).toBe('function');
    expect(typeof handle.journal.redo).toBe('function');
    expect(typeof handle.smartEdit.collectTargets).toBe('function');
    expect(typeof handle.smartEdit.preview).toBe('function');
    expect(typeof handle.smartEdit.apply).toBe('function');
    expect(typeof handle.bulkUpdate.collectTargets).toBe('function');
    expect(typeof handle.bulkUpdate.distinctValues).toBe('function');
    expect(typeof handle.bulkUpdate.preview).toBe('function');
    expect(typeof handle.bulkUpdate.apply).toBe('function');
    expect(typeof handle.getSettings).toBe('function');
    expect(typeof handle.updateSettings).toBe('function');
    expect(typeof handle.setNudges).toBe('function');
    expect(typeof handle.setShortcuts).toBe('function');
    expect(typeof handle.destroy).toBe('function');
  });

  it('idempotent re-wire: second call returns the SAME handle', () => {
    const fake = makeGrid();
    const first = wireEditIntoKernel(fake.grid);
    const second = wireEditIntoKernel(fake.grid);
    expect(second).toBe(first);
  });

  it('destroy() unsubscribes everything; re-wire after destroy produces a fresh handle', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    const recordSpy = vi.fn();
    const unsubJournal = handle.journal.subscribe(recordSpy);

    handle.destroy();

    // Emitting every subscribed event type mutates nothing post-destroy.
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: keyEvent('+') });
    fake.emit('cellValueChanged', { type: 'cellValueChanged', rowId: 'r0', colId: 'qty', oldValue: 10, newValue: 11, source: 'edit' });
    fake.emit('rowsChanged', { type: 'rowsChanged', added: [], updated: [], removed: [], source: 'transaction' });
    fake.emit('modelUpdated', { type: 'modelUpdated', visibleRowCount: rows.length });
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();

    unsubJournal();
    const fresh = wireEditIntoKernel(fake.grid);
    expect(fresh).not.toBe(handle);
    expect(fresh.journal).not.toBe(handle.journal);
  });

  it('mirror seed: rows from forEachRow are visible to patch-building (commit) immediately', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    // The target's OWN `rowData` is deliberately wrong — the commit clones
    // the BRIDGE's mirror row (seeded from forEachRow at wire time), not
    // whatever the caller happened to pass on the target.
    const result = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: { id: 'r0', qty: -1 }, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(result.applied).toBe(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toHaveLength(1);
    expect(tx.update[0]).toEqual({ ...rows[0], qty: 11 });
  });

  it('mirror freshen: rowsChanged add is reflected at the next commit', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    fake.emit('rowsChanged', {
      type: 'rowsChanged',
      added: [{ rowId: 'r9', row: { id: 'r9', qty: 99, price: 9.9, trader: 'z', status: 'active' } }],
      updated: [],
      removed: [],
      source: 'transaction',
    });
    const result = await handle.smartEdit.apply(
      [{ rowId: 'r9', colId: 'qty', field: 'qty', value: 99, rowIndex: 3, rowData: { id: 'r9', qty: -1 }, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(result.applied).toBe(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toHaveLength(1);
    // The mirror row (id/price/trader/status) came from rowsChanged's `added` payload.
    expect(tx.update[0]).toEqual({ id: 'r9', qty: 100, price: 9.9, trader: 'z', status: 'active' });
  });

  it('mirror staleness regression: same-rowId mutation without rowsChanged is stale until modelUpdated clears+reseeds', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);

    // Mutate _rows IN PLACE — same rowId, NEW row object — simulating a
    // same-rowId setRowData WITHOUT a rowsChanged event.
    fake._rows[0] = { id: 'r0', qty: 999, price: 1.5, trader: 'alice', status: 'active' };

    const stale = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: { id: 'r0', qty: 10 }, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(stale.applied).toBe(1);
    const staleTx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    // Mirror still had the OLD row (qty: 10) — commit reads mirror, not `_rows`.
    expect(staleTx.update[0]!.qty).toBe(11);

    fake.emit('modelUpdated', { type: 'modelUpdated', visibleRowCount: rows.length });

    const fresh = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 999, rowIndex: 0, rowData: { id: 'r0', qty: 999 }, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(fresh.applied).toBe(1);
    const freshTx = fake.applyTransactionSpy.mock.calls[1]![0] as { update: Array<Record<string, unknown>> };
    // Mirror reseeded from the NEW `_rows[0]` object (qty: 999) after modelUpdated.
    expect(freshTx.update[0]!.qty).toBe(1000);
  });
});

describe('wireEditIntoKernel — round B: key router (spec §3.1)', () => {
  function focusRange(rowIndex: number, colId: string) {
    return [{ rowStart: rowIndex, rowEnd: rowIndex, colIds: [colId] }];
  }

  it('editing guard: cellEditingStarted suppresses interception; cellEditingStopped restores it', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
    });
    fake.setRanges(focusRange(0, 'qty'));

    fake.emit('cellEditingStarted', { type: 'cellEditingStarted', rowIndex: 0, rowId: 'r0', colId: 'qty', value: 10, data: rows[0] });
    const e1 = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e1 });
    expect(e1.preventDefault).not.toHaveBeenCalled();
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();

    fake.emit('cellEditingStopped', { type: 'cellEditingStopped', rowIndex: 0, rowId: 'r0', colId: 'qty', oldValue: 10, newValue: 10, valueChanged: false, data: rows[0] });
    const e2 = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e2 });
    expect(e2.preventDefault).toHaveBeenCalledTimes(1);
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);
    void handle;
  });

  it('"+" with a matching enabled nudge: preventDefault, ONE applyTransaction, journal entry source plus-minus', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty nudge', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
    });
    fake.setRanges(focusRange(0, 'qty'));
    const e = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e });

    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[0], qty: 11 }]);

    const entries = handle.journal.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('plus-minus');
    expect(entries[0]!.label).toContain('qty');
    expect(entries[0]!.label).toContain('+1');
  });

  it('"=" also triggers the nudge path (same as "+")', () => {
    const fake = makeGrid();
    wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty nudge', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 5 }],
    });
    fake.setRanges(focusRange(0, 'qty'));
    const e = keyEvent('=');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[0], qty: 15 }]);
  });

  it('"-" uses decrementStep (falls back to incrementStep when absent)', () => {
    const fake = makeGrid();
    wireEditIntoKernel(fake.grid, {
      nudges: [
        { id: 'n1', name: 'qty nudge', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1, decrementStep: 3 },
        { id: 'n2', name: 'price nudge', enabled: true, scope: { columnIds: ['price'] }, incrementStep: 0.25 },
      ],
    });
    fake.setRanges(focusRange(0, 'qty'));
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: keyEvent('-') });
    let tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[0], qty: 7 }]); // 10 - 3

    fake.setRanges(focusRange(0, 'price'));
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'price', value: 1.5, event: keyEvent('-') });
    tx = fake.applyTransactionSpy.mock.calls[1]![0] as { update: Array<Record<string, unknown>> };
    // Mirror was freshened by the qty apply — price nudge rides the post-qty row.
    expect(tx.update).toEqual([{ ...rows[0], qty: 7, price: 1.25 }]); // 1.5 - 0.25 (fallback to incrementStep)
  });

  it('letter-key shortcut matches (case-insensitive) and commits with source shortcut', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      shortcuts: [{ id: 's1', name: 'add ten', enabled: true, shortcutKey: 'q', operation: 'add', shortcutValue: 10, scope: { columnIds: ['qty'] } }],
    });
    fake.setRanges(focusRange(0, 'qty'));
    const e = keyEvent('Q');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e });

    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[0], qty: 20 }]);
    expect(handle.journal.entries()[0]!.source).toBe('shortcut');
  });

  it('editability gate (closeout review): a non-editable numeric cell behaves like no-match — no preventDefault, no Tx, no journal entry', () => {
    const lockedColDefs: FakeColDef[] = [
      { colId: 'qty', field: 'qty', cellDataType: 'number', editable: false },
      colDefs[1]!, colDefs[2]!, colDefs[3]!,
    ];
    const fake = makeGrid({ colDefs: lockedColDefs });
    const handle = wireEditIntoKernel(fake.grid, {
      // Empty scope — matches ALL numeric editable columns, so this nudge
      // WOULD match 'qty' if editability weren't consulted.
      nudges: [{ id: 'n1', name: 'any numeric', enabled: true, scope: { columnIds: [] }, incrementStep: 1 }],
    });
    fake.setRanges(focusRange(0, 'qty'));
    const e = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e });

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
    expect(handle.journal.entries()).toHaveLength(0);
  });

  it('preventDefault discipline (assert the negative): unmatched key / non-scoped column / gated-false / feature-disabled never intercept', () => {
    const fake = makeGrid();
    wireEditIntoKernel(fake.grid, {
      nudges: [
        { id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 },
        { id: 'n2', name: 'price gated', enabled: true, scope: { columnIds: ['price'] }, incrementStep: 1, expression: 'status == "active"' },
      ],
      shortcuts: [{ id: 's1', name: 'add ten', enabled: true, shortcutKey: 'q', operation: 'add', shortcutValue: 10, scope: { columnIds: ['qty'] } }],
      evaluate: () => false,
    });

    // Unmatched key on a nudge-scoped column.
    fake.setRanges(focusRange(0, 'qty'));
    const eUnmatched = keyEvent('x');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: eUnmatched });
    expect(eUnmatched.preventDefault).not.toHaveBeenCalled();

    // Non-scoped column ('+' has no nudge for `trader`).
    fake.setRanges(focusRange(0, 'trader'));
    const eScope = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'trader', value: 'alice', event: eScope });
    expect(eScope.preventDefault).not.toHaveBeenCalled();

    // Expression-gate false.
    fake.setRanges(focusRange(0, 'price'));
    const eGated = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'price', value: 1.5, event: eGated });
    expect(eGated.preventDefault).not.toHaveBeenCalled();

    // Shortcut on a non-scoped column falls through (type-to-edit stays live).
    fake.setRanges(focusRange(0, 'trader'));
    const eShortcutScope = keyEvent('q');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'trader', value: 'alice', event: eShortcutScope });
    expect(eShortcutScope.preventDefault).not.toHaveBeenCalled();

    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
  });

  it('plusMinus.enabled: false suppresses the whole nudge branch (no preventDefault, no Tx)', () => {
    const fake = makeGrid();
    wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
      settings: { plusMinus: { enabled: false } },
    });
    fake.setRanges(focusRange(0, 'qty'));
    const e = keyEvent('+');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: e });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
  });

  it('recordHistory honored: feature-level flag off → Tx applied, not recorded', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
      settings: { plusMinus: { recordHistory: false } },
    });
    fake.setRanges(focusRange(0, 'qty'));
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: keyEvent('+') });
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);
    expect(handle.journal.entries()).toHaveLength(0);
  });

  it('recordHistory honored: history.suspended → Tx applied, not recorded (past preserved)', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
    });
    fake.setRanges(focusRange(0, 'qty'));
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: keyEvent('+') });
    expect(handle.journal.entries()).toHaveLength(1);

    handle.updateSettings({ history: { suspended: true } });
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 11, event: keyEvent('+') });
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(2);
    expect(handle.journal.entries()).toHaveLength(1); // unchanged — suspended, past preserved
  });

  it('setNudges/setShortcuts swap rules live (shortcut key set rebuilt)', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, {
      nudges: [{ id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1 }],
      shortcuts: [{ id: 's1', name: 'old', enabled: true, shortcutKey: 'q', operation: 'add', shortcutValue: 1, scope: { columnIds: ['qty'] } }],
    });
    fake.setRanges(focusRange(0, 'qty'));

    handle.setNudges([{ id: 'n2', name: 'qty x10', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 100 }]);
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 10, event: keyEvent('+') });
    let tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[0], qty: 110 }]);

    handle.setShortcuts([{ id: 's2', name: 'new', enabled: true, shortcutKey: 'z', operation: 'multiply', shortcutValue: 2, scope: { columnIds: ['qty'] } }]);
    // Old key 'q' no longer matches.
    const eOld = keyEvent('q');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 110, event: eOld });
    expect(eOld.preventDefault).not.toHaveBeenCalled();
    // New key 'z' matches.
    const eNew = keyEvent('z');
    fake.emit('cellKeyDown', { type: 'cellKeyDown', rowId: 'r0', colId: 'qty', value: 110, event: eNew });
    expect(eNew.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('wireEditIntoKernel — round C: commit pipeline + selection restore (spec §3.2/§3.3)', () => {
  it('parser/setter parity fixture: programmatic apply deep-equals a hand-computed editor-path result', async () => {
    const notionalColDef: FakeColDef = {
      colId: 'notional', field: 'notional', cellDataType: 'number',
      valueParser: (p) => (typeof p.newValue === 'number' ? p.newValue * 2 : p.newValue),
      valueSetter: (p) => {
        const data = p.data as Record<string, unknown>;
        data.notional = p.newValue;
        data.notionalSetterRan = true;
      },
    };
    const seededRows = rows.map((r) => ({ ...r, notional: 100 }));
    const fake = makeGrid({ colDefs: [...colDefs, notionalColDef], rows: seededRows });
    const handle = wireEditIntoKernel(fake.grid);

    // Programmatic path: smart-edit 'set' to the raw value 5 on r0.notional.
    const result = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'notional', field: 'notional', value: 100, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'set',
      5,
    );
    expect(result.applied).toBe(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    const programmaticRow = tx.update[0]!;

    // Hand-computed EDITOR path per editController.ts:289-330, same raw newValue (5):
    //   const parsed = valueParser({ newValue, oldValue, data: rowData, colDef });
    //   valueSetter({ data: rowData, newValue: parsed, oldValue, colDef });
    const editorRowData: Record<string, unknown> = { ...rows[0], notional: 100 };
    const oldValue = editorRowData.notional;
    const parsed = notionalColDef.valueParser!({ newValue: 5, oldValue, data: editorRowData, colDef: notionalColDef });
    notionalColDef.valueSetter!({ data: editorRowData, newValue: parsed, oldValue, colDef: notionalColDef });

    expect(programmaticRow).toEqual(editorRowData);
    expect(programmaticRow.notional).toBe(10);
    expect(programmaticRow.notionalSetterRan).toBe(true);
  });

  it('valueSetter return value is IGNORED (kernel parity): void mutation preserved, `false` not a failure', async () => {
    const priceColDef: FakeColDef = {
      colId: 'price', field: 'price', cellDataType: 'number',
      valueSetter: (p) => {
        (p.data as Record<string, unknown>).price = p.newValue;
        return false;
      },
    };
    const fake = makeGrid({ colDefs: [colDefs[0]!, priceColDef, colDefs[2]!, colDefs[3]!] });
    const handle = wireEditIntoKernel(fake.grid);
    const result = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'price', field: 'price', value: 1.5, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(result.applied).toBe(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update[0]!.price).toBe(2.5);
  });

  it('one entry = one Tx: a 3-patch 2-row entry produces exactly ONE applyTransaction with a 2-row update', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, { settings: { smartEdit: { enforceSingleColumn: false } } });
    const result = await handle.smartEdit.apply(
      [
        { rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' },
        { rowId: 'r0', colId: 'price', field: 'price', value: 1.5, rowIndex: 0, rowData: {}, cellDataType: 'number' },
        { rowId: 'r1', colId: 'qty', field: 'qty', value: 20, rowIndex: 1, rowData: {}, cellDataType: 'number' },
      ],
      'add',
      1,
    );
    expect(result.applied).toBe(3);
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toHaveLength(2);
    const byId = new Map(tx.update.map((r) => [r.id as string, r]));
    expect(byId.get('r0')).toEqual({ ...rows[0], qty: 11, price: 2.5 });
    expect(byId.get('r1')).toEqual({ ...rows[1], qty: 21 });
  });

  it('commitUpdates hook replaces applyTransaction for programmatic applies + undo', async () => {
    const fake = makeGrid();
    const commitUpdates = vi.fn();
    const handle = wireEditIntoKernel(fake.grid, { commitUpdates });
    await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'set',
      99,
    );
    expect(commitUpdates).toHaveBeenCalledTimes(1);
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
    const meta = commitUpdates.mock.calls[0]![1] as { direction: string; patches: unknown[] };
    expect(meta.direction).toBe('forward');

    handle.journal.undo();
    expect(commitUpdates).toHaveBeenCalledTimes(2);
    expect(commitUpdates.mock.calls[1]![1]).toMatchObject({ direction: 'undo' });
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('undo/redo through handle.journal: one Tx each, values flipped/restored', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    await handle.smartEdit.apply(
      [
        { rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' },
        { rowId: 'r1', colId: 'qty', field: 'qty', value: 20, rowIndex: 1, rowData: {}, cellDataType: 'number' },
      ],
      'add',
      5,
    );
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);

    const undone = handle.journal.undo();
    expect(undone).not.toBeNull();
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(2);
    const undoTx = fake.applyTransactionSpy.mock.calls[1]![0] as { update: Array<Record<string, unknown>> };
    expect(undoTx.update.map((r) => r.qty).sort()).toEqual([10, 20]);
    expect(handle.journal.canRedo()).toBe(true);

    const redone = handle.journal.redo();
    expect(redone).not.toBeNull();
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(3);
    const redoTx = fake.applyTransactionSpy.mock.calls[2]![0] as { update: Array<Record<string, unknown>> };
    expect(redoTx.update.map((r) => r.qty).sort()).toEqual([15, 25]);
  });

  it('parser discipline (closeout review): journal replay (undo/redo) never re-parses a non-idempotent valueParser', async () => {
    const notionalColDef: FakeColDef = {
      colId: 'notional', field: 'notional', cellDataType: 'number',
      valueParser: (p) => (typeof p.newValue === 'number' ? p.newValue / 100 : p.newValue),
    };
    const seededRows = rows.map((r) => ({ ...r, notional: 500 }));
    const fake = makeGrid({ colDefs: [...colDefs, notionalColDef], rows: seededRows });
    const handle = wireEditIntoKernel(fake.grid);

    // Simulate the kernel's own cell-editor commit (editController.ts:289-330):
    // the emitted `newValue` is ALREADY post-parse (parsed exactly once,
    // inside the kernel, before `cellValueChanged` fires).
    fake.emit('cellValueChanged', {
      type: 'cellValueChanged', rowId: 'r0', colId: 'notional', oldValue: 500, newValue: 5, source: 'edit',
    });
    expect(handle.journal.entries()).toHaveLength(1);

    // Undo must restore `oldValue` EXACTLY. Under the old "always parse"
    // behavior this would double-transform: parser(500) = 5, wrongly
    // leaving the cell at 5 instead of restoring 500.
    handle.journal.undo();
    const undoTx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(undoTx.update[0]!.notional).toBe(500);

    // Redo must restore `newValue` EXACTLY. Under the old behavior this
    // would double-transform: parser(5) = 0.05, instead of replaying the
    // already-parsed 5.
    handle.journal.redo();
    const redoTx = fake.applyTransactionSpy.mock.calls[1]![0] as { update: Array<Record<string, unknown>> };
    expect(redoTx.update[0]!.notional).toBe(5);
  });

  it('parser discipline (closeout review): a smart-edit INITIAL forward apply still runs valueParser (freshly-computed input)', async () => {
    const notionalColDef: FakeColDef = {
      colId: 'notional', field: 'notional', cellDataType: 'number',
      valueParser: (p) => (typeof p.newValue === 'number' ? p.newValue / 100 : p.newValue),
    };
    const seededRows = rows.map((r) => ({ ...r, notional: 500 }));
    const fake = makeGrid({ colDefs: [...colDefs, notionalColDef], rows: seededRows });
    const handle = wireEditIntoKernel(fake.grid);

    const result = await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'notional', field: 'notional', value: 500, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'set',
      1000,
    );
    expect(result.applied).toBe(1);
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update[0]!.notional).toBe(10); // 1000 parsed via /100 — parser DID run
  });

  it('undo skips rows missing from the mirror, without throwing', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'add',
      5,
    );
    fake.emit('rowsChanged', { type: 'rowsChanged', added: [], updated: [], removed: [{ rowId: 'r0', row: rows[0]! }], source: 'transaction' });
    expect(() => handle.journal.undo()).not.toThrow();
    // The only touched row was removed from the mirror — no second Tx.
    expect(fake.applyTransactionSpy).toHaveBeenCalledTimes(1);
  });

  it('selection snapshot/restore around every programmatic apply (order: clear -> add loop -> focus -> rowIds)', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    const snapshotRanges = [
      { rowStart: 0, rowEnd: 1, colIds: ['qty', 'price'] },
      { rowStart: 2, rowEnd: 2, colIds: ['trader'] },
    ];
    fake.setRanges(snapshotRanges);
    fake.setFocusedCell({ rowId: 'r1', colId: 'price' });
    fake.setSelectedRowIds(['r0', 'r1']);

    await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'add',
      1,
    );

    expect(fake.clearCellRangesSpy).toHaveBeenCalledTimes(1);
    expect(fake.addCellRangeSpy).toHaveBeenCalledTimes(2);
    expect(fake.addCellRangeSpy.mock.calls.map((c) => c[0])).toEqual(snapshotRanges);
    expect(fake.setFocusedCellSpy).toHaveBeenCalledWith('r1', 'price');
    expect(fake.setSelectedRowIdsSpy).toHaveBeenCalledWith(['r0', 'r1']);
    expect(fake.selectionCallLog).toEqual(['clear', 'add', 'add', 'focus', 'rowIds']);
    expect(fake.getRanges()).toEqual(snapshotRanges);
    expect(fake.getFocusedCell()).toEqual({ rowId: 'r1', colId: 'price' });
    expect(fake.getSelectedRowIds()).toEqual(['r0', 'r1']);
  });

  it('replay guard: a cellValueChanged fired synchronously inside applyTransaction is NOT recorded', async () => {
    const fake = makeGrid();
    fake.applyTransactionSpy.mockImplementation(() => {
      fake.emit('cellValueChanged', { type: 'cellValueChanged', rowId: 'r0', colId: 'qty', oldValue: 10, newValue: 999, source: 'edit' });
      return { add: [], update: [], remove: [] };
    });
    const handle = wireEditIntoKernel(fake.grid);
    await handle.smartEdit.apply(
      [{ rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' }],
      'add',
      1,
    );
    expect(handle.journal.entries()).toHaveLength(1);
    expect(handle.journal.entries()[0]!.source).toBe('smart-edit');
  });
});

describe('wireEditIntoKernel — round D: journal feeds + facades (spec §3.5, §4.2)', () => {
  it('cellValueChanged feed: one single-patch cell-editor entry; Object.is no-op skipped; recordSources gate honored', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid);
    fake.emit('cellValueChanged', { type: 'cellValueChanged', rowId: 'r0', colId: 'qty', oldValue: 10, newValue: 42, source: 'edit' });
    expect(handle.journal.entries()).toHaveLength(1);
    const entry = handle.journal.entries()[0]!;
    expect(entry.source).toBe('cell-editor');
    expect(entry.patches).toEqual([{ rowId: 'r0', colId: 'qty', field: 'qty', oldValue: 10, newValue: 42 }]);
    expect(entry.label).toContain('qty');

    fake.emit('cellValueChanged', { type: 'cellValueChanged', rowId: 'r0', colId: 'qty', oldValue: 42, newValue: 42, source: 'edit' });
    expect(handle.journal.entries()).toHaveLength(1); // Object.is no-op skipped

    const fake2 = makeGrid();
    const handle2 = wireEditIntoKernel(fake2.grid, { settings: { history: { recordSources: { cellEditor: false } } } });
    fake2.emit('cellValueChanged', { type: 'cellValueChanged', rowId: 'r0', colId: 'qty', oldValue: 10, newValue: 42, source: 'edit' });
    expect(handle2.journal.entries()).toHaveLength(0);
  });

  it('rowsChanged stream feed: recordSources.stream gate; source "edit" never stream-recorded', () => {
    const fake = makeGrid();
    const handleDefault = wireEditIntoKernel(fake.grid);
    fake.emit('rowsChanged', {
      type: 'rowsChanged', added: [], removed: [],
      updated: [{ rowId: 'r0', row: { ...rows[0], qty: 15 }, oldRow: rows[0] }],
      source: 'transaction',
    });
    expect(handleDefault.journal.entries()).toHaveLength(0); // stream OFF by default

    const fake2 = makeGrid();
    const handle2 = wireEditIntoKernel(fake2.grid, { settings: { history: { recordSources: { stream: true } } } });
    fake2.emit('rowsChanged', {
      type: 'rowsChanged', added: [], removed: [],
      updated: [{ rowId: 'r0', row: { ...rows[0], qty: 15 }, oldRow: rows[0] }],
      source: 'transaction',
    });
    expect(handle2.journal.entries()).toHaveLength(1);
    const entry = handle2.journal.entries()[0]!;
    expect(entry.source).toBe('stream');
    expect(entry.patches).toContainEqual({ rowId: 'r0', colId: 'qty', field: 'qty', oldValue: 10, newValue: 15 });

    fake2.emit('rowsChanged', {
      type: 'rowsChanged', added: [], removed: [],
      updated: [{ rowId: 'r1', row: { ...rows[1], qty: 99 }, oldRow: rows[1] }],
      source: 'edit',
    });
    expect(handle2.journal.entries()).toHaveLength(1); // 'edit' source never stream-recorded
  });

  it('smartEdit.collectTargets(): batches getRowsByIndex, no-range→null focus fallback, addon-side isCellEditable', async () => {
    const editableColDefs: FakeColDef[] = [
      ...colDefs,
      { colId: 'flag', field: 'flag', cellDataType: 'number', editable: (p) => (p.value as number) > 15 },
      { colId: 'boom', field: 'boom', cellDataType: 'number', editable: () => { throw new Error('boom'); } },
    ];
    const flaggedRows = rows.map((r, i) => ({ ...r, flag: i === 0 ? 10 : 20, boom: 1 }));
    const fake = makeGrid({ colDefs: editableColDefs, rows: flaggedRows });
    const handle = wireEditIntoKernel(fake.grid);

    fake.setRanges([]);
    const noRangeTargets = await handle.smartEdit.collectTargets();
    expect(noRangeTargets).toEqual([]); // no ranges + no focus → the adapter's null path

    fake.setRanges([{ rowStart: 0, rowEnd: 1, colIds: ['flag'] }]);
    const flagTargets = await handle.smartEdit.collectTargets();
    expect(flagTargets.map((t) => t.rowId)).toEqual(['r1']); // callback: value > 15
    expect(fake.getRowsByIndexSpy).toHaveBeenCalledTimes(1);

    fake.setRanges([{ rowStart: 0, rowEnd: 0, colIds: ['boom'] }]);
    const boomTargets = await handle.smartEdit.collectTargets();
    expect(boomTargets).toEqual([]); // throwing callback → not editable
  });

  it('smartEdit.preview threads opts.validator; apply enforces single column; label format; confirmThreshold never blocks', async () => {
    const validator = vi.fn(() => 'warning' as const);
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, { validator, settings: { smartEdit: { confirmThreshold: 1 } } });

    const targets = [
      { rowId: 'r0', colId: 'qty', field: 'qty', value: 10, rowIndex: 0, rowData: {}, cellDataType: 'number' },
    ];
    const preview = handle.smartEdit.preview(targets, 'multiply', 2);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]!.result).toBe('warning');
    expect(validator).toHaveBeenCalled();

    const mixed = [
      ...targets,
      { rowId: 'r1', colId: 'price', field: 'price', value: 2.5, rowIndex: 1, rowData: {}, cellDataType: 'number' },
    ];
    const violated = await handle.smartEdit.apply(mixed, 'multiply', 2);
    expect(violated).toEqual({ applied: 0, entry: null });
    expect(fake.applyTransactionSpy).not.toHaveBeenCalled();

    const ok = await handle.smartEdit.apply(targets, 'multiply', 2);
    expect(ok.applied).toBe(1);
    expect(ok.entry?.label).toBe('× 2');
  });

  it('bulkUpdate.distinctValues via makeDistinctValuesFeed; apply source bulk-update, Object.is no-op guard', async () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, { settings: { bulkUpdate: { maxDropdownValues: 2 } } });
    const values = await handle.bulkUpdate.distinctValues('status');
    expect(fake.getDistinctValuesSpy).toHaveBeenCalledWith('status', 2);
    expect(values).toEqual(['active', 'inactive']);

    const targets = [
      { rowId: 'r0', colId: 'status', field: 'status', value: 'active', rowIndex: 0, rowData: {}, cellDataType: 'text' },
      { rowId: 'r1', colId: 'status', field: 'status', value: 'inactive', rowIndex: 1, rowData: {}, cellDataType: 'text' },
    ];
    const result = await handle.bulkUpdate.apply(targets, 'active');
    expect(result.applied).toBe(1); // r0 already 'active' — Object.is no-op skipped
    expect(result.entry?.source).toBe('bulk-update');
    const tx = fake.applyTransactionSpy.mock.calls[0]![0] as { update: Array<Record<string, unknown>> };
    expect(tx.update).toEqual([{ ...rows[1], status: 'active' }]);
  });

  it('getSettings returns a merged copy (not same ref across calls); updateSettings re-merges over CURRENT settings', () => {
    const fake = makeGrid();
    const handle = wireEditIntoKernel(fake.grid, { settings: { smartEdit: { incrementStep: 5 } } });
    const sA = handle.getSettings();
    const sB = handle.getSettings();
    expect(sA).not.toBe(sB);
    expect(sA).toEqual(sB);
    expect(sA.smartEdit.incrementStep).toBe(5);

    handle.updateSettings({ history: { suspended: true } });
    const sC = handle.getSettings();
    expect(sC.history.suspended).toBe(true);
    expect(sC.smartEdit.incrementStep).toBe(5); // preserved — re-merged over CURRENT, not defaults
  });

  it('does not auto-wrap colDefs with magnitude parsing on wire (no colDef mutation)', () => {
    const fake = makeGrid();
    wireEditIntoKernel(fake.grid);
    const after = (fake.grid.getGridOption as (k: string) => unknown)('columnDefs');
    expect(after).toBe(colDefs); // same array reference — untouched
  });
});

describe('wireEditIntoKernel — module-state persistence (Cycle 21i Phase 2 / T6)', () => {
  function makeStatefulGrid() {
    const fake = makeGrid();
    const registered: any[] = [];
    const notified: string[] = [];
    (fake.grid as any).registerStateModule = (m: any) => {
      registered.push(m);
      return () => { const i = registered.indexOf(m); if (i >= 0) registered.splice(i, 1); };
    };
    (fake.grid as any).notifyModuleStateChanged = (id: string) => notified.push(id);
    return { fake, registered, notified };
  }

  it('registers an editSettings module; get() omits default settings, carries changes', () => {
    const { fake, registered } = makeStatefulGrid();
    const handle = wireEditIntoKernel(fake.grid);
    const mod = registered.find((m) => m.id === 'editSettings');
    expect(mod).toBeDefined();
    expect(mod.version).toBe(1);
    // Untouched settings → compact snapshot (slice omitted).
    expect(mod.get()).toBeUndefined();
    handle.updateSettings({ smartEdit: { incrementStep: 5 } });
    expect((mod.get() as any).smartEdit.incrementStep).toBe(5);
  });

  it('persists nudges and shortcutDefs in the editSettings envelope', () => {
    const { fake, registered } = makeStatefulGrid();
    const handle = wireEditIntoKernel(fake.grid);
    const mod = registered.find((m) => m.id === 'editSettings');
    handle.setNudges([{
      id: 'n1', name: 'qty', enabled: true, scope: { columnIds: ['qty'] }, incrementStep: 1,
    }]);
    handle.setShortcuts([{
      id: 's1', name: 'add', enabled: true, shortcutKey: 'q', operation: 'add',
      shortcutValue: 10, scope: { columnIds: ['qty'] },
    }]);
    const snap = mod.get() as { nudges: unknown[]; shortcutDefs: unknown[] };
    expect(snap.nudges).toHaveLength(1);
    expect(snap.shortcutDefs).toHaveLength(1);

    const { fake: fake2, registered: reg2 } = makeStatefulGrid();
    const handle2 = wireEditIntoKernel(fake2.grid);
    const mod2 = reg2.find((m) => m.id === 'editSettings');
    mod2.set(snap, 1);
    expect(handle2.getNudges().map((n) => n.id)).toEqual(['n1']);
    expect(handle2.getShortcuts().map((s) => s.id)).toEqual(['s1']);
  });

  it('updateSettings notifies the kernel so autosave runs; set() restores via defensive merge', () => {
    const { fake, registered, notified } = makeStatefulGrid();
    const handle = wireEditIntoKernel(fake.grid);
    handle.updateSettings({ smartEdit: { enabled: false } });
    expect(notified).toEqual(['editSettings']);
    const mod = registered.find((m) => m.id === 'editSettings');
    mod.set({ smartEdit: { incrementStep: 9, enabledOps: ['add', 'bogus'] } }, 1);
    const s = handle.getSettings();
    expect(s.smartEdit.incrementStep).toBe(9);
    // Defensive merge: unknown op filtered, defaults fill the rest.
    expect(s.smartEdit.enabledOps).toEqual(['add']);
    expect(s.smartEdit.enabled).toBe(true);
  });

  it('destroy unregisters the module; grids without the registry still wire cleanly', () => {
    const { fake, registered } = makeStatefulGrid();
    const handle = wireEditIntoKernel(fake.grid);
    expect(registered.some((m) => m.id === 'editSettings')).toBe(true);
    handle.destroy();
    expect(registered.some((m) => m.id === 'editSettings')).toBe(false);

    const bare = makeGrid();
    expect(() => wireEditIntoKernel(bare.grid)).not.toThrow();
  });
});

// ─── Editability resolution parity (VelocityGridExt toolbar regression) ──────────
// The kernel resolves `editable` against the RESOLVED colDef (defaultColDef
// folded at construction); the bridge reads AUTHORED defs, so it must fold
// defaultColDef itself — and prefer the kernel's own `isCellEditable` when
// the surface exposes it. Regression for the "Smart/Bulk report 0 cells on
// a grid authored with defaultColDef:{editable:true}" toolbar bug.
describe('wireEditIntoKernel — editability resolution parity', () => {
  const bareLeaves: FakeColDef[] = [
    { colId: 'qty', field: 'qty', cellDataType: 'number' },
    { colId: 'trader', field: 'trader', cellDataType: 'text' },
  ];

  it('folds defaultColDef.editable over bare leaves (smart-edit targets found)', async () => {
    const fake = createFakeKernelGrid({
      rows: rows.map((r) => ({ ...r })),
      colDefs: bareLeaves.map((d) => ({ ...d })),
      defaultColDef: { editable: true },
    });
    const handle = wireEditIntoKernel(fake.grid);
    fake.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }]);
    const targets = await handle.smartEdit.collectTargets();
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r1', 'r2']); // [] before the fold
  });

  it('treats legacy type: "number" like cellDataType: "number" for smart-edit targets', async () => {
    const fake = createFakeKernelGrid({
      rows: rows.map((r) => ({ ...r })),
      colDefs: [{ colId: 'qty', field: 'qty', type: 'number', editable: true }],
      defaultColDef: { editable: true },
    });
    const handle = wireEditIntoKernel(fake.grid);
    fake.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }]);
    const targets = await handle.smartEdit.collectTargets();
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r1', 'r2']);
    expect(targets.every((t) => t.cellDataType === 'number')).toBe(true);
  });

  it('leaf editable:false beats defaultColDef.editable:true (kernel precedence)', async () => {
    const fake = createFakeKernelGrid({
      rows: rows.map((r) => ({ ...r })),
      colDefs: [{ colId: 'qty', field: 'qty', cellDataType: 'number', editable: false }],
      defaultColDef: { editable: true },
    });
    const handle = wireEditIntoKernel(fake.grid);
    fake.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }]);
    expect(await handle.smartEdit.collectTargets()).toEqual([]);
  });

  it('unset everywhere still resolves to NOT editable (no silent opt-in)', async () => {
    const fake = createFakeKernelGrid({
      rows: rows.map((r) => ({ ...r })),
      colDefs: bareLeaves.map((d) => ({ ...d })),
    });
    const handle = wireEditIntoKernel(fake.grid);
    fake.setRanges([{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }]);
    expect(await handle.smartEdit.collectTargets()).toEqual([]);
  });

  it('prefers the surface-native isCellEditable when exposed (kernel delegation)', async () => {
    const fake = createFakeKernelGrid({
      rows: rows.map((r) => ({ ...r })),
      colDefs: bareLeaves.map((d) => ({ ...d })), // bare: replication alone would say false
    });
    const native = vi.fn((_rowIndex: number, colId: string) => colId === 'qty');
    (fake.grid as Record<string, unknown>).isCellEditable = native;
    const handle = wireEditIntoKernel(fake.grid);
    fake.setRanges([{ rowStart: 0, rowEnd: 1, colIds: ['qty'] }]);
    const targets = await handle.smartEdit.collectTargets();
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r1']); // native won over replication
    expect(native).toHaveBeenCalled();
  });
});
