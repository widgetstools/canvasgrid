// @cgrid/edit — journal.test.ts
// Covers EditJournal: dual stacks (past/future), monitor list, subscribe,
// shouldRecord gating, and (Task 3) the undoEntry cascade.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.1, §3.5, §3.2.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 2 Step 1 (15 cases)
// + Task 3 Step 1 cascade cases (replacing case 15's stub).

import { describe, it, expect, vi } from 'vitest';
import { EditJournal } from '../src/journal';
import { DEFAULT_EDIT_SETTINGS } from '../src/settings';
import type { CellPatch, DataChangeHistorySettings } from '../src/types';

function makeJournal(overrides?: {
  now?: () => number;
  nextId?: () => string;
  monitorLimit?: number;
}) {
  const settings: DataChangeHistorySettings = structuredClone(DEFAULT_EDIT_SETTINGS.history);
  const applier = vi.fn();
  const journal = new EditJournal({
    applyPatches: applier,
    getHistorySettings: () => settings,
    now: overrides?.now,
    nextId: overrides?.nextId,
    monitorLimit: overrides?.monitorLimit,
  });
  return { journal, applier, settings };
}

function patch(overrides?: Partial<CellPatch>): CellPatch {
  return { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 2, ...overrides };
}

describe('EditJournal — record basics', () => {
  it('records a basic entry; entries/monitor/canUndo/canRedo update; applier not invoked', () => {
    const { journal, applier } = makeJournal();
    const p1 = patch();
    const entry = journal.record({ source: 'smart-edit', label: '× 1.1', patches: [p1] });
    expect(entry).toEqual({ id: 'e1', timestamp: 0, source: 'smart-edit', label: '× 1.1', patches: [p1] });
    expect(journal.entries()).toEqual([entry]);
    expect(journal.monitorEntries()).toEqual([entry]);
    expect(journal.canUndo()).toBe(true);
    expect(journal.canRedo()).toBe(false);
    expect(applier).not.toHaveBeenCalled();
  });

  it('defensive copy: mutating the caller-supplied patches array after record() does not affect the stored entry', () => {
    const { journal } = makeJournal();
    const inputPatches = [patch({ rowId: 'r1' })];
    const entry = journal.record({ source: 'smart-edit', label: '× 1.1', patches: inputPatches });
    expect(entry?.patches).not.toBe(inputPatches); // not the same array reference — a defensive copy

    // Mutate the caller's array itself (push/splice) after record() returns.
    inputPatches.push(patch({ rowId: 'r2' }));
    inputPatches.length = 0;

    // The stored entry's `patches` array is unaffected by either mutation.
    expect(journal.entries()[0]!.patches).toHaveLength(1);
    expect(journal.entries()[0]!.patches[0]!.rowId).toBe('r1');
  });

  it('uses injected now/nextId when provided; falls back to Date-free defaults otherwise', () => {
    const ids = ['x1', 'x2'];
    let i = 0;
    const { journal: injected } = makeJournal({ now: () => 1234, nextId: () => ids[i++]! });
    const e1 = injected.record({ source: 'smart-edit', label: 'a', patches: [patch()] });
    const e2 = injected.record({ source: 'smart-edit', label: 'b', patches: [patch()] });
    expect(e1?.timestamp).toBe(1234);
    expect(e2?.timestamp).toBe(1234);
    expect(e1?.id).toBe('x1');
    expect(e2?.id).toBe('x2');

    const { journal: defaulted } = makeJournal();
    const d1 = defaulted.record({ source: 'smart-edit', label: 'a', patches: [patch()] });
    const d2 = defaulted.record({ source: 'smart-edit', label: 'b', patches: [patch()] });
    expect(d1?.timestamp).toBe(0);
    expect(d2?.timestamp).toBe(0);
    expect(d1?.id).toBe('e1');
    expect(d2?.id).toBe('e2');
  });
});

describe('EditJournal — shouldRecord gating', () => {
  it('disabled history: record() null, nothing stored, listener not fired', () => {
    const { journal, settings } = makeJournal();
    settings.enabled = false;
    const listener = vi.fn();
    journal.subscribe(listener);
    const result = journal.record({ source: 'smart-edit', label: 'a', patches: [patch()] });
    expect(result).toBeNull();
    expect(journal.entries()).toEqual([]);
    expect(journal.monitorEntries()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('suspended history: record() null, nothing stored; unsuspending allows the next record', () => {
    const { journal, settings } = makeJournal();
    settings.suspended = true;
    const listener = vi.fn();
    journal.subscribe(listener);
    expect(journal.record({ source: 'smart-edit', label: 'a', patches: [patch()] })).toBeNull();
    expect(journal.entries()).toEqual([]);
    expect(journal.monitorEntries()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();

    settings.suspended = false;
    const entry = journal.record({ source: 'smart-edit', label: 'b', patches: [patch()] });
    expect(entry).not.toBeNull();
    expect(journal.entries()).toEqual([entry]);
  });

  it('per-source gating: disabled source null, others still record; stream default-off', () => {
    const { journal, settings } = makeJournal();
    settings.recordSources.cellEditor = false;
    expect(journal.record({ source: 'cell-editor', label: 'a', patches: [patch()] })).toBeNull();
    const smartEntry = journal.record({ source: 'smart-edit', label: 'b', patches: [patch()] });
    expect(smartEntry).not.toBeNull();

    const { journal: fresh } = makeJournal();
    expect(fresh.record({ source: 'stream', label: 'c', patches: [patch()] })).toBeNull();
  });

  it('a gated (rejected) record leaves future intact', () => {
    const { journal, settings } = makeJournal();
    const a = journal.record({ source: 'smart-edit', label: 'A', patches: [patch()] });
    journal.undo();
    expect(journal.canRedo()).toBe(true);

    settings.suspended = true;
    const rejected = journal.record({ source: 'smart-edit', label: 'B', patches: [patch()] });
    expect(rejected).toBeNull();
    expect(journal.canRedo()).toBe(true);
    expect(journal.redo()).toEqual(a);
  });

  it('empty patches: record() null, nothing stored, no listener fire', () => {
    const { journal } = makeJournal();
    const listener = vi.fn();
    journal.subscribe(listener);
    const result = journal.record({ source: 'smart-edit', label: 'a', patches: [] });
    expect(result).toBeNull();
    expect(journal.entries()).toEqual([]);
    expect(journal.monitorEntries()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('EditJournal — undo/redo stacks', () => {
  it('record-after-undo clears future', () => {
    const { journal } = makeJournal();
    const a = journal.record({ source: 'smart-edit', label: 'A', patches: [patch()] });
    const b = journal.record({ source: 'smart-edit', label: 'B', patches: [patch()] });
    expect(journal.undo()).toEqual(b);
    const c = journal.record({ source: 'smart-edit', label: 'C', patches: [patch()] });
    expect(journal.canRedo()).toBe(false);
    expect(journal.redo()).toBeNull();
    expect(journal.entries()).toEqual([a, c]);
  });

  it('maxEntries trim drops OLDEST from past; monitor retains all', () => {
    const { journal, settings } = makeJournal();
    settings.maxEntries = 3;
    const entries = [1, 2, 3, 4].map((n) =>
      journal.record({ source: 'smart-edit', label: `e${n}`, patches: [patch()] }),
    );
    expect(journal.entries()).toEqual([entries[1], entries[2], entries[3]]);
    expect(journal.monitorEntries()).toEqual(entries);
  });

  it('monitorLimit trims the monitor list independently of maxEntries', () => {
    const { journal } = makeJournal({ monitorLimit: 2 });
    const entries = [1, 2, 3].map((n) =>
      journal.record({ source: 'smart-edit', label: `e${n}`, patches: [patch()] }),
    );
    expect(journal.monitorEntries()).toEqual([entries[1], entries[2]]);
    expect(journal.entries()).toEqual(entries);
  });

  it('live settings shrink applies at the next record, not retroactively', () => {
    const { journal, settings } = makeJournal();
    settings.maxEntries = 5;
    const entries = [1, 2, 3, 4, 5].map((n) =>
      journal.record({ source: 'smart-edit', label: `e${n}`, patches: [patch()] }),
    );
    settings.maxEntries = 2;
    const sixth = journal.record({ source: 'smart-edit', label: 'e6', patches: [patch()] });
    expect(journal.entries()).toEqual([entries[4], sixth]);
  });

  it('undo/redo round-trip with spy applier: correct entries, directions, and call count', () => {
    const { journal, applier } = makeJournal();
    const pa = patch({ rowId: 'ra' });
    const pb = patch({ rowId: 'rb' });
    const a = journal.record({ source: 'smart-edit', label: 'A', patches: [pa] });
    const b = journal.record({ source: 'smart-edit', label: 'B', patches: [pb] });

    expect(journal.undo()).toEqual(b);
    expect(applier).toHaveBeenLastCalledWith([pb], 'undo');
    expect(journal.undo()).toEqual(a);
    expect(applier).toHaveBeenLastCalledWith([pa], 'undo');
    expect(journal.undo()).toBeNull();
    expect(applier).toHaveBeenCalledTimes(2);

    expect(journal.redo()).toEqual(a);
    expect(applier).toHaveBeenLastCalledWith([pa], 'forward');
    expect(journal.redo()).toEqual(b);
    expect(applier).toHaveBeenLastCalledWith([pb], 'forward');
    expect(journal.redo()).toBeNull();
    expect(applier).toHaveBeenCalledTimes(4);
  });

  it('subscribe fires per mutation; unsubscribe stops delivery; multi-listener support', () => {
    const { journal } = makeJournal();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsubscribe = journal.subscribe(listener1);
    journal.subscribe(listener2);

    journal.record({ source: 'smart-edit', label: 'A', patches: [patch()] });
    expect(listener1).toHaveBeenCalledTimes(1);
    journal.undo();
    expect(listener1).toHaveBeenCalledTimes(2);
    journal.redo();
    expect(listener1).toHaveBeenCalledTimes(3);

    unsubscribe();
    journal.record({ source: 'smart-edit', label: 'B', patches: [patch()] });
    expect(listener1).toHaveBeenCalledTimes(3);
    expect(listener2).toHaveBeenCalledTimes(4);
  });

  it('entries()/monitorEntries() return defensive copies', () => {
    const { journal } = makeJournal();
    journal.record({ source: 'smart-edit', label: 'A', patches: [patch()] });
    const entriesCopy = journal.entries() as unknown as unknown[];
    const monitorCopy = journal.monitorEntries() as unknown as unknown[];
    entriesCopy.push('bogus');
    entriesCopy.pop();
    entriesCopy.pop();
    monitorCopy.splice(0, monitorCopy.length);

    expect(journal.entries().length).toBe(1);
    expect(journal.monitorEntries().length).toBe(1);
    expect(journal.canUndo()).toBe(true);
  });
});

describe('EditJournal — undoEntry cascade', () => {
  it('cascades undo through overlapping cells in newest-to-oldest order', () => {
    const store: Record<string, Record<string, unknown>> = { r1: { px: 1 } };
    const applier = vi.fn((patches: CellPatch[], direction: 'forward' | 'undo') => {
      for (const p of patches) {
        store[p.rowId]![p.field] = direction === 'forward' ? p.newValue : p.oldValue;
      }
    });
    const settings: DataChangeHistorySettings = structuredClone(DEFAULT_EDIT_SETTINGS.history);
    const journal = new EditJournal({ applyPatches: applier, getHistorySettings: () => settings });

    const p1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 2 };
    const p2: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 2, newValue: 3 };
    const p3: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 3, newValue: 4 };
    const e1 = journal.record({ source: 'smart-edit', label: 'e1', patches: [p1] });
    applier([p1], 'forward');
    const e2 = journal.record({ source: 'smart-edit', label: 'e2', patches: [p2] });
    applier([p2], 'forward');
    const e3 = journal.record({ source: 'smart-edit', label: 'e3', patches: [p3] });
    applier([p3], 'forward');
    applier.mockClear();

    expect(store.r1!.px).toBe(4);
    const undone = journal.undoEntry(e1!.id);
    expect(undone).toEqual([e3, e2, e1]);
    expect(store.r1!.px).toBe(1);
    expect(journal.canUndo()).toBe(false);
    expect(journal.canRedo()).toBe(true);

    // one applier call PER entry, never a coalesced batch
    expect(applier).toHaveBeenCalledTimes(3);
    expect(applier).toHaveBeenNthCalledWith(1, e3!.patches, 'undo');
    expect(applier).toHaveBeenNthCalledWith(2, e2!.patches, 'undo');
    expect(applier).toHaveBeenNthCalledWith(3, e1!.patches, 'undo');

    // redo replays forward in original chronological order
    expect(journal.redo()).toEqual(e1);
    expect(applier).toHaveBeenNthCalledWith(4, e1!.patches, 'forward');
    expect(journal.redo()).toEqual(e2);
    expect(applier).toHaveBeenNthCalledWith(5, e2!.patches, 'forward');
    expect(journal.redo()).toEqual(e3);
    expect(applier).toHaveBeenNthCalledWith(6, e3!.patches, 'forward');
    expect(store.r1!.px).toBe(4);
    expect(journal.redo()).toBeNull();
  });

  it('cascade target = newest degenerates to a plain undo()', () => {
    const { journal, applier } = makeJournal();
    const e1 = journal.record({ source: 'smart-edit', label: 'e1', patches: [patch({ rowId: 'r1' })] });
    const e2 = journal.record({ source: 'smart-edit', label: 'e2', patches: [patch({ rowId: 'r2' })] });
    const e3 = journal.record({ source: 'smart-edit', label: 'e3', patches: [patch({ rowId: 'r3' })] });
    applier.mockClear();

    const undone = journal.undoEntry(e3!.id);
    expect(undone).toEqual([e3]);
    expect(applier).toHaveBeenCalledTimes(1);
    expect(journal.entries()).toEqual([e1, e2]);
  });

  it('unknown entry id is a no-op: [] returned, no applier call, no listener fire, state unchanged', () => {
    const { journal, applier } = makeJournal();
    journal.record({ source: 'smart-edit', label: 'e1', patches: [patch()] });
    const listener = vi.fn();
    journal.subscribe(listener);
    applier.mockClear();

    const entriesBefore = journal.entries();
    const canRedoBefore = journal.canRedo();
    const result = journal.undoEntry('nope');
    expect(result).toEqual([]);
    expect(applier).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(journal.entries()).toEqual(entriesBefore);
    expect(journal.canRedo()).toBe(canRedoBefore);
  });

  it('notifies listeners exactly once across a multi-entry cascade', () => {
    const { journal, applier } = makeJournal();
    const e1 = journal.record({ source: 'smart-edit', label: 'e1', patches: [patch({ rowId: 'r1' })] });
    journal.record({ source: 'smart-edit', label: 'e2', patches: [patch({ rowId: 'r2' })] });
    journal.record({ source: 'smart-edit', label: 'e3', patches: [patch({ rowId: 'r3' })] });

    const listener = vi.fn();
    journal.subscribe(listener);
    applier.mockClear();

    journal.undoEntry(e1!.id);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
