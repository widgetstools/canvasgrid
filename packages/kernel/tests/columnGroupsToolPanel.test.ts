import { describe, it, expect, vi } from 'vitest';
import { ColumnGroupsToolPanel } from '../src/interaction/toolPanels/columnGroupsPanel';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';
import type { CColDef, CColGroupDef } from '../src/types';

function makeParams(onApply: ReturnType<typeof vi.fn>) {
  const defs: (CColDef | CColGroupDef)[] = [
    { colId: 'sym', field: 'sym', headerName: 'Symbol' },
    { groupId: 'trade', headerName: 'Trade', children: [
      { colId: 'bid', field: 'bid' }, { colId: 'ask', field: 'ask' },
    ] },
  ];
  return {
    api: {
      getColumnGroupDefs: () => defs,
      updateGridOptions: onApply,
    },
  } as unknown as ToolPanelParams;
}

describe('ColumnGroupsToolPanel', () => {
  it('renders a row per group and per column', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    expect(gui.querySelectorAll('[data-cg-node]').length).toBe(4); // sym, trade, bid, ask
    expect(gui.querySelector('[data-cg-node="trade"]')!.getAttribute('data-kind')).toBe('group');
  });

  it('Apply is disabled until an edit dirties the model', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('clicking "+ Group" dirties the model and enables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it('Apply on an empty new group is validation-blocked (no write)', () => {
    const onApply = vi.fn();
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(onApply));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement).click();
    expect(onApply).toHaveBeenCalledTimes(0); // empty group fails validate()
  });

  it('Reset re-seeds from getColumnGroupDefs and disables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-cg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-cg-reset]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-cg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(panel.getGui().querySelectorAll('[data-cg-node]').length).toBe(4);
  });

  it('collapsing a group survives a subsequent mutation/re-render', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    const tradeRow = gui.querySelector('[data-cg-node="trade"]') as HTMLElement;
    const chevron = tradeRow.querySelector('.cg-colgroups-chevron') as HTMLButtonElement;
    expect(chevron.getAttribute('aria-expanded')).toBe('true');

    // Collapse the 'trade' group. Clicking re-renders the tree (fresh DOM
    // nodes), so re-query rather than reuse the stale `chevron` reference.
    chevron.click();
    const chevronAfterCollapse = (gui.querySelector('[data-cg-node="trade"]') as HTMLElement)
      .querySelector('.cg-colgroups-chevron') as HTMLButtonElement;
    expect(chevronAfterCollapse.getAttribute('aria-expanded')).toBe('false');
    const bidRowBefore = gui.querySelector('[data-cg-node="bid"]') as HTMLElement;
    expect(bidRowBefore.style.display).toBe('none');

    // Trigger an unrelated edit that re-renders the whole tree.
    (gui.querySelector('[data-cg-add-group]') as HTMLButtonElement).click();

    // The 'trade' group must still be collapsed after the re-render.
    const tradeRowAfter = gui.querySelector('[data-cg-node="trade"]') as HTMLElement;
    const chevronAfter = tradeRowAfter.querySelector('.cg-colgroups-chevron') as HTMLButtonElement;
    expect(chevronAfter.getAttribute('aria-expanded')).toBe('false');
    const bidRowAfter = gui.querySelector('[data-cg-node="bid"]') as HTMLElement;
    expect(bidRowAfter.style.display).toBe('none');
  });
});
