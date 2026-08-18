import { describe, it, expect, vi } from 'vitest';
import { columnSettingsModule } from '../src/modules/columnSettings';
import type { VelocityGridExtContext } from '../src/extension/types';
import { createEngineSlots } from '../src/extension/engines';

/** `wireCalc: false` mounts the pane with NO calc engine wired — the D-F8
 *  case where the caption half of Save cannot land. */
function makeCtx(colDefs: Array<Record<string, unknown>> = [
  { colId: 'a', headerName: 'Alpha', sortable: true },
  { colId: 'b', headerName: 'Beta', sortable: false },
], opts: { wireCalc?: boolean } = {}) {
  const wireCalc = opts.wireCalc !== false;
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
    getColumnDefsSnapshot: () => colDefs.map((d) => ({ ...d })),
    updateGridOptions: (partial: { columnDefs?: unknown[] }) => {
      if (!partial.columnDefs) return;
      colDefs.splice(0, colDefs.length, ...partial.columnDefs as Array<Record<string, unknown>>);
    },
    // The real marker the calc bridge attaches. `createEngineSlots` probes it
    // at CALL time, so the pane resolves the engine through `ctx.engines`
    // exactly the way it does against a live grid.
    __calcBridgeWired: !wireCalc ? undefined : {
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
    engines: createEngineSlots(grid),
  } as unknown as VelocityGridExtContext;

  return { ctx, edits, markDirty, state, overrides };
}

describe('columnSettingsModule', () => {
  it('edits stay in draft until commit; Reset restores', () => {
    const { ctx, edits, markDirty } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    expect(host.querySelector('.ckp')).toBeTruthy();
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Alpha');

    // Toggle sortable — draft only.
    const switches = Array.from(host.querySelectorAll<HTMLButtonElement>('.ckp-switch'));
    const sortable = switches.find((s) => s.closest('.ckp-row')?.textContent?.includes('Sortable'));
    expect(sortable).toBeTruthy();
    const before = edits.length;
    sortable!.click();
    expect(edits.length).toBe(before); // not applied yet
    expect(markDirty).not.toHaveBeenCalled();

    inst.commit?.();
    expect(edits.some((e) => e.colId === 'a' && 'sortable' in e.patch)).toBe(true);
    expect(markDirty).toHaveBeenCalled();

    // Dirty again then Reset.
    const sortable2 = Array.from(host.querySelectorAll<HTMLButtonElement>('.ckp-switch'))
      .find((s) => s.closest('.ckp-row')?.textContent?.includes('Sortable'))!;
    sortable2.click();
    const reset = Array.from(host.querySelectorAll<HTMLButtonElement>('.ckp-actbtn'))
      .find((b) => b.textContent?.includes('Reset'))!;
    reset.click();
    const afterReset = edits.length;
    inst.commit?.();
    expect(edits.length).toBe(afterReset);

    inst.destroy();
  });

  it('lists columns in the rail and switches selection', () => {
    const { ctx } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    mod.mount(host, ctx);
    const rows = Array.from(host.querySelectorAll('.ckp-rail-row'));
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    rows[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Beta');
  });

  it('edits caption in draft and applies headerName on commit', () => {
    const { ctx, markDirty, overrides } = makeCtx();
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    const caption = host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!;
    expect(caption.value).toBe('Alpha');
    caption.value = 'Alpha Renamed';
    caption.dispatchEvent(new Event('input', { bubbles: true }));

    const title = host.querySelector<HTMLInputElement>('.ckp-title')!;
    expect(title.value).toBe('Alpha Renamed');

    inst.commit?.();
    expect(overrides.some((o) => o.colId === 'a' && o.headerName === 'Alpha Renamed')).toBe(true);
    expect(markDirty).toHaveBeenCalled();
    expect(host.querySelector('.ckp-rail-row.active')!.textContent).toContain('Alpha Renamed');
    expect((host.querySelector('.ckp-title') as HTMLInputElement).value).toBe('Alpha Renamed');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!.value).toBe('Alpha Renamed');
  });

  it('persists a valueGetter expression through getColumnDefsSnapshot / updateGridOptions', () => {
    const colDefs: Array<Record<string, unknown>> = [
      { colId: 'spread', headerName: 'Spread', field: 'spread' },
    ];
    const { ctx } = makeCtx(colDefs);
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    const ta = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Value getter expression"]')!;
    expect(ta).toBeTruthy();
    ta.value = '[ask] - [bid]';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    inst.commit?.();

    expect(colDefs[0]!.valueGetter).toBe('[ask] - [bid]');
    inst.destroy();
  });
});

/**
 * D-F8 — with NO calc engine wired, a caption Save used to LOOK like it
 * worked: `applyCaption` returned early, but Save still marked the profile
 * dirty, rewrote `committed.headerName` to the typed value and re-rendered
 * the editor showing it. The grid header never changed and nothing said so.
 */
describe('columnSettingsModule — calc engine missing (D-F8)', () => {
  it('surfaces a visible notice instead of silently succeeding on a caption Save', () => {
    const { ctx, overrides } = makeCtx(undefined, { wireCalc: false });
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    // Nothing is claimed before the user tries.
    expect(host.querySelector('.ckp-notice')).toBeNull();

    const caption = host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!;
    caption.value = 'Alpha Renamed';
    caption.dispatchEvent(new Event('input', { bubbles: true }));
    inst.commit?.();

    // The caption genuinely did not land...
    expect(overrides).toHaveLength(0);
    // ...and the pane says so, through the shared engine-missing surface.
    const notice = host.querySelector('.ckp-notice');
    expect(notice).toBeTruthy();
    expect(notice!.getAttribute('data-engine')).toBe('calc');
    expect(notice!.textContent).toContain('Calc engine not wired');

    // The editor still shows the caption the user typed (it is unsaved, not
    // discarded) rather than pretending it was committed.
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!.value)
      .toBe('Alpha Renamed');
    expect(host.querySelector('.ckp-rail-row.active')!.textContent).not.toContain('Alpha Renamed');
    inst.destroy();
  });

  it('still applies the flags half of the draft — only the caption needs calc', () => {
    const { ctx, edits } = makeCtx(undefined, { wireCalc: false });
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    const switches = Array.from(host.querySelectorAll<HTMLButtonElement>('.ckp-switch'));
    const sortable = switches.find((s) => s.closest('.ckp-row')?.textContent?.includes('Sortable'))!;
    sortable.click();
    inst.commit?.();

    expect(edits.some((e) => e.colId === 'a' && 'sortable' in e.patch)).toBe(true);
    // No caption change was attempted, so no notice.
    expect(host.querySelector('.ckp-notice')).toBeNull();
    inst.destroy();
  });

  it('picks up a calc engine wired AFTER mount (late registration)', () => {
    const { ctx, overrides } = makeCtx(undefined, { wireCalc: false });
    const host = document.createElement('div');
    const mod = columnSettingsModule();
    mod.init(ctx);
    const inst = mod.mount(host, ctx);

    // The host wires calc only now — the normal order for
    // `wireEditIntoKernel(ext.grid)`-style wiring. A context that snapshotted
    // its engines at creation would never see this.
    ctx.engines.register('calc', {
      getOverrides: () => overrides.map((o) => ({ ...o })),
      applyOverrides: (next: Array<Record<string, unknown>>) => {
        for (const o of next) overrides.push({ ...o });
      },
    } as never);

    const caption = host.querySelector<HTMLInputElement>('input[aria-label="Caption"]')!;
    caption.value = 'Alpha Renamed';
    caption.dispatchEvent(new Event('input', { bubbles: true }));
    inst.commit?.();

    expect(overrides.some((o) => o.colId === 'a' && o.headerName === 'Alpha Renamed')).toBe(true);
    expect(host.querySelector('.ckp-notice')).toBeNull();
    inst.destroy();
  });
});
