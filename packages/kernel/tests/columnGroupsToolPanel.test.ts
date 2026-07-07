import { describe, it, expect, vi } from 'vitest';
import { ColumnGroupsToolPanel, pruneBorder } from '../src/interaction/toolPanels/columnGroupsPanel';
import type { ToolPanelParams } from '../src/interaction/toolPanels/types';
import type { CColDef, CColGroupDef } from '../src/types';

/** A minimal in-memory stand-in for CGrid's generic floating-panel API
 *  (`openFloatingPanel`/`closeFloatingPanel`/`isFloatingPanelOpen`). The
 *  panel's Style editor now renders into a FLOATING panel's body rather
 *  than inline in the panel's own `getGui()` tree, so tests reach the
 *  Style band via `float.body()` instead of querying `gui` directly.
 *  Mirrors the real `FloatingPanelHost`'s "every open() call returns a
 *  brand-new body element" behaviour (including on a reopen/retarget). */
function makeFloatStub() {
  let body: HTMLElement | null = null;
  let title = '';
  let open = false;
  let onClose: (() => void) | null = null;
  return {
    openFloatingPanel: vi.fn((opts: { title: string; onClose: () => void }) => {
      body = document.createElement('div');
      title = opts.title;
      onClose = opts.onClose;
      open = true;
      return body;
    }),
    closeFloatingPanel: vi.fn(() => {
      open = false;
      body = null;
    }),
    isFloatingPanelOpen: () => open,
    /** In-place titlebar update (mirrors the real host's `setTitle`): a no-op
     *  when closed, otherwise overwrites the current title without reopening. */
    setFloatingPanelTitle: vi.fn((t: string) => {
      if (open) title = t;
    }),
    /** The current float body, or `null` when closed. */
    body: () => body,
    /** The float's current title, or `''` when never opened. */
    title: () => title,
    isOpen: () => open,
    /** Simulates the float's own Close (×) button — invokes the cached
     *  `onClose` callback WITHOUT itself closing (mirrors the real host:
     *  clicking Close only fires the callback; the caller decides
     *  whether/when to actually tear the frame down). */
    triggerClose: () => onClose?.(),
  };
}
type FloatStub = ReturnType<typeof makeFloatStub>;

function makeParams(onApply: ReturnType<typeof vi.fn>, float: FloatStub = makeFloatStub()) {
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
      openFloatingPanel: float.openFloatingPanel,
      closeFloatingPanel: float.closeFloatingPanel,
      isFloatingPanelOpen: float.isFloatingPanelOpen,
      setFloatingPanelTitle: float.setFloatingPanelTitle,
    },
  } as unknown as ToolPanelParams;
}

/** Top level interleaves group / column / group — the shape that used to
 *  mislabel the second group under a stale "Ungrouped" eyebrow (Fix 2). */
function makeInterleavedParams(onApply: ReturnType<typeof vi.fn>, float: FloatStub = makeFloatStub()) {
  const defs: (CColDef | CColGroupDef)[] = [
    { groupId: 'groupA', headerName: 'Group A', children: [{ colId: 'a1', field: 'a1' }] },
    { colId: 'mid', field: 'mid', headerName: 'Mid' },
    { groupId: 'groupB', headerName: 'Group B', children: [{ colId: 'b1', field: 'b1' }] },
  ];
  return {
    api: {
      getColumnGroupDefs: () => defs,
      updateGridOptions: onApply,
      openFloatingPanel: float.openFloatingPanel,
      closeFloatingPanel: float.closeFloatingPanel,
      isFloatingPanelOpen: float.isFloatingPanelOpen,
      setFloatingPanelTitle: float.setFloatingPanelTitle,
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
      const seg = gui.querySelector('[data-cg-node="bid"] [data-cg-groupshow]') as HTMLElement;
      // 3-state segment: ● Always (default pressed) · ◐ Open · ○ Closed.
      expect(seg.querySelector('[data-value=""]')!.getAttribute('aria-pressed')).toBe('true');

      (seg.querySelector('[data-value="open"]') as HTMLButtonElement).click();

      const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();

      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      const bid = trade.children.find((c: { colId?: string }) => c.colId === 'bid');
      expect(bid.columnGroupShow).toBe('open');
    });
  });

  describe('Depth-0 eyebrow runs (Fix 2)', () => {
    it('labels each contiguous top-level run, not just the first-seen kind', () => {
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeInterleavedParams(vi.fn()));
      const gui = panel.getGui();

      // Walk the tree in DOM order and record eyebrows + the node kind of
      // the very next `[data-cg-node]` row, so we can assert each eyebrow
      // immediately precedes a run of the kind it names.
      const children = Array.from(gui.querySelector('.cg-colgroups-tree')!.children);
      const seen: Array<{ text: string; nextKind: string | null }> = [];
      children.forEach((node, i) => {
        if (node.classList.contains('cg-colgroups-eyebrow')) {
          const next = children.slice(i + 1).find((c) => c.hasAttribute('data-cg-node'));
          seen.push({ text: node.textContent ?? '', nextKind: next?.getAttribute('data-kind') ?? null });
        }
      });

      expect(seen.map((s) => s.text)).toEqual(['Groups', 'Ungrouped', 'Groups']);
      seen.forEach((s) => {
        const expectedKind = s.text === 'Ungrouped' ? 'column' : 'group';
        expect(s.nextKind).toBe(expectedKind);
      });

      // groupB (the second, previously-mislabeled group) is a real group.
      expect(gui.querySelector('[data-cg-node="groupB"]')!.getAttribute('data-kind')).toBe('group');
    });
  });

  describe('Style band (floating panel)', () => {
    // Note: the group-select control is a real <button> (see the
    // keyboard-accessibility test below); the switch fields it exposes are
    // `.cg-settings-toggle` buttons (aria-pressed), not <input> checkboxes
    // — verified against `settingsForm/form.ts` before writing these.
    //
    // The Style editor now renders into a FLOATING panel body
    // (`this.api.openFloatingPanel`), not inline in the panel's own
    // `getGui()` tree — it has nowhere to dock back to. Tests reach it via
    // `float.body()` (see `makeFloatStub` above) instead of querying `gui`
    // for `[data-cg-style]` directly.

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

    it('selecting a group opens the Style float titled for that group, bound to it, and marks the row [data-selected]', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();

      expect(float.isOpen()).toBe(true);
      expect(float.title()).toBe('Style — Trade');
      const style = float.body()!.querySelector('[data-cg-style]')!;
      expect(style.getAttribute('data-for')).toBe('trade');
      expect((gui.querySelector('[data-cg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(true);

      // Toggling marryChildren dirties the model (routes through mutate()/
      // setGroupStyle, same as any other panel edit — Apply-only discipline).
      const marry = style.querySelector('[data-cg-field="marryChildren"] .cg-settings-toggle') as HTMLButtonElement;
      expect(marry.getAttribute('aria-pressed')).toBe('false');
      marry.click();
      const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      // Same group, still open — the float was NOT reopened for this edit.
      expect(float.openFloatingPanel).toHaveBeenCalledTimes(1);
    });

    it('clicking the select button again deselects and closes the Style float', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();
      const select = () => gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement;
      select().click();
      expect(float.isOpen()).toBe(true);
      expect(float.body()!.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe('trade');

      select().click();
      expect(float.closeFloatingPanel).toHaveBeenCalledTimes(1);
      expect(float.isOpen()).toBe(false);
      expect((gui.querySelector('[data-cg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(false);
    });

    it('the float\'s own Close callback deselects the group and tears down the float (no re-open loop)', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
      expect(float.isOpen()).toBe(true);

      // Simulates the user clicking the float's own Close (×) button.
      float.triggerClose();
      expect(float.closeFloatingPanel).toHaveBeenCalledTimes(1);
      expect(float.isOpen()).toBe(false);
      expect((gui.querySelector('[data-cg-node="trade"]') as HTMLElement).hasAttribute('data-selected')).toBe(false);
      // No runaway reopen loop.
      expect(float.openFloatingPanel).toHaveBeenCalledTimes(1);
    });

    it('Apply projects the styled group headerStyle/marryChildren/openByDefault into columnDefs', () => {
      const onApply = vi.fn();
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(onApply, float));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
      let style = float.body()!.querySelector('[data-cg-style]')!;

      (style.querySelector('[data-cg-field="marryChildren"] .cg-settings-toggle') as HTMLButtonElement).click();
      // The Style band is rebuilt on every mutation — re-query it (same
      // float body, since selection didn't change).
      style = float.body()!.querySelector('[data-cg-style]')!;
      (style.querySelector('[data-cg-field="openByDefault"] .cg-settings-toggle') as HTMLButtonElement).click();
      style = float.body()!.querySelector('[data-cg-style]')!;
      // Bold is now a segment toggle button carrying data-cg-field directly.
      (style.querySelector('[data-cg-field="fontWeight"]') as HTMLButtonElement).click();

      (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
      expect(onApply).toHaveBeenCalledTimes(1);
      const { columnDefs } = onApply.mock.calls[0][0];
      const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      expect(trade.marryChildren).toBe(true);
      expect(trade.openByDefault).toBe(true);
      expect(trade.headerStyle.fontWeight).toBe('bold');
    });

    it('the Style band holds ONLY styling clusters (fill/text, border, behavior) — no children-visibility list', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();

      const style = float.body()!.querySelector('[data-cg-style]')!;
      // The per-column columnGroupShow mirror was removed from the popout;
      // that control lives only on the inline tree rows now.
      expect(style.querySelector('[data-cg-child-show]')).toBeNull();
      // The styling clusters are still there.
      expect(style.querySelector('[data-cg-field="bg"]')).toBeTruthy();
      expect(style.querySelector('[data-cg-field="borderWidth"]')).toBeTruthy();
      // The inline per-row control is untouched.
      expect(gui.querySelector('[data-cg-node="bid"] [data-cg-groupshow]')).toBeTruthy();
    });

    // Task 9 — StarUI parity: italic/underline/fontSize/alignment/border.
    describe('Task 9 — enriched Style band', () => {
      it('exposes Italic/Underline/FontSize/Alignment/Border fields', () => {
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(vi.fn(), float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = float.body()!.querySelector('[data-cg-style]')!;
        for (const key of [
          'fontStyle', 'textDecoration', 'fontSize', 'halign',
          'borderWidth', 'borderStyle', 'borderColor',
        ]) {
          expect(style.querySelector(`[data-cg-field="${key}"]`)).toBeTruthy();
        }
      });

      it('toggling Italic sets headerStyle.fontStyle without wiping a previously-set Background/Bold (merge correctness)', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = float.body()!.querySelector('[data-cg-style]')!;

        // Set Background first via the colour-picker control: click the
        // swatch to open the portaled popover, type a hex value, commit.
        const bgSwatch = style.querySelector('[data-cg-field="bg"] .cg-colorpicker-swatch') as HTMLButtonElement;
        bgSwatch.click();
        const bgHex = document.querySelector('.cg-colorpicker-popover .cg-colorpicker-hex') as HTMLInputElement;
        bgHex.value = '#112233';
        bgHex.dispatchEvent(new Event('change'));
        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());

        // Bold next (existing Task 4 field) — then Italic (new). Both are
        // segment toggle buttons carrying data-cg-field directly.
        style = float.body()!.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="fontWeight"]') as HTMLButtonElement).click();
        style = float.body()!.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="fontStyle"]') as HTMLButtonElement).click();

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fontStyle).toBe('italic');
        expect(trade.headerStyle.fontWeight).toBe('bold'); // not wiped
        expect(trade.headerStyle.bg).toBe('rgb(17, 34, 51)'); // not wiped
      });

      it('toggling Underline sets headerStyle.textDecoration', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = float.body()!.querySelector('[data-cg-style]')!;
        (style.querySelector('[data-cg-field="textDecoration"]') as HTMLButtonElement).click();
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.textDecoration).toBe('underline');
      });

      it('setting Font size and Alignment writes headerStyle.fontSize/halign', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = float.body()!.querySelector('[data-cg-style]')!;

        const sizeInput = style.querySelector('[data-cg-field="fontSize"] input') as HTMLInputElement;
        sizeInput.value = '14';
        sizeInput.dispatchEvent(new Event('change'));

        style = float.body()!.querySelector('[data-cg-style]')!;
        // Alignment is now an icon segmented control (left/center/right).
        (style.querySelector('[data-cg-field="halign"] [data-align="center"]') as HTMLButtonElement).click();

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fontSize).toBe(14);
        expect(trade.headerStyle.halign).toBe('center');
      });

      it('setting Border width/style/colour composes a single headerStyle.border.all object', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = float.body()!.querySelector('[data-cg-style]')!;

        const widthInput = style.querySelector('[data-cg-field="borderWidth"] input') as HTMLInputElement;
        widthInput.value = '2';
        widthInput.dispatchEvent(new Event('change'));

        style = float.body()!.querySelector('[data-cg-style]')!;
        const styleSelect = style.querySelector('[data-cg-field="borderStyle"] select') as HTMLSelectElement;
        styleSelect.value = 'dashed';
        styleSelect.dispatchEvent(new Event('change'));

        style = float.body()!.querySelector('[data-cg-style]')!;
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

    describe('Fix 3 — colour commits do not tear down the Style band mid-drag', () => {
      it('a Fill colour commit flips dirty and writes headerStyle.bg WITHOUT rebuilding the Style band', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = float.body()!.querySelector('[data-cg-style]')!;

        const bgSwatch = style.querySelector('[data-cg-field="bg"] .cg-colorpicker-swatch') as HTMLButtonElement;
        bgSwatch.click();
        const popover = document.querySelector('.cg-colorpicker-popover') as HTMLElement;
        const bgHex = popover.querySelector('.cg-colorpicker-hex') as HTMLInputElement;
        bgHex.value = '#112233';
        bgHex.dispatchEvent(new Event('change')); // simulates a drag emitting onChange

        // The Style band must NOT have been rebuilt: the swatch queried
        // fresh from the (unchanged) style-section element is the exact
        // same DOM node as before the commit, and the still-open popover
        // survives (a `renderStyle()` rebuild would have torn both down).
        // The float itself must not have been reopened either.
        expect(style.querySelector('[data-cg-field="bg"] .cg-colorpicker-swatch')).toBe(bgSwatch);
        expect(document.body.contains(popover)).toBe(true);
        expect(document.querySelector('.cg-colorpicker-popover')).toBe(popover);
        expect(float.openFloatingPanel).toHaveBeenCalledTimes(1);

        const apply = gui.querySelector('[data-cg-apply]') as HTMLButtonElement;
        expect(apply.disabled).toBe(false);
        apply.click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.bg).toBe('rgb(17, 34, 51)');

        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());
      });

      it('a Text colour commit writes headerStyle.fg without throwing', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = float.body()!.querySelector('[data-cg-style]')!;

        const fgSwatch = style.querySelector('[data-cg-field="fg"] .cg-colorpicker-swatch') as HTMLButtonElement;
        fgSwatch.click();
        const fgHex = document.querySelector('.cg-colorpicker-popover .cg-colorpicker-hex') as HTMLInputElement;
        fgHex.value = '#00ff00';
        expect(() => fgHex.dispatchEvent(new Event('change'))).not.toThrow();
        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());

        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.fg).toBe('rgb(0, 255, 0)');
      });

      it('a Border colour commit writes headerStyle.border.<edge>.color and does not rebuild the Style band', () => {
        const onApply = vi.fn();
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        let style = float.body()!.querySelector('[data-cg-style]')!;
        // Select the "top" edge before writing its colour.
        (style.querySelector('[data-cg-border-edge="top"]') as HTMLButtonElement).click();
        style = float.body()!.querySelector('[data-cg-style]')!; // edge-select IS a structural render

        const borderSwatch = style.querySelector('[data-cg-field="borderColor"] .cg-colorpicker-swatch') as HTMLButtonElement;
        borderSwatch.click();
        const popover = document.querySelector('.cg-colorpicker-popover') as HTMLElement;
        const hex = popover.querySelector('.cg-colorpicker-hex') as HTMLInputElement;
        hex.value = '#abcdef';
        hex.dispatchEvent(new Event('change'));

        expect(style.querySelector('[data-cg-field="borderColor"] .cg-colorpicker-swatch')).toBe(borderSwatch);
        expect(document.body.contains(popover)).toBe(true);

        document.querySelectorAll('.cg-colorpicker-popover').forEach((p) => p.remove());
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const { columnDefs } = onApply.mock.calls[0][0];
        const trade = columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
        expect(trade.headerStyle.border.top.color).toBe('rgb(171, 205, 239)');
      });
    });

    describe('Fix 4 — distinct colour-swatch aria-labels', () => {
      it('gives the Fill/Text/Border swatches distinct aria-labels instead of the generic default', () => {
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(vi.fn(), float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        const style = float.body()!.querySelector('[data-cg-style]')!;

        const bg = style.querySelector('[data-cg-field="bg"] .cg-colorpicker-swatch')!;
        const fg = style.querySelector('[data-cg-field="fg"] .cg-colorpicker-swatch')!;
        const border = style.querySelector('[data-cg-field="borderColor"] .cg-colorpicker-swatch')!;

        expect(bg.getAttribute('aria-label')).toBe('Background colour');
        expect(fg.getAttribute('aria-label')).toBe('Text colour');
        expect(border.getAttribute('aria-label')).toMatch(/border colour$/i);
        // No two swatches share the generic default anymore.
        expect(new Set([bg, fg, border].map((s) => s.getAttribute('aria-label'))).size).toBe(3);
      });
    });

    // Task 12 — the box-model border editor. Clicking an edge target selects
    // it; the width/style/colour controls then read & write that one side.
    describe('Task 12 — box-model border editor', () => {
      function selectAndStyleGroup(onApply = vi.fn()) {
        const float = makeFloatStub();
        const panel = new ColumnGroupsToolPanel();
        panel.init(makeParams(onApply, float));
        const gui = panel.getGui();
        (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
        return { gui, onApply, float };
      }
      const style = (float: FloatStub) => float.body()!.querySelector('[data-cg-style]')!;
      const setWidth = (float: FloatStub, v: string) => {
        const w = style(float).querySelector('[data-cg-field="borderWidth"] input') as HTMLInputElement;
        w.value = v;
        w.dispatchEvent(new Event('change'));
      };
      const setStyle = (float: FloatStub, v: string) => {
        const s = style(float).querySelector('[data-cg-field="borderStyle"] select') as HTMLSelectElement;
        s.value = v;
        s.dispatchEvent(new Event('change'));
      };
      const clickEdge = (float: FloatStub, edge: string) =>
        (style(float).querySelector(`[data-cg-border-edge="${edge}"]`) as HTMLButtonElement).click();
      const applied = (onApply: ReturnType<typeof vi.fn>) => {
        const { columnDefs } = onApply.mock.calls[0][0];
        return columnDefs.find((d: { groupId?: string }) => d.groupId === 'trade');
      };

      it('defaults to the "all" edge (its target is pressed on open)', () => {
        const { float } = selectAndStyleGroup();
        expect(style(float).querySelector('[data-cg-border]')).toBeTruthy();
        expect(style(float).querySelector('[data-cg-border-edge="all"]')!.getAttribute('aria-pressed')).toBe('true');
        expect(style(float).querySelector('[data-cg-border-edge="top"]')!.getAttribute('aria-pressed')).toBe('false');
      });

      it('selecting the top edge then setting width/style writes headerStyle.border.top (not .all)', () => {
        const { gui, onApply, float } = selectAndStyleGroup();
        clickEdge(float, 'top');
        expect(style(float).querySelector('[data-cg-border-edge="top"]')!.getAttribute('aria-pressed')).toBe('true');
        setWidth(float, '3');
        setStyle(float, 'dotted');
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const trade = applied(onApply);
        expect(trade.headerStyle.border.top).toEqual({ width: 3, style: 'dotted' });
        expect(trade.headerStyle.border.all).toBeUndefined();
      });

      it('editing two different edges keeps both — no cross-side clobber', () => {
        const { gui, onApply, float } = selectAndStyleGroup();
        clickEdge(float, 'top');
        setWidth(float, '3');
        clickEdge(float, 'bottom');
        // Selecting a different edge reads THAT edge (empty) — the width
        // input must not still show the top edge's value.
        expect((style(float).querySelector('[data-cg-field="borderWidth"] input') as HTMLInputElement).value).toBe('');
        setWidth(float, '1');
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
        const trade = applied(onApply);
        expect(trade.headerStyle.border.top).toEqual({ width: 3 });
        expect(trade.headerStyle.border.bottom).toEqual({ width: 1 });
      });

      it('setting a side width back to 0 prunes the side away (and empties border)', () => {
        const { gui, onApply, float } = selectAndStyleGroup();
        clickEdge(float, 'left');
        setWidth(float, '4');
        setWidth(float, '0');
        (gui.querySelector('[data-cg-apply]') as HTMLButtonElement).click();
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

    it('switching selection to a different group retargets the float (reopens with the new title/content)', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();
      (gui.querySelector('[data-cg-add-group]') as HTMLButtonElement).click(); // creates a second group
      const groupIds = Array.from(gui.querySelectorAll('[data-kind="group"]')).map((n) => n.getAttribute('data-cg-node'));
      expect(groupIds.length).toBe(2);
      const [firstId, secondId] = groupIds as [string, string];

      (gui.querySelector(`[data-cg-node="${firstId}"] [data-cg-select]`) as HTMLElement).click();
      expect(float.body()!.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe(firstId);
      const firstBody = float.body();

      (gui.querySelector(`[data-cg-node="${secondId}"] [data-cg-select]`) as HTMLElement).click();
      // Retargeting to a different group reopens the float (new body, per
      // `FloatingPanelHost.open()` semantics) rather than reusing the old one.
      expect(float.openFloatingPanel).toHaveBeenCalledTimes(2);
      expect(float.body()).not.toBe(firstBody);
      expect(float.body()!.querySelector('[data-cg-style]')!.getAttribute('data-for')).toBe(secondId);
      expect((gui.querySelector(`[data-cg-node="${firstId}"]`) as HTMLElement).hasAttribute('data-selected')).toBe(false);
    });

    it('renaming the currently-floated group refreshes the titlebar in place (no reopen)', () => {
      const float = makeFloatStub();
      const panel = new ColumnGroupsToolPanel();
      panel.init(makeParams(vi.fn(), float));
      const gui = panel.getGui();

      (gui.querySelector('[data-cg-node="trade"] [data-cg-select]') as HTMLElement).click();
      expect(float.title()).toBe('Style — Trade');
      expect(float.openFloatingPanel).toHaveBeenCalledTimes(1);

      const name = gui.querySelector('[data-cg-node="trade"] .cg-colgroups-name-group') as HTMLInputElement;
      name.value = 'Execution';
      name.dispatchEvent(new Event('change'));

      // Same group id, so NO reopen — the titlebar is updated in place.
      expect(float.openFloatingPanel).toHaveBeenCalledTimes(1);
      expect(float.setFloatingPanelTitle).toHaveBeenCalledWith('Style — Execution');
      expect(float.title()).toBe('Style — Execution');
    });
  });
});
