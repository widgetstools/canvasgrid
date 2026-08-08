import { describe, it, expect, vi } from 'vitest';
import { columnSettingsModule } from '../src/modules/columnSettings';
import type { VelocityGridExtContext } from '../src/extension/types';

function makeCtx(colDefs: Array<Record<string, unknown>> = [
  { colId: 'a', headerName: 'Alpha', sortable: true },
  { colId: 'b', headerName: 'Beta', sortable: false },
]) {
  const state = colDefs.map((d) => ({
    colId: String(d.colId),
    pinned: null as 'left' | 'right' | null,
    hide: false,
  }));
  const valueCols: Array<{ colId: string; aggFunc: string }> = [];
  const templates: Array<{ id: string; overrides?: Record<string, unknown> }> = [];
  const overrides: Array<Record<string, unknown>> = [];
  const edits: Array<{ colId: string; patch: Record<string, unknown> }> = [];

  const grid = {
    getGridOption: (k: string) => (k === 'columnDefs' ? colDefs : undefined),
    getColumnHeaderName: (id: string) => {
      const ov = overrides.find((o) => o.colId === id);
      if (typeof ov?.headerName === 'string') return ov.headerName;
      return colDefs.find((c) => c.colId === id)?.headerName as string;
    },
    getColumnState: () => state,
    getValueColumns: () => valueCols,
    getTemplates: () => templates,
    editColumn: (colId: string, patch: Record<string, unknown>) => {
      edits.push({ colId, patch });
      // Mirror real CalcEngine.editColumn — headerName is NOT templated.
      const { headerName: _drop, ...rest } = patch;
      Object.assign(colDefs.find((c) => c.colId === colId) ?? {}, rest);
      if ('hide' in rest) {
        const st = state.find((s) => s.colId === colId);
        if (st) st.hide = !!rest.hide;
      }
    },
    setColumnsPinned: (ids: string[], pinned: 'left' | 'right' | null) => {
      for (const id of ids) {
        const st = state.find((s) => s.colId === id);
        if (st) st.pinned = pinned;
      }
    },
    addValueColumn: (colId: string, aggFunc: string) => { valueCols.push({ colId, aggFunc }); },
    removeValueColumn: (colId: string) => {
      const i = valueCols.findIndex((v) => v.colId === colId);
      if (i >= 0) valueCols.splice(i, 1);
    },
    setValueColumnAggFunc: (colId: string, aggFunc: string) => {
      const v = valueCols.find((x) => x.colId === colId);
      if (v) v.aggFunc = aggFunc;
    },
    __calcBridgeWired: {
      calc: {
        getOverrides: () => overrides.map((o) => ({ ...o })),
        applyOverrides: (next: Array<Record<string, unknown>>) => {
          for (const o of next) {
            const i = overrides.findIndex((x) => x.colId === o.colId);
            if (i >= 0) overrides[i] = { ...o };
            else overrides.push({ ...o });
            const def = colDefs.find((c) => c.colId === o.colId);
            if (def && typeof o.headerName === 'string') def.headerName = o.headerName;
          }
        },
      },
    },
  };

  const markDirty = vi.fn();
  const ctx = {
    grid,
    profiles: { markDirty, isDirty: () => false, onDirtyChange: () => () => {} },
  } as unknown as VelocityGridExtContext;

  return { ctx, edits, markDirty, state, overrides };
}

describe('columnSettingsModule', () => {
  it('edits stay in draft until Save, Reset restores, Save applies + marks dirty', () => {
    const { ctx, edits, markDirty } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init();
    const inst = mod.mount(host, ctx);

    expect(host.querySelector('.ckp')).toBeTruthy();
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Alpha');

    // Toggle sortable — draft only.
    const switches = [...host.querySelectorAll<HTMLButtonElement>('.ckp-switch')];
    const sortable = switches.find((s) => s.closest('.ckp-row')?.textContent?.includes('Sortable'));
    expect(sortable).toBeTruthy();
    const before = edits.length;
    sortable!.click();
    expect(edits.length).toBe(before); // not applied yet
    expect(markDirty).not.toHaveBeenCalled();

    const save = [...host.querySelectorAll<HTMLButtonElement>('.ckp-actbtn')]
      .find((b) => b.textContent?.includes('Save'))!;
    expect(save.disabled).toBe(false);
    save.click();
    expect(edits.some((e) => e.colId === 'a' && 'sortable' in e.patch)).toBe(true);
    expect(markDirty).toHaveBeenCalled();

    // Dirty again then Reset.
    const sortable2 = [...host.querySelectorAll<HTMLButtonElement>('.ckp-switch')]
      .find((s) => s.closest('.ckp-row')?.textContent?.includes('Sortable'))!;
    sortable2.click();
    const reset = [...host.querySelectorAll<HTMLButtonElement>('.ckp-actbtn')]
      .find((b) => b.textContent?.includes('Reset'))!;
    reset.click();
    const save2 = [...host.querySelectorAll<HTMLButtonElement>('.ckp-actbtn')]
      .find((b) => b.textContent?.includes('Save'))!;
    expect(save2.disabled).toBe(true);

    inst.destroy();
  });

  it('lists columns in the rail and switches selection', () => {
    const { ctx } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init();
    mod.mount(host, ctx);
    const rows = [...host.querySelectorAll('.ckp-rail-row')];
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    rows[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Beta');
  });

  it('edits caption in draft and applies headerName on Save', () => {
    const { ctx, markDirty, overrides } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init();
    mod.mount(host, ctx);

    const caption = host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!;
    expect(caption.value).toBe('Alpha');
    caption.value = 'Alpha Renamed';
    caption.dispatchEvent(new Event('input', { bubbles: true }));

    const title = host.querySelector<HTMLInputElement>('.ckp-title')!;
    expect(title.value).toBe('Alpha Renamed');

    const save = [...host.querySelectorAll<HTMLButtonElement>('.ckp-actbtn')]
      .find((b) => b.textContent?.includes('Save'))!;
    expect(save.disabled).toBe(false);
    save.click();
    expect(overrides.some((o) => o.colId === 'a' && o.headerName === 'Alpha Renamed')).toBe(true);
    expect(markDirty).toHaveBeenCalled();
    expect(host.querySelector('.ckp-rail-row.active')!.textContent).toContain('Alpha Renamed');
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Alpha Renamed');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!.value).toBe('Alpha Renamed');
  });
});
