import { describe, it, expect } from 'vitest';
import { A11yOverlay } from '../src/interaction/a11yOverlay';

describe('A11yOverlay', () => {
  it('mounts a role=grid scaffold', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    new A11yOverlay(root);
    expect(root.querySelector('[role="grid"]')).toBeTruthy();
  });

  it('renders focused row cells with aria-label including header name + value', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = new A11yOverlay(root);
    a.update({
      visibleRowCount: 100,
      columnCount: 3,
      focusedRowIndex: 5,
      focusedColId: 'b',
      focusedRowData: [
        { colId: 'a', valueFormatted: 'apple' },
        { colId: 'b', valueFormatted: '12.5' },
      ],
    });
    const cells = root.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(2);
    expect((cells[0] as HTMLElement).getAttribute('aria-label')).toContain('apple');
    expect((cells[1] as HTMLElement).getAttribute('aria-label')).toContain('12.5');
  });

  it('updates aria-rowcount + aria-colcount + row aria-rowindex', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = new A11yOverlay(root);
    a.update({
      visibleRowCount: 200,
      columnCount: 5,
      focusedRowIndex: 9,
      focusedColId: 'a',
      focusedRowData: [{ colId: 'a', valueFormatted: 'x' }],
    });
    const grid = root.querySelector('[role="grid"]') as HTMLElement;
    expect(grid.getAttribute('aria-rowcount')).toBe('200');
    expect(grid.getAttribute('aria-colcount')).toBe('5');
    const row = root.querySelector('[role="row"]') as HTMLElement;
    expect(row.getAttribute('aria-rowindex')).toBe('10');
  });
});
