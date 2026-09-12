/**
 * The Styling Rules editor pane.
 *
 * Two things are under test, and both are about a rule editor telling the
 * truth about the rule it is editing:
 *
 *   1. the header/cells TARGET switch — it must exist where it is meaningful
 *      (a cell-scoped rule names columns, so it can name their headers), be
 *      absent where it is not (a row-scoped rule names no column), and write
 *      `target` onto the draft;
 *   2. the PREVIEW — three cells showing the column header, a matching row
 *      and a non-matching one, so a style, a format string and the target
 *      switch all report to one place instead of being invisible until the
 *      rule is saved and the grid repaints.
 *
 * The head is checked too: it used to be six unlabelled controls, and a
 * select reading "Row" beside a number reading "0" is not a rule's scope and
 * priority to anyone who has not memorised the order.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function openEditor(): { host: HTMLElement; ext: VelocityGridExt; destroy(): void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ext = new VelocityGridExt(host, {
    getRowId: (r: { id: string }) => r.id,
    columnDefs: [
      { colId: 'id', field: 'id' },
      { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number' },
    ],
    rowData: [{ id: '1', pnl: -5 }],
  } as never);
  wireRules(ext.grid);
  ext.openSettings('conditional-styling');
  (host.querySelector('.ckp-addbtn') as HTMLButtonElement).click();
  return { host, ext, destroy() { ext.destroy(); host.remove(); } };
}

/** The scope select lives in the head's meta line. */
const scopeSelect = (host: HTMLElement): HTMLSelectElement =>
  host.querySelector('.ckp-metafield .ckp-select') as HTMLSelectElement;

function setScope(host: HTMLElement, kind: 'cell' | 'row'): void {
  const sel = scopeSelect(host);
  sel.value = kind;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The "Apply to" segmented control, or null when the band doesn't offer it. */
function targetPills(host: HTMLElement): HTMLElement | null {
  const row = Array.from(host.querySelectorAll('.ckp-row')).find(
    (r) => r.querySelector('.ckp-row-title')?.textContent === 'Apply to',
  );
  return (row?.querySelector('.ckp-pills') as HTMLElement) ?? null;
}

const pill = (pills: HTMLElement, label: string): HTMLButtonElement =>
  Array.from(pills.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

describe('the head names its controls', () => {
  it('every meta field carries a label', () => {
    const t = openEditor();
    expect(Array.from(t.host.querySelectorAll('.ckp-metafield .ckp-caps')).map((c) => c.textContent))
      .toEqual(['Status', 'Scope', 'Priority', 'Applied']);
    t.destroy();
  });

  it('Save and Reset stay in the head, not in the meta line', () => {
    const t = openEditor();
    const actions = t.host.querySelector('.ckp-head-actions') as HTMLElement;
    expect(actions.textContent).toContain('Save');
    expect(actions.textContent).toContain('Reset');
    t.destroy();
  });
});

describe('the header/cells target switch', () => {
  it('is offered for a cell-scoped rule', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    const pills = targetPills(t.host);
    expect(pills).not.toBeNull();
    expect(Array.from(pills!.querySelectorAll('button')).map((b) => b.textContent))
      .toEqual(['Cells', 'Header', 'Both']);
    t.destroy();
  });

  it('starts on Cells — the default a rule without a target means', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    expect(pill(targetPills(t.host)!, 'Cells').classList.contains('on')).toBe(true);
    t.destroy();
  });

  it('is offered for a row-scoped rule too — that is the scope a new rule starts on', () => {
    // Hiding it under row scope made the whole feature invisible: the
    // editor opens on a new row-scoped rule, so nobody who had not already
    // switched to Cell ever saw the switch.
    const t = openEditor();
    setScope(t.host, 'row');
    expect(targetPills(t.host)).not.toBeNull();
    t.destroy();
  });

  it('says which headers it will reach, and that depends on the scope', () => {
    const t = openEditor();
    setScope(t.host, 'row');
    const help = t.host.querySelector('.ckp-row .ckp-help') as HTMLElement;
    expect(help.textContent).toContain('every column');
    setScope(t.host, 'cell');
    expect((t.host.querySelector('.ckp-row .ckp-help') as HTMLElement).textContent)
      .toContain('no row for the expression to test');
    t.destroy();
  });

  it('writes the choice onto the saved rule', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    // A cell-scoped rule needs a column before it will save.
    const picker = Array.from(t.host.querySelectorAll('select')).find(
      (s) => s.options[0]?.textContent === 'Add column…',
    ) as HTMLSelectElement;
    picker.value = 'pnl';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    pill(targetPills(t.host)!, 'Both').click();
    (t.host.querySelector('.ckp-head-actions .ckp-actbtn') as HTMLButtonElement).click();

    const rules = (t.ext.grid as unknown as { getRules(): Array<{ target?: string }> }).getRules();
    expect(rules[0]?.target).toBe('both');
    t.destroy();
  });

  it('survives a scope change — scope and target are different questions', () => {
    // Scope decides WHICH columns, target decides which part of them.
    // Resetting one because the other moved loses work silently.
    const t = openEditor();
    setScope(t.host, 'cell');
    pill(targetPills(t.host)!, 'Header').click();
    setScope(t.host, 'row');
    expect(pill(targetPills(t.host)!, 'Header').classList.contains('on')).toBe(true);
    t.destroy();
  });

  it('a row-scoped header rule saves with its target', () => {
    const t = openEditor();
    pill(targetPills(t.host)!, 'Header').click();
    (t.host.querySelector('.ckp-head-actions .ckp-actbtn') as HTMLButtonElement).click();
    const rules = (t.ext.grid as unknown as { getRules(): Array<{ target?: string }> }).getRules();
    expect(rules[0]?.target).toBe('header');
    t.destroy();
  });
});

describe('alignment sits on the font row', () => {
  /** The one visible ribbon deck in the Style band — Font, after the move. */
  const fontDeck = (host: HTMLElement): HTMLElement =>
    host.querySelector('.ckp-stylechrome .vgext-rb-grp:not([hidden]) .vgext-rb-deck') as HTMLElement;

  const alignBtn = (host: HTMLElement, which: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll('.ckp-stylechrome button'))
      .find((b) => (b as HTMLElement).title === `Align ${which}`) as HTMLButtonElement;

  it('the three alignment buttons are in the font deck, after the font controls', () => {
    // The chrome ships alignment as its own ribbon group; in this pane that
    // would be a third labelled block under Font and Borders for three
    // buttons, so the module re-parents it onto the font row.
    const t = openEditor();
    const titles = Array.from(fontDeck(t.host).querySelectorAll('button')).map((b) => (b as HTMLElement).title);
    expect(titles).toEqual(expect.arrayContaining(['Align left', 'Align center', 'Align right']));
    // After, not before: bold still leads the row.
    expect(titles.indexOf('Align left')).toBeGreaterThan(titles.indexOf('Bold'));
    t.destroy();
  });

  it('the group it came from is retired, not left as an empty label', () => {
    const t = openEditor();
    const hidden = t.host.querySelectorAll('.ckp-stylechrome .vgext-rb-grp[hidden]');
    expect(hidden.length).toBe(1);
    expect(hidden[0]!.querySelector('button')).toBeNull();
    t.destroy();
  });

  it('clicking one writes halign onto the rule', () => {
    const t = openEditor();
    alignBtn(t.host, 'center').click();
    (t.host.querySelector('.ckp-head-actions .ckp-actbtn') as HTMLButtonElement).click();
    const rules = (t.ext.grid as unknown as {
      getRules(): Array<{ style?: { base?: { halign?: string } } }>;
    }).getRules();
    expect(rules[0]?.style?.base?.halign).toBe('center');
    t.destroy();
  });

  it('and moves the preview with it', () => {
    const t = openEditor();
    const match = t.host.querySelectorAll('.ckp-pv-cell')[1] as HTMLElement;
    alignBtn(t.host, 'center').click();
    expect(match.style.justifyContent).toBe('center');
    alignBtn(t.host, 'left').click();
    expect(match.style.justifyContent).toBe('flex-start');
    t.destroy();
  });

  it('nothing is highlighted until an alignment is chosen', () => {
    // The ribbon falls back to 'left' because a column always has an
    // alignment; a rule may have none, and "no override" must not read as
    // "left is set".
    const t = openEditor();
    const on = Array.from(t.host.querySelectorAll('.ckp-stylechrome [data-vg-field="halign"] button'))
      .filter((b) => b.classList.contains('is-on'));
    expect(on).toHaveLength(0);
    t.destroy();
  });

  it('clicking the chosen alignment again clears it', () => {
    // Otherwise there is no way back to "leave the column alone" once a
    // button has been pressed.
    const t = openEditor();
    alignBtn(t.host, 'center').click();
    const match = t.host.querySelectorAll('.ckp-pv-cell')[1] as HTMLElement;
    expect(match.style.justifyContent).toBe('center');
    alignBtn(t.host, 'center').click();
    expect(match.style.justifyContent).toBe('');
    expect(Array.from(t.host.querySelectorAll('.ckp-stylechrome [data-vg-field="halign"] button'))
      .filter((b) => b.classList.contains('is-on'))).toHaveLength(0);
    t.destroy();
  });

  it('alignment follows the Apply to target, like every other style property', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    alignBtn(t.host, 'center').click();
    const header = t.host.querySelector('.ckp-pv-cell.is-header') as HTMLElement;
    const match = t.host.querySelectorAll('.ckp-pv-cell')[1] as HTMLElement;

    pill(targetPills(t.host)!, 'Header').click();
    expect(header.style.justifyContent).toBe('center');
    expect(match.style.justifyContent).toBe('');

    pill(targetPills(t.host)!, 'Both').click();
    expect(header.style.justifyContent).toBe('center');
    expect(match.style.justifyContent).toBe('center');
    t.destroy();
  });
});

describe('the preview', () => {
  it('shows the header, a match and a non-match', () => {
    const t = openEditor();
    expect(Array.from(t.host.querySelectorAll('.ckp-pv-tag')).map((n) => n.textContent))
      .toEqual(['Header', 'Match', 'No match']);
    t.destroy();
  });

  it('names the target column in the header cell', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    const picker = Array.from(t.host.querySelectorAll('select')).find(
      (s) => s.options[0]?.textContent === 'Add column…',
    ) as HTMLSelectElement;
    picker.value = 'pnl';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    expect(t.host.querySelector('.ckp-pv-cell.is-header')?.textContent).toBe('P&L');
    t.destroy();
  });

  it('moves the style between the header and the cells with the switch', () => {
    const t = openEditor();
    setScope(t.host, 'cell');
    // Reach past the toolbar chrome and set the draft's style directly —
    // the colour control is a popover, and what is under test is which cell
    // the preview paints, not how the colour was chosen.
    const bold = Array.from(t.host.querySelectorAll('.ckp-stylechrome button'))
      .find((b) => (b as HTMLElement).title === 'Bold') as HTMLButtonElement | undefined;
    bold?.click();

    const header = t.host.querySelector('.ckp-pv-cell.is-header') as HTMLElement;
    const match = t.host.querySelectorAll('.ckp-pv-cell')[1] as HTMLElement;
    const noMatch = t.host.querySelectorAll('.ckp-pv-cell')[2] as HTMLElement;

    pill(targetPills(t.host)!, 'Cells').click();
    expect(match.style.fontWeight).toBe('bold');
    expect(header.style.fontWeight).toBe('');

    pill(targetPills(t.host)!, 'Header').click();
    expect(header.style.fontWeight).toBe('bold');
    expect(match.style.fontWeight).toBe('');

    pill(targetPills(t.host)!, 'Both').click();
    expect(header.style.fontWeight).toBe('bold');
    expect(match.style.fontWeight).toBe('bold');

    // The row the rule does not match is never styled, whatever the target.
    expect(noMatch.style.fontWeight).toBe('');
    t.destroy();
  });
});

describe('problems are reported where the control lives', () => {
  it('an unpicked target column is called out in its own band, not under the expression', () => {
    // `validateRule` answers for the whole rule: "rule.scope must be { kind:
    // 'row' } or …" used to print under the expression editor and underline
    // the expression, which is not where the problem is. The Target columns
    // band already says it, next to the picker that fixes it.
    const t = openEditor();
    setScope(t.host, 'cell');
    expect(t.host.querySelector('.ckp-warn')?.textContent).toContain('No columns');
    expect((t.host.querySelector('.ckp-error') as HTMLElement).style.display).toBe('none');
    // …and it is not repeated in the rule-level strip.
    expect((t.host.querySelector('.ckp-notice-shape') as HTMLElement).style.display).toBe('none');
    t.destroy();
  });

  it('an empty name goes to the rule-level strip — it has no band of its own', () => {
    const t = openEditor();
    const name = t.host.querySelector('.ckp-rule-topline .ckp-title') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const notice = t.host.querySelector('.ckp-notice-shape') as HTMLElement;
    expect(notice.style.display).not.toBe('none');
    expect(notice.textContent).toContain('Give the rule a name');
    t.destroy();
  });

  it('and clears as soon as the name is back', () => {
    const t = openEditor();
    const name = t.host.querySelector('.ckp-rule-topline .ckp-title') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.value = 'pnl_alert';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect((t.host.querySelector('.ckp-notice-shape') as HTMLElement).style.display).toBe('none');
    t.destroy();
  });
});

describe('the format picker is on the Settings tab, not behind Advanced', () => {
  it('the Number format band is in the default view', () => {
    const t = openEditor();
    const titles = Array.from(t.host.querySelectorAll('.ckp-band-title')).map((n) => n.textContent);
    expect(titles).toContain('Number format');
    expect(t.host.querySelector('.ckp-fmtbtn')).not.toBeNull();
    t.destroy();
  });
});
