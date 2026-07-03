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

describe('EditJournal — undoEntry (Task 2 stub)', () => {
  it('throws not-yet-implemented (replaced by the Task 3 cascade suite)', () => {
    const { journal } = makeJournal();
    journal.record({ source: 'smart-edit', label: 'e1', patches: [patch()] });
    expect(() => journal.undoEntry('e1')).toThrow('not-yet-implemented');
  });
});
