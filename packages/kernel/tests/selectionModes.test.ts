// Cycle 15.5 / Task 5 — groupSelects mode completeness tests.
//
// Tests the three group-selects modes ('self', 'descendants',
// 'filteredDescendants') plus the groupSelects/checkboxLocation wiring
// in SelectionModel, independently of cgrid.ts.

import { describe, it, expect } from 'vitest';
import { SelectionModel, type GroupMembershipResolver } from '../src/interaction/selectionModel';

// Synthetic membership resolver: each group maps to its leaf row IDs.
function makeResolver(map: Record<string, string[]>): GroupMembershipResolver {
  return {
    getDescendantRowIds(groupKey: string) {
      return map[groupKey] ?? [];
    },
  };
}

// ─── 'descendants' mode (Task 8 behavior, now via setGroupSelects) ────────

describe("groupSelects: 'descendants'", () => {
  it('setGroupSelected cascades to all descendants', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('descendants', resolver);

    m.setGroupSelected('desk:APAC', true);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all');
  });

  it('deselect cascades removes all descendants', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('descendants', resolver);
    m.setSelectedRowIds(['1', '2', '3'], [0, 1, 2]);

    m.setGroupSelected('desk:APAC', false);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it('partial selection returns partial state', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('descendants', resolver);
    m.setSelectedRowIds(['1'], [0]);

    expect(m.getGroupSelectionState('desk:APAC')).toBe('partial');
  });

  it('getGroupSelects returns descendants', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('descendants', makeResolver({}));
    expect(m.getGroupSelects()).toBe('descendants');
  });

  it('isGroupSelectsChildren returns true for descendants mode', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('descendants', makeResolver({}));
    expect(m.isGroupSelectsChildren()).toBe(true);
  });
});

// ─── 'self' mode ──────────────────────────────────────────────────────────

describe("groupSelects: 'self'", () => {
  it('setGroupSelected marks the group key as selected', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);

    m.setGroupSelected('desk:APAC', true);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all');
  });

  it('getGroupSelectionState returns none when not selected', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it('deselect removes group from selected keys', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    m.setGroupSelected('desk:APAC', false);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it('self mode never returns partial — only none or all', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    // Selecting some but not all descendants (irrelevant in self mode)
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all');
    expect(m.getGroupSelectionState('desk:EMEA')).toBe('none');
  });

  it('getSelectedGroupKeys reflects selected group keys', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    m.setGroupSelected('desk:EMEA', true);
    const keys = m.getSelectedGroupKeys();
    expect(keys).toContain('desk:APAC');
    expect(keys).toContain('desk:EMEA');
    expect(keys).toHaveLength(2);
  });

  it('clearGroupKeySelection empties selected group keys', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    m.clearGroupKeySelection();
    expect(m.getSelectedGroupKeys()).toHaveLength(0);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it('setGroupSelected is no-op in none mode', () => {
    const m = new SelectionModel('none');
    m.setGroupSelects('self', null);
    const listener = vi.fn();
    m.onChange(listener);
    m.setGroupSelected('desk:APAC', true);
    expect(listener).not.toHaveBeenCalled();
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it('getGroupSelects returns self', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    expect(m.getGroupSelects()).toBe('self');
  });

  it('isGroupSelectsChildren returns false for self mode', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    expect(m.isGroupSelectsChildren()).toBe(false);
  });
});

// ─── 'filteredDescendants' mode ───────────────────────────────────────────

describe("groupSelects: 'filteredDescendants'", () => {
  it('setGroupSelected selects only filtered descendants', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    // Only rows 1 and 2 pass the filter
    m.setGroupSelects('filteredDescendants', resolver, new Set(['1', '2']));

    m.setGroupSelected('desk:APAC', true);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all'); // all filtered = 2/2
    // Row 3 should NOT be selected
    expect(m.getPersistentSelectedRowIds()).not.toContain('3');
    expect(m.getPersistentSelectedRowIds()).toContain('1');
    expect(m.getPersistentSelectedRowIds()).toContain('2');
  });

  it('getGroupSelectionState counts only filtered descendants', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('filteredDescendants', resolver, new Set(['1', '2']));
    // Manually select row 1 (in filter) and row 3 (NOT in filter)
    m.setSelectedRowIds(['1', '3'], [0, 2]);

    // 1 of 2 filtered descendants selected → partial
    expect(m.getGroupSelectionState('desk:APAC')).toBe('partial');
  });

  it('all filtered descendants selected → state is all', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('filteredDescendants', resolver, new Set(['2', '3']));
    m.setSelectedRowIds(['2', '3'], [1, 2]);
    // Row 1 not selected, but not in filter — all filtered descendants are selected
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all');
  });

  it('setFilteredIds updates the filter set', () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2', '3'] });
    m.setGroupSelects('filteredDescendants', resolver, new Set(['1']));
    m.setSelectedRowIds(['1'], [0]);
    expect(m.getGroupSelectionState('desk:APAC')).toBe('all'); // 1/1 filtered

    // Filter changes — now 2 rows are visible
    m.setFilteredIds(new Set(['1', '2']));
    expect(m.getGroupSelectionState('desk:APAC')).toBe('partial'); // 1/2 filtered
  });

  it('getGroupSelects returns filteredDescendants', () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('filteredDescendants', makeResolver({}), new Set());
    expect(m.getGroupSelects()).toBe('filteredDescendants');
  });
});

// ─── mode transitions ─────────────────────────────────────────────────────

describe('mode transitions', () => {
  it("switching from 'descendants' to 'none' does not clear selected IDs", () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1', '2'] });
    m.setGroupSelects('descendants', resolver);
    m.setGroupSelected('desk:APAC', true);

    m.setGroupSelects('none', null);

    // IDs persist — only mode machinery is disabled
    expect(m.getPersistentSelectedRowIds()).toContain('1');
    expect(m.getPersistentSelectedRowIds()).toContain('2');
    // But group state query returns none (mode is off)
    expect(m.getGroupSelectionState('desk:APAC')).toBe('none');
  });

  it("switching from 'self' to 'descendants' switches mode cleanly", () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    expect(m.getSelectedGroupKeys()).toHaveLength(1);

    const resolver = makeResolver({ 'desk:APAC': ['1', '2'] });
    m.setGroupSelects('descendants', resolver);
    // Self group-key selection is still in the set (not cleared),
    // but mode switches to descendants
    expect(m.getGroupSelects()).toBe('descendants');
    expect(m.isGroupSelectsChildren()).toBe(true);
  });

  it('default mode is none', () => {
    const m = new SelectionModel('multiple');
    expect(m.getGroupSelects()).toBe('none');
    expect(m.getGroupSelectionState('any:key')).toBe('none');
  });
});

// ─── onChange emission ─────────────────────────────────────────────────────

describe('onChange emission for group selects', () => {
  it("'self' mode emits on first select", () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    const listener = vi.fn();
    m.onChange(listener);
    m.setGroupSelected('desk:APAC', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("'self' mode does NOT emit on redundant select", () => {
    const m = new SelectionModel('multiple');
    m.setGroupSelects('self', null);
    m.setGroupSelected('desk:APAC', true);
    const listener = vi.fn();
    m.onChange(listener);
    m.setGroupSelected('desk:APAC', true); // already selected
    expect(listener).not.toHaveBeenCalled();
  });

  it("'filteredDescendants' emits when cascade mutates the set", () => {
    const m = new SelectionModel('multiple');
    const resolver = makeResolver({ 'desk:APAC': ['1'] });
    m.setGroupSelects('filteredDescendants', resolver, new Set(['1']));
    const listener = vi.fn();
    m.onChange(listener);
    m.setGroupSelected('desk:APAC', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// need vi for the spy
import { vi } from 'vitest';
