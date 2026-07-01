/**
 * Cycle 7 / Task 6 — MultiConditionWrapper unit tests.
 *
 * Drives the wrapper through a fake `buildConditionRow` factory so the
 * per-type popups (text/number/date) can be tested in isolation. The
 * wrapper's only contract:
 *   - mount `numAlwaysVisibleConditions` rows initially
 *   - reveal the next row once the previous one is filled
 *   - mount a join-operator radio between rows; flipping fires onChange
 *     with the new operator
 *   - `maxNumConditions: 1` hides the join radio + the second row
 *     entirely
 *   - the composed `{ operator, conditions }` shape emitted via
 *     `onChange` carries only the filled rows
 */
import { describe, it, expect, vi } from 'vitest';
import { MultiConditionWrapper } from '../src/interaction/filters/multiCondition';
import type { CFilterModelEntry } from '../src/types';

/** Minimal condition stub — mounts a `<input>` whose value drives a
 *  fake CTextFilterModel. Empty input → null condition. */
function makeConditionFactory(): (
  initial: CFilterModelEntry | null,
  onChange: (next: CFilterModelEntry | null) => void,
) => HTMLElement {
  return (initial, onChange) => {
    const row = document.createElement('div');
    row.className = 'fake-condition-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-cg-test-condition', '');
    if (initial && initial.filterType === 'text' && initial.filter != null) {
      input.value = initial.filter;
    }
    input.addEventListener('input', () => {
      const v = input.value;
      if (v === '') onChange(null);
      else onChange({ filterType: 'text', type: 'contains', filter: v });
    });
    row.appendChild(input);
    return row;
  };
}

function fillRow(row: HTMLElement, value: string): void {
  const input = row.querySelector('input[data-cg-test-condition]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MultiConditionWrapper — initial mount', () => {
  it('mounts numAlwaysVisibleConditions rows initially (default 1)', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange: vi.fn(),
    });
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(1);
  });

  it('mounts two rows when numAlwaysVisibleConditions is 2', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 2,
      onChange: vi.fn(),
    });
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(2);
  });

  it('mounts the AND/OR join radio between the two rows', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 2,
      onChange: vi.fn(),
    });
    const radios = host.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);
    const checked = host.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value).toBe('AND');
  });
});

describe('MultiConditionWrapper — progressive reveal', () => {
  it('reveals the second row once the first is filled', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange: vi.fn(),
    });
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(1);
    fillRow(host.querySelectorAll('.fake-condition-row')[0] as HTMLElement, 'POS');
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(2);
    // Join radio also appears when the second row reveals.
    expect(host.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it('hides the second row + join radio when maxNumConditions is 1', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 1,
      numAlwaysVisibleConditions: 1,
      onChange: vi.fn(),
    });
    // Filling row 1 must NOT reveal a second row.
    fillRow(host.querySelectorAll('.fake-condition-row')[0] as HTMLElement, 'POS');
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(1);
    expect(host.querySelectorAll('input[type="radio"]').length).toBe(0);
  });
});

describe('MultiConditionWrapper — onChange composition', () => {
  it('emits a single-condition model when only the first row is filled', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange,
    });
    fillRow(host.querySelectorAll('.fake-condition-row')[0] as HTMLElement, 'POS');
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toEqual({
      operator: 'AND',
      conditions: [{ filterType: 'text', type: 'contains', filter: 'POS' }],
    });
  });

  it('emits a two-condition model when both rows are filled', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange,
    });
    fillRow(host.querySelectorAll('.fake-condition-row')[0] as HTMLElement, 'POS');
    fillRow(host.querySelectorAll('.fake-condition-row')[1] as HTMLElement, '100');
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.conditions.length).toBe(2);
    expect(last.conditions[0]).toEqual({ filterType: 'text', type: 'contains', filter: 'POS' });
    expect(last.conditions[1]).toEqual({ filterType: 'text', type: 'contains', filter: '100' });
  });

  it('flipping the join radio from AND to OR fires onChange with the new operator', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 2,
      onChange,
    });
    const orRadio = host.querySelector<HTMLInputElement>('input[type="radio"][value="OR"]');
    expect(orRadio).not.toBeNull();
    orRadio!.checked = true;
    orRadio!.dispatchEvent(new Event('change', { bubbles: true }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.operator).toBe('OR');
  });

  it('seeds the operator from defaultJoinOperator via `initial`', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'OR', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 2,
      onChange: vi.fn(),
    });
    const checked = host.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value).toBe('OR');
  });

  it('seeds rows from `initial.conditions`', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: {
        operator: 'AND',
        conditions: [{ filterType: 'text', type: 'contains', filter: 'seed1' }],
      },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange: vi.fn(),
    });
    const inputs = host.querySelectorAll<HTMLInputElement>('input[data-cg-test-condition]');
    expect(inputs.length).toBe(1);
    expect(inputs[0].value).toBe('seed1');
  });

  it('clearing the first condition hides the revealed second row', () => {
    const host = document.createElement('div');
    new MultiConditionWrapper(host, {
      buildConditionRow: makeConditionFactory(),
      initial: { operator: 'AND', conditions: [] },
      maxNumConditions: 2,
      numAlwaysVisibleConditions: 1,
      onChange: vi.fn(),
    });
    const firstRow = host.querySelectorAll('.fake-condition-row')[0] as HTMLElement;
    fillRow(firstRow, 'POS');
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(2);
    fillRow(firstRow, '');
    expect(host.querySelectorAll('.fake-condition-row').length).toBe(1);
  });
});
