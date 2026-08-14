import { describe, it, expect, vi } from 'vitest';
import { ColumnGroupsToolPanel, pruneBorder } from '../src/interaction/toolPanels/columnGroupsPanel';
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

const styleIn = (gui: HTMLElement) => gui.querySelector('[data-vg-style]') as HTMLElement | null;
const selectTrade = (gui: HTMLElement) => {
  (gui.querySelector('[data-vg-node="trade"] [data-vg-select]') as HTMLElement).click();
};

describe('ColumnGroupsToolPanel', () => {
  it('list shows groups only (makeParams: trade at top level)', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    const groupNodes = gui.querySelectorAll('[data-vg-node][data-kind="group"]');
    expect(groupNodes.length).toBe(1);
    expect(gui.querySelector('[data-vg-node="trade"]')!.getAttribute('data-kind')).toBe('group');
    expect(gui.querySelector('[data-vg-node="bid"]')).toBeNull();
    expect(gui.querySelector('[data-vg-node="sym"]')).toBeNull();
  });

  it('renders master–detail body with list and editor; auto-selects first group', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    expect(gui.querySelector('.vg-colgroups-list')).toBeTruthy();
    expect(gui.querySelector('.vg-colgroups-editor')).toBeTruthy();
    expect(gui.querySelector('[data-vg-group-selected]')).toBeNull();
    expect((gui.querySelector('[data-vg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);
    expect(styleIn(gui)!.getAttribute('data-for')).toBe('trade');
  });

  it('Apply is disabled until an edit dirties the model', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const apply = panel.getGui().querySelector('[data-vg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('clicking data-vg-add-group dirties the model and enables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-vg-add-group]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-vg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });

  it('new group gets a unique id — rename and columns stay independent of existing groups', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      {
        groupId: 'vg-grp-1',
        headerName: 'Trade',
        children: [
          { colId: 'bid', field: 'bid', headerName: 'Bid' },
          { colId: 'ask', field: 'ask', headerName: 'Ask' },
        ],
      },
    ];
    const panel = new ColumnGroupsToolPanel();
    panel.init({
      api: {
        getColumnGroupDefs: () => defs,
        updateGridOptions: vi.fn(),
      },
    } as unknown as ToolPanelParams);

    (panel.getGui().querySelector('[data-vg-add-group]') as HTMLButtonElement).click();
    const gui = panel.getGui();
    expect(gui.querySelector('[data-vg-node="vg-grp-1"]')).toBeTruthy();
    expect(gui.querySelector('[data-vg-node="vg-grp-2"]')).toBeTruthy();
    expect((gui.querySelector('[data-vg-node="vg-grp-2"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);

    // New group must not show Trade's columns.
    const chips = [...gui.querySelectorAll('.vg-colgroups-chip')].map((c) => c.textContent);
    expect(chips).toEqual([]);
    expect(gui.querySelector('.vg-colgroups-chips-empty')).toBeTruthy();

    const nameInput = gui.querySelector('.vg-colgroups-rename') as HTMLInputElement;
    nameInput.value = 'Risk';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(gui.querySelector('[data-vg-node="vg-grp-1"] .vg-colgroups-list-name')!.textContent).toBe('Trade');
    expect(gui.querySelector('[data-vg-node="vg-grp-2"] .vg-colgroups-list-name')!.textContent).toBe('Risk');
  });

  it('does not expose list drag handle or visibility checkbox — Columns panel owns those', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    const gui = panel.getGui();
    expect(gui.querySelector('[data-vg-add-subgroup]')).toBeNull();
    expect(gui.querySelector('[data-vg-drag]')).toBeNull();
    expect(gui.querySelector('[data-vg-group-visible]')).toBeNull();
    expect(gui.querySelector('.vg-colgroups-grip')).toBeNull();
  });

  it('chip remove ungroups a column even when marryChildren is set', () => {
    const defs: (CColDef | CColGroupDef)[] = [
      {
        groupId: 'trade',
        headerName: 'Trade',
        marryChildren: true,
        children: [
          { colId: 'bid', field: 'bid', headerName: 'Bid' },
          { colId: 'ask', field: 'ask', headerName: 'Ask' },
        ],
      },
    ];
    const panel = new ColumnGroupsToolPanel();
    panel.init({
      api: {
        getColumnGroupDefs: () => defs,
        updateGridOptions: vi.fn(),
      },
    } as unknown as ToolPanelParams);

    const gui = panel.getGui();
    expect(gui.querySelector('[data-vg-chip="bid"]')).toBeTruthy();
    (gui.querySelector('[data-vg-chip="bid"] [data-vg-remove-col]') as HTMLButtonElement).click();

    expect(gui.querySelector('[data-vg-chip="bid"]')).toBeNull();
    expect(gui.querySelector('[data-vg-chip="ask"]')).toBeTruthy();
    expect((gui.querySelector('[data-vg-apply]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Apply on an empty new group is validation-blocked (no write)', () => {
    const onApply = vi.fn();
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(onApply));
    (panel.getGui().querySelector('[data-vg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-vg-apply]') as HTMLButtonElement).click();
    expect(onApply).toHaveBeenCalledTimes(0);
  });

  it('Reset re-seeds from getColumnGroupDefs and disables Apply', () => {
    const panel = new ColumnGroupsToolPanel();
    panel.init(makeParams(vi.fn()));
    (panel.getGui().querySelector('[data-vg-add-group]') as HTMLButtonElement).click();
    (panel.getGui().querySelector('[data-vg-reset]') as HTMLButtonElement).click();
    const apply = panel.getGui().querySelector('[data-vg-apply]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(panel.getGui().querySelectorAll('[data-vg-node][data-kind="group"]').length).toBe(1);
  });

  describe('columnGroupShow chip cycle', () => {
    it('renders on a chip inside the editor after selecting trade', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      selectTrade(gui);
      const chip = gui.querySelector('[data-vg-chip="bid"]') as HTMLElement;
      expect(chip).toBeTruthy();
      expect(chip.querySelector('[data-vg-groupshow]')).toBeTruthy();
      expect(gui.querySelector('[data-vg-add-col]')).toBeTruthy();
    });

    it('cycling the chip control dirties the model and Apply projects the value', () => {
      const onApply = vi.fn();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply));
      const gui = panel.getGui();
      selectTrade(gui);
      const showBtn = gui.querySelector('[data-vg-chip="bid"] [data-vg-groupshow]') as HTMLButtonElement;
      expect(showBtn.getAttribute('data-value')).toBe('');

      showBtn.click(); // null → open

      const apply = gui.querySelector('[data-vg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();

      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      const bid = trade.children.find((c: { colId?: string }) => c.colId === 'bid');
      expect(bid.columnGroupShow).toBe('open');
    });
  });

  describe('Style band (editor pane)', () => {
    it('list select affordance is a real, keyboard-reachable <button>', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const select = panel.getGui().querySelector('[data-vg-node="trade"] [data-vg-select]') as HTMLElement;
      expect(select.tagName).toBe('BUTTON');
      expect(select.getAttribute('tabindex')).toBeNull();
      expect((select as HTMLButtonElement).disabled).toBe(false);
    });

    it('selecting a group shows Style bound to it and marks the row [data-selected]', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      selectTrade(gui);

      const style = styleIn(gui)!;
      expect(style.getAttribute('data-for')).toBe('trade');
      expect((gui.querySelector('[data-vg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);

      const marry = style.querySelector('[data-vg-field="marryChildren"] input.vg-checkbox') as HTMLInputElement;
      expect(marry.checked).toBe(false);
      marry.checked = true;
      marry.dispatchEvent(new Event('change', { bubbles: true }));
      const apply = gui.querySelector('[data-vg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
    });

    it('clicking the same group again keeps it selected (no toggle-off)', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      const select = () => gui.querySelector('[data-vg-node="trade"] [data-vg-select]') as HTMLElement;
      select().click();
      expect(styleIn(gui)!.getAttribute('data-for')).toBe('trade');

      select().click();
      expect(styleIn(gui)!.getAttribute('data-for')).toBe('trade');
      expect((gui.querySelector('[data-vg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);
    });

    it('Apply projects the styled group headerStyle/marryChildren/openByDefault into columnDefs', () => {
      const onApply = vi.fn();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply));
      const gui = panel.getGui();
      selectTrade(gui);
      let style = styleIn(gui)!;

      const marryCb = style.querySelector('[data-vg-field="marryChildren"] input.vg-checkbox') as HTMLInputElement;
      marryCb.checked = true;
      marryCb.dispatchEvent(new Event('change', { bubbles: true }));
      style = styleIn(gui)!;
      const openCb = style.querySelector('[data-vg-field="openByDefault"] input.vg-checkbox') as HTMLInputElement;
      openCb.checked = true;
      openCb.dispatchEvent(new Event('change', { bubbles: true }));
      style = styleIn(gui)!;
      (style.querySelector('[data-vg-field="fontWeight"]') as HTMLButtonElement).click();

      (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
      expect(onApply).toHaveBeenCalledTimes(1);
      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      expect(trade.marryChildren).toBe(true);
      expect(trade.openByDefault).toBe(true);
      expect(trade.headerStyle.fontWeight).toBe('bold');
    });

    it('Style band holds styling clusters; columns are chips (not a membership checklist)', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      selectTrade(gui);

      const style = styleIn(gui)!;
      expect(style.querySelector('[data-vg-child-show]')).toBeNull();
      expect(style.querySelector('[data-vg-field="bg"]')).toBeTruthy();
      expect(style.querySelector('[data-vg-field="borderWidth"]')).toBeTruthy();
      expect(gui.querySelector('.vg-colgroups-membership')).toBeNull();
      expect(gui.querySelector('[data-vg-chip="bid"] [data-vg-groupshow]')).toBeTruthy();
    });

    describe('Task 9 — enriched Style band', () => {
      it('exposes Italic/Underline/FontSize/Alignment/Border fields', () => {
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(vi.fn()));
        const gui = panel.getGui();
        selectTrade(gui);
        const style = styleIn(gui)!;
        for (const key of [
          'fontStyle', 'textDecoration', 'fontSize', 'halign',
          'borderWidth', 'borderStyle', 'borderColor',
        ]) {
          expect(style.querySelector(`[data-vg-field="${key}"]`)).toBeTruthy();
        }
      });

      it('toggling Italic sets headerStyle.fontStyle without wiping a previously-set Background/Bold (merge correctness)', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        let style = styleIn(gui)!;

        const bgSwatch = style.querySelector('[data-vg-field="bg"] .vg-colorpicker-swatch') as HTMLButtonElement;
        bgSwatch.click();
        const bgHex = document.querySelector('.vg-colorpicker-popover .vg-colorpicker-hex') as HTMLInputElement;
        bgHex.value = '#112233';
        bgHex.dispatchEvent(new Event('change'));
        document.querySelectorAll('.vg-colorpicker-popover').forEach((p) => p.remove());

        style = styleIn(gui)!;
        (style.querySelector('[data-vg-field="fontWeight"]') as HTMLButtonElement).click();
        style = styleIn(gui)!;
        (style.querySelector('[data-vg-field="fontStyle"]') as HTMLButtonElement).click();

        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fontStyle).toBe('italic');
        expect(trade.headerStyle.fontWeight).toBe('bold');
        expect(trade.headerStyle.bg).toBe('rgb(17, 34, 51)');
      });

      it('toggling Underline sets headerStyle.textDecoration', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        const style = styleIn(gui)!;
        (style.querySelector('[data-vg-field="textDecoration"]') as HTMLButtonElement).click();
        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.textDecoration).toBe('underline');
      });

      it('setting Font size and Alignment writes headerStyle.fontSize/halign', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        let style = styleIn(gui)!;

        const sizeInput = style.querySelector('[data-vg-field="fontSize"] input') as HTMLInputElement;
        sizeInput.value = '14';
        sizeInput.dispatchEvent(new Event('change'));

        style = styleIn(gui)!;
        (style.querySelector('[data-vg-field="halign"] [data-align="center"]') as HTMLButtonElement).click();

        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
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
        selectTrade(gui);
        let style = styleIn(gui)!;

        const widthInput = style.querySelector('[data-vg-field="borderWidth"] input') as HTMLInputElement;
        widthInput.value = '2';
        widthInput.dispatchEvent(new Event('change'));

        style = styleIn(gui)!;
        const styleSelect = style.querySelector('[data-vg-field="borderStyle"] select') as HTMLSelectElement;
        styleSelect.value = 'dashed';
        styleSelect.dispatchEvent(new Event('change'));

        style = styleIn(gui)!;
        const colorSwatch = style.querySelector('[data-vg-field="borderColor"] .vg-colorpicker-swatch') as HTMLButtonElement;
        colorSwatch.click();
        const colorHex = document.querySelector('.vg-colorpicker-popover .vg-colorpicker-hex') as HTMLInputElement;
        colorHex.value = '#ff0000';
        colorHex.dispatchEvent(new Event('change'));
        document.querySelectorAll('.vg-colorpicker-popover').forEach((p) => p.remove());

        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.border.all).toEqual({ width: 2, style: 'dashed', color: 'rgb(255, 0, 0)' });
      });
    });

    describe('Fix 3 — colour commits do not tear down the Style band mid-drag', () => {
      it('a Fill colour commit flips dirty and writes headerStyle.bg WITHOUT rebuilding the Style band', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        const style = styleIn(gui)!;

        const bgSwatch = style.querySelector('[data-vg-field="bg"] .vg-colorpicker-swatch') as HTMLButtonElement;
        bgSwatch.click();
        const popover = document.querySelector('.vg-colorpicker-popover') as HTMLElement;
        const bgHex = popover.querySelector('.vg-colorpicker-hex') as HTMLInputElement;
        bgHex.value = '#112233';
        bgHex.dispatchEvent(new Event('change'));

        expect(style.querySelector('[data-vg-field="bg"] .vg-colorpicker-swatch')).toBe(bgSwatch);
        expect(document.body.contains(popover)).toBe(true);
        expect(document.querySelector('.vg-colorpicker-popover')).toBe(popover);

        const apply = gui.querySelector('[data-vg-apply]') as HTMLButtonElement;
        expect(apply.disabled).toBe(false);
        apply.click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.bg).toBe('rgb(17, 34, 51)');

        document.querySelectorAll('.vg-colorpicker-popover').forEach((p) => p.remove());
      });

      it('a Text colour commit writes headerStyle.fg without throwing', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        const style = styleIn(gui)!;

        const fgSwatch = style.querySelector('[data-vg-field="fg"] .vg-colorpicker-swatch') as HTMLButtonElement;
        fgSwatch.click();
        const fgHex = document.querySelector('.vg-colorpicker-popover .vg-colorpicker-hex') as HTMLInputElement;
        fgHex.value = '#00ff00';
        expect(() => fgHex.dispatchEvent(new Event('change'))).not.toThrow();
        document.querySelectorAll('.vg-colorpicker-popover').forEach((p) => p.remove());

        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fg).toBe('rgb(0, 255, 0)');
      });

      it('a Border colour commit writes headerStyle.border.<edge>.color and does not rebuild the Style band', () => {
        const onApply = vi.fn();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        let style = styleIn(gui)!;
        const sideSel = style.querySelector('[data-vg-border-side]') as HTMLSelectElement;
        sideSel.value = 'top';
        sideSel.dispatchEvent(new Event('change'));
        style = styleIn(gui)!;

        const borderSwatch = style.querySelector('[data-vg-field="borderColor"] .vg-colorpicker-swatch') as HTMLButtonElement;
        borderSwatch.click();
        const popover = document.querySelector('.vg-colorpicker-popover') as HTMLElement;
        const hex = popover.querySelector('.vg-colorpicker-hex') as HTMLInputElement;
        hex.value = '#abcdef';
        hex.dispatchEvent(new Event('change'));

        expect(style.querySelector('[data-vg-field="borderColor"] .vg-colorpicker-swatch')).toBe(borderSwatch);
        expect(document.body.contains(popover)).toBe(true);

        document.querySelectorAll('.vg-colorpicker-popover').forEach((p) => p.remove());
        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.border.top.color).toBe('rgb(171, 205, 239)');
      });
    });

    describe('Fix 4 — distinct colour-swatch aria-labels', () => {
      it('gives the Fill/Text/Border swatches distinct aria-labels instead of the generic default', () => {
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(vi.fn()));
        const gui = panel.getGui();
        selectTrade(gui);
        const style = styleIn(gui)!;

        const bg = style.querySelector('[data-vg-field="bg"] .vg-colorpicker-swatch')!;
        const fg = style.querySelector('[data-vg-field="fg"] .vg-colorpicker-swatch')!;
        const border = style.querySelector('[data-vg-field="borderColor"] .vg-colorpicker-swatch')!;

        expect(bg.getAttribute('aria-label')).toBe('Background colour');
        expect(fg.getAttribute('aria-label')).toBe('Text colour');
        expect(border.getAttribute('aria-label')).toMatch(/border colour$/i);
        expect(new Set([bg, fg, border].map((s) => s.getAttribute('aria-label'))).size).toBe(3);
      });
    });

    describe('Task 12 — box-model border editor', () => {
      function selectAndStyleGroup(onApply = vi.fn()) {
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply));
        const gui = panel.getGui();
        selectTrade(gui);
        return { gui, onApply };
      }
      const style = (gui: HTMLElement) => styleIn(gui)!;
      const setWidth = (gui: HTMLElement, v: string) => {
        const w = style(gui).querySelector('[data-vg-field="borderWidth"] input') as HTMLInputElement;
        w.value = v;
        w.dispatchEvent(new Event('change'));
      };
      const setStyle = (gui: HTMLElement, v: string) => {
        const s = style(gui).querySelector('[data-vg-field="borderStyle"] select') as HTMLSelectElement;
        s.value = v;
        s.dispatchEvent(new Event('change'));
      };
      const clickEdge = (gui: HTMLElement, edge: string) => {
        const sel = style(gui).querySelector('[data-vg-border-side]') as HTMLSelectElement;
        sel.value = edge;
        sel.dispatchEvent(new Event('change'));
      };
      const applied = (onApply: ReturnType<typeof vi.fn>) => {
        const { columnDefs } = onApply.mock.calls[0][0];
        return columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      };

      it('defaults to the "all" side (the Side selector reads All on open)', () => {
        const { gui } = selectAndStyleGroup();
        expect(style(gui).querySelector('[data-vg-border]')).toBeTruthy();
        expect((style(gui).querySelector('[data-vg-border-side]') as HTMLSelectElement).value).toBe('all');
      });

      it('selecting the top side then setting width/style writes headerStyle.border.top (not .all)', () => {
        const { gui, onApply } = selectAndStyleGroup();
        clickEdge(gui, 'top');
        expect((style(gui).querySelector('[data-vg-border-side]') as HTMLSelectElement).value).toBe('top');
        setWidth(gui, '3');
        setStyle(gui, 'dotted');
        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const trade = applied(onApply);
        expect(trade.headerStyle.border.top).toEqual({ width: 3, style: 'dotted' });
        expect(trade.headerStyle.border.all).toBeUndefined();
      });

      it('editing two different edges keeps both — no cross-side clobber', () => {
        const { gui, onApply } = selectAndStyleGroup();
        clickEdge(gui, 'top');
        setWidth(gui, '3');
        clickEdge(gui, 'bottom');
        expect((style(gui).querySelector('[data-vg-field="borderWidth"] input') as HTMLInputElement).value).toBe('');
        setWidth(gui, '1');
        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const trade = applied(onApply);
        expect(trade.headerStyle.border.top).toEqual({ width: 3 });
        expect(trade.headerStyle.border.bottom).toEqual({ width: 1 });
      });

      it('setting a side width back to 0 prunes the side away (and empties border)', () => {
        const { gui, onApply } = selectAndStyleGroup();
        clickEdge(gui, 'left');
        setWidth(gui, '4');
        setWidth(gui, '0');
        (gui.querySelector('[data-vg-apply]') as HTMLButtonElement).click();
        const trade = applied(onApply);
        expect(trade.headerStyle?.border).toBeUndefined();
      });
    });

    describe('pruneBorder (pure)', () => {
      it('returns undefined for nullish/empty specs', () => {
        expect(pruneBorder(undefined)).toBeUndefined();
        expect(pruneBorder({})).toBeUndefined();
        expect(pruneBorder({ all: {}, top: { width: 0 } })).toBeUndefined();
      });
      it('drops non-positive widths but keeps other facets, and drops all-empty sides', () => {
        expect(pruneBorder({ top: { width: 2 }, bottom: {} })).toEqual({ top: { width: 2 } });
        expect(pruneBorder({ top: { width: 0, style: 'dashed' } })).toEqual({ top: { style: 'dashed' } });
        expect(pruneBorder({ right: { width: 1, color: 'rgb(1, 2, 3)', style: 'solid' } }))
          .toEqual({ right: { width: 1, color: 'rgb(1, 2, 3)', style: 'solid' } });
      });
    });

    it('switching selection to a different group retargets the editor Style band', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn()));
      const gui = panel.getGui();
      (gui.querySelector('[data-vg-add-group]') as HTMLButtonElement).click();
      const groupIds = Array.from(gui.querySelectorAll('[data-kind="group"]')).map((n) => n.getAttribute('data-vg-node'));
      expect(groupIds.length).toBe(2);
      const [firstId, secondId] = groupIds as [string, string];

      (gui.querySelector(`[data-vg-node="${firstId}"] [data-vg-select]`) as HTMLElement).click();
      expect(styleIn(gui)!.getAttribute('data-for')).toBe(firstId);

      (gui.querySelector(`[data-vg-node="${secondId}"] [data-vg-select]`) as HTMLElement).click();
      expect(styleIn(gui)!.getAttribute('data-for')).toBe(secondId);
      expect((gui.querySelector(`[data-vg-node="${firstId}"]`) as HTMLElement).hasAttribute('data-selected')).toBe(false);
    });
  });
});
