/**
 * D-XSS1 — stored XSS via unescaped custom cell-format strings.
 *
 * `previewFormat()` compiles a user-authored format string and runs it
 * through `formatText()`; Excel-style quoted-literal sections are emitted
 * verbatim. Conditional Styling's and Calculated Columns' "Value formatter"
 * chips used to interpolate that output straight into `.innerHTML`, so any
 * rule/column carrying a payload like `"<img src=x onerror=alert(1)>"General`
 * executed markup every time the settings pane rendered the chip.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { compileFormat } from '@wellsfargo-starui/velocity-grid/format';
import { previewFormat } from '../src/toolbar/formatPicker';

const EXPLOIT_FORMAT = '"<img src=x onerror=alert(1)>"General';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

describe('format preview XSS (D-XSS1)', () => {
  it('exploit precondition: compileFormat compiles the payload and previewFormat passes it through verbatim', () => {
    const compiled = compileFormat(EXPLOIT_FORMAT);
    expect(compiled.ok).toBe(true);
    const preview = previewFormat(EXPLOIT_FORMAT, 1234.5);
    expect(preview).toContain('<img src=x onerror=alert(1)>');
  });

  it('Conditional Styling: a rule carrying the exploit valueFormatter renders no <img> in the settings sheet', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);
    wireRules(ext.grid);
    const grid = ext.grid as unknown as { addRule(rule: unknown): void };
    grid.addRule({
      id: 'xss_rule',
      name: 'xss',
      kind: 'style',
      enabled: true,
      priority: 0,
      scope: { kind: 'row' },
      condition: 'true',
      style: { base: {} },
      valueFormatter: EXPLOIT_FORMAT,
    });

    ext.openSettings('conditional-styling');

    expect(host.querySelector('img')).toBeNull();
    const fmtBtn = host.querySelector('.ckp-fmtbtn');
    expect(fmtBtn).not.toBeNull();
    expect(fmtBtn!.innerHTML).not.toContain('<img');

    ext.destroy();
    host.remove();
  });

  it('Calculated Columns: a column carrying the exploit format renders no <img> in the settings sheet', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, {
      getRowId: (r: { a: string }) => r.a,
      columnDefs: [{ colId: 'a', field: 'a', editable: true }],
      rowData: [{ a: '1' }],
    } as never);
    const { calc } = wireCalc(ext.grid);
    const result = calc.registerCalculatedColumn({
      colId: 'vcol_xss',
      headerName: 'XSS',
      expression: '[a]',
      cellDataType: 'number',
      position: 0,
      format: EXPLOIT_FORMAT,
    });
    expect(result.ok).toBe(true);

    ext.openSettings('calculated-columns');

    expect(host.querySelector('img')).toBeNull();
    const fmtBtn = host.querySelector('.ckp-fmtbtn');
    expect(fmtBtn).not.toBeNull();
    expect(fmtBtn!.innerHTML).not.toContain('<img');

    ext.destroy();
    host.remove();
  });
});
