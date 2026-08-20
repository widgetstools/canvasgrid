// @wellsfargo-starui/velocity-grid-ext/edit — settings.test.ts
// Covers DEFAULT_EDIT_SETTINGS, mergeEditSettings, recordSourceKey, shouldRecord.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §2.2, §1.1.8.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 1, Step 1 (9 cases).

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EDIT_SETTINGS,
  mergeEditSettings,
  recordSourceKey,
  shouldRecord,
} from '../../src/edit/settings';
import type { EditSource, DataChangeHistorySettings } from '../../src/edit/types';

describe('DEFAULT_EDIT_SETTINGS', () => {
  it('matches the spec-locked defaults exactly', () => {
    expect(DEFAULT_EDIT_SETTINGS).toEqual({
      history: {
        enabled: true,
        maxEntries: 50,
        suspended: false,
        unifyUndo: true,
        recordSources: {
          smartEdit: true,
          bulkUpdate: true,
          plusMinus: true,
          shortcuts: true,
          cellEditor: true,
          stream: false,
        },
      },
      smartEdit: {
        enabled: true,
        incrementStep: 1,
        magnitudeShortcutsEnabled: true,
        enabledOps: ['multiply', 'divide', 'add', 'subtract', 'set'],
        confirmThreshold: 0,
        enforceSingleColumn: true,
        previewBeforeApply: true,
        recordHistory: true,
      },
      bulkUpdate: {
        enabled: true,
        confirmThreshold: 0,
        showDistinctValues: true,
        maxDropdownValues: 20,
        enforceSingleColumn: true,
        recordHistory: true,
      },
      plusMinus: { enabled: true, recordHistory: true },
      shortcuts: { enabled: true, recordHistory: true },
    });
    expect(DEFAULT_EDIT_SETTINGS.history.recordSources.stream).toBe(false);
  });
});

describe('mergeEditSettings', () => {
  it('with no argument deep-equals defaults but is not the same reference', () => {
    const merged = mergeEditSettings();
    expect(merged).toEqual(DEFAULT_EDIT_SETTINGS);
    expect(merged).not.toBe(DEFAULT_EDIT_SETTINGS);
    expect(merged.history).not.toBe(DEFAULT_EDIT_SETTINGS.history);
    expect(merged.history.recordSources).not.toBe(DEFAULT_EDIT_SETTINGS.history.recordSources);
    expect(merged.smartEdit).not.toBe(DEFAULT_EDIT_SETTINGS.smartEdit);
    expect(merged.smartEdit.enabledOps).not.toBe(DEFAULT_EDIT_SETTINGS.smartEdit.enabledOps);
    expect(merged.bulkUpdate).not.toBe(DEFAULT_EDIT_SETTINGS.bulkUpdate);
    expect(merged.plusMinus).not.toBe(DEFAULT_EDIT_SETTINGS.plusMinus);
    expect(merged.shortcuts).not.toBe(DEFAULT_EDIT_SETTINGS.shortcuts);
  });

  it('mutating a merge result never corrupts DEFAULT_EDIT_SETTINGS (no aliasing)', () => {
    const merged = mergeEditSettings();
    merged.smartEdit.enabledOps.push('add');
    merged.history.recordSources.stream = true;
    expect(DEFAULT_EDIT_SETTINGS.smartEdit.enabledOps).toEqual([
      'multiply', 'divide', 'add', 'subtract', 'set',
    ]);
    expect(DEFAULT_EDIT_SETTINGS.history.recordSources.stream).toBe(false);
  });

  it('applies a partial merge for a single nested field, leaving siblings default', () => {
    const merged = mergeEditSettings({ history: { maxEntries: 100 } });
    expect(merged.history.maxEntries).toBe(100);
    expect(merged.history.enabled).toBe(DEFAULT_EDIT_SETTINGS.history.enabled);
    expect(merged.history.suspended).toBe(DEFAULT_EDIT_SETTINGS.history.suspended);
    expect(merged.history.recordSources).toEqual(DEFAULT_EDIT_SETTINGS.history.recordSources);
  });

  it('merges recordSources per-key, leaving the other five defaults intact', () => {
    const merged = mergeEditSettings({ history: { recordSources: { stream: true } } });
    expect(merged.history.recordSources).toEqual({
      smartEdit: true,
      bulkUpdate: true,
      plusMinus: true,
      shortcuts: true,
      cellEditor: true,
      stream: true,
    });
  });

  it('drops unknown recordSources keys', () => {
    const merged = mergeEditSettings({
      history: { recordSources: { stream: true, bogus: true } as never },
    });
    expect(Object.keys(merged.history.recordSources).sort()).toEqual(
      ['bulkUpdate', 'cellEditor', 'plusMinus', 'shortcuts', 'smartEdit', 'stream'].sort(),
    );
    expect(merged.history.recordSources.stream).toBe(true);
  });

  it('replaces enabledOps wholesale and filters unknown ops, falling back to defaults when empty', () => {
    const merged = mergeEditSettings({ smartEdit: { enabledOps: ['add', 'nope' as never] } });
    expect(merged.smartEdit.enabledOps).toEqual(['add']);

    const allUnknown = mergeEditSettings({ smartEdit: { enabledOps: ['nope' as never] } });
    expect(allUnknown.smartEdit.enabledOps).toEqual(DEFAULT_EDIT_SETTINGS.smartEdit.enabledOps);
  });
});

describe('recordSourceKey', () => {
  it('maps every EditSource kebab-case value to its camelCase recordSources key', () => {
    const pairs: Array<[EditSource, keyof DataChangeHistorySettings['recordSources']]> = [
      ['smart-edit', 'smartEdit'],
      ['bulk-update', 'bulkUpdate'],
      ['plus-minus', 'plusMinus'],
      ['shortcut', 'shortcuts'],
      ['cell-editor', 'cellEditor'],
      ['stream', 'stream'],
    ];
    for (const [source, key] of pairs) {
      expect(recordSourceKey(source)).toBe(key);
    }
  });
});

describe('shouldRecord', () => {
  const sources: EditSource[] = [
    'smart-edit', 'bulk-update', 'plus-minus', 'shortcut', 'cell-editor', 'stream',
  ];

  it('is false for every source when history is disabled', () => {
    const settings: DataChangeHistorySettings = {
      ...DEFAULT_EDIT_SETTINGS.history,
      enabled: false,
    };
    for (const source of sources) {
      expect(shouldRecord(source, settings)).toBe(false);
    }
  });

  it('is false for every source when history is suspended (even if enabled)', () => {
    const settings: DataChangeHistorySettings = {
      ...DEFAULT_EDIT_SETTINGS.history,
      enabled: true,
      suspended: true,
    };
    for (const source of sources) {
      expect(shouldRecord(source, settings)).toBe(false);
    }
  });

  it('mirrors the per-source recordSources flag when enabled and unsuspended', () => {
    const settings: DataChangeHistorySettings = {
      enabled: true,
      maxEntries: 50,
      suspended: false,
      unifyUndo: true,
      recordSources: {
        smartEdit: true,
        bulkUpdate: false,
        plusMinus: true,
        shortcuts: false,
        cellEditor: true,
        stream: false,
      },
    };
    expect(shouldRecord('smart-edit', settings)).toBe(true);
    expect(shouldRecord('bulk-update', settings)).toBe(false);
    expect(shouldRecord('plus-minus', settings)).toBe(true);
    expect(shouldRecord('shortcut', settings)).toBe(false);
    expect(shouldRecord('cell-editor', settings)).toBe(true);
    expect(shouldRecord('stream', settings)).toBe(false);
  });

  it('is false for stream by default (default-off lock)', () => {
    expect(shouldRecord('stream', DEFAULT_EDIT_SETTINGS.history)).toBe(false);
  });
});

describe('JSON cleanliness', () => {
  it('DEFAULT_EDIT_SETTINGS round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_EDIT_SETTINGS))).toEqual(DEFAULT_EDIT_SETTINGS);
  });
});
