// @wellsfargo-starui/velocity-grid-edit — shortcuts.test.ts
// Covers collectShortcutKeys, matchShortcutForCell, buildShortcutPatches,
// detectShortcutConflicts.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.7.
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.6.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 9 Step 1 (11 cases).

import { describe, it, expect } from 'vitest';
import {
  collectShortcutKeys,
  matchShortcutForCell,
  buildShortcutPatches,
  detectShortcutConflicts,
} from '../src/shortcuts';
import type { CellTarget } from '../src/patches';
import type { ShortcutDefinition } from '../src/types';

function shortcut(overrides?: Partial<ShortcutDefinition>): ShortcutDefinition {
  return {
    id: 's1', name: 'shortcut', enabled: true,
    shortcutKey: 'm',
    operation: 'multiply',
    shortcutValue: 2,
    scope: { columnIds: [] },
    ...overrides,
  };
}

function target(overrides?: Partial<CellTarget>): CellTarget {
  return {
    rowId: 'r1', colId: 'qty', field: 'qty', value: 10, rowIndex: 0,
    rowData: {},
    ...overrides,
  };
}

describe('collectShortcutKeys', () => {
  it('Set contains only enabled keys, all lowercase', () => {
    const keys = collectShortcutKeys([
      shortcut({ shortcutKey: 'm', enabled: true }),
      shortcut({ shortcutKey: 'Q', enabled: false }),
      shortcut({ shortcutKey: 'X', enabled: true }),
    ]);
    expect(keys).toEqual(new Set(['m', 'x']));
  });

  it('empty input -> empty Set', () => {
    expect(collectShortcutKeys([])).toEqual(new Set());
  });
});

describe('matchShortcutForCell', () => {
  it('case-insensitive: stored lowercase matches an uppercase delivered key (Shift+M scenario)', () => {
    const s = shortcut({ shortcutKey: 'm' });
    expect(matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'M', [s])).toBe(s);
    expect(matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'm', [s])).toBe(s);
  });

  it('first-enabled-match ordering', () => {
    const a = shortcut({ id: 'a', shortcutKey: 'm' });
    const b = shortcut({ id: 'b', shortcutKey: 'm' });
    expect(matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'm', [a, b])?.id).toBe('a');
    expect(
      matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'm', [{ ...a, enabled: false }, b])?.id,
    ).toBe('b');
    expect(
      matchShortcutForCell(
        { colId: 'qty', field: 'qty' },
        'm',
        [{ ...a, enabled: false }, { ...b, enabled: false }],
      ),
    ).toBeNull();
    expect(matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'z', [a, b])).toBeNull();
  });

  it('scope rule parity with nudges: empty matches all; scoped matches colId OR field', () => {
    const empty = shortcut({ scope: { columnIds: [] } });
    expect(matchShortcutForCell({ colId: 'anything', field: 'anything' }, 'm', [empty])).toBe(empty);

    const scoped = shortcut({ scope: { columnIds: ['qty'] } });
    expect(matchShortcutForCell({ colId: 'qty', field: 'qty' }, 'm', [scoped])).toBe(scoped);
    expect(matchShortcutForCell({ colId: 'col_7', field: 'qty' }, 'm', [scoped])).toBe(scoped);
    expect(matchShortcutForCell({ colId: 'other', field: 'other' }, 'm', [scoped])).toBeNull();
  });
});

describe('buildShortcutPatches', () => {
  it('negative/fractional operands', () => {
    expect(
      buildShortcutPatches({
        targets: [target({ value: 10 })],
        key: 'm',
        shortcuts: [shortcut({ operation: 'multiply', shortcutValue: 0.5 })],
      }),
    ).toEqual([{ rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 5 }]);

    expect(
      buildShortcutPatches({
        targets: [target({ value: 10 })],
        key: 'm',
        shortcuts: [shortcut({ operation: 'add', shortcutValue: -5 })],
      }),
    ).toEqual([{ rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 5 }]);
  });

  // Type-level lock: this compiles ONLY while ShortcutDefinition['operation']
  // is exactly 'add' | 'subtract' | 'multiply' | 'divide' — a `never`-typed
  // default branch makes the switch exhaustive at compile time; adding or
  // removing a member from the union breaks this file's typecheck.
  it("operation union has NO 'set' (type-level exhaustive-switch lock)", () => {
    function valueFor(op: ShortcutDefinition['operation'], current: number, operand: number): number {
      switch (op) {
        case 'add':
          return current + operand;
        case 'subtract':
          return current - operand;
        case 'multiply':
          return current * operand;
        case 'divide':
          return current / operand;
        default: {
          const exhaustive: never = op;
          throw new Error(`unreachable: ${String(exhaustive)}`);
        }
      }
    }

    expect(valueFor('add', 10, 5)).toBe(15);
    expect(valueFor('subtract', 10, 5)).toBe(5);
    expect(valueFor('multiply', 10, 5)).toBe(50);
    expect(valueFor('divide', 10, 5)).toBe(2);

    // Runtime half via buildShortcutPatches for each op.
    for (const [op, expected] of [
      ['add', 15],
      ['subtract', 5],
      ['multiply', 50],
      ['divide', 2],
    ] as const) {
      const patches = buildShortcutPatches({
        targets: [target({ value: 10 })],
        key: 'm',
        shortcuts: [shortcut({ operation: op, shortcutValue: 5 })],
      });
      expect(patches[0]!.newValue).toBe(expected);
    }
  });

  it('non-numeric current skipped (via applyNumericOp -> null)', () => {
    expect(
      buildShortcutPatches({
        targets: [target({ value: '—' })],
        key: 'm',
        shortcuts: [shortcut()],
      }),
    ).toEqual([]);
  });

  it('mixed list: only scoped numeric value-changing targets produce patches', () => {
    const scoped = shortcut({ scope: { columnIds: ['qty'] } });
    const targets = [
      target({ rowId: 'scoped', colId: 'qty', value: 10 }),
      target({ rowId: 'unscoped', colId: 'other', field: 'other', value: 10 }),
    ];
    const patches = buildShortcutPatches({ targets, key: 'm', shortcuts: [scoped] });
    expect(patches).toEqual([{ rowId: 'scoped', colId: 'qty', field: 'qty', oldValue: 10, newValue: 20 }]);
  });

  it('Object.is no-op guard: multiply by 1 produces no patch', () => {
    const s = shortcut({ operation: 'multiply', shortcutValue: 1 });
    expect(buildShortcutPatches({ targets: [target({ value: 10 })], key: 'm', shortcuts: [s] })).toEqual([]);
  });
});

describe('detectShortcutConflicts', () => {
  const key = 'm';

  it('(a) empty vs empty scope -> conflict, winner first, shadowed = [second]', () => {
    const first = shortcut({ id: 'first', shortcutKey: key, scope: { columnIds: [] } });
    const second = shortcut({ id: 'second', shortcutKey: key, scope: { columnIds: [] } });
    expect(detectShortcutConflicts([first, second])).toEqual([
      { key, winnerId: 'first', shadowedIds: ['second'] },
    ]);
  });

  it('(b) empty vs scoped -> conflict (empty overlaps everything, both orderings)', () => {
    const empty = shortcut({ id: 'empty', shortcutKey: key, scope: { columnIds: [] } });
    const scoped = shortcut({ id: 'scoped', shortcutKey: key, scope: { columnIds: ['qty'] } });
    expect(detectShortcutConflicts([empty, scoped])).toEqual([
      { key, winnerId: 'empty', shadowedIds: ['scoped'] },
    ]);
    expect(detectShortcutConflicts([scoped, empty])).toEqual([
      { key, winnerId: 'scoped', shadowedIds: ['empty'] },
    ]);
  });

  it('(c) disjoint scoped scopes -> NO conflict, group omitted', () => {
    const a = shortcut({ id: 'a', shortcutKey: key, scope: { columnIds: ['qty'] } });
    const b = shortcut({ id: 'b', shortcutKey: key, scope: { columnIds: ['price'] } });
    expect(detectShortcutConflicts([a, b])).toEqual([]);
  });

  it('(d) intersecting scoped scopes -> conflict', () => {
    const a = shortcut({ id: 'a', shortcutKey: key, scope: { columnIds: ['qty', 'price'] } });
    const b = shortcut({ id: 'b', shortcutKey: key, scope: { columnIds: ['price'] } });
    expect(detectShortcutConflicts([a, b])).toEqual([
      { key, winnerId: 'a', shadowedIds: ['b'] },
    ]);
  });

  it('conflicts ignore disabled shortcuts', () => {
    const a = shortcut({ id: 'a', shortcutKey: key, scope: { columnIds: [] } });
    const disabled = shortcut({ id: 'disabled', shortcutKey: key, scope: { columnIds: [] }, enabled: false });
    const b = shortcut({ id: 'b', shortcutKey: key, scope: { columnIds: [] } });
    expect(detectShortcutConflicts([a, disabled, b])).toEqual([
      { key, winnerId: 'a', shadowedIds: ['b'] },
    ]);
  });

  it('grouping + shape: distinct keys -> distinct groups; 3-way shadow lists both later ids', () => {
    const onM1 = shortcut({ id: 'm1', shortcutKey: 'm', scope: { columnIds: [] } });
    const onM2 = shortcut({ id: 'm2', shortcutKey: 'm', scope: { columnIds: [] } });
    const onM3 = shortcut({ id: 'm3', shortcutKey: 'm', scope: { columnIds: [] } });
    const onQ = shortcut({ id: 'q1', shortcutKey: 'q', scope: { columnIds: [] } });
    expect(detectShortcutConflicts([onM1, onM2, onM3, onQ])).toEqual([
      { key: 'm', winnerId: 'm1', shadowedIds: ['m2', 'm3'] },
    ]);
  });

  it('conflict-free input -> []', () => {
    const a = shortcut({ id: 'a', shortcutKey: 'm', scope: { columnIds: ['qty'] } });
    const b = shortcut({ id: 'b', shortcutKey: 'q', scope: { columnIds: ['price'] } });
    expect(detectShortcutConflicts([a, b])).toEqual([]);
  });
});
