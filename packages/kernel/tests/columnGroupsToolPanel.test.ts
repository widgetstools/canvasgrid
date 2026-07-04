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

  describe('columnGroupShow inline control', () => {
    it('renders on a grouped column row and NOT on an ungrouped column row', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      expect(gui.querySelector('[data-cg-node="bid"] [data-cg-groupshow]')).toBeTruthy();
      expect(gui.querySelector('[data-cg-node="sym"] [data-cg-groupshow]')).toBeNull();
    });

    it('changing the inline control dirties the model and Apply projects the chosen value', () => {
      const onApply = vi.fn();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply));
      const gui = panel.getGui();
      const select = gui.querySelector('[data-cg-node="bid"] [data-cg-groupshow]') as HTMLSelectElement;
      expect(select.value).toBe(''); // always (unset)

      select.value = 'open';
      select.dispatchEvent(new Event('change'));

      const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();

      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      const bid = trade.children.find((c: { colId?: string }) => c.colId === 'bid');
      expect(bid.columnGroupShow).toBe('open');
    });
  });

  describe('Style band', () => {
    // Note: the group-select control is a real <button> (see the
    // keyboard-accessibility test below); the switch fields it exposes are
    // `.cg-settings-toggle` buttons (aria-pressed), not <input> checkboxes
    // — verified against `settingsForm/form.ts` before writing these.

    it('the group-select affordance is a real, keyboard-reachable <button> (not tabindex=-1)', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const select = panel.getGui().querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement;
      // A native <button> is focusable/keyboard-activatable (Enter/Space)
      // by default — unlike Task 3's row, which was `tabIndex=-1` with
      // click-only select. Assert there's no explicit opt-out.
      expect(select.tagName).toBe('BUTTON');
      expect(select.getAttribute('tabindex')).toBeNull();
      expect((select as HTMLButtonElement).disabled).toBe(false);
    });

    it('selecting a group reveals a Style section bound to that group, and marks the row [data-selected]', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();

      const style = gui.querySelector('[data-cg-style]')!;
      expect(style.getAttribute('data-for')).toBe('trade');
      expect((gui.querySelector('[data-cg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);

      // Toggling marryChildren dirties the model (routes through mutate()/
      // setGroupStyle, same as any other panel edit — Apply-only discipline).
      const marry = style.querySelector('[data-cg-field="marryChildren"] .cg-settings-toggle') as HTMLButtonElement;
      expect(marry.getAttribute('aria-pressed')).toBe('false');
      marry.click();
      const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
    });

    it('clicking the select button again deselects and empties the Style band', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      const select = () => gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement;
      select().click();
      expect(gui.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe('trade');

      select().click();
      const style = gui.querySelector('[data-cg-style]')!;
      expect(style.getAttribute('data-for')).toBeNull();
      expect(style.children.length).toBe(0);
      expect((gui.querySelector('[data-cg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(false);
    });

    it('Apply projects the styled group headerStyle/marryChildren/openByDefault into columnDefs', () => {
      const onApply = vi.fn();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
      let style = gui.querySelector('[data-cg-style]')!;

      (style.querySelector('[data-cg-field="marryChildren"] .cg-settings-toggle') as HTMLButtonElement).click();
      // The Style band is rebuilt on every mutation — re-query it.
      style = gui.querySelector('[data-cg-style]')!;
      (style.querySelector('[data-cg-field="openByDefault"] .cg-settings-toggle') as HTMLButtonElement).click();
      style = gui.querySelector('[data-cg-style]')!;
      (style.querySelector('[data-cg-field="fontWeight"] .cg-settings-toggle') as HTMLButtonElement).click();

      (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
      expect(onApply).toHaveBeenCalledTimes(1);
      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      expect(trade.marryChildren).toBe(true);
      expect(trade.openByDefault).toBe(true);
      expect(trade.headerStyle.fontWeight).toBe('bold');
    });

    it('renders a "Children visibility" list bound to the selected group\'s columns, sharing setColumnGroupShow', () => {
      const onApply = vi.fn();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();

      const style = gui.querySelector('[data-cg-style]')!;
      const bidChild = style.querySelector('[data-cg-child-show="bid"]') as HTMLSelectElement;
      expect(bidChild).toBeTruthy();
      expect(bidChild.tagName).toBe('SELECT');
      expect(bidChild.value).toBe(''); // always (unset)

      bidChild.value = 'closed';
      bidChild.dispatchEvent(new Event('change'));

      const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);

      // Same helper wrote it — the inline control on the 'bid' row must
      // now reflect the identical value too (both surfaces never diverge).
      const inline = gui.querySelector('[data-cg-node="bid"] [data-cg-groupshow]') as HTMLSelectElement;
      expect(inline.value).toBe('closed');

      apply.click();
      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      const bid = trade.children.find((c: { colId?: string }) => c.colId === 'bid');
      expect(bid.columnGroupShow).toBe('closed');
    });

    // Task 9 — StarUI parity: italic/underline/fontSize/alignment/border.
    describe('Task 9 — enriched Style band', () => {
      it('exposes Italic/Underline/FontSize/Alignment/Border fields', () => {
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(vi.fn()));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = gui.querySelector('[data-cg-style]')!;
        for (const key of [
          'fontStyle', 'textDecoration', 'fontSize', 'halign',
          'borderWidth', 'borderStyle', 'borderColor',
        ]) {
          expect(style.querySelector(`[data-cg-field="${key}"]`)).toBeTruthy();
        }
      });

      it('toggling Italic sets headerStyle.fontStyle without wiping a previously-set Background/Bold (merge correctness)', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = gui.querySelector('[data-cg-style]')!;

        // Set Background first via the colour-picker control: click the
        // swatch to open the portaled popover, type a hex value, commit.
        const bgSwatch = style.querySelector('[data-cg-field="bg"] .cg-colorpicker-swatch') as HTMLButtonElement;
        bgSwatch.click();
        const bgHex = document.querySelector('.cg-colorpicker-popover .cg-colorpicker-hex') as HTMLInputElement;
        bgHex.value = '#112233';
        bgHex.dispatchEvent(new Event('change'));
        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());

        // Bold next (existing Task 4 field) — then Italic (new).
        style = gui.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="fontWeight"] .cg-settings-toggle') as HTMLButtonElement).click();
        style = gui.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="fontStyle"] .cg-settings-toggle') as HTMLButtonElement).click();

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fontStyle).toBe('italic');
        expect(trade.headerStyle.fontWeight).toBe('bold'); // not wiped
        expect(trade.headerStyle.bg).toBe('rgb(17, 34, 51)'); // not wiped
      });

      it('toggling Underline sets headerStyle.textDecoration', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = gui.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="textDecoration"] .cg-settings-toggle') as HTMLButtonElement).click();
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.textDecoration).toBe('underline');
      });

      it('setting Font size and Alignment writes headerStyle.fontSize/halign', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = gui.querySelector('[data-cg-style]')!;

        const sizeInput = style.querySelector('[data-cg-field="fontSize"] input') as HTMLInputElement;
        sizeInput.value = '14';
        sizeInput.dispatchEvent(new Event('change'));

        style = gui.querySelector('[data-cg-style]')!;
        const alignSelect = style.querySelector('[data-cg-field="halign"] select') as HTMLSelectElement;
        alignSelect.value = 'center';
        alignSelect.dispatchEvent(new Event('change'));

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fontSize).toBe(14);
        expect(trade.headerStyle.halign).toBe('center');
      });

      it('setting Border width/style/colour composes a single headerStyle.border.all object', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = gui.querySelector('[data-cg-style]')!;

        const widthInput = style.querySelector('[data-cg-field="borderWidth"] input') as HTMLInputElement;
        widthInput.value = '2';
        widthInput.dispatchEvent(new Event('change'));

        style = gui.querySelector('[data-cg-style]')!;
        const styleSelect = style.querySelector('[data-cg-field="borderStyle"] select') as HTMLSelectElement;
        styleSelect.value = 'dashed';
        styleSelect.dispatchEvent(new Event('change'));

        style = gui.querySelector('[data-cg-style]')!;
        const colorSwatch = style.querySelector('[data-cg-field="borderColor"] .cg-colorpicker-swatch') as HTMLButtonElement;
        colorSwatch.click();
        const colorHex = document.querySelector('.cg-colorpicker-popover .cg-colorpicker-hex') as HTMLInputElement;
        colorHex.value = '#ff0000';
        colorHex.dispatchEvent(new Event('change'));
        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.border.all).toEqual({ width: 2, style: 'dashed', color: 'rgb(255, 0, 0)' });
      });
    });

    it('switching selection to a different group rebinds the Style section', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-add-group]') as HTMLButtonElement).click(); // creates a second group
      const groupIds = Array.from(gui.querySelectorAll('[data-kind="group"]')).map((n) => n.getAttribute('data-cg-node'));
      expect(groupIds.length).toBe(2);
      const [firstId, secondId] = groupIds as [string, string];

      (gui.querySelector(`[data-cg-node="${firstId}"] [data-cg-select]`) as HTMLElement).click();
      expect(gui.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe(firstId);

      (gui.querySelector(`[data-cg-node="${secondId}"] [data-cg-select]`) as HTMLElement).click();
      expect(gui.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe(secondId);
      expect((gui.querySelector(`[data-cg-node="${firstId}"]`) as HTMLElement).hasAttribute('data-selected')).toBe(false);
    });
  });
});
