import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { defineCgridExt } from '../src/element';

beforeAll(() => { installGridTestEnv(); defineCgridExt(); });
beforeEach(() => localStorage.clear());

describe('<cgrid-ext>', () => {
  it('constructs a CGridExt on connect using .options', () => {
    const el = document.createElement('cgrid-ext') as any;
    el.options = { columnDefs: [{ colId: 'a', field: 'a' }], rowData: [], getRowId: (r: any) => r.a };
    document.body.appendChild(el);
    expect(el.querySelector('.cgext-root')).toBeTruthy();
    expect(el.instance).toBeTruthy();
    el.remove();
  });

  it('defineCgridExt is idempotent', () => {
    expect(() => { defineCgridExt(); defineCgridExt(); }).not.toThrow();
  });
});
