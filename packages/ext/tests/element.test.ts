import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { defineVelocityGridExt } from '../src/element';

beforeAll(() => { installGridTestEnv(); defineVelocityGridExt(); });
beforeEach(() => localStorage.clear());

describe('<velocity-grid-ext>', () => {
  it('constructs a VelocityGridExt on connect using .options', () => {
    const el = document.createElement('velocity-grid-ext') as any;
    el.options = { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [], getRowId: (r: any) => r.a };
    document.body.appendChild(el);
    expect(el.classList.contains('vgext-root')).toBe(true);
    expect(el.instance).toBeTruthy();
    el.remove();
  });

  it('defineVelocityGridExt is idempotent', () => {
    expect(() => { defineVelocityGridExt(); defineVelocityGridExt(); }).not.toThrow();
  });
});
